/**
 * @file controllers/projectController.js
 * @description Create/open project rooms and manage project access keys.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const Project = require('../models/Project');
const ChatRoom = require('../models/ChatRoom');
const { verifyAccessKey } = require('../middleware/auth');
const { handleValidation, timingSafeMatch } = require('../utils/helpers');
const { MIN_KEY_LEN, MAX_KEY_LEN, MAX_NAME_LEN, BCRYPT_ROUNDS } = require('../config/db');
const { log } = require('../utils/logger');

/**
 * POST /create-project
 * Creates a new project or opens an existing one with a matching key.
 */
async function createOrOpenProject(req, res) {
    if (!handleValidation(req, res)) return;
    try {
        const projectName = req.body.name.trim();
        const accessKey = req.body.accessKey.trim();
        const rawOwnerKey = req.body.ownerKey ? String(req.body.ownerKey).trim() : '';

        const existingProject = await Project.findOne({ name: projectName });
        if (existingProject) {
            if (existingProject.status === 'inactive') {
                return res.status(410).json({
                    error: 'room_expired',
                    message: 'This room has expired due to 15 days of inactivity and is no longer accessible.'
                });
            }
            const match = await verifyAccessKey(
                accessKey,
                existingProject.accessKey,
                (newHash) => Project.updateOne({ name: projectName }, { accessKey: newHash })
            );
            if (!match) {
                return res.status(403).json({ error: 'Incorrect access key for this project.' });
            }
            return res.status(200).json({ redirectUrl: `/projects/${encodeURIComponent(projectName)}` });
        }

        const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
        const hashedOwnerKey = rawOwnerKey ? await bcrypt.hash(rawOwnerKey, BCRYPT_ROUNDS) : hashedKey;
        const ownerToken = crypto.randomBytes(32).toString('hex');
        const newProject = new Project({ name: projectName, accessKey: hashedKey, ownerKey: hashedOwnerKey, ownerToken });
        await newProject.save();

        // Auto-link: create the chat room with the same name/key/token
        try {
            const existingChat = await ChatRoom.findOne({ name: projectName });
            if (!existingChat) {
                const chatRoom = new ChatRoom({ name: projectName, accessKey: hashedKey, ownerKey: hashedOwnerKey, ownerToken });
                await chatRoom.save();
                log('info', `[AUTO-LINK] Created linked chat room for project "${projectName}".`);
            }
        } catch (chatErr) {
            log('warn', `[AUTO-LINK] Could not auto-create chat room: ${chatErr.message}`);
        }

        res.status(201).json({ redirectUrl: `/projects/${encodeURIComponent(projectName)}`, ownerToken });
    } catch (err) {
        log('error', 'Project creation/opening error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/project/:name/change-key
 * Rotates the project access key (owner only).
 */
async function changeProjectKey(req, res) {
    if (!handleValidation(req, res)) return;
    const projectName = String(req.params.name || '').trim().slice(0, MAX_NAME_LEN);
    const { ownerToken, newKey } = req.body;
    try {
        const project = await Project.findOne({ name: projectName });
        if (!project) return res.status(404).json({ error: 'Project not found.' });
        if (!project.ownerToken || !timingSafeMatch(project.ownerToken, String(ownerToken)))
            return res.status(403).json({ error: 'Only the project owner can change the access key.' });
        const hashedKey = await bcrypt.hash(newKey.trim(), BCRYPT_ROUNDS);
        await Project.updateOne({ name: projectName }, { accessKey: hashedKey });
        await ChatRoom.updateOne({ name: projectName }, { accessKey: hashedKey });
        log('info', `[CHANGE-KEY] Project "${projectName}" key rotated.`);
        res.json({ success: true, message: 'Access key updated. Share the new key with collaborators.' });
    } catch (err) {
        log('error', 'Change key error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** Validation rules for createOrOpenProject */
const createProjectValidation = [
    body('name')
        .isString().trim().notEmpty().withMessage('Project name is required.')
        .isLength({ max: MAX_NAME_LEN }).withMessage(`Project name must not exceed ${MAX_NAME_LEN} characters.`)
        .matches(/^[\w\s\-().]+$/).withMessage('Project name contains invalid characters.'),
    body('accessKey')
        .isString().trim()
        .isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN })
        .withMessage(`Access key must be between ${MIN_KEY_LEN} and ${MAX_KEY_LEN} characters.`)
];

/** Validation rules for changeProjectKey */
const changeKeyValidation = [
    body('ownerToken').isString().notEmpty().withMessage('Owner token required.'),
    body('newKey').isString().trim().isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN })
        .withMessage(`New key must be ${MIN_KEY_LEN}–${MAX_KEY_LEN} characters.`)
];

module.exports = { createOrOpenProject, changeProjectKey, createProjectValidation, changeKeyValidation };
