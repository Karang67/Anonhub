/**
 * @file models/Attachment.js
 * @description Mongoose schema for binary file attachments stored in MongoDB.
 */

const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
    timestamp: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('Attachment', attachmentSchema);
