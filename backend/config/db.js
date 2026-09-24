/**
 * @file config/db.js
 * @description MongoDB connection setup and all environment/config constants.
 */

const dns = require('dns');
try {
    dns.setDefaultResultOrder('ipv4first');
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {}

const mongoose = require('mongoose');
const { log } = require('../utils/logger');

// ─── Environment ──────────────────────────────────────────────────────────────

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/trinetra-db';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1';

// Mail
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = (process.env.SMTP_SECURE === 'true');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || '';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || '';
const MAILGUN_BASE_URL = process.env.MAILGUN_BASE_URL || `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}`;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || `no-reply@trinetra.app`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'loveinsights880@gmail.com';
const WEB3FORMS_ACCESS_KEY = process.env.WEB3FORMS_ACCESS_KEY || process.env.VITE_WEB3FORMS_ACCESS_KEY || '';

// Admin
const ADMIN_PAGE_KEY = process.env.ADMIN_PAGE_KEY || 'trinetra-admin-key';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'trinetra-secret-key';
const ADMIN_SESSION_COOKIE = process.env.ADMIN_SESSION_COOKIE || 'trinetra_admin_session';
const ADMIN_SESSION_MAX_AGE = Number(process.env.ADMIN_SESSION_MAX_AGE || 7 * 24 * 60 * 60 * 1000);

// Upload / Input constraints
const MAX_FILE_SIZE_MB = parseFloat(process.env.MAX_FILE_SIZE_MB || '10');
const MAX_FILE_SIZE_BYTES = Math.round(
    process.env.MAX_UPLOAD_SIZE_BYTES
        ? parseInt(process.env.MAX_UPLOAD_SIZE_BYTES, 10)
        : MAX_FILE_SIZE_MB * 1024 * 1024
);
const MAX_NAME_LEN = 100;
const MAX_KEY_LEN = 128;
const MIN_KEY_LEN = 4;
const MAX_MESSAGE_LEN = 2000;
const MAX_CODE_LEN = 50000;
const BCRYPT_ROUNDS = 10;

// ─── Room Lifecycle ───────────────────────────────────────────────────────────

const ROOM_INACTIVITY_DAYS = parseInt(process.env.ROOM_INACTIVITY_DAYS || '15', 10);
const ROOM_MAX_STORAGE_MB  = parseFloat(process.env.ROOM_MAX_STORAGE_MB || '100');
const ROOM_MAX_STORAGE_BYTES = Math.round(ROOM_MAX_STORAGE_MB * 1024 * 1024);
// Grace period after marking inactive before permanent deletion (default 2 days)
const ROOM_DELETE_GRACE_DAYS = parseInt(process.env.ROOM_DELETE_GRACE_DAYS || '2', 10);

// ─── Code Execution ───────────────────────────────────────────────────────────

const CODE_EXECUTION_TIMEOUT_MS = parseInt(process.env.CODE_EXECUTION_TIMEOUT_MS || '5000', 10);
const CODE_MEMORY_LIMIT_MB = parseInt(process.env.CODE_MEMORY_LIMIT_MB || '128', 10);
const CODE_MAX_OUTPUT_KB = parseInt(process.env.CODE_MAX_OUTPUT_KB || '512', 10);
const CODE_MAX_OUTPUT_BYTES = CODE_MAX_OUTPUT_KB * 1024;

// ─── Whiteboard ───────────────────────────────────────────────────────────────

const WHITEBOARD_MAX_OBJECTS = parseInt(process.env.WHITEBOARD_MAX_OBJECTS || '5000', 10);
const WHITEBOARD_MAX_PAYLOAD_KB = parseInt(process.env.WHITEBOARD_MAX_PAYLOAD_KB || '256', 10);
const WHITEBOARD_MAX_PAYLOAD_BYTES = WHITEBOARD_MAX_PAYLOAD_KB * 1024;

// ─── Rate Limits (env-configurable) ──────────────────────────────────────────

const RL_API_MAX        = parseInt(process.env.RL_API_MAX        || '60',  10);
const RL_AUTH_MAX       = parseInt(process.env.RL_AUTH_MAX       || '20',  10);
const RL_ROOM_CREATE    = parseInt(process.env.RL_ROOM_CREATE     || '5',   10);
const RL_ROOM_JOIN      = parseInt(process.env.RL_ROOM_JOIN       || '15',  10);
const RL_COMPILE_MAX    = parseInt(process.env.RL_COMPILE_MAX     || '10',  10);
const RL_AI_MAX         = parseInt(process.env.RL_AI_MAX          || '15',  10);
const RL_UPLOAD_MAX     = parseInt(process.env.RL_UPLOAD_MAX      || '10',  10);
const RL_WINDOW_MS      = parseInt(process.env.RL_WINDOW_MS       || '60000', 10);

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'text/plain', 'text/html', 'text/css', 'text/csv', 'text/markdown',
    'application/json', 'application/xml',
    'application/zip', 'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
]);

// ─── CORS ─────────────────────────────────────────────────────────────────────

const rawAllowed = [
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
].map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);

const PROD_ALLOWED_ORIGINS = Array.from(new Set(rawAllowed));

function isOriginAllowed(origin) {
    if (!origin) return true;
    if (!IS_PROD) return true;
    const cleanOrigin = origin.trim().replace(/\/+$/, '');
    if (PROD_ALLOWED_ORIGINS.length === 0) return false;
    return PROD_ALLOWED_ORIGINS.includes(cleanOrigin);
}

// ─── MongoDB Connection ───────────────────────────────────────────────────────

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI);
        log('info', 'Connected to MongoDB.');
    } catch (err) {
        log('error', 'Could not connect to MongoDB:', err);
        if (IS_PROD) process.exit(1);
    }
}

// ─── Startup Validation Warnings ─────────────────────────────────────────────

function runStartupChecks() {
    if (!GEMINI_API_KEY) {
        log('warn', 'GEMINI_API_KEY is not set — AI assistant will run in mock mode.');
    }
    if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
        log('warn', 'MONGODB_URI is not set — using local MongoDB fallback.');
    }
    if (ADMIN_PASSWORD === 'changeme123' || ADMIN_PAGE_KEY === 'trinetra-admin-key' || ADMIN_SESSION_SECRET === 'trinetra-secret-key') {
        log('warn', '⚠️ SECURITY RISK: Default admin credentials or session secret in use! Set ADMIN_PASSWORD, ADMIN_PAGE_KEY, and ADMIN_SESSION_SECRET in .env');
        if (IS_PROD) {
            log('error', '🚨 FATAL: Default admin credentials detected in production environment. Set secure values for ADMIN_PASSWORD, ADMIN_PAGE_KEY, and ADMIN_SESSION_SECRET before deploying.');
            process.exit(1);
        }
    }
    if (IS_PROD && PROD_ALLOWED_ORIGINS.some(o => o.includes('localhost'))) {
        log('warn', 'Production mode detected but ALLOWED_ORIGINS still contains localhost.');
    }
    log('info', `Room inactivity threshold: ${ROOM_INACTIVITY_DAYS} days | Max storage per room: ${ROOM_MAX_STORAGE_MB} MB`);
    log('info', `Code execution timeout: ${CODE_EXECUTION_TIMEOUT_MS}ms | Output cap: ${CODE_MAX_OUTPUT_KB}KB`);
}

module.exports = {
    NODE_ENV, IS_PROD, PORT, MONGO_URI,
    GEMINI_API_KEY, GEMINI_API_VERSION,
    SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
    MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_BASE_URL, MAIL_FROM,
    ADMIN_EMAIL, WEB3FORMS_ACCESS_KEY,
    ADMIN_PAGE_KEY, ADMIN_USERNAME, ADMIN_PASSWORD,
    ADMIN_SESSION_SECRET, ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE,
    MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES,
    MAX_NAME_LEN, MAX_KEY_LEN, MIN_KEY_LEN,
    MAX_MESSAGE_LEN, MAX_CODE_LEN, BCRYPT_ROUNDS,
    ALLOWED_MIME_TYPES,
    PROD_ALLOWED_ORIGINS,
    // Room lifecycle
    ROOM_INACTIVITY_DAYS, ROOM_MAX_STORAGE_MB, ROOM_MAX_STORAGE_BYTES,
    ROOM_DELETE_GRACE_DAYS,
    // Code execution
    CODE_EXECUTION_TIMEOUT_MS, CODE_MEMORY_LIMIT_MB,
    CODE_MAX_OUTPUT_KB, CODE_MAX_OUTPUT_BYTES,
    // Whiteboard
    WHITEBOARD_MAX_OBJECTS, WHITEBOARD_MAX_PAYLOAD_KB, WHITEBOARD_MAX_PAYLOAD_BYTES,
    // Rate limits
    RL_API_MAX, RL_AUTH_MAX, RL_ROOM_CREATE, RL_ROOM_JOIN,
    RL_COMPILE_MAX, RL_AI_MAX, RL_UPLOAD_MAX, RL_WINDOW_MS,
    isOriginAllowed, connectDB, runStartupChecks,
};
