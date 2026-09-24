/**
 * @file routes/compileRoutes.js
 * @description Code compilation route.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { compile } = require('../controllers/compileController');
const { compileLimiter } = require('../middleware/rateLimiter');
const { MAX_CODE_LEN } = require('../config/db');
const { requireFeature } = require('../middleware/featureMiddleware');

router.post('/compile',
    compileLimiter,
    requireFeature('project.code_editor'),
    [
        body('language').isString().trim().notEmpty().withMessage('Language is required.'),
        body('code').isString().isLength({ max: MAX_CODE_LEN }).withMessage(`Code must not exceed ${MAX_CODE_LEN} characters.`)
    ],
    compile
);

module.exports = router;
