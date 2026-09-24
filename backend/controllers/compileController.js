/**
 * @file controllers/compileController.js
 * @description Delegates code execution to the compiler module.
 */

const { compileAndRun } = require('../compiler');
const { handleValidation } = require('../utils/helpers');
const { log } = require('../utils/logger');

/**
 * POST /api/compile
 * Compiles and runs the submitted code snippet.
 */
async function compile(req, res) {
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

module.exports = { compile };
