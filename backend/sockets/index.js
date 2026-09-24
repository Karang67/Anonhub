/**
 * @file sockets/index.js
 * @description Main Socket.IO connection handler.
 * Initializes per-socket state, shared helpers, and delegates events
 * to domain-specific socket handler modules.
 */

const crypto = require('crypto');
const Message = require('../models/Message');
const { parseHandshakeCookies, generateRandomName } = require('../utils/helpers');
const { log } = require('../utils/logger');

const registerChatSocketHandlers = require('./chatSocket');
const registerProjectSocketHandlers = require('./projectSocket');
const registerOfficeSocketHandlers = require('./officeSocket');
const registerWhiteboardSocketHandlers = require('./whiteboardSocket');
const registerGlobalChatSocketHandlers = require('./globalChatSocket');

/**
 * Tracks socket connections: Maps socket.id -> { username, sessionId, rooms: Set<string> }
 * @type {Map}
 */
const activeUsers = new Map();

/**
 * Per-socket event rate limiter state: Maps socket.id -> { event -> { count, resetAt } }
 * @type {Map}
 */
const socketRateLimits = new Map();

/**
 * Returns true if the socket is within the rate limit for the given event.
 */
function checkSocketRateLimit(socketId, event, maxPerWindow = 30, windowMs = 10_000) {
    if (!socketRateLimits.has(socketId)) socketRateLimits.set(socketId, {});
    const limits = socketRateLimits.get(socketId);
    const now = Date.now();
    if (!limits[event] || now > limits[event].resetAt) {
        limits[event] = { count: 1, resetAt: now + windowMs };
        return true;
    }
    limits[event].count++;
    return limits[event].count <= maxPerWindow;
}

/**
 * Registers all Socket.IO event handlers on the io server instance.
 * @param {import('socket.io').Server} io
 */
function registerSocketHandlers(io) {
    io.on('connection', (socket) => {
        const cookies = parseHandshakeCookies(socket.handshake.headers.cookie);

        let username = socket.handshake.auth?.username || cookies['trinetra-username'] || cookies['anonhub-username'];
        if (!username || typeof username !== 'string' || username.trim() === '') {
            username = generateRandomName();
        } else {
            username = username.trim().slice(0, 50).replace(/[<>"'&]/g, '');
        }

        let sessionId = cookies['trinetra-session-id'] || cookies['anonhub-session-id'] || socket.handshake.auth?.sessionId;
        if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
            sessionId = crypto.randomBytes(16).toString('hex');
        }

        activeUsers.set(socket.id, { username, sessionId, rooms: new Set() });
        socket.emit('set username', username);
        socket.emit('set session id', sessionId);
        log('debug', `Socket connected: ${socket.id} as "${username}" [Session: ${sessionId}]`);

        // ─── Shared helpers passed to domain handlers ─────────────────────────

        /**
         * Broadcasts the updated user roster for a room.
         */
        const updateRoomUsers = (room) => {
            const usersInRoom = [];
            for (const [id, userData] of activeUsers.entries()) {
                if (userData.rooms.has(room)) {
                    usersInRoom.push({ id, username: userData.username });
                }
            }
            io.to(room).emit('room users', usersInRoom);
        };

        /**
         * Joins a Socket.IO channel, seeds message history, and broadcasts user entry.
         */
        const joinRoom = async (room) => {
            socket.join(room);
            const userData = activeUsers.get(socket.id);
            if (userData) userData.rooms.add(room);
            const currentName = userData ? userData.username : username;
            log('info', `[${room}] "${currentName}" joined.`);
            const messages = await Message.find({ room }).sort({ timestamp: -1 }).limit(50).lean().exec();
            socket.emit('load messages', messages.reverse());
            socket.to(room).emit('chat message', { username: 'System', msg: `${currentName} has joined.` });
            updateRoomUsers(room);
        };

        // ─── Register domain event handlers ──────────────────────────────────

        registerChatSocketHandlers(socket, io, activeUsers, checkSocketRateLimit, joinRoom, updateRoomUsers);
        registerProjectSocketHandlers(socket, io, activeUsers, checkSocketRateLimit, joinRoom);
        registerOfficeSocketHandlers(socket, io, activeUsers, checkSocketRateLimit, joinRoom);
        registerWhiteboardSocketHandlers(socket, io, activeUsers, checkSocketRateLimit, joinRoom);
        registerGlobalChatSocketHandlers(socket, io, activeUsers, checkSocketRateLimit);

        // ─── disconnect ───────────────────────────────────────────────────────

        socket.on('disconnect', () => {
            const userData = activeUsers.get(socket.id);
            if (userData) {
                log('info', `Socket disconnected: "${userData.username}"`);
                userData.rooms.forEach(room => {
                    if (room !== 'GLOBAL_CHAT') {
                        io.to(room).emit('chat message', { username: 'System', msg: `${userData.username} has left.` });
                        io.to(`${room}-webrtc`).emit('webrtc-user-left', { socketId: socket.id });
                        updateRoomUsers(room);
                    }
                });
                if (userData.rooms.has('GLOBAL_CHAT')) {
                    const gcRoom = io.sockets.adapter.rooms.get('GLOBAL_CHAT');
                    io.to('GLOBAL_CHAT').emit('global-chat-count', { count: gcRoom ? gcRoom.size : 0 });
                }
                activeUsers.delete(socket.id);
            }
            socketRateLimits.delete(socket.id);
        });
    });
}

module.exports = { registerSocketHandlers, activeUsers };
