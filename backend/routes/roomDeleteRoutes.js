/**
 * @file routes/roomDeleteRoutes.js
 * @description Owner-only room deletion routes.
 * Factory function takes the io instance for socket notifications.
 */

const express = require('express');
const { deleteProject, deleteChat, deleteOffice } = require('../controllers/roomDeleteController');
const { authLimiter } = require('../middleware/rateLimiter');

module.exports = function (io) {
    const router = express.Router();

    router.delete('/project/:name', authLimiter, (req, res) => deleteProject(req, res, io));
    router.delete('/chat/:name',    authLimiter, (req, res) => deleteChat(req, res, io));
    router.delete('/office/:name',  authLimiter, (req, res) => deleteOffice(req, res, io));

    return router;
};
