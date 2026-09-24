/**
 * @file models/ChatRoom.js
 * @description Mongoose schema for anonymous chat rooms.
 * Access key is stored as a bcrypt hash.
 * Includes lifecycle fields: createdAt, lastActivityAt, status, storageUsed.
 */

const mongoose = require('mongoose');
const { MAX_NAME_LEN } = require('../config/db');

const chatRoomSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: MAX_NAME_LEN },
    accessKey: { type: String, required: true },   // bcrypt hash
    ownerKey: { type: String },                    // bcrypt hash for dedicated owner key
    ownerToken: { type: String },
    permissions: {
        allowUserEdit:   { type: Boolean, default: false },
        allowUserDelete: { type: Boolean, default: false },
        allowUserUpload: { type: Boolean, default: true  }
    },
    // ─── Lifecycle fields ─────────────────────────────────────────────────────
    status:         { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    createdAt:      { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    storageUsed:    { type: Number, default: 0 }   // bytes
});

chatRoomSchema.index({ status: 1, lastActivityAt: 1 });

module.exports = mongoose.model('ChatRoom', chatRoomSchema);
