/**
 * @file controllers/aiController.js
 * @description Gemini AI chat assistant handler.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY, GEMINI_API_VERSION } = require('../config/db');
const { handleValidation } = require('../utils/helpers');
const { log } = require('../utils/logger');

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

/**
 * POST /api/ai-chat
 * Sends a message to the Gemini model and streams back the response.
 * Falls back to a mock response when GEMINI_API_KEY is not configured.
 */
async function aiChat(req, res) {
    if (!handleValidation(req, res)) return;
    const { message, history } = req.body;
    try {
        if (genAI) {
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }, { apiVersion: GEMINI_API_VERSION });
            // Security: limit history depth (prevent API cost abuse) and text length
            const MAX_HISTORY_ENTRIES = 20;
            const MAX_HISTORY_TEXT_LEN = 4000;
            let formattedHistory = Array.isArray(history)
                ? history.slice(-MAX_HISTORY_ENTRIES).map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: String(msg.parts?.[0]?.text || msg.text || '').slice(0, MAX_HISTORY_TEXT_LEN) }]
                }))
                : [];

            formattedHistory = formattedHistory
                .filter(entry => entry.parts[0].text.trim().length > 0);

            if (formattedHistory.length === 0 || formattedHistory[0].role !== 'user') {
                formattedHistory = [];
            }

            const chat = formattedHistory.length
                ? model.startChat({ history: formattedHistory })
                : model.startChat();
            const result = await chat.sendMessage(message);
            const response = await result.response;
            res.json({ response: response.text() });
        } else {
            log('info', '[AI CHAT MOCK] Replying to query.');
            const mockText = `🤖 **[Trinetra AI Assistant - Mock Mode]**\n\nI am currently running in mock mode because no \`GEMINI_API_KEY\` was found.\n\nTo activate full capabilities, set the \`GEMINI_API_KEY\` environment variable and restart the server.\n\n*Mocking response to: "${message}"*`;
            res.json({ response: mockText });
        }
    } catch (err) {
        log('error', 'Gemini API execution error:', err);
        res.status(500).json({ error: 'AI Assistant failed to generate a response.' });
    }
}

module.exports = { aiChat };
