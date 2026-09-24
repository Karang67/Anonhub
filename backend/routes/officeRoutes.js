/**
 * @file routes/officeRoutes.js
 * @description Office workspace room creation route.
 */

const express = require('express');
const router = express.Router();
const { createOrJoinOffice, createOfficeValidation } = require('../controllers/officeController');
const { authLimiter } = require('../middleware/rateLimiter');
const { requireFeature } = require('../middleware/featureMiddleware');

router.post('/create-office', requireFeature('officeboard', 'USE'), authLimiter, createOfficeValidation, createOrJoinOffice);

module.exports = router;
