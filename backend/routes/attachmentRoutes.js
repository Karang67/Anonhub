/**
 * @file routes/attachmentRoutes.js
 * @description File upload and download routes.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { uploadFile, getFile } = require('../controllers/attachmentController');
const { upload } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { preventCache } = require('../utils/helpers');

// POST /upload  — save file, return URL
router.post('/upload', uploadLimiter, upload.single('file'), uploadFile);

// Multer error handler for this router
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || (err && err.message && err.message.includes('not allowed'))) {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

// GET /api/attachments/:id and /attachments/:id — stream stored file
router.get('/attachments/:id', preventCache, getFile);
router.get('/api/attachments/:id', preventCache, getFile);

module.exports = router;
