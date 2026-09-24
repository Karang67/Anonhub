/**
 * @file backend/server.js
 * @description AnonHub Express + Socket.IO application bootstrap.
 *
 * This file is intentionally kept lean — it only:
 *  1. Loads environment variables from root .env
 *  2. Configures Express middleware (security, CORS, body parsing, static files)
 *  3. Mounts all API route modules
 *  4. Registers Socket.IO handlers
 *  5. Starts the HTTP server
 *
 * Business logic lives in: controllers/, models/, middleware/, sockets/, utils/
 */

const dns = require('dns');
try {
    dns.setDefaultResultOrder('ipv4first');
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// ─── Load .env before anything else ──────────────────────────────────────────

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

// ─── Config & Utilities ───────────────────────────────────────────────────────

const { connectDB, runStartupChecks, isOriginAllowed, IS_PROD, PORT } = require('./config/db');
const { log } = require('./utils/logger');
const { generateRandomName } = require('./utils/helpers');

// ─── Route Modules ────────────────────────────────────────────────────────────

const { apiLimiter, roomCreateLimiter, roomJoinLimiter } = require('./middleware/rateLimiter');
const adminRoutes      = require('./routes/adminRoutes');
const attachmentRoutes = require('./routes/attachmentRoutes');
const compileRoutes    = require('./routes/compileRoutes');
const aiRoutes         = require('./routes/aiRoutes');
const projectRoutes    = require('./routes/projectRoutes');
const chatRoutes       = require('./routes/chatRoutes');
const officeRoutes     = require('./routes/officeRoutes');
const feedbackRoutes   = require('./routes/feedbackRoutes');
const versionRoutes    = require('./routes/versionRoutes');
const roomDeleteRoutes = require('./routes/roomDeleteRoutes');
const createFeatureRoutes = require('./routes/featureRoutes');
const { seedDefaultFeaturesAndRoles } = require('./config/featureRegistry');

// ─── Socket Handlers ──────────────────────────────────────────────────────────

const { registerSocketHandlers } = require('./sockets/index');
const { startCleanupScheduler } = require('./services/cleanupScheduler');

// ─── Run startup checks & connect DB ─────────────────────────────────────────

runStartupChecks();
connectDB().then(() => {
    seedDefaultFeaturesAndRoles();
}).catch(() => {});

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();

app.use(compression());
app.set('trust proxy', 1);

const server = http.createServer(app);

// ─── Socket.IO ────────────────────────────────────────────────────────────────

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin)) return callback(null, true);
            log('warn', `[CORS] Socket.IO Blocked origin: ${origin}`);
            return callback(new Error(`Origin ${origin} is not allowed.`));
        },
        credentials: true,
        methods: ['GET', 'POST']
    }
});

// ─── Security Middleware ──────────────────────────────────────────────────────

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "wss:", "ws:", "http:", "https:"],
            workerSrc: ["'self'", "blob:"],
            frameSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"],
            childSrc: ["'self'", "blob:"],
        }
    },
    crossOriginEmbedderPolicy: false,
}));

const corsOptions = {
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) return callback(null, true);
        log('warn', `[CORS] HTTP Blocked origin: ${origin}`);
        return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'ngrok-skip-browser-warning']
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── General API Rate Limiter ─────────────────────────────────────────────────

app.use('/api/', apiLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Username / Session Cookie Middleware ─────────────────────────────────────

app.use((req, res, next) => {
    if (req.method === 'GET') {
        const ext = path.extname(req.path);
        if (!ext || ext === '.html') {
            if (!req.cookies['trinetra-username'] && !req.cookies['anonhub-username']) {
                res.cookie('trinetra-username', generateRandomName(), {
                    path: '/', sameSite: 'lax', httpOnly: false, secure: IS_PROD
                });
            }
            if (!req.cookies['trinetra-session-id'] && !req.cookies['anonhub-session-id']) {
                res.cookie('trinetra-session-id', crypto.randomBytes(16).toString('hex'), {
                    path: '/', sameSite: 'lax', httpOnly: false, secure: IS_PROD
                });
            }
        }
    }
    next();
});

// ─── Static Files (production SPA catch-all below) ───────────────────────────
// Note: Static serving is handled by the SPA catch-all block below, which
// correctly serves from frontend/dist with appropriate cache settings.

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/admin',  adminRoutes);
app.use('/',           attachmentRoutes);
app.use('/api',        compileRoutes);
app.use('/api',        aiRoutes);
app.use('/',           projectRoutes);
app.use('/',           chatRoutes);
app.use('/',           officeRoutes);
app.use('/api',        feedbackRoutes);
app.use('/api',        versionRoutes(io));
app.use('/api',        roomDeleteRoutes(io));
app.use('/api',        createFeatureRoutes(io));

// ─── SPA Catch-all ────────────────────────────────────────────────────────────

const DIST_DIR = path.resolve(__dirname, '..', 'frontend', 'dist');

if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR, { maxAge: IS_PROD ? '1y' : 0, etag: true }));
    app.use((req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
    log('info', `Serving static frontend from: ${DIST_DIR}`);
} else {
    log('warn', `Frontend dist folder not found at ${DIST_DIR}. Run "npm run build" in the frontend directory.`);
    app.use((req, res) => res.status(404).json({ error: 'Frontend not built. Run npm run build in the frontend directory.' }));
}

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use((err, req, res, next) => {
    log('error', 'Unhandled Express error:', err);
    res.status(err.status || 500).json({
        error: IS_PROD ? 'An unexpected internal server error occurred.' : err.message
    });
});

// ─── Socket.IO Handler Registration ───────────────────────────────────────────

registerSocketHandlers(io);

// ─── Start Cleanup Scheduler ──────────────────────────────────────────────────

startCleanupScheduler();

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    log('info', `🚀 Trinetra server running on http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
