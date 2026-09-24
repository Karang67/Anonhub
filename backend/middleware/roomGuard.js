/**
 * @file middleware/roomGuard.js
 * @description Express middleware factory that blocks access to inactive/deleted rooms.
 * Returns 410 Gone with a structured error when a room has been marked inactive.
 */

const { log } = require('../utils/logger');

/**
 * Creates a middleware that checks room status before allowing joins.
 * @param {import('mongoose').Model} Model - Mongoose model (Project, ChatRoom, OfficeRoom)
 * @param {string} nameParam - The route param name for room name (default: 'name')
 * @returns {Function} Express middleware
 */
function guardRoom(Model, nameParam = 'name') {
    return async (req, res, next) => {
        const roomName = String(req.params[nameParam] || req.body?.[nameParam] || '').trim();
        if (!roomName) return next();
        try {
            const room = await Model.findOne({ name: roomName }).select('status name').lean();
            if (!room) return next(); // Will be handled by controller (room not found)
            if (room.status === 'inactive') {
                log('info', `[ROOM GUARD] Blocked access to inactive room: "${roomName}"`);
                return res.status(410).json({
                    error: 'room_expired',
                    message: 'This room has expired due to inactivity and is no longer accessible. Rooms are automatically deactivated after 15 days without activity.'
                });
            }
            next();
        } catch (err) {
            log('error', '[ROOM GUARD] Error checking room status:', err.message);
            next(); // Fail open — let controller handle DB errors
        }
    };
}

module.exports = { guardRoom };
