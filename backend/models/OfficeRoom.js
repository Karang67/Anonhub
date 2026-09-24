/**
 * @file models/OfficeRoom.js
 * @description Mongoose schema for collaborative office workspace rooms.
 * Access key is stored as a bcrypt hash.
 * Includes lifecycle fields: createdAt, lastActivityAt, status, storageUsed.
 */

const mongoose = require('mongoose');
const { MAX_NAME_LEN } = require('../config/db');

const officeRoomSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: MAX_NAME_LEN },
    accessKey: { type: String, required: true },   // bcrypt hash
    ownerToken: { type: String },
    spreadsheet: { type: String, default: '[]' },
    wordContent: { type: String, default: '' },
    notes: { type: String, default: '[]' },
    kanban: { type: String, default: '[]' },
    // ─── Lifecycle fields ─────────────────────────────────────────────────────
    status:         { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    createdAt:      { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    storageUsed:    { type: Number, default: 0 }   // bytes
});

officeRoomSchema.index({ status: 1, lastActivityAt: 1 });

module.exports = mongoose.model('OfficeRoom', officeRoomSchema);
