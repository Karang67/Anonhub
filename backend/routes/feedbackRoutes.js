/**
 * @file routes/feedbackRoutes.js
 * @description Feedback submission and admin listing routes.
 */

const express = require('express');
const router = express.Router();
const { submitFeedback, listFeedback, feedbackStatus, feedbackValidation } = require('../controllers/feedbackController');
const { requireAdminAuth } = require('../middleware/auth');
const { preventCache } = require('../utils/helpers');

router.post('/feedback', feedbackValidation, submitFeedback);
router.get('/admin/feedback', preventCache, requireAdminAuth, listFeedback);
router.get('/admin/feedback/status', preventCache, requireAdminAuth, feedbackStatus);

module.exports = router;
