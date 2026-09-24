/**
 * @file routes/adminRoutes.js
 * @description Admin login/logout routes.
 */

const express = require('express');
const router = express.Router();
const { login, logout } = require('../controllers/adminController');
const { requireAdminAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/login', authLimiter, login);
router.post('/logout', requireAdminAuth, logout);

module.exports = router;
