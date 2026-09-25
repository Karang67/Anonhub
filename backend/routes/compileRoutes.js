/**
 * @file routes/compileRoutes.js
 * @description Sandboxed code compilation route with real-time peer notification.
 */

const express = require('express');
const { body } = require('express-validator');
const { compile } = require('../controllers/compileController');
const { compileLimiter } = require('../middleware/rateLimiter');
const { MAX_CODE_LEN } = require('../config/db');
const { requireFeature } = require('../middleware/featureMiddleware');

module.exports = function(io) {
    const router = express.Router();

    router.post('/compile',
        compileLimiter,
        requireFeature('project.code_editor'),
        [
            body('language').isString().trim().notEmpty().withMessage('Language is required.'),
            body('code').isString().isLength({ max: MAX_CODE_LEN }).withMessage(`Code must not exceed ${MAX_CODE_LEN} characters.`)
        ],
        (req, res) => compile(req, res, io || req.app.get('io'))
    );

    return router;
};
