/**
 * @file routes/featureRoutes.js
 * @description API routes for Feature Management, Role-Based Access Control, and Audit Logs.
 */

const express = require('express');
const { requireAdminAuth } = require('../middleware/auth');
const {
    getPublicFeatureConfig,
    getAllFeaturesAdmin,
    createFeatureAdmin,
    updateFeatureAdmin,
    deleteFeatureAdmin,
    getRolesAdmin,
    createRoleAdmin,
    updateRolePermissionsAdmin,
    getAuditLogsAdmin
} = require('../controllers/featureController');

module.exports = function createFeatureRoutes(io) {
    const router = express.Router();

    // ─── Public Client Configuration Endpoint ─────────────────────────────────
    router.get('/features/config', getPublicFeatureConfig);
    router.get('/config', getPublicFeatureConfig);

    // ─── Admin Feature Management Endpoints ───────────────────────────────────
    router.get('/admin/features', requireAdminAuth, getAllFeaturesAdmin);
    router.post('/admin/features', requireAdminAuth, async (req, res, next) => {
        const handler = await createFeatureAdmin(io);
        return handler(req, res, next);
    });
    router.put('/admin/features/:key', requireAdminAuth, async (req, res, next) => {
        const handler = await updateFeatureAdmin(io);
        return handler(req, res, next);
    });
    router.delete('/admin/features/:key', requireAdminAuth, async (req, res, next) => {
        const handler = await deleteFeatureAdmin(io);
        return handler(req, res, next);
    });

    // ─── Admin Role & Permission Matrix Endpoints ─────────────────────────────
    router.get('/admin/roles', requireAdminAuth, getRolesAdmin);
    router.post('/admin/roles', requireAdminAuth, createRoleAdmin);
    router.put('/admin/roles/:roleName', requireAdminAuth, async (req, res, next) => {
        const handler = await updateRolePermissionsAdmin(io);
        return handler(req, res, next);
    });

    // ─── Admin Audit Trail Logs ───────────────────────────────────────────────
    router.get('/admin/audit-logs', requireAdminAuth, getAuditLogsAdmin);

    return router;
};
