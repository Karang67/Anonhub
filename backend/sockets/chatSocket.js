/**
 * @file sockets/chatSocket.js
 * @description Socket.IO handlers for chat room events:
 * messaging, editing, deleting, reactions, permissions, and ownership claims.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ChatRoom = require('../models/ChatRoom');
const Project = require('../models/Project');
const Message = require('../models/Message');
const { verifyAccessKey } = require('../middleware/auth');
const { isValidObjectId } = require('../utils/helpers');
const { MAX_NAME_LEN, MAX_KEY_LEN, MAX_MESSAGE_LEN, MIN_KEY_LEN, BCRYPT_ROUNDS } = require('../config/db');
const { log } = require('../utils/logger');

// ─── Throttled activity tracking (max 1 DB write per 30s per room) ────────────
const lastActivityUpdate = new Map(); // roomName -> timestamp
function touchActivity(Model, roomName) {
    const now = Date.now();
    const last = lastActivityUpdate.get(roomName) || 0;
    if (now - last > 30_000) {
        lastActivityUpdate.set(roomName, now);
        Model.updateOne({ name: roomName }, { lastActivityAt: new Date() }).catch(() => {});
    }
}

module.exports = function registerChatSocketHandlers(socket, io, activeUsers, checkSocketRateLimit, joinRoom, updateRoomUsers) {

    // ─── join room ────────────────────────────────────────────────────────────

    socket.on('join room', async (data) => {
        let room = '', accessKey = '', clientOwnerToken = '';
        if (typeof data === 'string') {
            room = data;
        } else if (data && typeof data === 'object') {
            room = String(data.room || '').trim().slice(0, MAX_NAME_LEN);
            accessKey = String(data.accessKey || '').trim().slice(0, MAX_KEY_LEN);
            clientOwnerToken = String(data.ownerToken || '').trim();
        }
        if (!room) return;

        if (!checkSocketRateLimit(socket.id, 'join room', 5, 30_000)) {
            socket.emit('error', 'Too many join attempts. Please wait.');
            return;
        }

        try {
            let chatRoom = await ChatRoom.findOne({ name: room });
            let newlyCreated = false;

            if (!chatRoom) {
                if (accessKey && accessKey.length >= MIN_KEY_LEN) {
                    const ownerToken = crypto.randomBytes(32).toString('hex');
                    const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
                    chatRoom = new ChatRoom({ name: room, accessKey: hashedKey, ownerToken });
                    await chatRoom.save();
                    socket.emit('set owner token', ownerToken);
                    newlyCreated = true;
                } else {
                    socket.emit('access denied', { room, type: 'chat', message: 'Access key required' });
                    return;
                }
            } else {
                if (chatRoom.status === 'inactive') {
                    socket.emit('access denied', {
                        room,
                        type: 'chat',
                        message: 'This room has expired due to 15 days of inactivity and is no longer accessible.'
                    });
                    return;
                }
                const match = await verifyAccessKey(
                    accessKey,
                    chatRoom.accessKey,
                    (newHash) => ChatRoom.updateOne({ name: room }, { accessKey: newHash })
                );
                if (!match) {
                    socket.emit('access denied', { room, type: 'chat', message: 'Incorrect access key' });
                    return;
                }
            }

            let currentOwnerToken = chatRoom.ownerToken;
            let isOwner = false;

            if (newlyCreated) {
                isOwner = true;
            } else if (!currentOwnerToken) {
                currentOwnerToken = crypto.randomBytes(32).toString('hex');
                await ChatRoom.updateOne({ name: room }, { ownerToken: currentOwnerToken });
                socket.emit('set owner token', currentOwnerToken);
                isOwner = true;
            } else {
                isOwner = clientOwnerToken.length > 0 &&
                    crypto.timingSafeEqual(
                        Buffer.from(clientOwnerToken.padEnd(64, '0').slice(0, 64)),
                        Buffer.from(currentOwnerToken.padEnd(64, '0').slice(0, 64))
                    ) && clientOwnerToken === currentOwnerToken;

                if (!isOwner && clientOwnerToken.length > 0) {
                    const linkedProject = await Project.findOne({ name: room, ownerToken: clientOwnerToken });
                    if (linkedProject) {
                        isOwner = true;
                        log('info', `[CROSS-OWNERSHIP] Chat room "${room}" ownership granted via matching project token.`);
                    }
                }

                if (isOwner) socket.emit('set owner token', currentOwnerToken);
            }

            if (!socket.ownedRooms) socket.ownedRooms = new Set();
            if (isOwner) {
                socket.ownedRooms.add(room);
            }

            socket.isOwner = isOwner;
            socket.currentRoom = room;
            socket.emit('is owner', isOwner);

            const perms = chatRoom.permissions || {};
            socket.emit('room permissions', {
                allowUserEdit:   !!perms.allowUserEdit,
                allowUserDelete: !!perms.allowUserDelete,
                allowUserUpload: perms.allowUserUpload !== false
            });

            await joinRoom(room);
            socket.emit('join success', { room });
        } catch (err) {
            log('error', 'Socket join room error:', err);
            socket.emit('error', 'Server validation error');
        }
    });

    // ─── room message ─────────────────────────────────────────────────────────

    socket.on('room message', async (data) => {
        if (!checkSocketRateLimit(socket.id, 'room message', 30, 10_000)) {
            socket.emit('error', 'You are sending messages too fast. Please slow down.');
            return;
        }
        const room = String(data?.room || '').trim().slice(0, MAX_NAME_LEN);
        const msg = String(data?.msg || '').trim().slice(0, MAX_MESSAGE_LEN);
        const userData = activeUsers.get(socket.id);
        if (userData && msg && room && userData.rooms.has(room)) {
            // Guard: refuse writes to inactive rooms
            const chatRoom = await ChatRoom.findOne({ name: room }).select('status').lean();
            if (chatRoom && chatRoom.status === 'inactive') {
                socket.emit('room deleted', { room, message: 'This room has expired and is no longer active.' });
                return;
            }
            const newMessage = new Message({ room, username: userData.username, sessionId: userData.sessionId, msg });
            await newMessage.save();
            touchActivity(ChatRoom, room);
            io.to(room).emit('chat message', {
                _id: newMessage._id,
                username: userData.username,
                msg,
                timestamp: newMessage.timestamp
            });
        }
    });

    // ─── delete message ───────────────────────────────────────────────────────

    socket.on('delete message', async (data) => {
        const { room, messageId } = data || {};
        if (!isValidObjectId(messageId)) return;
        const targetRoom = String(room || '').trim().slice(0, MAX_NAME_LEN);
        if (!targetRoom) return;
        try {
            const isOwner = socket.ownedRooms && socket.ownedRooms.has(targetRoom);
            if (!isOwner) {
                const chatRoom = await ChatRoom.findOne({ name: targetRoom }).select('permissions').lean();
                if (!chatRoom?.permissions?.allowUserDelete) return;
                const userData = activeUsers.get(socket.id);
                if (!userData) return;
                const msg = await Message.findById(messageId).select('username sessionId').lean();
                if (!msg) return;
                const isAuthor = msg.sessionId ? (msg.sessionId === userData.sessionId) : (msg.username === userData.username);
                if (!isAuthor) return;
            }
            await Message.deleteOne({ _id: messageId });
            io.to(targetRoom).emit('message deleted', { messageId });
        } catch (err) {
            log('error', 'Error deleting message:', err);
        }
    });

    // ─── delete messages (bulk) ───────────────────────────────────────────────

    socket.on('delete messages', async (data) => {
        const { room, messageIds } = data || {};
        const targetRoom = String(room || '').trim().slice(0, MAX_NAME_LEN);
        if (!targetRoom || !Array.isArray(messageIds) || messageIds.length === 0) return;
        const validIds = messageIds.filter(id => isValidObjectId(id));
        if (validIds.length === 0) return;
        try {
            const isOwner = socket.ownedRooms && socket.ownedRooms.has(targetRoom);
            if (!isOwner) {
                const chatRoom = await ChatRoom.findOne({ name: targetRoom }).select('permissions').lean();
                if (!chatRoom?.permissions?.allowUserDelete) return;
                const userData = activeUsers.get(socket.id);
                if (!userData) return;
                const ownedMessages = await Message.find({
                    _id: { $in: validIds },
                    $or: [
                        { sessionId: userData.sessionId },
                        { username: userData.username }
                    ]
                }).select('_id').lean();
                const ownedIds = ownedMessages.map(m => String(m._id));
                if (ownedIds.length === 0) return;
                await Message.deleteMany({ _id: { $in: ownedIds } });
                io.to(targetRoom).emit('messages deleted', { messageIds: ownedIds });
                return;
            }
            await Message.deleteMany({ _id: { $in: validIds } });
            io.to(targetRoom).emit('messages deleted', { messageIds: validIds });
        } catch (err) {
            log('error', 'Error bulk deleting messages:', err);
        }
    });

    // ─── edit message ─────────────────────────────────────────────────────────

    socket.on('edit message', async (data) => {
        const { room, messageId } = data || {};
        const targetRoom = String(room || '').trim().slice(0, MAX_NAME_LEN);
        const newMsg = String(data?.newMsg || '').trim().slice(0, MAX_MESSAGE_LEN);
        if (!targetRoom || !newMsg || !isValidObjectId(messageId)) return;
        try {
            const isOwner = socket.ownedRooms && socket.ownedRooms.has(targetRoom);
            if (!isOwner) {
                const chatRoom = await ChatRoom.findOne({ name: targetRoom }).select('permissions').lean();
                if (!chatRoom?.permissions?.allowUserEdit) return;
                const userData = activeUsers.get(socket.id);
                if (!userData) return;
                const msg = await Message.findById(messageId).select('username sessionId').lean();
                if (!msg) return;
                const isAuthor = msg.sessionId ? (msg.sessionId === userData.sessionId) : (msg.username === userData.username);
                if (!isAuthor) return;
            }
            await Message.updateOne({ _id: messageId }, { msg: newMsg });
            io.to(targetRoom).emit('message edited', { messageId, newMsg });
        } catch (err) {
            log('error', 'Error editing message:', err);
        }
    });

    // ─── update permissions ───────────────────────────────────────────────────

    socket.on('update permissions', async (data) => {
        const room = String(data?.room || '').trim().slice(0, MAX_NAME_LEN);
        if (!room) return;
        if (!socket.ownedRooms || !socket.ownedRooms.has(room)) {
            socket.emit('error', 'Only the room owner can change permissions.');
            return;
        }
        const allowUserEdit   = !!data?.allowUserEdit;
        const allowUserDelete = !!data?.allowUserDelete;
        const allowUserUpload = data?.allowUserUpload !== false;
        try {
            await ChatRoom.updateOne({ name: room }, {
                'permissions.allowUserEdit':   allowUserEdit,
                'permissions.allowUserDelete': allowUserDelete,
                'permissions.allowUserUpload': allowUserUpload
            });
            io.to(room).emit('room permissions', { allowUserEdit, allowUserDelete, allowUserUpload });
            log('info', `[PERMISSIONS] Room "${room}" permissions updated.`);
        } catch (err) {
            log('error', 'Error updating permissions:', err);
        }
    });

    // ─── claim ownership ──────────────────────────────────────────────────────

    socket.on('claim ownership', async (data) => {
        const room = String(data?.room || '').trim().slice(0, MAX_NAME_LEN);
        const accessKey = String(data?.accessKey || data?.ownerKey || '').trim().slice(0, MAX_KEY_LEN);
        if (!room || !accessKey) {
            socket.emit('claim ownership result', { success: false, message: 'Room name and Owner Key are required.' });
            return;
        }
        if (!checkSocketRateLimit(socket.id, 'claim ownership', 5, 60_000)) {
            socket.emit('claim ownership result', { success: false, message: 'Too many attempts. Please wait.' });
            return;
        }
        try {
            const chatRoom = await ChatRoom.findOne({ name: room });
            if (!chatRoom) {
                socket.emit('claim ownership result', { success: false, message: 'Room not found.' });
                return;
            }
            const targetHash = chatRoom.ownerKey || chatRoom.accessKey;
            const match = await verifyAccessKey(
                accessKey, targetHash,
                (newHash) => ChatRoom.updateOne({ name: room }, { ownerKey: newHash })
            );
            if (!match) {
                socket.emit('claim ownership result', { success: false, message: 'Incorrect Owner Key.' });
                return;
            }
            if (!socket.ownedRooms) socket.ownedRooms = new Set();
            socket.ownedRooms.add(room);
            socket.isOwner = true;
            socket.currentRoom = room;
            socket.emit('is owner', true);
            if (chatRoom.ownerToken) socket.emit('set owner token', chatRoom.ownerToken);
            socket.emit('claim ownership result', { success: true, message: 'Ownership claimed! You now have owner privileges.' });
            log('info', `[CLAIM-OWNERSHIP] Socket ${socket.id} claimed ownership of room "${room}".`);
        } catch (err) {
            log('error', 'Error claiming ownership:', err);
            socket.emit('claim ownership result', { success: false, message: 'Server error.' });
        }
    });

    // ─── update username ──────────────────────────────────────────────────────

    socket.on('update username', (data) => {
        if (!checkSocketRateLimit(socket.id, 'update username', 5, 30_000)) {
            socket.emit('error', 'Too many nickname changes. Please wait.');
            return;
        }
        const newName = String(data?.username || '').trim().slice(0, 50).replace(/[<>"'&]/g, '');
        if (!newName) return;
        const userData = activeUsers.get(socket.id);
        if (!userData) return;
        const oldName = userData.username;
        const targetSessionId = userData.sessionId;

        const roomsToNotify = new Set();
        for (const user of activeUsers.values()) {
            if (user.sessionId === targetSessionId) user.rooms.forEach(r => roomsToNotify.add(r));
        }
        for (const [id, user] of activeUsers.entries()) {
            if (user.sessionId === targetSessionId) {
                user.username = newName;
                io.to(id).emit('username updated', newName);
            }
        }
        roomsToNotify.forEach(room => {
            socket.to(room).emit('chat message', { username: 'System', msg: `${oldName} is now known as ${newName}` });
            updateRoomUsers(room);
        });
    });

    // ─── typing ───────────────────────────────────────────────────────────────

    socket.on('typing', (data) => {
        if (!checkSocketRateLimit(socket.id, 'typing', 10, 5_000)) return;
        const userData = activeUsers.get(socket.id);
        if (!userData) return;
        const room = String(data?.room || '').trim().slice(0, MAX_NAME_LEN);
        // Security: only broadcast typing to rooms the socket has joined
        if (!room || !userData.rooms.has(room)) return;
        socket.to(room).emit('typing', `${userData.username} is typing...`);
    });

    // ─── add/remove reactions ─────────────────────────────────────────────────

    socket.on('add reaction', async ({ room, messageId, emoji }) => {
        if (!checkSocketRateLimit(socket.id, 'add reaction', 20, 10_000)) return;
        if (!isValidObjectId(messageId)) return;
        const userData = activeUsers.get(socket.id);
        if (!userData) return;
        const safeEmoji = String(emoji || '').slice(0, 8);
        const roomName = String(room || '').trim().slice(0, MAX_NAME_LEN);
        // Verify room membership
        if (!roomName || !userData.rooms.has(roomName)) return;
        try {
            const msg = await Message.findById(messageId);
            if (!msg || msg.room !== roomName) return;
            // Cap total distinct reaction types per message
            if (msg.reactions.length >= 50 && !msg.reactions.find(r => r.emoji === safeEmoji)) return;
            const existing = msg.reactions.find(r => r.emoji === safeEmoji);
            if (existing) {
                if (!existing.users.includes(userData.username)) existing.users.push(userData.username);
            } else {
                msg.reactions.push({ emoji: safeEmoji, users: [userData.username] });
            }
            await msg.save();
            io.to(roomName).emit('reaction update', { messageId, reactions: msg.reactions });
        } catch (err) {
            log('error', 'Reaction add error:', err);
        }
    });

    socket.on('remove reaction', async ({ room, messageId, emoji }) => {
        if (!checkSocketRateLimit(socket.id, 'remove reaction', 20, 10_000)) return;
        if (!isValidObjectId(messageId)) return;
        const userData = activeUsers.get(socket.id);
        if (!userData) return;
        const safeEmoji = String(emoji || '').slice(0, 8);
        const roomName = String(room || '').trim().slice(0, MAX_NAME_LEN);
        try {
            const msg = await Message.findById(messageId);
            if (!msg || msg.room !== roomName) return;
            const existing = msg.reactions.find(r => r.emoji === safeEmoji);
            if (existing) {
                existing.users = existing.users.filter(u => u !== userData.username);
                if (existing.users.length === 0) msg.reactions = msg.reactions.filter(r => r.emoji !== safeEmoji);
            }
            await msg.save();
            io.to(roomName).emit('reaction update', { messageId, reactions: msg.reactions });
        } catch (err) {
            log('error', 'Reaction remove error:', err);
        }
    });
};
