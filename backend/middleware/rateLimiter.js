/**
 * @file middleware/rateLimiter.js
 * @description Centralized Express rate limiter instances for all API routes.
 * All limits are configurable via environment variables (RL_* prefix).
 */

const rateLimit = require('express-rate-limit');
const {
    RL_API_MAX, RL_AUTH_MAX, RL_ROOM_CREATE, RL_ROOM_JOIN,
    RL_COMPILE_MAX, RL_AI_MAX, RL_UPLOAD_MAX, RL_WINDOW_MS
} = require('../config/db');

/**
 * Factory for creating rate limiters with consistent configuration.
 * Always returns 429 with a JSON error body.
 */
const makeRateLimiter = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (req, res) => {
        res.status(429).json({ error: message });
    }
});

// General API calls (GET endpoints, misc)
const apiLimiter      = makeRateLimiter(RL_WINDOW_MS, RL_API_MAX,     'Too many requests. Please slow down.');

// Room creation (strict — prevent room spam)
const roomCreateLimiter = makeRateLimiter(RL_WINDOW_MS, RL_ROOM_CREATE, 'Room creation rate limit exceeded. Please wait before creating another room.');

// Room join attempts
const roomJoinLimiter   = makeRateLimiter(RL_WINDOW_MS, RL_ROOM_JOIN,  'Too many join attempts. Please wait before trying again.');

// Code compilation (resource-heavy)
const compileLimiter  = makeRateLimiter(RL_WINDOW_MS, RL_COMPILE_MAX, 'Compile rate limit exceeded. Max requests per minute reached.');

// AI chat (API cost)
const aiChatLimiter   = makeRateLimiter(RL_WINDOW_MS, RL_AI_MAX,      'AI chat rate limit exceeded. Please wait before sending more messages.');

// File uploads (storage-heavy)
const uploadLimiter   = makeRateLimiter(RL_WINDOW_MS, RL_UPLOAD_MAX,  'Upload rate limit exceeded. Please wait before uploading more files.');

// Auth endpoints (prevent brute-force)
const authLimiter     = makeRateLimiter(RL_WINDOW_MS, RL_AUTH_MAX,    'Too many authentication attempts. Please wait before trying again.');

module.exports = {
    apiLimiter, roomCreateLimiter, roomJoinLimiter,
    compileLimiter, aiChatLimiter, uploadLimiter, authLimiter
};
