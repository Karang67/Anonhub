/**
 * @file backend/server.js
 * @description Core Express server and Socket.IO real-time collaboration hub.
 * Integrates MongoDB for persisting collaborative document markup, Monaco editor code files,
 * whiteboard state graphs, project attachments (saved directly as binary buffers), and message logs.
 * Includes security-gating token verification for room access and document management.
 *
 * SECURITY ENHANCEMENTS:
 * - helmet.js for HTTP security headers (CSP, HSTS, X-Frame-Options, etc.)
 * - Explicit CORS policy via ALLOWED_ORIGINS env variable
 * - express-rate-limit on all REST API endpoints
 * - Socket.IO per-event rate limiting
 * - bcryptjs hashing for all access keys at rest
 * - httpOnly + secure cookie flags
 * - Input validation and length constraints via express-validator
 * - File upload type whitelist and size limit
 * - Removed localhost auto-grant vulnerability
 * - Environment variable startup validation
 * - Production-safe structured logging
 * - MongoDB compound indexes for scalability
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');

// Load local environment variables from root .env file when present.
// This keeps secrets out of source code and works for local development.
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .forEach(line => {
            const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (!match) return;
            const [, key, rawValue] = match;
            if (process.env[key] !== undefined) return;
            let value = rawValue.trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        });
}
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { body, param, validationResult } = require('express-validator');
const { compileAndRun } = require('./compiler');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const os = require('os');

// ─────────────────────────────────────────────────────────────────────────────
// Environment & Config
// ─────────────────────────────────────────────────────────────────────────────

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
// Support both `MONGODB_URI` (preferred) and legacy `MONGO_URI` env var names.
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/anonhub-db';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// Mail configuration (optional). If not provided, emails will not be sent.
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = (process.env.SMTP_SECURE === 'true');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || '';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || '';
const MAILGUN_BASE_URL = process.env.MAILGUN_BASE_URL || `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}`;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || `no-reply@${os.hostname()}`;
// Default admin recipient (falls back to the email you provided)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'loveinsights880@gmail.com';
const ADMIN_PAGE_KEY = process.env.ADMIN_PAGE_KEY || 'anonhub-admin-key';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'anonhub-secret-key';
const ADMIN_SESSION_COOKIE = process.env.ADMIN_SESSION_COOKIE || 'anonhub_admin_session';
const ADMIN_SESSION_MAX_AGE = Number(process.env.ADMIN_SESSION_MAX_AGE || 7 * 24 * 60 * 60 * 1000); // 7 days

let mailTransport = null;
let mailDeliveryEnabled = false;
let useMailgunApi = false;

if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
    useMailgunApi = true;
    mailDeliveryEnabled = true;
    log('info', 'Mailgun API configured for email delivery.');
} else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    mailTransport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    // Verify transport in background and disable email delivery if auth fails
    mailTransport.verify()
        .then(() => {
            mailDeliveryEnabled = true;
            log('info', 'SMTP transport verified.');
        })
        .catch(err => {
            mailTransport = null;
            mailDeliveryEnabled = false;
            log('warn', 'SMTP transport verification failed; feedback email delivery disabled.', err);
        });
} else {
    log('info', 'Mailgun and SMTP not configured — feedback emails will not be sent. Set MAILGUN_* or SMTP_* env vars to enable.');
}

function generateAdminSessionToken() {
    return crypto.createHmac('sha256', ADMIN_SESSION_SECRET)
        .update(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`)
        .digest('hex');
}

function requireAdminAuth(req, res, next) {
    const sessionToken = req.cookies[ADMIN_SESSION_COOKIE];
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey || req.body.adminKey;
    if (sessionToken === generateAdminSessionToken() || adminKey === ADMIN_PAGE_KEY) {
        return next();
    }
    return res.status(403).json({ error: 'Unauthorized access.' });
}

async function sendFeedbackEmail(mailOpts) {
    if (useMailgunApi) {
        const form = new URLSearchParams();
        form.append('from', mailOpts.from);
        form.append('to', mailOpts.to);
        form.append('subject', mailOpts.subject);
        form.append('text', mailOpts.text);
        form.append('html', mailOpts.html);

        const response = await fetch(`${MAILGUN_BASE_URL}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`
            },
            body: form
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Mailgun send failed: ${response.status} ${body}`);
        }

        return response.text();
    }

    if (mailTransport) {
        return mailTransport.sendMail(mailOpts);
    }

    throw new Error('No mail transport configured.');
}

// In development: allow ALL origins so any device on the local network can connect.
// In production: lock down to the comma-separated list in ALLOWED_ORIGINS env var.
const PROD_ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [];

// Backwards-compatible alias: some older branches reference `ALLOWED_ORIGINS`.
// Ensure it always exists to avoid ReferenceError during startup.
const ALLOWED_ORIGINS = PROD_ALLOWED_ORIGINS;


// File upload limits
const MAX_FILE_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || '10485760', 10); // 10 MB default
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

// Input constraints
const MAX_NAME_LEN = 100;
const MAX_KEY_LEN = 128;
const MIN_KEY_LEN = 4;
const MAX_MESSAGE_LEN = 2000;
const MAX_CODE_LEN = 50000;
const BCRYPT_ROUNDS = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Startup validation
// ─────────────────────────────────────────────────────────────────────────────

function log(level, ...args) {
    const prefix = { info: 'ℹ️ ', warn: '⚠️ ', error: '❌', debug: '🔍' }[level] || '';
    if (level === 'debug' && IS_PROD) return; // suppress debug in production
    console[level === 'error' ? 'error' : 'log'](`${prefix}`, ...args);
}

if (!GEMINI_API_KEY) {
    log('warn', 'GEMINI_API_KEY is not set — AI assistant will run in mock mode.');
}
if (!process.env.MONGODB_URI) {
    log('warn', 'MONGODB_URI is not set — using local MongoDB fallback.');
}
if (IS_PROD && PROD_ALLOWED_ORIGINS.some(o => o.includes('localhost'))) {
    log('warn', 'Production mode detected but ALLOWED_ORIGINS still contains localhost.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini AI
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1';
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ─────────────────────────────────────────────────────────────────────────────
// Multer — in-memory file storage with type & size validation
// ─────────────────────────────────────────────────────────────────────────────

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type "${file.mimetype}" is not allowed.`));
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Express & Socket.IO Setup
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Register compression early to compress all text/static responses
app.use(compression());

// Trust the first proxy hop so express-rate-limit can resolve client IPs
// from X-Forwarded-For headers without throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
app.set('trust proxy', 1);

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!IS_PROD) {
                // Development: allow ALL origins so any LAN device can connect
                return callback(null, true);
            }
            // Production: strict whitelist from ALLOWED_ORIGINS env var
            if (!origin || PROD_ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                log('warn', `[CORS] Blocked origin: ${origin}`);
                callback(new Error(`Origin ${origin} is not allowed.`));
            }
        },
        methods: ['GET', 'POST']
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// MongoDB Connection
// ─────────────────────────────────────────────────────────────────────────────

mongoose.connect(MONGO_URI)
    .then(() => log('info', 'Connected to MongoDB.'))
    .catch(err => {
        log('error', 'Could not connect to MongoDB:', err);
        if (IS_PROD) {
            process.exit(1);
        }
    });

// ─────────────────────────────────────────────────────────────────────────────
// Database Schemas & Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Project Schema — access key is stored as a bcrypt hash.
 */
const projectSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: MAX_NAME_LEN },
    accessKey: { type: String, required: true },   // bcrypt hash
    content: { type: String, default: '' },
    whiteboard: { type: String, default: '{}' },
    code: { type: String, default: '// Start coding in VS Code style here...\n' },
    codeLanguage: { type: String, default: 'javascript' },
    attachments: { type: String, default: '[]' },
    notes: { type: String, default: '[]' },
    polls: { type: String, default: '[]' },
    snippets: { type: String, default: '[]' },
    ownerToken: { type: String }
});

/**
 * ChatRoom Schema — access key is stored as a bcrypt hash.
 */
const chatRoomSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: MAX_NAME_LEN },
    accessKey: { type: String, required: true },   // bcrypt hash
    ownerToken: { type: String }
});

/**
 * Message Schema — compound index for fast per-room history queries.
 * reactions: array of { emoji, users[] } for emoji reaction support.
 */
const messageSchema = new mongoose.Schema({
    room: { type: String, index: true },
    username: String,
    msg: { type: String, maxlength: MAX_MESSAGE_LEN },
    timestamp: { type: Date, default: Date.now },
    reactions: [{
        emoji: { type: String, maxlength: 8 },
        users: [{ type: String, maxlength: 60 }]
    }]
});
messageSchema.index({ room: 1, timestamp: -1 });

/**
 * Attachment Schema — binary file blob stored in MongoDB.
 */
const attachmentSchema = new mongoose.Schema({
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
    timestamp: { type: Date, default: Date.now, index: true }
});

/**
 * ProjectVersion Schema — stores auto-saved snapshots for undo/restore.
 * Keeps last 10 versions per project+type combination.
 */
const projectVersionSchema = new mongoose.Schema({
    projectName: { type: String, required: true, index: true },
    type: { type: String, enum: ['document', 'code'], required: true },
    content: { type: String, required: true },
    language: { type: String, default: 'javascript' }, // for code versions
    comment: { type: String, default: '' },
    savedAt: { type: Date, default: Date.now, index: true }
});
projectVersionSchema.index({ projectName: 1, type: 1, savedAt: -1 });

const Project = mongoose.model('Project', projectSchema);
const Message = mongoose.model('Message', messageSchema);
const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);
const Attachment = mongoose.model('Attachment', attachmentSchema);
const ProjectVersion = mongoose.model('ProjectVersion', projectVersionSchema);

/**
 * Feedback Schema — simple store for user feedback submitted via the Help page
 */
const feedbackSchema = new mongoose.Schema({
    name: { type: String, maxlength: 100 },
    email: { type: String, maxlength: 254 },
    message: { type: String, required: true, maxlength: 2000 },
    rating: { type: Number, min: 1, max: 5 },
    createdAt: { type: Date, default: Date.now }
});

const Feedback = mongoose.model('Feedback', feedbackSchema);

/**
 * OfficeRoom Schema — access key is stored as a bcrypt hash.
 */
const officeRoomSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: MAX_NAME_LEN },
    accessKey: { type: String, required: true },   // bcrypt hash
    ownerToken: { type: String },
    spreadsheet: { type: String, default: '[]' },
    wordContent: { type: String, default: '' },
    notes: { type: String, default: '[]' },
    kanban: { type: String, default: '[]' }
});

const OfficeRoom = mongoose.model('OfficeRoom', officeRoomSchema);

/**
 * Saves a project version snapshot. Keeps max 10 per project+type.
 */
async function saveProjectVersion(projectName, type, content, language = 'javascript', comment = '') {
    try {
        await ProjectVersion.create({ projectName, type, content, language, comment });
        // Trim to last 10 versions
        const all = await ProjectVersion.find({ projectName, type })
            .sort({ savedAt: -1 })
            .select('_id')
            .exec();
        if (all.length > 10) {
            const toDelete = all.slice(10).map(v => v._id);
            await ProjectVersion.deleteMany({ _id: { $in: toDelete } });
        }
    } catch (err) {
        log('warn', '[VERSION] Failed to save version snapshot:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Security Middleware
// ─────────────────────────────────────────────────────────────────────────────

// HTTP Security Headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",  // Required for TinyMCE and Monaco inline scripts
                "'unsafe-eval'",    // Required for Monaco editor
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com",
                "https://unpkg.com"
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            // Allow WebSocket connections to any host (needed for LAN access from other devices)
            connectSrc: ["'self'", "wss:", "ws:", "http:", "https:"],
            workerSrc: ["'self'", "blob:"],
            // TinyMCE renders its editor inside an iframe loaded from cdnjs
            frameSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"],
            // Monaco editor uses blob: workers
            childSrc: ["'self'", "blob:"],
        }
    },
    crossOriginEmbedderPolicy: false, // Disabled: required for Monaco editor workers
}));

// CORS for Express HTTP routes
// Development: open to all origins (LAN access). Production: env-configured whitelist.
const corsOptions = {
    origin: IS_PROD
        ? (origin, callback) => {
            if (!origin || PROD_ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error(`Origin ${origin} is not allowed.`));
            }
        }
        : true, // allow all in dev
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// Cookie parser
app.use(cookieParser());

// Body parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiters
// ─────────────────────────────────────────────────────────────────────────────

const makeRateLimiter = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Skip X-Forwarded-For validation errors in dev; trust proxy handles this in prod
    validate: { xForwardedForHeader: false },
    message: { error: message }
});

const apiLimiter = makeRateLimiter(60_000, 60, 'Too many requests. Please slow down.');
const compileLimiter = makeRateLimiter(60_000, 10, 'Compile rate limit exceeded. Max 10 per minute.');
const aiChatLimiter = makeRateLimiter(60_000, 15, 'AI chat rate limit exceeded. Max 15 per minute.');
const uploadLimiter = makeRateLimiter(60_000, 10, 'Upload rate limit exceeded. Max 10 per minute.');
const authLimiter = makeRateLimiter(60_000, 20, 'Too many auth attempts. Max 20 per minute.');

// Apply general API rate limiter to all /api/* routes
app.use('/api/', apiLimiter);

app.post('/api/admin/login', authLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
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
});

app.post('/api/admin/logout', requireAdminAuth, (req, res) => {
    res.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
    res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Duplicate rate limiter block removed (defined earlier).

// ─────────────────────────────────────────────────────────────────────────────
// Utility Helpers
// ─────────────────────────────────────────────────────────────────────────────

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
 * Checks whether a string looks like a bcrypt hash.
 * bcrypt hashes always start with $2a$ or $2b$ and are 60 chars long.
 * @param {string} str
 * @returns {boolean}
 */
function isBcryptHash(str) {
    return typeof str === 'string' && /^\$2[ab]\$\d{2}\$/.test(str) && str.length === 60;
}

/**
 * Backward-compatible access key verification.
 * - If the stored key is already a bcrypt hash  → use bcrypt.compare()
 * - If the stored key is plain-text (legacy)    → compare directly,
 *   then rehash & persist the key so future logins use bcrypt.
 *
 * @param {string} inputKey     - The raw key the user typed
 * @param {string} storedKey    - The key stored in MongoDB (hash or plain-text)
 * @param {Function} rehashFn   - async fn() called when a legacy key is migrated
 * @returns {Promise<boolean>}
 */
async function verifyAccessKey(inputKey, storedKey, rehashFn) {
    if (isBcryptHash(storedKey)) {
        // Modern path: stored value is already a bcrypt hash
        return bcrypt.compare(inputKey, storedKey);
    }
    // Legacy path: stored value is plain-text — compare directly
    if (inputKey === storedKey) {
        // Silently migrate to bcrypt on successful login
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

/**
 * Parse cookies from raw Cookie header (used in Socket.IO handshake).
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
 */
function handleValidation(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(422).json({ error: errors.array()[0].msg });
        return false;
    }
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Username Cookie Middleware
// ─────────────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
    if (req.method === 'GET') {
        const ext = path.extname(req.path);
        if (!ext || ext === '.html') {
            if (!req.cookies['anonhub-username']) {
                const newUsername = generateRandomName();
                // Session cookie (no maxAge) — the username persists only while the
                // browser is open, matching the "same browser session" requirement.
                res.cookie('anonhub-username', newUsername, {
                    path: '/',
                    sameSite: 'lax',
                    httpOnly: false,         // Must be readable by client JS for display
                    secure: IS_PROD,         // HTTPS-only in production
                    // No maxAge — this makes it a session cookie that expires when browser closes
                });
            }
            if (!req.cookies['anonhub-session-id']) {
                const newSessionId = crypto.randomBytes(16).toString('hex');
                res.cookie('anonhub-session-id', newSessionId, {
                    path: '/',
                    sameSite: 'lax',
                    httpOnly: false,         // Must be readable by client JS
                    secure: IS_PROD,         // HTTPS-only in production
                });
            }
        }
    }
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Static Files
// ─────────────────────────────────────────────────────────────────────────────

const staticPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(staticPath, {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.includes('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory User Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks socket connections to usernames and active rooms.
 * Maps socket.id -> { username: String, rooms: Set<String> }
 */
const activeUsers = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO Per-Event Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-socket event rate tracker.
 * Maps socket.id -> { event -> { count, resetAt } }
 */
const socketRateLimits = new Map();

/**
 * Returns true if the socket is within rate limit for the given event.
 * @param {string} socketId
 * @param {string} event
 * @param {number} maxPerWindow - max events allowed
 * @param {number} windowMs - time window in ms
 */
function checkSocketRateLimit(socketId, event, maxPerWindow = 30, windowMs = 10_000) {
    if (!socketRateLimits.has(socketId)) {
        socketRateLimits.set(socketId, {});
    }
    const limits = socketRateLimits.get(socketId);
    const now = Date.now();
    if (!limits[event] || now > limits[event].resetAt) {
        limits[event] = { count: 1, resetAt: now + windowMs };
        return true;
    }
    limits[event].count++;
    return limits[event].count <= maxPerWindow;
}

// ─────────────────────────────────────────────────────────────────────────────
// REST API Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @api {post} /upload Upload Attachment File
 */
app.post('/upload',
    uploadLimiter,
    upload.single('file'),
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }
        try {
            const safeFilename = sanitizeFilename(req.file.originalname);
            const newAttachment = new Attachment({
                filename: safeFilename,
                contentType: req.file.mimetype,
                data: req.file.buffer
            });
            const saved = await newAttachment.save();
            const fileUrl = `/api/attachments/${saved._id}`;
            res.json({ location: fileUrl });
        } catch (err) {
            log('error', 'File save to MongoDB error:', err);
            res.status(500).json({ error: 'Database storage error.' });
        }
    }
);

// Multer error handler (file type/size rejections)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || (err && err.message && err.message.includes('not allowed'))) {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

/**
 * @api {get} /api/attachments/:id Download/Stream Attachment
 */
app.get('/api/attachments/:id', preventCache, async (req, res) => {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
        return res.status(400).send('Invalid attachment ID.');
    }
    try {
        const attachment = await Attachment.findById(id);
        if (!attachment) {
            return res.status(404).send('File not found.');
        }
        res.set('Content-Type', attachment.contentType);
        res.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
        res.send(Buffer.from(attachment.data));
    } catch (err) {
        log('error', 'File retrieval error:', err);
        res.status(500).send('Database error.');
    }
});

/**
 * @api {post} /api/compile Compile and Run Code
 */
app.post('/api/compile',
    compileLimiter,
    [
        body('language').isString().trim().notEmpty().withMessage('Language is required.'),
        body('code').isString().isLength({ max: MAX_CODE_LEN }).withMessage(`Code must not exceed ${MAX_CODE_LEN} characters.`)
    ],
    async (req, res) => {
        if (!handleValidation(req, res)) return;
        const { code, language } = req.body;
        try {
            const result = await compileAndRun(code, language);
            res.json(result);
        } catch (err) {
            log('error', 'Compilation execution error:', err);
            res.status(500).json({ error: 'Internal execution error.' });
        }
    }
);

/**
 * @api {post} /api/ai-chat AI Chat Assistant
 */
app.post('/api/ai-chat',
    aiChatLimiter,
    [
        body('message').isString().trim().notEmpty().isLength({ max: 4000 }).withMessage('Message must be between 1 and 4000 characters.')
    ],
    async (req, res) => {
        if (!handleValidation(req, res)) return;
        const { message, history } = req.body;
        try {
            if (genAI) {
                const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }, { apiVersion: GEMINI_API_VERSION });
                let formattedHistory = Array.isArray(history)
                    ? history.map(msg => ({
                        role: msg.role === 'user' ? 'user' : 'model',
                        parts: [{ text: msg.parts?.[0]?.text || msg.text || '' }]
                    }))
                    : [];

                formattedHistory = formattedHistory
                    .filter(entry => entry.parts[0].text.trim().length > 0);

                if (formattedHistory.length === 0 || formattedHistory[0].role !== 'user') {
                    formattedHistory = [];
                }

                const chat = formattedHistory.length
                    ? model.startChat({ history: formattedHistory })
                    : model.startChat();
                const result = await chat.sendMessage(message);
                const response = await result.response;
                const text = response.text();
                res.json({ response: text });
            } else {
                log('info', `[AI CHAT MOCK] Replying to query.`);
                const mockText = `🤖 **[AnonHub AI Assistant - Mock Mode]**\n\nI am currently running in mock mode because no \`GEMINI_API_KEY\` was found.\n\nTo activate full capabilities, set the \`GEMINI_API_KEY\` environment variable and restart the server.\n\n*Mocking response to: "${message}"*`;
                res.json({ response: mockText });
            }
        } catch (err) {
            log('error', 'Gemini API execution error:', err);
            res.status(500).json({ error: 'AI Assistant failed to generate a response.' });
        }
    }
);

/**
 * @api {post} /create-project Create or Open Project
 * Access key is bcrypt-hashed before storage. Comparison uses bcrypt.compare().
 */
app.post('/create-project',
    authLimiter,
    [
        body('name')
            .isString().trim().notEmpty().withMessage('Project name is required.')
            .isLength({ max: MAX_NAME_LEN }).withMessage(`Project name must not exceed ${MAX_NAME_LEN} characters.`)
            .matches(/^[\w\s\-().]+$/).withMessage('Project name contains invalid characters.'),
        body('accessKey')
            .isString().trim()
            .isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN })
            .withMessage(`Access key must be between ${MIN_KEY_LEN} and ${MAX_KEY_LEN} characters.`)
    ],
    async (req, res) => {
        if (!handleValidation(req, res)) return;
        try {
            const projectName = req.body.name.trim();
            const accessKey = req.body.accessKey.trim();

            const existingProject = await Project.findOne({ name: projectName });
            if (existingProject) {
                const match = await verifyAccessKey(
                    accessKey,
                    existingProject.accessKey,
                    (newHash) => Project.updateOne({ name: projectName }, { accessKey: newHash })
                );
                if (!match) {
                    return res.status(403).json({ error: 'Incorrect access key for this project.' });
                }
                // Return redirectUrl without ownerToken to secure ownership
                return res.status(200).json({
                    redirectUrl: `/projects/${encodeURIComponent(projectName)}`
                });
            }

            const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
            const ownerToken = crypto.randomBytes(32).toString('hex');
            const newProject = new Project({ name: projectName, accessKey: hashedKey, ownerToken });
            await newProject.save();

            // ── Auto-link: create the chat room with the same name/key/token ──────────
            // This lets the project creator also own the chat room with the same name.
            try {
                const existingChat = await ChatRoom.findOne({ name: projectName });
                if (!existingChat) {
                    const chatRoom = new ChatRoom({ name: projectName, accessKey: hashedKey, ownerToken });
                    await chatRoom.save();
                    log('info', `[AUTO-LINK] Created linked chat room for project "${projectName}".`);
                }
            } catch (chatErr) {
                // Non-fatal: project was saved; chat link failure is acceptable
                log('warn', `[AUTO-LINK] Could not auto-create chat room: ${chatErr.message}`);
            }

            res.status(201).json({ redirectUrl: `/projects/${encodeURIComponent(projectName)}`, ownerToken });

        } catch (err) {
            log('error', 'Project creation/opening error:', err);
            res.status(500).json({ error: 'Server error.' });
        }
    }
);

/**
 * @api {post} /create-office Create or Join Office Workspace Room
 * Access key is bcrypt-hashed before storage. Comparison uses bcrypt.compare().
 */
app.post('/create-office',
    authLimiter,
    [
        body('name')
            .isString().trim().notEmpty().withMessage('Office room name is required.')
            .isLength({ max: MAX_NAME_LEN }).withMessage(`Office room name must not exceed ${MAX_NAME_LEN} characters.`)
            .matches(/^[\w\s\-().]+$/).withMessage('Office room name contains invalid characters.'),
        body('accessKey')
            .isString().trim()
            .isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN })
            .withMessage(`Access key must be between ${MIN_KEY_LEN} and ${MAX_KEY_LEN} characters.`)
    ],
    async (req, res) => {
        if (!handleValidation(req, res)) return;
        try {
            const officeName = req.body.name.trim();
            const accessKey = req.body.accessKey.trim();

            const existingOffice = await OfficeRoom.findOne({ name: officeName });
            if (existingOffice) {
                const match = await verifyAccessKey(
                    accessKey,
                    existingOffice.accessKey,
                    (newHash) => OfficeRoom.updateOne({ name: officeName }, { accessKey: newHash })
                );
                if (!match) {
                    return res.status(403).json({ error: 'Incorrect access key for this Office Board.' });
                }
                return res.status(200).json({
                    redirectUrl: `/office/${encodeURIComponent(officeName)}`
                });
            }

            const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
            const ownerToken = crypto.randomBytes(32).toString('hex');
            const newOffice = new OfficeRoom({ name: officeName, accessKey: hashedKey, ownerToken });
            await newOffice.save();

            res.status(201).json({ redirectUrl: `/office/${encodeURIComponent(officeName)}`, ownerToken });
        } catch (err) {
            log('error', 'Office creation/opening error:', err);
            res.status(500).json({ error: 'Server error.' });
        }
    }
);

/**
 * @api {post} /join-chat Create or Join Chat Room
 * Access key is bcrypt-hashed before storage.
 */
app.post('/join-chat',
    authLimiter,
    [
        body('room')
            .isString().trim().notEmpty().withMessage('Room name is required.')
            .isLength({ max: MAX_NAME_LEN }).withMessage(`Room name must not exceed ${MAX_NAME_LEN} characters.`)
            .matches(/^[\w\s\-().]+$/).withMessage('Room name contains invalid characters.'),
        body('accessKey')
            .isString().trim()
            .isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN })
            .withMessage(`Access key must be between ${MIN_KEY_LEN} and ${MAX_KEY_LEN} characters.`)
    ],
    async (req, res) => {
        if (!handleValidation(req, res)) return;
        try {
            const roomName = req.body.room.trim();
            const accessKey = req.body.accessKey.trim();

            const existingRoom = await ChatRoom.findOne({ name: roomName });
            if (existingRoom) {
                const match = await verifyAccessKey(
                    accessKey,
                    existingRoom.accessKey,
                    (newHash) => ChatRoom.updateOne({ name: roomName }, { accessKey: newHash })
                );
                if (!match) {
                    return res.status(403).json({ error: 'Incorrect access key for this chat room.' });
                }
                // Return redirectUrl without ownerToken to secure ownership
                return res.status(200).json({
                    redirectUrl: `/chat/${encodeURIComponent(roomName)}`
                });
            }

            const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
            const ownerToken = crypto.randomBytes(32).toString('hex');
            const newRoom = new ChatRoom({ name: roomName, accessKey: hashedKey, ownerToken });
            await newRoom.save();
            res.status(201).json({ redirectUrl: `/chat/${encodeURIComponent(roomName)}`, ownerToken });

        } catch (err) {
            log('error', 'Chat room joining error:', err);
            res.status(500).json({ error: 'Server error.' });
        }
    }
);

/**
 * @api {post} /api/project/:name/change-key  Change Project Access Key (owner only)
 */
app.post('/api/project/:name/change-key',
    authLimiter,
    [
        body('ownerToken').isString().notEmpty().withMessage('Owner token required.'),
        body('newKey').isString().trim().isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN }).withMessage(`New key must be ${MIN_KEY_LEN}–${MAX_KEY_LEN} characters.`)
    ],
    async (req, res) => {
        if (!handleValidation(req, res)) return;
        const projectName = String(req.params.name || '').trim().slice(0, MAX_NAME_LEN);
        const { ownerToken, newKey } = req.body;
        try {
            const project = await Project.findOne({ name: projectName });
            if (!project) return res.status(404).json({ error: 'Project not found.' });
            if (!project.ownerToken || project.ownerToken !== ownerToken)
                return res.status(403).json({ error: 'Only the project owner can change the access key.' });
            const hashedKey = await bcrypt.hash(newKey.trim(), BCRYPT_ROUNDS);
            await Project.updateOne({ name: projectName }, { accessKey: hashedKey });
            // Also update linked chat room if it exists
            await ChatRoom.updateOne({ name: projectName }, { accessKey: hashedKey });
            log('info', `[CHANGE-KEY] Project "${projectName}" key rotated.`);
            res.json({ success: true, message: 'Access key updated. Share the new key with collaborators.' });
        } catch (err) {
            log('error', 'Change key error:', err);
            res.status(500).json({ error: 'Server error.' });
        }
    }
);

/**
 * @api {post} /api/chat/:name/change-key  Change Chat Room Access Key (owner only)
 */
app.post('/api/chat/:name/change-key',
    authLimiter,
    [
        body('ownerToken').isString().notEmpty().withMessage('Owner token required.'),
        body('newKey').isString().trim().isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN }).withMessage(`New key must be ${MIN_KEY_LEN}–${MAX_KEY_LEN} characters.`)
    ],
    async (req, res) => {
        if (!handleValidation(req, res)) return;
        const roomName = String(req.params.name || '').trim().slice(0, MAX_NAME_LEN);
        const { ownerToken, newKey } = req.body;
        try {
            const room = await ChatRoom.findOne({ name: roomName });
            if (!room) return res.status(404).json({ error: 'Room not found.' });
            if (!room.ownerToken || room.ownerToken !== ownerToken)
                return res.status(403).json({ error: 'Only the room owner can change the access key.' });
            const hashedKey = await bcrypt.hash(newKey.trim(), BCRYPT_ROUNDS);
            await ChatRoom.updateOne({ name: roomName }, { accessKey: hashedKey });
            log('info', `[CHANGE-KEY] Chat room "${roomName}" key rotated.`);
            res.json({ success: true });
        } catch (err) {
            log('error', 'Change chat key error:', err);
            res.status(500).json({ error: 'Server error.' });
        }
    }
);

/**
 * @api {get} /api/versions/:projectName  Get version history for a project
 */
app.get('/api/versions/:projectName', preventCache, async (req, res) => {
    const projectName = String(req.params.projectName || '').trim().slice(0, MAX_NAME_LEN);
    const type = req.query.type === 'code' ? 'code' : 'document';
    try {
        const versions = await ProjectVersion.find({ projectName, type })
            .sort({ savedAt: -1 })
            .limit(10)
            .select('_id type savedAt language comment')
            .exec();
        res.json(versions);
    } catch (err) {
        log('error', 'Version history error:', err);
        res.status(500).json({ error: 'Failed to load version history.' });
    }
});

/**
 * @api {post} /api/feedback Submit user feedback from Help page
 */
app.post('/api/feedback',
    apiLimiter,
    [
        body('name').optional().isString().trim().isLength({ max: 100 }).withMessage('Name is too long.'),
        body('email').optional().isEmail().withMessage('Invalid email address.'),
        body('message').isString().trim().notEmpty().isLength({ max: 2000 }).withMessage('Message is required and must be under 2000 characters.'),
        body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5.'),
    ],
    async (req, res) => {
        if (!handleValidation(req, res)) return;
        try {
            const { name, email, message, rating } = req.body;
            const fb = new Feedback({ name: name || undefined, email: email || undefined, message, rating: rating || undefined });
            await fb.save();
            // Optionally: emit an admin socket event or send an email here.
            // Only attempt email delivery if a provider is actually enabled.
            if (ADMIN_EMAIL && mailDeliveryEnabled) {
                try {
                    const mailOpts = {
                        from: MAIL_FROM,
                        to: ADMIN_EMAIL,
                        subject: `New feedback received`,
                        text: `Name: ${fb.name || '—'}\nEmail: ${fb.email || '—'}\nRating: ${fb.rating || '—'}\n\nMessage:\n${fb.message}`,
                        html: `<p><strong>Name:</strong> ${fb.name || '—'}</p><p><strong>Email:</strong> ${fb.email || '—'}</p><p><strong>Rating:</strong> ${fb.rating || '—'}</p><hr/><p>${(fb.message || '').replace(/\n/g, '<br/>')}</p>`
                    };
                    await sendFeedbackEmail(mailOpts);
                    log('info', 'Feedback email sent to', ADMIN_EMAIL);
                } catch (err) {
                    log('warn', 'Feedback email send failed; feedback stored without notification.', err);
                }
            } else {
                log('debug', 'Email delivery disabled or not configured; feedback saved only to the database.');
            }
            res.json({ success: true });
        } catch (err) {
            log('error', 'Failed to save feedback:', err);
            res.status(500).json({ error: 'Failed to save feedback.' });
        }
    }
);

app.get('/api/admin/feedback', preventCache, requireAdminAuth, async (req, res) => {
    try {
        const feedback = await Feedback.find().sort({ createdAt: -1 }).limit(200).lean().exec();
        res.json(feedback.map(item => ({
            id: item._id,
            name: item.name || 'Anonymous',
            email: item.email || 'N/A',
            rating: item.rating || null,
            message: item.message,
            createdAt: item.createdAt,
        })));
    } catch (err) {
        log('error', 'Admin feedback list error:', err);
        res.status(500).json({ error: 'Failed to load feedback.' });
    }
});

app.get('/api/admin/feedback/status', preventCache, requireAdminAuth, (req, res) => {
    res.json({
        emailDeliveryEnabled: mailDeliveryEnabled,
        emailProvider: useMailgunApi ? 'mailgun' : (mailTransport ? 'smtp' : 'none'),
        adminEmail: ADMIN_EMAIL,
        message: mailDeliveryEnabled
            ? 'Email notifications are enabled.'
            : 'Email notifications are disabled. Feedback is still stored in the database.'
    });
});

/**
 * @api {get} /api/versions/:id/content  Get specific version content
 */
app.get('/api/versions/:id/content', preventCache, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid version ID.' });
    try {
        const version = await ProjectVersion.findById(req.params.id).select('content language type savedAt').exec();
        if (!version) return res.status(404).json({ error: 'Version not found.' });
        res.json(version);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load version.' });
    }
});

/**
 * @api {delete} /api/versions/:id  Delete a specific version history entry
 */
app.delete('/api/versions/:id', async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid version ID.' });
    try {
        const version = await ProjectVersion.findById(req.params.id).exec();
        if (!version) return res.status(404).json({ error: 'Version not found.' });

        const { projectName, type } = version;
        await ProjectVersion.findByIdAndDelete(req.params.id).exec();

        // Notify other clients in the project room to refresh history
        io.to(projectName).emit('version list updated', { type });

        res.json({ success: true, message: 'Version history deleted successfully.' });
    } catch (err) {
        log('error', 'Delete version error:', err);
        res.status(500).json({ error: 'Failed to delete version.' });
    }
});

/**
 * @api {get} /api/messages/:room  Paginated chat history
 * Returns up to 50 messages before the given timestamp (for "Load older" button).
 * Query params: ?before=<ISO timestamp>&limit=<1-50>
 */
app.get('/api/messages/:room', preventCache, async (req, res) => {
    const room = String(req.params.room || '').trim().slice(0, MAX_NAME_LEN);
    if (!room) return res.status(400).json({ error: 'Room name required.' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 50);
    const before = req.query.before ? new Date(req.query.before) : new Date();
    if (isNaN(before.getTime())) return res.status(400).json({ error: 'Invalid before timestamp.' });
    try {
        const messages = await Message.find({ room, timestamp: { $lt: before } })
            .sort({ timestamp: -1 })
            .limit(limit)
            .exec();
        res.json(messages.reverse());
    } catch (err) {
        log('error', 'Message pagination error:', err);
        res.status(500).json({ error: 'Failed to load messages.' });
    }
});

// SPA catch-all
app.get('/*splat', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO — Real-Time Messaging & State Synchronization
// ─────────────────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
    const cookies = parseHandshakeCookies(socket.handshake.headers.cookie);

    // Resolve user identity: prefer the client-sent auth.username (from sessionStorage)
    // so users navigating between pages within the same browser session keep their name.
    // Fall back to the persistent cookie if the client sends no username, then generate a new one.
    let username = socket.handshake.auth?.username || cookies['anonhub-username'];
    if (!username || typeof username !== 'string' || username.trim() === '') {
        username = generateRandomName();
    } else {
        // Sanitize and truncate username
        username = username.trim().slice(0, 50).replace(/[<>"'&]/g, '');
    }

    // Resolve user browser session ID: read from cookie or client-sent auth handshake,
    // fallback to a newly generated unique session identifier.
    let sessionId = cookies['anonhub-session-id'] || socket.handshake.auth?.sessionId;
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        sessionId = crypto.randomBytes(16).toString('hex');
    }

    activeUsers.set(socket.id, { username, sessionId, rooms: new Set() });
    socket.emit('set username', username);
    socket.emit('set session id', sessionId);
    log('debug', `Socket connected: ${socket.id} as "${username}" [Session: ${sessionId}]`);

    /**
     * Broadcasts the updated active user roster for a room.
     */
    const updateRoomUsers = (room) => {
        const usersInRoom = [];
        for (const [id, userData] of activeUsers.entries()) {
            if (userData.rooms.has(room)) {
                usersInRoom.push({ id, username: userData.username });
            }
        }
        io.to(room).emit('room users', usersInRoom);
    };

    /**
     * Joins a Socket.IO channel, seeds message history, and broadcasts user entry.
     */
    const joinRoom = async (room) => {
        socket.join(room);
        const userData = activeUsers.get(socket.id);
        if (userData) userData.rooms.add(room);

        const currentName = userData ? userData.username : username;
        log('info', `[${room}] "${currentName}" joined.`);

        const messages = await Message.find({ room }).sort({ timestamp: -1 }).limit(50).exec();
        socket.emit('load messages', messages.reverse());

        socket.to(room).emit('chat message', { username: 'System', msg: `${currentName} has joined.` });
        updateRoomUsers(room);
    };

    // ─── Event: join room ────────────────────────────────────────────────────

    socket.on('join room', async (data) => {
        let room = '', accessKey = '', clientOwnerToken = '';
        if (typeof data === 'string') {
            room = data;
        } else if (data && typeof data === 'object') {
            room = String(data.room || '').trim().slice(0, MAX_NAME_LEN);
            accessKey = String(data.accessKey || '').trim().slice(0, MAX_KEY_LEN);
            clientOwnerToken = String(data.ownerToken || '').trim();
        }
        if (!room) return;

        // Rate limit join events
        if (!checkSocketRateLimit(socket.id, 'join room', 5, 30_000)) {
            socket.emit('error', 'Too many join attempts. Please wait.');
            return;
        }

        try {
            let chatRoom = await ChatRoom.findOne({ name: room });
            let newlyCreated = false;
            if (!chatRoom) {
                if (accessKey && accessKey.length >= MIN_KEY_LEN) {
                    const ownerToken = crypto.randomBytes(32).toString('hex');
                    const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
                    chatRoom = new ChatRoom({ name: room, accessKey: hashedKey, ownerToken });
                    await chatRoom.save();
                    socket.emit('set owner token', ownerToken);
                    newlyCreated = true;
                } else {
                    socket.emit('access denied', { room, type: 'chat', message: 'Access key required' });
                    return;
                }
            } else {
                const match = await verifyAccessKey(
                    accessKey,
                    chatRoom.accessKey,
                    (newHash) => ChatRoom.updateOne({ name: room }, { accessKey: newHash })
                );
                if (!match) {
                    socket.emit('access denied', { room, type: 'chat', message: 'Incorrect access key' });
                    return;
                }
            }

            // Determine ownership via token comparison only (no localhost bypass)
            let currentOwnerToken = chatRoom.ownerToken;
            let isOwner = false;

            if (newlyCreated) {
                isOwner = true;
            } else if (!currentOwnerToken) {
                // Legacy: generate ownerToken for rooms created before this update
                currentOwnerToken = crypto.randomBytes(32).toString('hex');
                await ChatRoom.updateOne({ name: room }, { ownerToken: currentOwnerToken });
                socket.emit('set owner token', currentOwnerToken);
                isOwner = true;
            } else {
                // Secure constant-time comparison to prevent timing attacks
                isOwner = clientOwnerToken.length > 0 &&
                    crypto.timingSafeEqual(
                        Buffer.from(clientOwnerToken.padEnd(64, '0').slice(0, 64)),
                        Buffer.from(currentOwnerToken.padEnd(64, '0').slice(0, 64))
                    ) && clientOwnerToken === currentOwnerToken;

                // Cross-ownership: if token didn't match the chat room's token,
                // check if the client owns the PROJECT with the same name.
                // A project creator automatically owns the linked chat room.
                if (!isOwner && clientOwnerToken.length > 0) {
                    const linkedProject = await Project.findOne({ name: room, ownerToken: clientOwnerToken });
                    if (linkedProject) {
                        isOwner = true;
                        log('info', `[CROSS-OWNERSHIP] Chat room "${room}" ownership granted via matching project token.`);
                    }
                }

                // Re-send token to client so it can re-cache it if localStorage was cleared
                if (isOwner) {
                    socket.emit('set owner token', currentOwnerToken);
                }
            }

            socket.isOwner = isOwner;
            socket.emit('is owner', isOwner);
            await joinRoom(room);
            socket.emit('join success', { room });

        } catch (err) {
            log('error', 'Socket join room error:', err);
            socket.emit('error', 'Server validation error');
        }
    });

    // ─── Event: join project ─────────────────────────────────────────────────

    socket.on('join project', async (data) => {
        let projectName = '', accessKey = '', clientOwnerToken = '';
        if (typeof data === 'string') {
            projectName = data;
        } else if (data && typeof data === 'object') {
            projectName = String(data.projectName || '').trim().slice(0, MAX_NAME_LEN);
            accessKey = String(data.accessKey || '').trim().slice(0, MAX_KEY_LEN);
            clientOwnerToken = String(data.ownerToken || '').trim();
        }
        if (!projectName) return;

        // Rate limit join events
        if (!checkSocketRateLimit(socket.id, 'join project', 5, 30_000)) {
            socket.emit('error', 'Too many join attempts. Please wait.');
            return;
        }

        try {
            let project = await Project.findOne({ name: projectName });
            if (!project) {
                if (accessKey && accessKey.length >= MIN_KEY_LEN) {
                    const ownerToken = crypto.randomBytes(32).toString('hex');
                    const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
                    try {
                        project = new Project({ name: projectName, accessKey: hashedKey, ownerToken });
                        await project.save();
                        socket.emit('set owner token', ownerToken);
                    } catch (saveErr) {
                        if (saveErr.code === 11000) {
                            // Race condition: another client created the project first
                            project = await Project.findOne({ name: projectName });
                        } else {
                            throw saveErr;
                        }
                    }
                } else {
                    socket.emit('access denied', { room: projectName, type: 'project', message: 'Access key required' });
                    return;
                }
            } else {
                const match = await verifyAccessKey(
                    accessKey,
                    project.accessKey,
                    (newHash) => Project.updateOne({ name: projectName }, { accessKey: newHash })
                );
                if (!match) {
                    socket.emit('access denied', { room: projectName, type: 'project', message: 'Incorrect access key' });
                    return;
                }
            }

            await joinRoom(projectName);
            const refreshedProject = await Project.findOne({ name: projectName });
            if (refreshedProject) {
                let currentOwnerToken = refreshedProject.ownerToken;
                let isOwner = false;

                if (!currentOwnerToken) {
                    currentOwnerToken = crypto.randomBytes(32).toString('hex');
                    await Project.updateOne({ name: projectName }, { ownerToken: currentOwnerToken });
                    socket.emit('set owner token', currentOwnerToken);
                    isOwner = true;
                } else {
                    // Secure constant-time comparison — no localhost bypass
                    isOwner = clientOwnerToken.length > 0 &&
                        crypto.timingSafeEqual(
                            Buffer.from(clientOwnerToken.padEnd(64, '0').slice(0, 64)),
                            Buffer.from(currentOwnerToken.padEnd(64, '0').slice(0, 64))
                        ) && clientOwnerToken === currentOwnerToken;

                    // Re-send token to client so it can re-cache it if localStorage was cleared
                    if (isOwner) {
                        socket.emit('set owner token', currentOwnerToken);
                    }
                }

                socket.isOwner = isOwner;
                socket.emit('is owner', isOwner);
                socket.emit('project content', refreshedProject.content);
                socket.emit('whiteboard content', refreshedProject.whiteboard);
                socket.emit('code content', {
                    code: refreshedProject.code || '// Start coding in VS Code style here...\n',
                    language: refreshedProject.codeLanguage || 'javascript'
                });
                socket.emit('attachments content', refreshedProject.attachments || '[]');
                socket.emit('notes content', refreshedProject.notes || '[]');
                socket.emit('polls content', refreshedProject.polls || '[]');
                socket.emit('snippets content', refreshedProject.snippets || '[]');
            }
            socket.emit('join success', { room: projectName });

        } catch (err) {
            log('error', 'Socket join project error:', err);
            socket.emit('error', 'Server validation error');
        }
    });

    // ─── Event: join office ──────────────────────────────────────────────────

    socket.on('join office', async (data) => {
        let officeName = '', accessKey = '', clientOwnerToken = '';
        if (typeof data === 'string') {
            officeName = data;
        } else if (data && typeof data === 'object') {
            officeName = String(data.officeName || '').trim().slice(0, MAX_NAME_LEN);
            accessKey = String(data.accessKey || '').trim().slice(0, MAX_KEY_LEN);
            clientOwnerToken = String(data.ownerToken || '').trim();
        }
        if (!officeName) return;

        if (!checkSocketRateLimit(socket.id, 'join office', 5, 30_000)) {
            socket.emit('error', 'Too many join attempts. Please wait.');
            return;
        }

        try {
            let office = await OfficeRoom.findOne({ name: officeName });
            if (!office) {
                if (accessKey && accessKey.length >= MIN_KEY_LEN) {
                    const ownerToken = crypto.randomBytes(32).toString('hex');
                    const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
                    try {
                        office = new OfficeRoom({ name: officeName, accessKey: hashedKey, ownerToken });
                        await office.save();
                        socket.emit('set owner token', ownerToken);
                    } catch (saveErr) {
                        if (saveErr.code === 11000) {
                            office = await OfficeRoom.findOne({ name: officeName });
                        } else {
                            throw saveErr;
                        }
                    }
                } else {
                    socket.emit('access denied', { room: officeName, type: 'office', message: 'Access key required' });
                    return;
                }
            } else {
                const match = await verifyAccessKey(
                    accessKey,
                    office.accessKey,
                    (newHash) => OfficeRoom.updateOne({ name: officeName }, { accessKey: newHash })
                );
                if (!match) {
                    socket.emit('access denied', { room: officeName, type: 'office', message: 'Incorrect access key' });
                    return;
                }
            }

            await joinRoom(officeName);
            const refreshedOffice = await OfficeRoom.findOne({ name: officeName });
            if (refreshedOffice) {
                let currentOwnerToken = refreshedOffice.ownerToken;
                let isOwner = false;

                if (!currentOwnerToken) {
                    currentOwnerToken = crypto.randomBytes(32).toString('hex');
                    await OfficeRoom.updateOne({ name: officeName }, { ownerToken: currentOwnerToken });
                    socket.emit('set owner token', currentOwnerToken);
                    isOwner = true;
                } else {
                    isOwner = clientOwnerToken.length > 0 &&
                        crypto.timingSafeEqual(
                            Buffer.from(clientOwnerToken.padEnd(64, '0').slice(0, 64)),
                            Buffer.from(currentOwnerToken.padEnd(64, '0').slice(0, 64))
                        ) && clientOwnerToken === currentOwnerToken;

                    if (isOwner) {
                        socket.emit('set owner token', currentOwnerToken);
                    }
                }

                socket.isOwner = isOwner;
                socket.emit('is owner', isOwner);
                socket.emit('office data', {
                    spreadsheet: refreshedOffice.spreadsheet || '[]',
                    wordContent: refreshedOffice.wordContent || '',
                    notes: refreshedOffice.notes || '[]',
                    kanban: refreshedOffice.kanban || '[]'
                });
            }
            socket.emit('join success', { room: officeName });

        } catch (err) {
            log('error', 'Socket join office error:', err);
            socket.emit('error', 'Server validation error');
        }
    });

    // ─── Event: room message ─────────────────────────────────────────────────

    socket.on('room message', async (data) => {
        if (!checkSocketRateLimit(socket.id, 'room message', 30, 10_000)) {
            socket.emit('error', 'You are sending messages too fast. Please slow down.');
            return;
        }
        const room = String(data?.room || '').trim().slice(0, MAX_NAME_LEN);
        const msg = String(data?.msg || '').trim().slice(0, MAX_MESSAGE_LEN);
        const userData = activeUsers.get(socket.id);
        // Security: socket must be a verified member of this room
        if (userData && msg && room && userData.rooms.has(room)) {
            const newMessage = new Message({ room, username: userData.username, msg });
            await newMessage.save();
            io.to(room).emit('chat message', {
                _id: newMessage._id,
                username: userData.username,
                msg,
                timestamp: newMessage.timestamp
            });
        }
    });

    // ─── Event: delete message ───────────────────────────────────────────────

    socket.on('delete message', async (data) => {
        const { room, messageId } = data || {};
        if (!socket.isOwner) return;
        if (!isValidObjectId(messageId)) return;
        try {
            await Message.deleteOne({ _id: messageId });
            io.to(room).emit('message deleted', { messageId });
        } catch (err) {
            log('error', 'Error deleting message:', err);
        }
    });

    // ─── Event: delete messages (bulk) ───────────────────────────────────────

    socket.on('delete messages', async (data) => {
        const { room, messageIds } = data || {};
        if (!socket.isOwner) return;
        if (!Array.isArray(messageIds) || messageIds.length === 0) return;
        const validIds = messageIds.filter(id => isValidObjectId(id));
        if (validIds.length === 0) return;
        try {
            await Message.deleteMany({ _id: { $in: validIds } });
            io.to(room).emit('messages deleted', { messageIds: validIds });
        } catch (err) {
            log('error', 'Error bulk deleting messages:', err);
        }
    });

    // ─── Event: edit message ─────────────────────────────────────────────────

    socket.on('edit message', async (data) => {
        const { room, messageId } = data || {};
        const newMsg = String(data?.newMsg || '').trim().slice(0, MAX_MESSAGE_LEN);
        if (!socket.isOwner || !newMsg || !isValidObjectId(messageId)) return;
        try {
            await Message.updateOne({ _id: messageId }, { msg: newMsg });
            io.to(room).emit('message edited', { messageId, newMsg });
        } catch (err) {
            log('error', 'Error editing message:', err);
        }
    });

    socket.on('update username', (data) => {
        if (!checkSocketRateLimit(socket.id, 'update username', 5, 30_000)) {
            socket.emit('error', 'Too many nickname changes. Please wait.');
            return;
        }
        const newName = String(data?.username || '').trim().slice(0, 50).replace(/[<>"'&]/g, '');
        if (!newName) return;
        const userData = activeUsers.get(socket.id);
        if (!userData) return;
        const oldName = userData.username;
        const targetSessionId = userData.sessionId;

        // Synchronize nickname change across all tabs of the same session
        const roomsToNotify = new Set();
        for (const user of activeUsers.values()) {
            if (user.sessionId === targetSessionId) {
                user.rooms.forEach(r => roomsToNotify.add(r));
            }
        }

        for (const [id, user] of activeUsers.entries()) {
            if (user.sessionId === targetSessionId) {
                user.username = newName;
                io.to(id).emit('username updated', newName);
            }
        }

        roomsToNotify.forEach(room => {
            socket.to(room).emit('chat message', { username: 'System', msg: `${oldName} is now known as ${newName}` });
            updateRoomUsers(room);
        });
    });

    // ─── Event: typing ───────────────────────────────────────────────────────

    socket.on('typing', (data) => {
        if (!checkSocketRateLimit(socket.id, 'typing', 10, 5_000)) return;
        const userData = activeUsers.get(socket.id);
        if (userData) {
            const room = String(data?.room || '').trim().slice(0, MAX_NAME_LEN);
            socket.to(room).emit('typing', `${userData.username} is typing...`);
        }
    });

    // ─── Event: project update (with auto-versioning) ─────────────────────────

    let docUpdateCount = 0;
    socket.on('project update', async ({ projectName, content }) => {
        if (!checkSocketRateLimit(socket.id, 'project update', 20, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        // Security: verify the socket is a member of this room before writing
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        await Project.updateOne({ name }, { content });
        socket.to(name).emit('project content', content);
        // Auto-save version every 5 updates to avoid flooding DB
        docUpdateCount++;
        if (docUpdateCount % 5 === 0) {
            saveProjectVersion(name, 'document', content);
        }
    });

    // ─── Event: whiteboard update ────────────────────────────────────────────

    socket.on('whiteboard update', async ({ projectName, content }) => {
        if (!checkSocketRateLimit(socket.id, 'whiteboard update', 20, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        // Security: verify the socket is a member of this room before writing
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        await Project.updateOne({ name }, { whiteboard: content });
        socket.to(name).emit('whiteboard content', content);
    });

    // ─── Event: code update (with auto-versioning) ────────────────────────────

    let codeUpdateCount = 0;
    socket.on('code update', async ({ projectName, code, language }) => {
        if (!checkSocketRateLimit(socket.id, 'code update', 20, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        const safeCode = String(code || '').slice(0, MAX_CODE_LEN);
        if (!name) return;
        // Security: verify the socket is a member of this room before writing
        const ud = activeUsers.get(socket.id);
        if (!ud || !ud.rooms.has(name)) return;
        await Project.updateOne({ name }, { code: safeCode, codeLanguage: language });
        socket.to(name).emit('code content', { code: safeCode, language });
        // Auto-save version every 5 code updates
        codeUpdateCount++;
        if (codeUpdateCount % 5 === 0) {
            saveProjectVersion(name, 'code', safeCode, language || 'javascript');
        }
    });

    // ─── Event: join-call-room (lightweight room join for video call pages) ──
    // Unlike 'join room', this does NOT require a ChatRoom document in MongoDB.
    // It simply joins the socket to the Socket.IO presence room, broadcasts user
    // entry, and seeds chat history — allowing CallRoom.jsx to show user rosters
    // and receive messages without needing a pre-existing ChatRoom record.
    socket.on('join-call-room', async ({ room, accessKey }, callback) => {
        const name = String(room || '').trim().slice(0, MAX_NAME_LEN);
        const key = String(accessKey || '').trim().slice(0, MAX_KEY_LEN);
        if (!name) {
            if (typeof callback === 'function') callback({ error: 'Invalid room name' });
            return;
        }

        if (!checkSocketRateLimit(socket.id, 'join-call-room', 5, 30_000)) {
            if (typeof callback === 'function') callback({ error: 'Too many join attempts' });
            return;
        }

        // Try to validate against a Project or ChatRoom if one exists.
        // If neither exists, allow entry so a fresh call room can be created without pre-setup.
        try {
            const existingProject = await Project.findOne({ name }).exec();
            const existingChat = await ChatRoom.findOne({ name }).exec();

            if (existingProject) {
                const match = await verifyAccessKey(key, existingProject.accessKey,
                    (newHash) => Project.updateOne({ name }, { accessKey: newHash }));
                if (!match) {
                    if (typeof callback === 'function') callback({ error: 'Incorrect access key' });
                    return;
                }
            } else if (existingChat) {
                const match = await verifyAccessKey(key, existingChat.accessKey,
                    (newHash) => ChatRoom.updateOne({ name }, { accessKey: newHash }));
                if (!match) {
                    if (typeof callback === 'function') callback({ error: 'Incorrect access key' });
                    return;
                }
            }
            // If no record found — allow entry (fresh call room)

            await joinRoom(name);
            if (typeof callback === 'function') callback({ success: true });
        } catch (err) {
            log('error', 'Socket join-call-room error:', err);
            if (typeof callback === 'function') callback({ error: 'Server error' });
        }
    });

    // ─── WebRTC Signaling events ─────────────────────────────────────────────
    socket.on('webrtc-join-call', ({ projectName }, callback) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) {
            if (typeof callback === 'function') callback({ error: 'Invalid room name' });
            return;
        }

        const roomName = `${name}-webrtc`;
        const roomClients = io.sockets.adapter.rooms.get(roomName);
        const existingPeers = [];
        if (roomClients) {
            roomClients.forEach(clientId => {
                if (clientId !== socket.id) {
                    const u = activeUsers.get(clientId)?.username || 'Participant';
                    existingPeers.push({ socketId: clientId, username: u });
                }
            });
        }

        socket.join(roomName);
        const peerUsername = activeUsers.get(socket.id)?.username || 'Participant';
        socket.to(roomName).emit('webrtc-user-joined', { socketId: socket.id, username: peerUsername });
        if (typeof callback === 'function') callback({ success: true, existingPeers });
    });

    socket.on('webrtc-leave-call', ({ projectName }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        socket.leave(`${name}-webrtc`);
        socket.to(`${name}-webrtc`).emit('webrtc-user-left', { socketId: socket.id });
    });

    socket.on('webrtc-signal', ({ targetId, signal }) => {
        const senderUsername = activeUsers.get(socket.id)?.username || 'Participant';
        io.to(targetId).emit('webrtc-signal', {
            senderId: socket.id,
            senderUsername,
            signal
        });
    });

    // ─── MoQ Signaling & Roster Sync ──────────────────────────────────────────
    socket.on('moq-join-room', ({ projectName, username }, callback) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const roomName = `${name}-moq`;
        socket.join(roomName);
        const peerUsername = username || activeUsers.get(socket.id)?.username || 'Participant';
        socket.to(roomName).emit('moq-user-joined', { socketId: socket.id, username: peerUsername });
        if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('moq-leave-room', ({ projectName }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        socket.leave(`${name}-moq`);
        socket.to(`${name}-moq`).emit('moq-user-left', { socketId: socket.id });
    });

    socket.on('moq-packet', ({ projectName, packet }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        socket.to(`${name}-moq`).emit('moq-packet', { senderId: socket.id, packet });
    });

    // ─── Event: mic-status (relay mute state to room peers) ───────────
    socket.on('mic-status', ({ projectName, muted }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        // Relay to everyone else in WebRTC & MoQ signaling rooms
        socket.to(`${name}-webrtc`).to(`${name}-moq`).emit('peer-mic-status', {
            socketId: socket.id,
            muted: !!muted
        });
    });

    // ─── Event: update polls ─────────────────────────────────────────────────
    socket.on('update polls', async ({ projectName, polls }) => {
        if (!checkSocketRateLimit(socket.id, 'update polls', 30, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;

        try {
            await Project.updateOne({ name }, { polls });
            socket.to(name).emit('polls content', polls);
        } catch (err) {
            log('error', 'Polls update error:', err);
        }
    });

    // ─── Event: update snippets ──────────────────────────────────────────────
    socket.on('update snippets', async ({ projectName, snippets }) => {
        if (!checkSocketRateLimit(socket.id, 'update snippets', 30, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;

        try {
            await Project.updateOne({ name }, { snippets });
            socket.to(name).emit('snippets content', snippets);
        } catch (err) {
            log('error', 'Snippets update error:', err);
        }
    });

    // ─── Event: office spreadsheet update ────────────────────────────────────

    socket.on('update spreadsheet', async ({ officeName, spreadsheet }) => {
        if (!checkSocketRateLimit(socket.id, 'update spreadsheet', 30, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;

        try {
            await OfficeRoom.updateOne({ name }, { spreadsheet });
            socket.to(name).emit('spreadsheet content', spreadsheet);
        } catch (err) {
            log('error', 'Spreadsheet update error:', err);
        }
    });

    // ─── Event: office word update ───────────────────────────────────────────

    socket.on('update word', async ({ officeName, wordContent }) => {
        if (!checkSocketRateLimit(socket.id, 'update word', 30, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;

        try {
            await OfficeRoom.updateOne({ name }, { wordContent });
            socket.to(name).emit('word content', wordContent);
        } catch (err) {
            log('error', 'Word update error:', err);
        }
    });

    // ─── Event: office notes update ──────────────────────────────────────────

    socket.on('update office notes', async ({ officeName, notes }) => {
        if (!checkSocketRateLimit(socket.id, 'update office notes', 30, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;

        try {
            await OfficeRoom.updateOne({ name }, { notes });
            socket.to(name).emit('office notes content', notes);
        } catch (err) {
            log('error', 'Office notes update error:', err);
        }
    });

    // ─── Event: office kanban update ─────────────────────────────────────────

    socket.on('update kanban', async ({ officeName, kanban }) => {
        if (!checkSocketRateLimit(socket.id, 'update kanban', 30, 5_000)) return;
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;

        try {
            await OfficeRoom.updateOne({ name }, { kanban });
            socket.to(name).emit('kanban content', kanban);
        } catch (err) {
            log('error', 'Kanban update error:', err);
        }
    });

    // ─── Event: office group chat message ──────────────────────────────────

    socket.on('send chat message', ({ officeName, msg }) => {
        if (!checkSocketRateLimit(socket.id, 'send chat message', 30, 10_000)) {
            socket.emit('error', 'You are sending messages too fast. Please slow down.');
            return;
        }
        const name = String(officeName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name || !msg) return;
        const userData = activeUsers.get(socket.id);
        // Accept if tracked in userData.rooms OR if the socket is already in the room (mobile reconnect edge case)
        const inRoom = (userData && userData.rooms.has(name)) || socket.rooms.has(name);
        if (!inRoom) {
            log('warn', `[send chat message] Socket ${socket.id} not in room "${name}" — dropping.`);
            return;
        }

        const safeMsg = String(msg).trim().slice(0, MAX_MESSAGE_LEN);
        if (!safeMsg) return;

        const chatMsg = {
            username: (userData && userData.username) || 'Anonymous',
            msg: safeMsg,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // Broadcast to everyone in the room including the sender
        io.to(name).emit('chat message', chatMsg);
    });

    // ─── Event: add reaction ─────────────────────────────────────────────────

    socket.on('add reaction', async ({ room, messageId, emoji }) => {
        if (!checkSocketRateLimit(socket.id, 'add reaction', 20, 10_000)) return;
        if (!isValidObjectId(messageId)) return;
        const userData = activeUsers.get(socket.id);
        if (!userData) return;
        const safeEmoji = String(emoji || '').slice(0, 8);
        const roomName = String(room || '').trim().slice(0, MAX_NAME_LEN);
        try {
            const msg = await Message.findById(messageId);
            if (!msg || msg.room !== roomName) return;
            const existing = msg.reactions.find(r => r.emoji === safeEmoji);
            if (existing) {
                if (!existing.users.includes(userData.username)) {
                    existing.users.push(userData.username);
                }
            } else {
                msg.reactions.push({ emoji: safeEmoji, users: [userData.username] });
            }
            await msg.save();
            io.to(roomName).emit('reaction update', { messageId, reactions: msg.reactions });
        } catch (err) {
            log('error', 'Reaction add error:', err);
        }
    });

    // ─── Event: remove reaction ───────────────────────────────────────────────

    socket.on('remove reaction', async ({ room, messageId, emoji }) => {
        if (!checkSocketRateLimit(socket.id, 'remove reaction', 20, 10_000)) return;
        if (!isValidObjectId(messageId)) return;
        const userData = activeUsers.get(socket.id);
        if (!userData) return;
        const safeEmoji = String(emoji || '').slice(0, 8);
        const roomName = String(room || '').trim().slice(0, MAX_NAME_LEN);
        try {
            const msg = await Message.findById(messageId);
            if (!msg || msg.room !== roomName) return;
            const existing = msg.reactions.find(r => r.emoji === safeEmoji);
            if (existing) {
                existing.users = existing.users.filter(u => u !== userData.username);
                if (existing.users.length === 0) {
                    msg.reactions = msg.reactions.filter(r => r.emoji !== safeEmoji);
                }
            }
            await msg.save();
            io.to(roomName).emit('reaction update', { messageId, reactions: msg.reactions });
        } catch (err) {
            log('error', 'Reaction remove error:', err);
        }
    });

    // ─── Event: restore version ───────────────────────────────────────────────

    socket.on('restore version', async ({ projectName, versionId }) => {
        if (!isValidObjectId(versionId)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        try {
            const version = await ProjectVersion.findById(versionId);
            if (!version || version.projectName !== name) return;
            if (version.type === 'document') {
                if (!socket.isOwner) { socket.emit('error', 'Only the project owner can restore document versions.'); return; }
                await Project.updateOne({ name }, { content: version.content });
                io.to(name).emit('project content', version.content);
            } else {
                // Code versions can be restored by anyone in the room
                await Project.updateOne({ name }, { code: version.content, codeLanguage: version.language });
                io.to(name).emit('code content', { code: version.content, language: version.language });
            }
            socket.emit('version restored', { type: version.type, savedAt: version.savedAt });
            io.to(name).emit('version list updated', { type: version.type });
        } catch (err) {
            log('error', 'Restore version error:', err);
        }
    });

    // ─── Event: save version ─────────────────────────────────────────────────

    socket.on('save version', async ({ projectName, type, content, language, comment }) => {
        if (!checkSocketRateLimit(socket.id, 'save version', 15, 30_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;

        const safeComment = String(comment || '').trim().slice(0, 100);
        const safeContent = String(content || '');
        const safeLang = String(language || 'javascript');

        try {
            await saveProjectVersion(name, type, safeContent, safeLang, safeComment);
            socket.emit('version saved', { type, savedAt: new Date() });
            io.to(name).emit('version list updated', { type });
        } catch (err) {
            log('error', 'Manual save version error:', err);
        }
    });

    // ─── Event: notes update ─────────────────────────────────────────────────

    socket.on('notes update', async ({ projectName, notes }) => {
        if (!checkSocketRateLimit(socket.id, 'notes update', 30, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;

        try {
            await Project.updateOne({ name }, { notes });
            socket.to(name).emit('notes content', notes);
        } catch (err) {
            log('error', 'Notes update error:', err);
        }
    });

    // ─── Event: add attachment ───────────────────────────────────────────────

    socket.on('add attachment', async ({ projectName, file }) => {
        if (!checkSocketRateLimit(socket.id, 'add attachment', 5, 60_000)) {
            socket.emit('error', 'Attachment rate limit exceeded.');
            return;
        }
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        try {
            const project = await Project.findOne({ name });
            if (project) {
                const list = JSON.parse(project.attachments || '[]');
                list.push(file);
                const updated = JSON.stringify(list);
                await Project.updateOne({ name }, { attachments: updated });
                io.to(name).emit('attachments content', updated);
            }
        } catch (e) {
            log('error', 'Error adding attachment:', e);
        }
    });

    // ─── Event: remove attachment ────────────────────────────────────────────

    socket.on('remove attachment', async ({ projectName, fileUrl }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        const userData = activeUsers.get(socket.id);

        if (!userData || !userData.rooms.has(name)) {
            socket.emit('error', 'You must be joined in this project to delete attachments.');
            return;
        }
        try {
            const project = await Project.findOne({ name });
            if (project) {
                const list = JSON.parse(project.attachments || '[]');
                const fileToDelete = list.find(f => f.url === fileUrl);

                if (!fileToDelete) return;
                
                if (!socket.isOwner && fileToDelete.uploader !== userData.username) {
                    socket.emit('error', 'Only the project creator or the uploader can delete attachments.');
                    return;
                }

                const filteredList = list.filter(f => f.url !== fileUrl);
                const updated = JSON.stringify(filteredList);
                await Project.updateOne({ name }, { attachments: updated });
                io.to(name).emit('attachments content', updated);

                if (fileUrl && fileUrl.includes('/api/attachments/')) {
                    const parts = fileUrl.split('/');
                    const id = parts[parts.length - 1];
                    if (isValidObjectId(id)) {
                        await Attachment.findByIdAndDelete(id);
                    }
                }
            }
        } catch (e) {
            log('error', 'Error removing attachment:', e);
        }
    });

    // ─── Event: disconnect ───────────────────────────────────────────────────

    socket.on('disconnect', () => {
        const userData = activeUsers.get(socket.id);
        if (userData) {
            log('info', `Socket disconnected: "${userData.username}"`);
            userData.rooms.forEach(room => {
                io.to(room).emit('chat message', { username: 'System', msg: `${userData.username} has left.` });
                // Clean up WebRTC signaling room
                io.to(`${room}-webrtc`).emit('webrtc-user-left', { socketId: socket.id });
                updateRoomUsers(room);
            });
            activeUsers.delete(socket.id);
        }
        // Clean up per-socket rate limit state
        socketRateLimits.delete(socket.id);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static File Serving & SPA Catch-All (must be AFTER all API routes)
// ─────────────────────────────────────────────────────────────────────────────

const DIST_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');

if (fs.existsSync(DIST_DIR)) {
    // Serve built React assets (JS, CSS, images, etc.)
    app.use(express.static(DIST_DIR, {
        maxAge: IS_PROD ? '1y' : 0,
        etag: true
    }));

    // SPA catch-all: any route not matched by API handlers above falls through
    // to index.html so React Router can handle client-side navigation.
    // app.use matches all remaining requests without path-to-regexp parsing errors.
    app.use((req, res) => {
        res.sendFile(path.join(DIST_DIR, 'index.html'));
    });

    log('info', `Serving static frontend from: ${DIST_DIR}`);
} else {
    log('warn', `Frontend dist folder not found at ${DIST_DIR}. Run "npm run build" in the frontend directory.`);
    // In development, the Vite dev server handles the frontend separately
    app.use((req, res) => {
        res.status(404).json({ error: 'Frontend not built. Run npm run build in the frontend directory.' });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
    log('error', 'Unhandled server error:', err.message);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Server Startup
// ─────────────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    log('info', `🚀 AnonHub server running on http://localhost:${PORT} [${NODE_ENV}]`);
});
