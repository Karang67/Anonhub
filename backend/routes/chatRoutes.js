/**
 * @file routes/chatRoutes.js
 * @description Chat room join and key management routes.
 */

const express = require('express');
const router = express.Router();
const {
    joinOrCreateChat, changeChatKey,
    joinChatValidation, changeChatKeyValidation
} = require('../controllers/chatController');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/join-chat', authLimiter, joinChatValidation, joinOrCreateChat);
router.post('/api/chat/:name/change-key', authLimiter, changeChatKeyValidation, changeChatKey);

module.exports = router;
