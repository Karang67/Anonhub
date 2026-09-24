/**
 * @file sockets/globalChatSocket.js
 * @description Socket.IO handlers for the Global Anonymous Chat room.
 * Enforces single shared global room ('GLOBAL_CHAT'), automatic guest identities,
 * real-time broadcast, live user count, rate limiting, and rolling 100-message database retention.
 */

const GlobalMessage = require('../models/GlobalMessage');
const FeatureConfig = require('../models/FeatureConfig');
const { MAX_MESSAGE_LEN } = require('../config/db');
const { log } = require('../utils/logger');

const GLOBAL_ROOM = 'GLOBAL_CHAT';
const MAX_STORED_MESSAGES = 100;

// Curated guest avatar color accents
const GUEST_ACCENTS = [
    '#E11D48', '#2563EB', '#059669', '#D97706', '#7C3AED',
    '#DB2777', '#0284C7', '#0D9488', '#EA580C', '#4F46E5',
    '#10B981', '#F43F5E', '#8B5CF6', '#06B6D4', '#84CC16'
];

/**
 * Checks if the 'chat.global' feature is enabled in FeatureConfig.
 */
async function isGlobalChatEnabled() {
    try {
        const feat = await FeatureConfig.findOne({ key: 'chat.global' }).lean();
        if (!feat) return true; // Default to enabled if not explicitly disabled
        return feat.enabled && feat.status !== 'disabled';
    } catch {
        return true;
    }
}

let pruneTimer = null;
let lastPruneTime = 0;
const PRUNE_THROTTLE_MS = 15_000;

/**
 * Prunes the GlobalMessage collection to keep only the latest 100 messages.
 * Throttled to execute at most once per 15s to eliminate unnecessary database round-trips.
 */
function scheduleMessageRetention() {
    const now = Date.now();
    if (now - lastPruneTime < PRUNE_THROTTLE_MS) {
        if (!pruneTimer) {
            pruneTimer = setTimeout(() => {
                pruneTimer = null;
                lastPruneTime = Date.now();
                enforceMessageRetention();
            }, PRUNE_THROTTLE_MS - (now - lastPruneTime));
        }
        return;
    }
    lastPruneTime = now;
    enforceMessageRetention();
}

async function enforceMessageRetention() {
    try {
        const total = await GlobalMessage.countDocuments();
        if (total > MAX_STORED_MESSAGES) {
            const cutoffMessages = await GlobalMessage.find()
                .sort({ timestamp: -1 })
                .skip(MAX_STORED_MESSAGES - 1)
                .limit(1)
                .select('timestamp')
                .lean();

            if (cutoffMessages && cutoffMessages.length > 0) {
                const cutoffDate = cutoffMessages[0].timestamp;
                const deleteResult = await GlobalMessage.deleteMany({ timestamp: { $lt: cutoffDate } });
                if (deleteResult.deletedCount > 0) {
                    log('debug', `[GLOBAL-CHAT] Pruned ${deleteResult.deletedCount} old messages (kept latest ${MAX_STORED_MESSAGES}).`);
                }
            }
        }
    } catch (err) {
        log('error', '[GLOBAL-CHAT] Error pruning messages:', err);
    }
}

module.exports = function registerGlobalChatSocketHandlers(socket, io, activeUsers, checkSocketRateLimit) {

    /**
     * Broadcasts the live online user count for the global chat room.
     */
    const broadcastGlobalUserCount = () => {
        const roomClients = io.sockets.adapter.rooms.get(GLOBAL_ROOM);
        const count = roomClients ? roomClients.size : 0;
        io.to(GLOBAL_ROOM).emit('global-chat-count', { count });
    };

    // ─── Join Global Chat ─────────────────────────────────────────────────────

    socket.on('join-global-chat', async (data) => {
        const enabled = await isGlobalChatEnabled();
        if (!enabled) {
            socket.emit('global-chat-disabled', { message: 'Global Chat is currently disabled by administrator.' });
            return;
        }

        try {
            let userData = activeUsers.get(socket.id);
            // Validate client-provided persistentGuestId (must match safe gc_ prefix pattern)
            const clientPersistentId = (typeof data?.persistentGuestId === 'string' &&
                /^gc_[a-zA-Z0-9_-]{8,64}$/.test(data.persistentGuestId))
                ? data.persistentGuestId
                : null;
            if (!userData) {
                const randomNum = Math.floor(100 + Math.random() * 900);
                const guestName = (data?.username && typeof data.username === 'string' && data.username.trim())
                    ? data.username.trim().slice(0, 30).replace(/[<>"'&]/g, '')
                    : `Guest-${randomNum}`;
                const color = GUEST_ACCENTS[Math.floor(Math.random() * GUEST_ACCENTS.length)];
                // Use persistent client ID so edit/delete works after reconnects
                const guestId = clientPersistentId || `guest_${socket.id}`;
                userData = { username: guestName, color, rooms: new Set(), guestId };
                activeUsers.set(socket.id, userData);
            } else {
                // Upgrade to persistent ID if not already set
                if (!userData.guestId || userData.guestId === `guest_${socket.id}`) {
                    userData.guestId = clientPersistentId || userData.guestId || `guest_${socket.id}`;
                }
                if (!userData.color) userData.color = GUEST_ACCENTS[Math.floor(Math.random() * GUEST_ACCENTS.length)];
                if (data?.username && typeof data.username === 'string') {
                    const cleanName = data.username.trim().slice(0, 30).replace(/[<>"'&]/g, '');
                    if (cleanName) userData.username = cleanName;
                }
            }

            socket.join(GLOBAL_ROOM);
            userData.rooms.add(GLOBAL_ROOM);

            // Fetch the latest 100 messages in ascending order
            const history = await GlobalMessage.find()
                .sort({ timestamp: -1 })
                .limit(MAX_STORED_MESSAGES)
                .lean();

            socket.emit('global-chat-init', {
                user: {
                    guestId: userData.guestId,
                    username: userData.username,
                    color: userData.color
                },
                messages: history.reverse(),
                maxLimit: MAX_STORED_MESSAGES
            });

            broadcastGlobalUserCount();
            log('info', `[GLOBAL-CHAT] "${userData.username}" joined Global Chat.`);
        } catch (err) {
            log('error', '[GLOBAL-CHAT] Join error:', err);
            socket.emit('global-chat-error', { error: 'Failed to join Global Chat.' });
        }
    });

    // ─── Send Global Message ──────────────────────────────────────────────────

    socket.on('send-global-message', async (data) => {
        const enabled = await isGlobalChatEnabled();
        if (!enabled) {
            socket.emit('global-chat-disabled', { message: 'Global Chat is disabled.' });
            return;
        }

        // Anti-Spam Rate Limit: 5 messages per 10 seconds
        if (!checkSocketRateLimit(socket.id, 'send-global-message', 5, 10_000)) {
            socket.emit('global-chat-rate-limited', {
                message: 'You are sending messages too quickly. Please wait a moment.'
            });
            return;
        }

        const rawMsg = (data && typeof data === 'object') ? data.message : data;
        const cleanMsg = String(rawMsg || '').trim().slice(0, MAX_MESSAGE_LEN);

        if (!cleanMsg) {
            socket.emit('global-chat-error', { error: 'Message cannot be empty.' });
            return;
        }

        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(GLOBAL_ROOM)) {
            socket.emit('global-chat-error', { error: 'You are not joined in Global Chat.' });
            return;
        }

        try {
            const newMsg = new GlobalMessage({
                guestId: userData.guestId || `guest_${socket.id}`,
                username: userData.username,
                msg: cleanMsg,
                timestamp: new Date()
            });

            await newMsg.save();

            const messagePayload = {
                _id: newMsg._id,
                guestId: newMsg.guestId,
                username: newMsg.username,
                msg: newMsg.msg,
                timestamp: newMsg.timestamp,
                color: userData.color || '#2563EB'
            };

            // Real-time broadcast to everyone in Global Chat
            io.to(GLOBAL_ROOM).emit('global-chat-message', messagePayload);

            // Asynchronously schedule rolling 100-message storage limit (throttled)
            scheduleMessageRetention();
        } catch (err) {
            log('error', '[GLOBAL-CHAT] Message save error:', err);
            socket.emit('global-chat-error', { error: 'Failed to send message.' });
        }
    });

    // ─── Edit Global Message (Author Only) ────────────────────────────────────

    socket.on('edit-global-message', async (data) => {
        if (!checkSocketRateLimit(socket.id, 'edit-global-message', 10, 10_000)) {
            socket.emit('global-chat-error', { error: 'You are editing messages too quickly.' });
            return;
        }

        const messageId = data?.messageId;
        const newMsg = String(data?.newMsg || data?.message || '').trim().slice(0, MAX_MESSAGE_LEN);

        if (!messageId || !newMsg) {
            socket.emit('global-chat-error', { error: 'Message cannot be empty.' });
            return;
        }

        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(GLOBAL_ROOM)) {
            socket.emit('global-chat-error', { error: 'You are not joined in Global Chat.' });
            return;
        }

        try {
            const msgDoc = await GlobalMessage.findById(messageId);
            if (!msgDoc) {
                socket.emit('global-chat-error', { error: 'Message not found or already removed.' });
                return;
            }

            // Verify author ownership
            const userGuestId = userData.guestId || `guest_${socket.id}`;
            const isOwner = msgDoc.guestId === userGuestId || 
                            msgDoc.guestId === socket.id || 
                            msgDoc.guestId === `guest_${socket.id}`;

            if (!isOwner) {
                socket.emit('global-chat-error', { error: 'Unauthorized: You can only edit your own messages.' });
                return;
            }

            msgDoc.msg = newMsg;
            msgDoc.edited = true;
            await msgDoc.save();

            // Broadcast edit to all users in Global Chat
            io.to(GLOBAL_ROOM).emit('global-chat-message-edited', {
                _id: msgDoc._id,
                msg: msgDoc.msg,
                edited: true
            });
            log('debug', `[GLOBAL-CHAT] Message ${messageId} edited by "${userData.username}".`);
        } catch (err) {
            log('error', '[GLOBAL-CHAT] Message edit error:', err);
            socket.emit('global-chat-error', { error: 'Failed to edit message.' });
        }
    });

    // ─── Delete Global Message (Author Only) ──────────────────────────────────

    socket.on('delete-global-message', async (data) => {
        if (!checkSocketRateLimit(socket.id, 'delete-global-message', 10, 10_000)) {
            socket.emit('global-chat-error', { error: 'You are deleting messages too quickly.' });
            return;
        }

        const messageId = data?.messageId;
        if (!messageId) return;

        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(GLOBAL_ROOM)) {
            socket.emit('global-chat-error', { error: 'You are not joined in Global Chat.' });
            return;
        }

        try {
            const msgDoc = await GlobalMessage.findById(messageId);
            if (!msgDoc) {
                socket.emit('global-chat-error', { error: 'Message not found or already removed.' });
                return;
            }

            // Verify author ownership
            const userGuestId = userData.guestId || `guest_${socket.id}`;
            const isOwner = msgDoc.guestId === userGuestId || 
                            msgDoc.guestId === socket.id || 
                            msgDoc.guestId === `guest_${socket.id}`;

            if (!isOwner) {
                socket.emit('global-chat-error', { error: 'Unauthorized: You can only delete your own messages.' });
                return;
            }

            await GlobalMessage.findByIdAndDelete(messageId);

            // Broadcast deletion to all users in Global Chat
            io.to(GLOBAL_ROOM).emit('global-chat-message-deleted', {
                messageId
            });
            log('debug', `[GLOBAL-CHAT] Message ${messageId} deleted by "${userData.username}".`);
        } catch (err) {
            log('error', '[GLOBAL-CHAT] Message delete error:', err);
            socket.emit('global-chat-error', { error: 'Failed to delete message.' });
        }
    });

    // ─── Update Global Nickname ───────────────────────────────────────────────

    socket.on('update-global-username', (data) => {
        if (!checkSocketRateLimit(socket.id, 'update-global-username', 5, 30_000)) {
            socket.emit('global-chat-error', { error: 'Too many nickname changes. Please wait.' });
            return;
        }

        const rawName = String(data?.username || '').trim().slice(0, 30).replace(/[<>"'&]/g, '');
        if (!rawName) return;

        const userData = activeUsers.get(socket.id);
        if (userData && userData.rooms.has(GLOBAL_ROOM)) {
            const oldName = userData.username;
            userData.username = rawName;
            socket.emit('global-username-updated', { username: rawName });
            socket.to(GLOBAL_ROOM).emit('global-chat-system', {
                msg: `${oldName} is now known as ${rawName}`
            });
        }
    });

    // ─── Leave Global Chat ────────────────────────────────────────────────────

    socket.on('leave-global-chat', () => {
        socket.leave(GLOBAL_ROOM);
        const userData = activeUsers.get(socket.id);
        if (userData) {
            userData.rooms.delete(GLOBAL_ROOM);
        }
        broadcastGlobalUserCount();
    });
};
