/**
 * @file services/cleanupScheduler.js
 * @description Background cleanup scheduler for room expiration.
 *
 * Runs immediately on server start (so missed runs self-correct after restarts)
 * then on a configurable interval (default: every 6 hours).
 *
 * Compatible with Render's free tier (no Docker/cron daemon required).
 */

const { cleanupExpiredRooms } = require('./roomCleanupService');
const { log } = require('../utils/logger');

const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10); // 6 hours

let schedulerHandle = null;
let started = false;

/**
 * Starts the cleanup scheduler.
 * - Runs cleanup immediately after DB is ready.
 * - Then repeats on CLEANUP_INTERVAL_MS.
 * - Only starts once (idempotent).
 */
function startCleanupScheduler() {
    if (started) return;
    started = true;

    log('info', `[SCHEDULER] Room cleanup scheduler started. Interval: ${CLEANUP_INTERVAL_MS / 1000 / 60} minutes.`);

    // Run once immediately (catches missed runs from restarts)
    // Defer slightly so DB connection is established
    setTimeout(() => {
        cleanupExpiredRooms().catch(err => {
            log('error', '[SCHEDULER] Initial cleanup failed:', err.message);
        });
    }, 5000);

    schedulerHandle = setInterval(() => {
        cleanupExpiredRooms().catch(err => {
            log('error', '[SCHEDULER] Scheduled cleanup failed:', err.message);
        });
    }, CLEANUP_INTERVAL_MS);

    // Allow process to exit even if scheduler is running
    if (schedulerHandle && typeof schedulerHandle.unref === 'function') {
        schedulerHandle.unref();
    }
}

/**
 * Stops the cleanup scheduler (useful for graceful shutdown / testing).
 */
function stopCleanupScheduler() {
    if (schedulerHandle) {
        clearInterval(schedulerHandle);
        schedulerHandle = null;
        started = false;
        log('info', '[SCHEDULER] Cleanup scheduler stopped.');
    }
}

module.exports = { startCleanupScheduler, stopCleanupScheduler };
