/**
 * @file routes/versionRoutes.js
 * @description Project version history routes.
 */

const express = require('express');
const router = express.Router();
const { listVersions, getVersionContent, deleteVersion } = require('../controllers/versionController');
const { preventCache } = require('../utils/helpers');

const { requireFeature } = require('../middleware/featureMiddleware');

// Factory to inject the io instance into the delete handler
module.exports = function(io) {
    router.get('/versions/:projectName', preventCache, requireFeature('project.document_board'), listVersions);
    router.get('/versions/:id/content', preventCache, requireFeature('project.document_board'), getVersionContent);
    router.delete('/versions/:id', requireFeature('project.document_board'), (req, res) => deleteVersion(req, res, io));
    return router;
};
