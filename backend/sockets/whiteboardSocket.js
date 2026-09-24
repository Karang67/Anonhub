/**
 * @file sockets/whiteboardSocket.js
 * @description Socket.IO handlers for real-time multiplayer Whiteboard collaboration.
 * Manages anonymous guest presence, differential change broadcasting,
 * live multi-user cursors, and throttled database snapshot persistence.
 */

const WhiteboardRoom = require('../models/WhiteboardRoom');
const { MAX_NAME_LEN, WHITEBOARD_MAX_PAYLOAD_BYTES } = require('../config/db');
const { log } = require('../utils/logger');

// In-memory snapshot cache for zero-latency tab switching and instant room joins
const latestRoomSnapshots = new Map();
const pendingSaves = new Map();
const lastDbSaveTime = new Map();

function scheduleSnapshotSave(roomName, snapshotStr) {
    latestRoomSnapshots.set(roomName, snapshotStr);
    pendingSaves.set(roomName, snapshotStr);

    const now = Date.now();
    const last = lastDbSaveTime.get(roomName) || 0;

    // Save immediately if more than 2 seconds passed, otherwise debounce
    if (now - last > 2000) {
        flushSnapshotSave(roomName);
    } else {
        if (!pendingSaves.has(`${roomName}_timer`)) {
            const timer = setTimeout(() => {
                pendingSaves.delete(`${roomName}_timer`);
                flushSnapshotSave(roomName);
            }, 2000);
            pendingSaves.set(`${roomName}_timer`, timer);
        }
    }
}

async function flushSnapshotSave(roomName) {
    const snapshotStr = pendingSaves.get(roomName);
    if (!snapshotStr) return;
    pendingSaves.delete(roomName);
    lastDbSaveTime.set(roomName, Date.now());

    try {
        await WhiteboardRoom.findOneAndUpdate(
            { name: roomName },
            { 
                snapshot: snapshotStr, 
                lastActivityAt: new Date(),
                storageUsed: Buffer.byteLength(snapshotStr, 'utf8')
            },
            { upsert: true }
        );
        log('debug', `[WHITEBOARD] Snapshot saved for room "${roomName}"`);
    } catch (err) {
        log('error', `[WHITEBOARD] Failed saving snapshot for room "${roomName}":`, err);
    }
}

// Vibrant curated colors for anonymous collaborators
const GUEST_COLORS = [
    '#E11D48', '#2563EB', '#059669', '#D97706', '#7C3AED', 
    '#DB2777', '#0284C7', '#0D9488', '#EA580C', '#4F46E5',
    '#10B981', '#F43F5E', '#8B5CF6', '#06B6D4', '#84CC16'
];

module.exports = function registerWhiteboardSocketHandlers(socket, io, activeUsers, checkSocketRateLimit, joinRoom) {
    
    // Helper to get room roster
    const getWhiteboardRoster = (roomName) => {
        const roster = [];
        for (const [id, userData] of activeUsers.entries()) {
            if (userData.rooms.has(roomName)) {
                roster.push({
                    id,
                    username: userData.username,
                    color: userData.color || '#2563EB',
                    isSelf: id === socket.id
                });
            }
        }
        return roster;
    };

    const broadcastWhiteboardUsers = (roomName) => {
        const roster = getWhiteboardRoster(roomName);
        io.to(roomName).emit('whiteboard-users', roster);
    };

    // ─── Join Whiteboard ──────────────────────────────────────────────────────
    socket.on('join whiteboard', async (data) => {
        let roomName = '';
        let clientUsername = '';
        let clientColor = '';

        if (typeof data === 'string') {
            roomName = data;
        } else if (data && typeof data === 'object') {
            roomName = String(data.roomName || data.name || '').trim().slice(0, MAX_NAME_LEN);
            clientUsername = String(data.username || '').trim().slice(0, 50);
            clientColor = String(data.color || '').trim().slice(0, 20);
        }

        if (!roomName) return;

        try {
            // Assign anonymous guest name if needed
            let userData = activeUsers.get(socket.id);
            if (!userData) {
                const randomNum = Math.floor(100 + Math.random() * 900);
                const guestName = clientUsername || `Guest-${randomNum}`;
                const guestColor = clientColor || GUEST_COLORS[Math.floor(Math.random() * GUEST_COLORS.length)];
                userData = { username: guestName, color: guestColor, rooms: new Set() };
                activeUsers.set(socket.id, userData);
            } else {
                if (clientUsername && (!userData.username || userData.username.startsWith('Guest-') || clientUsername !== userData.username)) {
                    userData.username = clientUsername;
                }
                if (!userData.color) {
                    userData.color = clientColor || GUEST_COLORS[Math.floor(Math.random() * GUEST_COLORS.length)];
                }
            }

            socket.join(roomName);
            userData.rooms.add(roomName);

            let currentSnapshot = latestRoomSnapshots.get(roomName);
            if (!currentSnapshot) {
                let roomDoc = await WhiteboardRoom.findOne({ name: roomName }).select('snapshot').lean();
                if (roomDoc && roomDoc.snapshot) {
                    currentSnapshot = roomDoc.snapshot;
                    latestRoomSnapshots.set(roomName, currentSnapshot);
                }
            }
            if (!currentSnapshot) currentSnapshot = '{}';

            // Send initial state to the joining user
            socket.emit('whiteboard-init', {
                roomName,
                snapshot: currentSnapshot,
                user: {
                    id: socket.id,
                    username: userData.username,
                    color: userData.color
                }
            });

            // Notify everyone in the room of updated roster
            broadcastWhiteboardUsers(roomName);

            log('info', `[WHITEBOARD] "${userData.username}" (${socket.id}) joined room "${roomName}"`);
        } catch (err) {
            log('error', `[WHITEBOARD] Error joining room "${roomName}":`, err);
            socket.emit('whiteboard-error', 'Failed to join whiteboard room.');
        }
    });

    // ─── Real-time Differential Changes ───────────────────────────────────────
    socket.on('whiteboard-changes', (data) => {
        if (!data || !data.roomName) return;
        if (!checkSocketRateLimit(socket.id, 'whiteboard-changes', 60, 5_000)) return;
        const roomName = String(data.roomName).trim().slice(0, MAX_NAME_LEN);
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(roomName)) return;

        // Broadcast changes immediately to all other peers in the room
        socket.to(roomName).emit('whiteboard-remote-changes', {
            changes: data.changes,
            senderId: socket.id
        });

        // If a full snapshot is provided, validate size and schedule throttled persistence
        if (data.snapshot) {
            const snapshotStr = typeof data.snapshot === 'string' ? data.snapshot : JSON.stringify(data.snapshot);
            if (Buffer.byteLength(snapshotStr, 'utf8') <= WHITEBOARD_MAX_PAYLOAD_BYTES) {
                scheduleSnapshotSave(roomName, snapshotStr);
            }
        }
    });

    // ─── Real-time Cursor & Presence ──────────────────────────────────────────
    socket.on('whiteboard-presence', (data) => {
        if (!data || !data.roomName) return;
        const roomName = String(data.roomName).trim().slice(0, MAX_NAME_LEN);
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(roomName)) return;

        // High speed broadcast to peers
        socket.to(roomName).emit('whiteboard-remote-presence', {
            userId: socket.id,
            username: userData.username,
            color: userData.color || '#2563EB',
            presence: data.presence
        });
    });

    // ─── Clear Canvas ─────────────────────────────────────────────────────────
    socket.on('whiteboard-clear', async (data) => {
        if (!data || !data.roomName) return;
        const roomName = String(data.roomName).trim().slice(0, MAX_NAME_LEN);
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(roomName)) return;

        latestRoomSnapshots.set(roomName, '{}');
        pendingSaves.set(roomName, '{}');
        try {
            await WhiteboardRoom.updateOne({ name: roomName }, { snapshot: '{}', lastActivityAt: new Date() });
        } catch (err) {}

        io.to(roomName).emit('whiteboard-cleared', { senderId: socket.id });
    });

    // ─── Leave / Disconnect Whiteboard ────────────────────────────────────────
    socket.on('leave whiteboard', (data) => {
        const roomName = typeof data === 'string' ? data : data?.roomName;
        if (!roomName) return;
        socket.leave(roomName);
        const userData = activeUsers.get(socket.id);
        if (userData) {
            userData.rooms.delete(roomName);
            broadcastWhiteboardUsers(roomName);
            socket.to(roomName).emit('whiteboard-user-left', { userId: socket.id });
        }
    });
};
