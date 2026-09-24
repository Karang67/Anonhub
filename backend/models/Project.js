/**
 * @file models/Project.js
 * @description Mongoose schema for collaborative project rooms.
 * Access key is stored as a bcrypt hash.
 * Includes lifecycle fields: createdAt, lastActivityAt, status, storageUsed.
 */

const mongoose = require('mongoose');
const { MAX_NAME_LEN } = require('../config/db');

const projectSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: MAX_NAME_LEN },
    accessKey: { type: String, required: true },   // bcrypt hash
    ownerKey: { type: String },                    // bcrypt hash for dedicated owner key
    ownerToken: { type: String },
    content: { type: String, default: '' },
    whiteboard: { type: String, default: '{}' },
    code: { type: String, default: '// Start coding in VS Code style here...\n' },
    codeLanguage: { type: String, default: 'javascript' },
    attachments: { type: String, default: '[]' },
    notes: { type: String, default: '[]' },
    polls: { type: String, default: '[]' },
    snippets: { type: String, default: '[]' },
    permissions: {
        allowDraw:      { type: Boolean, default: true },
        allowDocWrite:  { type: Boolean, default: true },
        allowCodeWrite: { type: Boolean, default: true }
    },
    // ─── Lifecycle fields ─────────────────────────────────────────────────────
    status:         { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    createdAt:      { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    storageUsed:    { type: Number, default: 0 }   // bytes
});

projectSchema.index({ status: 1, lastActivityAt: 1 });

module.exports = mongoose.model('Project', projectSchema);
