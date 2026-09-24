/**
 * @file services/roomCleanupService.js
 * @description Reusable room cleanup service.
 * Handles finding expired rooms, marking them inactive,
 * deleting associated resources, and permanent deletion.
 *
 * All operations are:
 * - Idempotent (safe to run multiple times)
 * - Failure-tolerant (logs errors, continues)
 * - Restart-safe (runs on every server start)
 */

const Project     = require('../models/Project');
const ChatRoom    = require('../models/ChatRoom');
const OfficeRoom  = require('../models/OfficeRoom');
const Message     = require('../models/Message');
const Attachment  = require('../models/Attachment');
const ProjectVersion = require('../models/ProjectVersion');
const { log } = require('../utils/logger');
const { ROOM_INACTIVITY_DAYS, ROOM_DELETE_GRACE_DAYS } = require('../config/db');

/**
 * Calculates the cutoff date for inactivity.
 * Rooms with lastActivityAt before this date will be marked inactive.
 */
function getInactivityCutoff() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ROOM_INACTIVITY_DAYS);
    return cutoff;
}

/**
 * Calculates the cutoff date for permanent deletion.
 * Rooms marked inactive before this date will be permanently deleted.
 */
function getDeletionCutoff() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (ROOM_INACTIVITY_DAYS + ROOM_DELETE_GRACE_DAYS));
    return cutoff;
}

/**
 * Deletes all attachments stored in MongoDB for a given room name.
 * Also looks for attachment IDs embedded in the room's attachments JSON.
 * @param {string} roomName
 * @param {string} attachmentsJson
 */
async function deleteRoomFiles(roomName, attachmentsJson = '[]') {
    try {
        let attachmentList = [];
        try { attachmentList = JSON.parse(attachmentsJson || '[]'); } catch (_) {}
        const attachmentIds = attachmentList
            .map(a => {
                if (!a.url) return null;
                const parts = a.url.split('/');
                return parts[parts.length - 1];
            })
            .filter(id => id && id.match(/^[a-f\d]{24}$/i));

        if (attachmentIds.length > 0) {
            const result = await Attachment.deleteMany({ _id: { $in: attachmentIds } });
            log('info', `[CLEANUP] Deleted ${result.deletedCount} attachment file(s) for room "${roomName}".`);
        }
    } catch (err) {
        log('error', `[CLEANUP] Failed to delete attachments for room "${roomName}": ${err.message}`);
    }
}

/**
 * Deletes all chat messages for a given room.
 * @param {string} roomName
 */
async function deleteRoomMessages(roomName) {
    try {
        const result = await Message.deleteMany({ room: roomName });
        log('info', `[CLEANUP] Deleted ${result.deletedCount} message(s) for room "${roomName}".`);
    } catch (err) {
        log('error', `[CLEANUP] Failed to delete messages for room "${roomName}": ${err.message}`);
    }
}

/**
 * Deletes all project version history for a given project.
 * @param {string} projectName
 */
async function deleteProjectVersions(projectName) {
    try {
        const result = await ProjectVersion.deleteMany({ projectName });
        log('info', `[CLEANUP] Deleted ${result.deletedCount} version(s) for project "${projectName}".`);
    } catch (err) {
        log('error', `[CLEANUP] Failed to delete versions for project "${projectName}": ${err.message}`);
    }
}

/**
 * Permanently deletes a single project and all its associated resources.
 * @param {Object} project - Mongoose Project document
 */
async function permanentlyDeleteProject(project) {
    const name = project.name;
    log('info', `[CLEANUP] Permanently deleting project: "${name}"`);
    await deleteRoomFiles(name, project.attachments);
    await deleteRoomMessages(name);
    await deleteProjectVersions(name);
    await Project.deleteOne({ _id: project._id });
    log('info', `[CLEANUP] Project "${name}" permanently deleted.`);
}

/**
 * Permanently deletes a single chat room and all its associated resources.
 * @param {Object} chatRoom - Mongoose ChatRoom document
 */
async function permanentlyDeleteChatRoom(chatRoom) {
    const name = chatRoom.name;
    log('info', `[CLEANUP] Permanently deleting chat room: "${name}"`);
    await deleteRoomMessages(name);
    await ChatRoom.deleteOne({ _id: chatRoom._id });
    log('info', `[CLEANUP] Chat room "${name}" permanently deleted.`);
}

/**
 * Permanently deletes a single office room.
 * @param {Object} officeRoom - Mongoose OfficeRoom document
 */
async function permanentlyDeleteOfficeRoom(officeRoom) {
    const name = officeRoom.name;
    log('info', `[CLEANUP] Permanently deleting office room: "${name}"`);
    await OfficeRoom.deleteOne({ _id: officeRoom._id });
    log('info', `[CLEANUP] Office room "${name}" permanently deleted.`);
}

/**
 * Marks rooms as inactive if they have been idle past ROOM_INACTIVITY_DAYS.
 * @returns {{ projects: number, chats: number, offices: number }}
 */
async function markInactiveRooms() {
    const cutoff = getInactivityCutoff();
    const filter = { status: 'active', lastActivityAt: { $lt: cutoff } };
    const update = { status: 'inactive' };
    const opts = { multi: true };

    const [pResult, cResult, oResult] = await Promise.allSettled([
        Project.updateMany(filter, update),
        ChatRoom.updateMany(filter, update),
        OfficeRoom.updateMany(filter, update),
    ]);

    const p = pResult.status === 'fulfilled' ? pResult.value.modifiedCount : 0;
    const c = cResult.status === 'fulfilled' ? cResult.value.modifiedCount : 0;
    const o = oResult.status === 'fulfilled' ? oResult.value.modifiedCount : 0;

    if (p + c + o > 0) {
        log('info', `[CLEANUP] Marked inactive — Projects: ${p}, Chats: ${c}, Offices: ${o}`);
    }
    return { projects: p, chats: c, offices: o };
}

/**
 * Permanently deletes rooms that have been inactive past the deletion cutoff.
 * @returns {{ projects: number, chats: number, offices: number }}
 */
async function deleteExpiredRooms() {
    const cutoff = getDeletionCutoff();
    const filter = { status: 'inactive', lastActivityAt: { $lt: cutoff } };
    let deleted = { projects: 0, chats: 0, offices: 0 };

    try {
        const projects = await Project.find(filter).select('name attachments').lean();
        for (const project of projects) {
            try { await permanentlyDeleteProject(project); deleted.projects++; }
            catch (err) { log('error', `[CLEANUP] Failed to delete project "${project.name}": ${err.message}`); }
        }
    } catch (err) {
        log('error', '[CLEANUP] Failed to query expired projects:', err.message);
    }

    try {
        const chats = await ChatRoom.find(filter).select('name').lean();
        for (const chat of chats) {
            try { await permanentlyDeleteChatRoom(chat); deleted.chats++; }
            catch (err) { log('error', `[CLEANUP] Failed to delete chat room "${chat.name}": ${err.message}`); }
        }
    } catch (err) {
        log('error', '[CLEANUP] Failed to query expired chat rooms:', err.message);
    }

    try {
        const offices = await OfficeRoom.find(filter).select('name').lean();
        for (const office of offices) {
            try { await permanentlyDeleteOfficeRoom(office); deleted.offices++; }
            catch (err) { log('error', `[CLEANUP] Failed to delete office room "${office.name}": ${err.message}`); }
        }
    } catch (err) {
        log('error', '[CLEANUP] Failed to query expired office rooms:', err.message);
    }

    if (deleted.projects + deleted.chats + deleted.offices > 0) {
        log('info', `[CLEANUP] Permanently deleted — Projects: ${deleted.projects}, Chats: ${deleted.chats}, Offices: ${deleted.offices}`);
    }
    return deleted;
}

/**
 * Main cleanup entry point. Marks inactive rooms, then permanently deletes expired ones.
 * Designed to be called on startup and periodically.
 */
async function cleanupExpiredRooms() {
    log('info', '[CLEANUP] Running room cleanup cycle...');
    try {
        await markInactiveRooms();
        await deleteExpiredRooms();
        log('info', '[CLEANUP] Cleanup cycle complete.');
    } catch (err) {
        log('error', '[CLEANUP] Unexpected error during cleanup cycle:', err.message);
    }
}

module.exports = {
    cleanupExpiredRooms,
    markInactiveRooms,
    deleteExpiredRooms,
    deleteRoomFiles,
    deleteRoomMessages,
    deleteProjectVersions,
    permanentlyDeleteProject,
    permanentlyDeleteChatRoom,
    permanentlyDeleteOfficeRoom,
};
