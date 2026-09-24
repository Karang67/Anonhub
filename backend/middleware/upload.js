/**
 * @file middleware/upload.js
 * @description Multer in-memory file storage with MIME type whitelist and size limit.
 */

const multer = require('multer');
const { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES } = require('../config/db');

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

module.exports = { upload };
