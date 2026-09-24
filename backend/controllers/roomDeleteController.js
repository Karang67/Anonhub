/**
 * @file controllers/roomDeleteController.js
 * @description Owner-only room deletion for Projects, ChatRooms, and OfficeRooms.
 * Verifies ownership server-side, cleans up all resources, and notifies active users.
 */

const crypto = require('crypto');
const Project    = require('../models/Project');
const ChatRoom   = require('../models/ChatRoom');
const OfficeRoom = require('../models/OfficeRoom');
const {
    permanentlyDeleteProject,
    permanentlyDeleteChatRoom,
    permanentlyDeleteOfficeRoom,
} = require('../services/roomCleanupService');
const { MAX_NAME_LEN } = require('../config/db');
const { log } = require('../utils/logger');

/**
 * Verifies the owner token using a timing-safe comparison.
 */
function verifyOwnerToken(provided, stored) {
    if (!provided || !stored) return false;
    if (provided.length !== stored.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(stored));
    } catch {
        return false;
    }
}

/**
 * DELETE /api/project/:name
 * Permanently deletes a project and all associated resources.
 */
async function deleteProject(req, res, io) {
    const projectName = String(req.params.name || '').trim().slice(0, MAX_NAME_LEN);
    const { ownerToken } = req.body || {};
    if (!projectName || !ownerToken) {
        return res.status(400).json({ error: 'Room name and owner token are required.' });
    }
    try {
        const project = await Project.findOne({ name: projectName });
        if (!project) return res.status(404).json({ error: 'Project not found.' });
        if (!verifyOwnerToken(String(ownerToken), project.ownerToken)) {
            log('warn', `[DELETE] Unauthorized delete attempt on project "${projectName}".`);
            return res.status(403).json({ error: 'Only the room owner can delete this room.' });
        }

        // Notify connected users before deletion
        io.to(projectName).emit('room deleted', {
            room: projectName,
            message: 'This room has been permanently deleted by the owner.'
        });

        await permanentlyDeleteProject({ name: project.name, attachments: project.attachments, _id: project._id });
        // Also delete linked chat room if it exists
        const linkedChat = await ChatRoom.findOne({ name: projectName });
        if (linkedChat) {
            await permanentlyDeleteChatRoom({ name: linkedChat.name, _id: linkedChat._id });
        }

        log('info', `[DELETE] Project "${projectName}" deleted by owner.`);
        res.json({ success: true, message: 'Room permanently deleted.' });
    } catch (err) {
        log('error', '[DELETE] Project deletion error:', err);
        res.status(500).json({ error: 'Server error during room deletion.' });
    }
}

/**
 * DELETE /api/chat/:name
 * Permanently deletes a chat room and all associated resources.
 */
async function deleteChat(req, res, io) {
    const roomName = String(req.params.name || '').trim().slice(0, MAX_NAME_LEN);
    const { ownerToken } = req.body || {};
    if (!roomName || !ownerToken) {
        return res.status(400).json({ error: 'Room name and owner token are required.' });
    }
    try {
        const chatRoom = await ChatRoom.findOne({ name: roomName });
        if (!chatRoom) return res.status(404).json({ error: 'Chat room not found.' });
        if (!verifyOwnerToken(String(ownerToken), chatRoom.ownerToken)) {
            log('warn', `[DELETE] Unauthorized delete attempt on chat room "${roomName}".`);
            return res.status(403).json({ error: 'Only the room owner can delete this room.' });
        }

        io.to(roomName).emit('room deleted', {
            room: roomName,
            message: 'This room has been permanently deleted by the owner.'
        });

        await permanentlyDeleteChatRoom({ name: chatRoom.name, _id: chatRoom._id });

        log('info', `[DELETE] Chat room "${roomName}" deleted by owner.`);
        res.json({ success: true, message: 'Room permanently deleted.' });
    } catch (err) {
        log('error', '[DELETE] Chat deletion error:', err);
        res.status(500).json({ error: 'Server error during room deletion.' });
    }
}

/**
 * DELETE /api/office/:name
 * Permanently deletes an office room and all associated resources.
 */
async function deleteOffice(req, res, io) {
    const roomName = String(req.params.name || '').trim().slice(0, MAX_NAME_LEN);
    const { ownerToken } = req.body || {};
    if (!roomName || !ownerToken) {
        return res.status(400).json({ error: 'Room name and owner token are required.' });
    }
    try {
        const officeRoom = await OfficeRoom.findOne({ name: roomName });
        if (!officeRoom) return res.status(404).json({ error: 'Office room not found.' });
        if (!verifyOwnerToken(String(ownerToken), officeRoom.ownerToken)) {
            log('warn', `[DELETE] Unauthorized delete attempt on office room "${roomName}".`);
            return res.status(403).json({ error: 'Only the room owner can delete this room.' });
        }

        io.to(roomName).emit('room deleted', {
            room: roomName,
            message: 'This room has been permanently deleted by the owner.'
        });

        await permanentlyDeleteOfficeRoom({ name: officeRoom.name, _id: officeRoom._id });

        log('info', `[DELETE] Office room "${roomName}" deleted by owner.`);
        res.json({ success: true, message: 'Room permanently deleted.' });
    } catch (err) {
        log('error', '[DELETE] Office deletion error:', err);
        res.status(500).json({ error: 'Server error during room deletion.' });
    }
}

module.exports = { deleteProject, deleteChat, deleteOffice };
