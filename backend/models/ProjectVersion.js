/**
 * @file models/ProjectVersion.js
 * @description Mongoose schema for auto-saved project snapshots.
 * Keeps last 10 versions per project+type combination.
 */

const mongoose = require('mongoose');
const { MAX_NAME_LEN } = require('../config/db');

const projectVersionSchema = new mongoose.Schema({
    projectName: { type: String, required: true, index: true },
    type: { type: String, enum: ['document', 'code'], required: true },
    content: { type: String, required: true },
    language: { type: String, default: 'javascript' },
    comment: { type: String, default: '' },
    savedAt: { type: Date, default: Date.now, index: true }
});
projectVersionSchema.index({ projectName: 1, type: 1, savedAt: -1 });

module.exports = mongoose.model('ProjectVersion', projectVersionSchema);
