/**
 * @file controllers/adminController.js
 * @description Admin authentication: login and logout handlers.
 */

const { generateAdminSessionToken } = require('../middleware/auth');
const {
    ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_MAX_AGE, IS_PROD
} = require('../config/db');

const { timingSafeMatch } = require('../utils/helpers');

/**
 * POST /api/admin/login
 * Validates credentials and sets a session cookie on success.
 */
async function login(req, res) {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Username and password are required.' });
    }
    const isUserValid = timingSafeMatch(username.trim(), ADMIN_USERNAME);
    const isPassValid = timingSafeMatch(password, ADMIN_PASSWORD);
    if (!isUserValid || !isPassValid) {
        return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const token = generateAdminSessionToken();
    res.cookie(ADMIN_SESSION_COOKIE, token, {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        maxAge: ADMIN_SESSION_MAX_AGE,
        path: '/'
    });
    res.json({ success: true });
}

/**
 * POST /api/admin/logout
 * Clears the admin session cookie.
 */
function logout(req, res) {
    res.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
    res.json({ success: true });
}

module.exports = { login, logout };
