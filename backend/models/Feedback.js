/**
 * @file models/Feedback.js
 * @description Mongoose schema for user feedback submitted via the Help page.
 */

const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    name: { type: String, maxlength: 100 },
    email: { type: String, maxlength: 254 },
    message: { type: String, required: true, maxlength: 2000 },
    rating: { type: Number, min: 1, max: 5 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Feedback', feedbackSchema);
