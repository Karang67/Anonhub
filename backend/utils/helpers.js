/**
 * @file utils/helpers.js
 * @description Shared utility functions used across controllers, middleware, and sockets.
 */

const path = require('path');
const mongoose = require('mongoose');

/**
 * Generates an anonymous, developer-friendly pseudonym.
 * @returns {string} E.g. "Silent Voyager" or "Cosmic Fox"
 */
function generateRandomName() {
    const adjectives = ['Silent', 'Brave', 'Clever', 'Witty', 'Cosmic', 'Swift', 'Lunar', 'Neon', 'Phantom', 'Rogue'];
    const nouns = ['Fox', 'Dragon', 'Alchemist', 'Explorer', 'Voyager', 'Cipher', 'Specter', 'Oracle', 'Nomad', 'Sage'];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
}

/**
 * Prevent browser/proxy caching on dynamic API routes.
 */
function preventCache(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
}

/**
 * Sanitize a filename to prevent path traversal and remove dangerous characters.
 * @param {string} filename
 * @returns {string}
 */
function sanitizeFilename(filename) {
    return path.basename(filename).replace(/[^a-zA-Z0-9._\-() ]/g, '_');
}

/**
 * Validate that a string is a valid MongoDB ObjectId.
 * @param {string} id
 * @returns {boolean}
 */
function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Parse cookies from a raw Cookie header string (used in Socket.IO handshake).
 * @param {string} cookieHeader
 * @returns {Object}
 */
function parseHandshakeCookies(cookieHeader) {
    const cookies = {};
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            if (parts.length >= 2) {
                const name = parts.shift().trim();
                const value = parts.join('=').trim();
                cookies[name] = decodeURIComponent(value);
            }
        });
    }
    return cookies;
}

/**
 * Handle express-validator result — returns 422 if validation failed.
 * @returns {boolean} true if validation passed
 */
function handleValidation(req, res) {
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(422).json({ error: errors.array()[0].msg });
        return false;
    }
    return true;
}

/**
 * Secure, constant-time comparison for strings / tokens.
 * Returns false immediately if types differ or either is falsy.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeMatch(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const crypto = require('crypto');
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    try {
        return crypto.timingSafeEqual(bufA, bufB);
    } catch {
        return false;
    }
}

module.exports = {
    generateRandomName,
    preventCache,
    sanitizeFilename,
    isValidObjectId,
    parseHandshakeCookies,
    handleValidation,
    timingSafeMatch,
};
