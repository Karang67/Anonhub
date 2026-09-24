/**
 * @file controllers/chatController.js
 * @description Create/join chat rooms and manage chat access keys.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const ChatRoom = require('../models/ChatRoom');
const { verifyAccessKey } = require('../middleware/auth');
const { handleValidation, timingSafeMatch } = require('../utils/helpers');
const { MIN_KEY_LEN, MAX_KEY_LEN, MAX_NAME_LEN, BCRYPT_ROUNDS } = require('../config/db');
const { log } = require('../utils/logger');

/**
 * POST /join-chat
 * Creates a new chat room or joins an existing one with a matching key.
 */
async function joinOrCreateChat(req, res) {
    if (!handleValidation(req, res)) return;
    try {
        const roomName = req.body.room.trim();
        const accessKey = req.body.accessKey.trim();
        const rawOwnerKey = req.body.ownerKey ? String(req.body.ownerKey).trim() : '';

        const existingRoom = await ChatRoom.findOne({ name: roomName });
        if (existingRoom) {
            if (existingRoom.status === 'inactive') {
                return res.status(410).json({
                    error: 'room_expired',
                    message: 'This room has expired due to 15 days of inactivity and is no longer accessible.'
                });
            }
            const match = await verifyAccessKey(
                accessKey,
                existingRoom.accessKey,
                (newHash) => ChatRoom.updateOne({ name: roomName }, { accessKey: newHash })
            );
            if (!match) {
                return res.status(403).json({ error: 'Incorrect access key for this chat room.' });
            }
            return res.status(200).json({ redirectUrl: `/chat/${encodeURIComponent(roomName)}` });
        }

        const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
        const hashedOwnerKey = rawOwnerKey ? await bcrypt.hash(rawOwnerKey, BCRYPT_ROUNDS) : hashedKey;
        const ownerToken = crypto.randomBytes(32).toString('hex');
        const newRoom = new ChatRoom({ name: roomName, accessKey: hashedKey, ownerKey: hashedOwnerKey, ownerToken });
        await newRoom.save();
        res.status(201).json({ redirectUrl: `/chat/${encodeURIComponent(roomName)}`, ownerToken });
    } catch (err) {
        log('error', 'Chat room joining error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/chat/:name/change-key
 * Rotates the chat room access key (owner only).
 */
async function changeChatKey(req, res) {
    if (!handleValidation(req, res)) return;
    const roomName = String(req.params.name || '').trim().slice(0, MAX_NAME_LEN);
    const { ownerToken, newKey } = req.body;
    try {
        const room = await ChatRoom.findOne({ name: roomName });
        if (!room) return res.status(404).json({ error: 'Room not found.' });
        if (!room.ownerToken || !timingSafeMatch(room.ownerToken, String(ownerToken)))
            return res.status(403).json({ error: 'Only the room owner can change the access key.' });
        const hashedKey = await bcrypt.hash(newKey.trim(), BCRYPT_ROUNDS);
        await ChatRoom.updateOne({ name: roomName }, { accessKey: hashedKey });
        log('info', `[CHANGE-KEY] Chat room "${roomName}" key rotated.`);
        res.json({ success: true });
    } catch (err) {
        log('error', 'Change chat key error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** Validation rules for joinOrCreateChat */
const joinChatValidation = [
    body('room')
        .isString().trim().notEmpty().withMessage('Room name is required.')
        .isLength({ max: MAX_NAME_LEN }).withMessage(`Room name must not exceed ${MAX_NAME_LEN} characters.`)
        .matches(/^[\w\s\-().]+$/).withMessage('Room name contains invalid characters.'),
    body('accessKey')
        .isString().trim()
        .isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN })
        .withMessage(`Access key must be between ${MIN_KEY_LEN} and ${MAX_KEY_LEN} characters.`)
];

/** Validation rules for changeChatKey */
const changeChatKeyValidation = [
    body('ownerToken').isString().notEmpty().withMessage('Owner token required.'),
    body('newKey').isString().trim().isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN })
        .withMessage(`New key must be ${MIN_KEY_LEN}–${MAX_KEY_LEN} characters.`)
];

module.exports = { joinOrCreateChat, changeChatKey, joinChatValidation, changeChatKeyValidation };
