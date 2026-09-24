/**
 * @file utils/logger.js
 * @description Centralized structured logging utility.
 * Suppresses debug output in production environments.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Logs a message with an appropriate emoji prefix per level.
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {...any} args
 */
function log(level, ...args) {
    const prefix = { info: 'ℹ️ ', warn: '⚠️ ', error: '❌', debug: '🔍' }[level] || '';
    if (level === 'debug' && IS_PROD) return;
    console[level === 'error' ? 'error' : 'log'](`${prefix}`, ...args);
}

module.exports = { log };
