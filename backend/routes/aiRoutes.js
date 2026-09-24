/**
 * @file routes/aiRoutes.js
 * @description AI chat assistant route.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { aiChat } = require('../controllers/aiController');
const { aiChatLimiter } = require('../middleware/rateLimiter');
const { requireFeature } = require('../middleware/featureMiddleware');

router.post('/ai-chat',
    requireFeature('ai.chatbot', 'USE'),
    aiChatLimiter,
    [
        body('message').isString().trim().notEmpty().isLength({ max: 4000 })
            .withMessage('Message must be between 1 and 4000 characters.')
    ],
    aiChat
);

module.exports = router;
