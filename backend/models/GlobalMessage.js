/**
 * @file models/GlobalMessage.js
 * @description Mongoose schema for the global public anonymous chat messages.
 * Uses a rolling retention strategy (max 100 messages kept in database).
 */

const mongoose = require('mongoose');
const { MAX_MESSAGE_LEN } = require('../config/db');

const globalMessageSchema = new mongoose.Schema({
    guestId: { type: String, required: true, index: true },
    username: { type: String, required: true, maxlength: 60 },
    msg: { type: String, required: true, maxlength: MAX_MESSAGE_LEN },
    timestamp: { type: Date, default: Date.now, index: true },
    edited: { type: Boolean, default: false }
});

globalMessageSchema.index({ timestamp: -1 });

module.exports = mongoose.model('GlobalMessage', globalMessageSchema);
