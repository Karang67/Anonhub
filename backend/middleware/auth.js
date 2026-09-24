/**
 * @file middleware/auth.js
 * @description Authentication middleware: admin session guard and access key verification.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
    ADMIN_SESSION_COOKIE, ADMIN_PAGE_KEY,
    ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_SECRET,
    BCRYPT_ROUNDS
} = require('../config/db');
const { log } = require('../utils/logger');

/**
 * Checks whether a string looks like a bcrypt hash.
 * bcrypt hashes always start with $2a$ or $2b$ and are 60 chars long.
 * @param {string} str
 * @returns {boolean}
 */
function isBcryptHash(str) {
    return typeof str === 'string' && /^\$2[ab]\$\d{2}\$/.test(str) && str.length === 60;
}

/**
 * Generates a deterministic HMAC-based admin session token.
 * @returns {string}
 */
function generateAdminSessionToken() {
    return crypto.createHmac('sha256', ADMIN_SESSION_SECRET)
        .update(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`)
        .digest('hex');
}

const { timingSafeMatch } = require('../utils/helpers');

/**
 * Express middleware that rejects requests without a valid admin session.
 */
function requireAdminAuth(req, res, next) {
    const sessionToken = req.cookies ? req.cookies[ADMIN_SESSION_COOKIE] : undefined;
    const adminKey = req.headers?.['x-admin-key'] || (req.body ? req.body.adminKey : undefined);
    const validSession = timingSafeMatch(sessionToken, generateAdminSessionToken());
    const validKey = adminKey && timingSafeMatch(String(adminKey), ADMIN_PAGE_KEY);
    if (validSession || validKey) {
        return next();
    }
    return res.status(403).json({ error: 'Unauthorized access.' });
}

/**
 * Backward-compatible access key verification.
 * - If the stored key is a bcrypt hash  → use bcrypt.compare()
 * - If the stored key is plain-text (legacy) → compare directly, then rehash & persist.
 *
 * @param {string} inputKey     - The raw key the user typed
 * @param {string} storedKey    - The key stored in MongoDB (hash or plain-text)
 * @param {Function} rehashFn   - async fn(newHash) called when a legacy key is migrated
 * @returns {Promise<boolean>}
 */
async function verifyAccessKey(inputKey, storedKey, rehashFn) {
    if (isBcryptHash(storedKey)) {
        return bcrypt.compare(inputKey, storedKey);
    }
    // Legacy plain-text path
    if (inputKey === storedKey) {
        try {
            const newHash = await bcrypt.hash(inputKey, BCRYPT_ROUNDS);
            await rehashFn(newHash);
            log('info', '[KEY MIGRATION] Rehashed legacy plain-text access key to bcrypt.');
        } catch (migErr) {
            log('error', '[KEY MIGRATION] Failed to rehash key:', migErr.message);
        }
        return true;
    }
    return false;
}

module.exports = { isBcryptHash, generateAdminSessionToken, requireAdminAuth, verifyAccessKey };
