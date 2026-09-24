/**
 * @file models/WhiteboardRoom.js
 * @description Mongoose schema for persistent multiplayer Whiteboard rooms.
 * Supports anonymous access with full real-time canvas state persistence.
 */

const mongoose = require('mongoose');
const { MAX_NAME_LEN } = require('../config/db');

const whiteboardRoomSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: MAX_NAME_LEN },
    snapshot: { type: String, default: '{}' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    createdAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    storageUsed: { type: Number, default: 0 }
});

whiteboardRoomSchema.index({ status: 1, lastActivityAt: 1 });

module.exports = mongoose.model('WhiteboardRoom', whiteboardRoomSchema);
