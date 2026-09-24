/**
 * @file routes/projectRoutes.js
 * @description Project room creation and key management routes.
 */

const express = require('express');
const router = express.Router();
const {
    createOrOpenProject, changeProjectKey,
    createProjectValidation, changeKeyValidation
} = require('../controllers/projectController');
const { authLimiter } = require('../middleware/rateLimiter');
const { requireFeature } = require('../middleware/featureMiddleware');

router.post('/create-project', requireFeature('project.create', 'CREATE'), authLimiter, createProjectValidation, createOrOpenProject);
router.post('/api/project/:name/change-key', requireFeature('project', 'UPDATE'), authLimiter, changeKeyValidation, changeProjectKey);

module.exports = router;
