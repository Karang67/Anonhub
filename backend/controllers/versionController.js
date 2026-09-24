/**
 * @file controllers/versionController.js
 * @description Project version history: list, retrieve content, delete, and save.
 */

const ProjectVersion = require('../models/ProjectVersion');
const Project = require('../models/Project');
const { isValidObjectId, timingSafeMatch } = require('../utils/helpers');
const { MAX_NAME_LEN } = require('../config/db');
const { log } = require('../utils/logger');

/**
 * Saves a project version snapshot. Keeps max 10 per project+type.
 * @param {string} projectName
 * @param {'document'|'code'} type
 * @param {string} content
 * @param {string} language
 * @param {string} comment
 */
async function saveProjectVersion(projectName, type, content, language = 'javascript', comment = '') {
    try {
        await ProjectVersion.create({ projectName, type, content, language, comment });
        const all = await ProjectVersion.find({ projectName, type })
            .sort({ savedAt: -1 })
            .select('_id')
            .exec();
        if (all.length > 10) {
            const toDelete = all.slice(10).map(v => v._id);
            await ProjectVersion.deleteMany({ _id: { $in: toDelete } });
        }
    } catch (err) {
        log('warn', '[VERSION] Failed to save version snapshot:', err.message);
    }
}

/**
 * GET /api/versions/:projectName
 * Returns up to 10 version entries for a project+type.
 */
async function listVersions(req, res) {
    const projectName = String(req.params.projectName || '').trim().slice(0, MAX_NAME_LEN);
    const type = req.query.type === 'code' ? 'code' : 'document';
    try {
        const versions = await ProjectVersion.find({ projectName, type })
            .sort({ savedAt: -1 })
            .limit(10)
            .select('_id type savedAt language comment')
            .exec();
        res.json(versions);
    } catch (err) {
        log('error', 'Version history error:', err);
        res.status(500).json({ error: 'Failed to load version history.' });
    }
}

/**
 * GET /api/versions/:id/content
 * Returns the full content of a specific version.
 */
async function getVersionContent(req, res) {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid version ID.' });
    try {
        const version = await ProjectVersion.findById(req.params.id).select('content language type savedAt').exec();
        if (!version) return res.status(404).json({ error: 'Version not found.' });
        res.json(version);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load version.' });
    }
}

/**
 * DELETE /api/versions/:id
 * Deletes a specific version history entry.
 * Requires the caller to provide the project's ownerToken for authorization.
 */
async function deleteVersion(req, res, io) {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid version ID.' });
    const { ownerToken } = req.body || {};
    if (!ownerToken || typeof ownerToken !== 'string') {
        return res.status(400).json({ error: 'ownerToken is required to delete a version.' });
    }
    try {
        const version = await ProjectVersion.findById(req.params.id).exec();
        if (!version) return res.status(404).json({ error: 'Version not found.' });
        const { projectName, type } = version;
        // Verify ownership against the parent project
        const project = await Project.findOne({ name: projectName }).select('ownerToken').lean();
        if (!project || !project.ownerToken || !timingSafeMatch(String(ownerToken), project.ownerToken)) {
            log('warn', `[VERSION DELETE] Unauthorized delete attempt on project "${projectName}".`);
            return res.status(403).json({ error: 'Only the project owner can delete version history.' });
        }
        await ProjectVersion.findByIdAndDelete(req.params.id).exec();
        io.to(projectName).emit('version list updated', { type });
        res.json({ success: true, message: 'Version history deleted successfully.' });
    } catch (err) {
        log('error', 'Delete version error:', err);
        res.status(500).json({ error: 'Failed to delete version.' });
    }
}

module.exports = { saveProjectVersion, listVersions, getVersionContent, deleteVersion };
