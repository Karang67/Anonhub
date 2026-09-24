/**
 * @file models/Message.js
 * @description Mongoose schema for chat messages.
 * Compound index for fast per-room history queries.
 * reactions: array of { emoji, users[] } for emoji reaction support.
 */

const mongoose = require('mongoose');
const { MAX_MESSAGE_LEN } = require('../config/db');

const messageSchema = new mongoose.Schema({
    room: { type: String, index: true },
    username: String,
    sessionId: { type: String, index: true },
    msg: { type: String, maxlength: MAX_MESSAGE_LEN },
    timestamp: { type: Date, default: Date.now },
    reactions: [{
        emoji: { type: String, maxlength: 8 },
        users: [{ type: String, maxlength: 60 }]
    }]
});
messageSchema.index({ room: 1, timestamp: -1 });

module.exports = mongoose.model('Message', messageSchema);
