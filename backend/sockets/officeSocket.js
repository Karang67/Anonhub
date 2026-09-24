/**
 * @file sockets/officeSocket.js
 * @description Socket.IO handlers for Office Board events:
 * joining, spreadsheet, word, notes, kanban, and group chat.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const OfficeRoom = require('../models/OfficeRoom');
const { verifyAccessKey } = require('../middleware/auth');
const { MAX_NAME_LEN, MAX_KEY_LEN, MAX_MESSAGE_LEN, MIN_KEY_LEN, BCRYPT_ROUNDS } = require('../config/db');
const { log } = require('../utils/logger');

// ─── Throttled activity tracking (max 1 DB write per 30s per room) ────────────
const lastActivityUpdate = new Map();
function touchActivity(roomName) {
    const now = Date.now();
    const last = lastActivityUpdate.get(roomName) || 0;
    if (now - last > 30_000) {
        lastActivityUpdate.set(roomName, now);
        OfficeRoom.updateOne({ name: roomName }, { lastActivityAt: new Date() }).catch(() => {});
    }
}

module.exports = function registerOfficeSocketHandlers(socket, io, activeUsers, checkSocketRateLimit, joinRoom) {

    // ─── join office ──────────────────────────────────────────────────────────

    socket.on('join office', async (data) => {
        let officeName = '', accessKey = '', clientOwnerToken = '';
        if (typeof data === 'string') {
            officeName = data;
        } else if (data && typeof data === 'object') {
            officeName = String(data.officeName || '').trim().slice(0, MAX_NAME_LEN);
            accessKey = String(data.accessKey || '').trim().slice(0, MAX_KEY_LEN);
            clientOwnerToken = String(data.ownerToken || '').trim();
        }
        if (!officeName) return;

        if (!checkSocketRateLimit(socket.id, 'join office', 5, 30_000)) {
            socket.emit('error', 'Too many join attempts. Please wait.');
            return;
        }

        try {
            let office = await OfficeRoom.findOne({ name: officeName });
            if (!office) {
                if (accessKey && accessKey.length >= MIN_KEY_LEN) {
                    const ownerToken = crypto.randomBytes(32).toString('hex');
                    const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
                    try {
                        office = new OfficeRoom({ name: officeName, accessKey: hashedKey, ownerToken });
                        await office.save();
                        socket.emit('set owner token', ownerToken);
                    } catch (saveErr) {
                        if (saveErr.code === 11000) {
                            office = await OfficeRoom.findOne({ name: officeName });
                        } else throw saveErr;
                    }
                } else {
                    socket.emit('access denied', { room: officeName, type: 'office', message: 'Access key required' });
                    return;
                }
            } else {
                if (office.status === 'inactive') {
                    socket.emit('access denied', {
                        room: officeName,
                        type: 'office',
                        message: 'This room has expired due to 15 days of inactivity and is no longer accessible.'
                    });
                    return;
                }
                const match = await verifyAccessKey(
                    accessKey, office.accessKey,
                    (newHash) => OfficeRoom.updateOne({ name: officeName }, { accessKey: newHash })
                );
                if (!match) {
                    socket.emit('access denied', { room: officeName, type: 'office', message: 'Incorrect access key' });
                    return;
                }
            }

            await joinRoom(officeName);
            const activeOffice = office;
            if (activeOffice) {
                let currentOwnerToken = activeOffice.ownerToken;
                let isOwner = false;
                if (!currentOwnerToken) {
                    currentOwnerToken = crypto.randomBytes(32).toString('hex');
                    await OfficeRoom.updateOne({ name: officeName }, { ownerToken: currentOwnerToken });
                    socket.emit('set owner token', currentOwnerToken);
                    isOwner = true;
                } else {
                    isOwner = clientOwnerToken.length > 0 &&
                        crypto.timingSafeEqual(
                            Buffer.from(clientOwnerToken.padEnd(64, '0').slice(0, 64)),
                            Buffer.from(currentOwnerToken.padEnd(64, '0').slice(0, 64))
                        ) && clientOwnerToken === currentOwnerToken;
                    if (isOwner) socket.emit('set owner token', currentOwnerToken);
                }
                if (!socket.ownedRooms) socket.ownedRooms = new Set();
                if (isOwner) {
                    socket.ownedRooms.add(officeName);
                }
                socket.isOwner = isOwner;
                socket.emit('is owner', isOwner);
                socket.emit('spreadsheet content', activeOffice.spreadsheet || '[]');
                socket.emit('word content', activeOffice.wordContent || '');
                socket.emit('notes content', activeOffice.notes || '[]');
                socket.emit('kanban content', activeOffice.kanban || '[]');
            }
            socket.emit('join success', { room: officeName });
        } catch (err) {
            log('error', 'Socket join office error:', err);
            socket.emit('error', 'Server validation error');
        }
    });

    // ─── spreadsheet ──────────────────────────────────────────────────────────

    const MAX_OFFICE_PAYLOAD = 2 * 1024 * 1024; // 2MB cap per payload

    socket.on('update spreadsheet', async ({ officeName, spreadsheet }) => {
        if (!checkSocketRateLimit(socket.id, 'update spreadsheet', 30, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        if (Buffer.byteLength(String(spreadsheet || ''), 'utf8') > MAX_OFFICE_PAYLOAD) {
            socket.emit('error', 'Spreadsheet data exceeds maximum payload size.');
            return;
        }
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        try {
            touchActivity(name);
            await OfficeRoom.updateOne({ name }, { spreadsheet });
            socket.to(name).emit('spreadsheet content', spreadsheet);
        } catch (err) {
            log('error', 'Spreadsheet update error:', err);
        }
    });

    socket.on('spreadsheet operation', ({ officeName, operation }) => {
        if (!checkSocketRateLimit(socket.id, 'spreadsheet operation', 60, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name || !operation) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        socket.to(name).emit('spreadsheet op', operation);
    });

    socket.on('spreadsheet selection', ({ officeName, user, cell, color, sheetId }) => {
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name || !cell) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        socket.to(name).emit('spreadsheet peer selection', {
            socketId: socket.id,
            user: user || userData.username || 'Anonymous',
            cell,
            color: color || '#3b82f6',
            sheetId: sheetId || 'sheet_1'
        });
    });

    // ─── word document ────────────────────────────────────────────────────────

    socket.on('update word', async ({ officeName, wordContent }) => {
        if (!checkSocketRateLimit(socket.id, 'update word', 30, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        if (Buffer.byteLength(String(wordContent || ''), 'utf8') > MAX_OFFICE_PAYLOAD) {
            socket.emit('error', 'Document data exceeds maximum payload size.');
            return;
        }
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        try {
            await OfficeRoom.updateOne({ name }, { wordContent });
            socket.to(name).emit('word content', wordContent);
        } catch (err) {
            log('error', 'Word update error:', err);
        }
    });

    // ─── notes ────────────────────────────────────────────────────────────────

    socket.on('update office notes', async ({ officeName, notes }) => {
        if (!checkSocketRateLimit(socket.id, 'update office notes', 30, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        if (Buffer.byteLength(String(notes || ''), 'utf8') > MAX_OFFICE_PAYLOAD) {
            socket.emit('error', 'Notes data exceeds maximum payload size.');
            return;
        }
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        try {
            await OfficeRoom.updateOne({ name }, { notes });
            socket.to(name).emit('office notes content', notes);
        } catch (err) {
            log('error', 'Office notes update error:', err);
        }
    });

    // ─── kanban ───────────────────────────────────────────────────────────────

    socket.on('update kanban', async ({ officeName, kanban }) => {
        if (!checkSocketRateLimit(socket.id, 'update kanban', 30, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        if (Buffer.byteLength(String(kanban || ''), 'utf8') > MAX_OFFICE_PAYLOAD) {
            socket.emit('error', 'Kanban data exceeds maximum payload size.');
            return;
        }
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        try {
            await OfficeRoom.updateOne({ name }, { kanban });
            socket.to(name).emit('kanban content', kanban);
        } catch (err) {
            log('error', 'Kanban update error:', err);
        }
    });

    // ─── office group chat ────────────────────────────────────────────────────

    socket.on('send chat message', ({ officeName, msg }) => {
        if (!checkSocketRateLimit(socket.id, 'send chat message', 30, 10_000)) {
            socket.emit('error', 'You are sending messages too fast. Please slow down.');
            return;
        }
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name || !msg) return;
        const userData = activeUsers.get(socket.id);
        const inRoom = (userData && userData.rooms.has(name)) || socket.rooms.has(name);
        if (!inRoom) {
            log('warn', `[send chat message] Socket ${socket.id} not in room "${name}" — dropping.`);
            return;
        }
        const safeMsg = String(msg).trim().slice(0, MAX_MESSAGE_LEN);
        if (!safeMsg) return;
        io.to(name).emit('chat message', {
            username: (userData && userData.username) || 'Anonymous',
            msg: safeMsg,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });
};
