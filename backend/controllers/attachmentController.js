/**
 * @file controllers/attachmentController.js
 * @description Upload and serve binary file attachments stored in MongoDB.
 * Enforces per-room storage limits before accepting uploads.
 */

const Attachment = require('../models/Attachment');
const Project    = require('../models/Project');
const ChatRoom   = require('../models/ChatRoom');
const { sanitizeFilename, isValidObjectId } = require('../utils/helpers');
const { log } = require('../utils/logger');
const { ROOM_MAX_STORAGE_BYTES, MAX_FILE_SIZE_BYTES } = require('../config/db');

/**
 * Looks up the room owning this upload request.
 * Checks both Project and ChatRoom by the 'room' or 'projectName' body field.
 */
async function findRoomForUpload(req) {
    const roomName = String(req.body?.room || req.body?.projectName || req.query?.room || '').trim();
    if (!roomName) return { room: null, model: null, roomName: '' };

    let room = await Project.findOne({ name: roomName }).select('storageUsed status name').lean();
    let model = Project;
    if (!room) {
        room = await ChatRoom.findOne({ name: roomName }).select('storageUsed status name').lean();
        model = ChatRoom;
    }
    return { room, model, roomName };
}

/**
 * POST /upload
 * Saves an uploaded file buffer to MongoDB and returns its URL.
 * Enforces:
 * - Individual file size limit (MAX_FILE_SIZE_BYTES)
 * - Per-room storage cap (ROOM_MAX_STORAGE_BYTES)
 * - Atomic storageUsed increment
 */
async function uploadFile(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    // Backend file size validation (never trust frontend)
    if (req.file.size > MAX_FILE_SIZE_BYTES) {
        return res.status(413).json({
            error: `File exceeds the maximum allowed size of ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB.`
        });
    }

    try {
        // Storage limit check: require room context
        const { room, model, roomName } = await findRoomForUpload(req);
        if (!room || !model) {
            return res.status(400).json({ error: 'A valid active room name is required for file uploads.' });
        }

        if (room.status === 'inactive') {
            return res.status(410).json({ error: 'room_expired', message: 'This room has expired and cannot accept new uploads.' });
        }
        const currentUsage = room.storageUsed || 0;
        const newTotal = currentUsage + req.file.size;
        if (newTotal > ROOM_MAX_STORAGE_BYTES) {
            const usedMB = (currentUsage / 1024 / 1024).toFixed(1);
            const maxMB = (ROOM_MAX_STORAGE_BYTES / 1024 / 1024).toFixed(0);
            log('warn', `[UPLOAD] Storage limit exceeded for room "${roomName}" (${usedMB}/${maxMB} MB).`);
            return res.status(413).json({
                error: `This room has reached its maximum storage limit of ${maxMB} MB. Delete existing files before uploading new ones. Currently used: ${usedMB} MB.`
            });
        }

        const safeFilename = sanitizeFilename(req.file.originalname);
        const newAttachment = new Attachment({
            filename: safeFilename,
            contentType: req.file.mimetype,
            data: req.file.buffer
        });
        const saved = await newAttachment.save();

        // Atomically increment storageUsed — prevents race conditions on concurrent uploads
        await model.updateOne(
            { name: roomName },
            { $inc: { storageUsed: req.file.size }, lastActivityAt: new Date() }
        );

        log('info', `[UPLOAD] File "${safeFilename}" (${(req.file.size / 1024).toFixed(1)} KB) uploaded to room "${roomName}".`);
        return res.json({ 
            location: `/api/attachments/${saved._id}`,
            filename: safeFilename,
            contentType: req.file.mimetype,
            size: req.file.size
        });
    } catch (err) {
        log('error', 'File save to MongoDB error:', err);
        res.status(500).json({ error: 'Database storage error.' });
    }
}

/**
 * GET /api/attachments/:id
 * Streams a stored attachment by its MongoDB ObjectId.
 */
async function getFile(req, res) {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
        return res.status(400).send('Invalid attachment ID.');
    }
    try {
        const attachment = await Attachment.findById(id);
        if (!attachment) {
            return res.status(404).send('File not found.');
        }

        const etag = `"${attachment._id}"`;
        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        const scriptableMimeTypes = new Set(['text/html', 'image/svg+xml', 'application/xml', 'text/xml']);
        const isScriptable = scriptableMimeTypes.has(attachment.contentType);

        res.set('Content-Type', attachment.contentType);
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'public, max-age=86400, immutable');
        res.set('ETag', etag);
        
        if (isScriptable) {
            res.set('Content-Security-Policy', "default-src 'none'; sandbox");
            res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
        } else {
            res.set('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.filename)}"`);
        }
        
        res.send(Buffer.from(attachment.data));
    } catch (err) {
        log('error', 'File retrieval error:', err);
        res.status(500).send('Database error.');
    }
}

module.exports = { uploadFile, getFile };
