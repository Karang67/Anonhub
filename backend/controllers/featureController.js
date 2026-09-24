/**
 * @file controllers/featureController.js
 * @description Controllers for Feature Management, Dynamic Registry, and RBAC matrix.
 */

const FeatureConfig = require('../models/FeatureConfig');
const RolePermission = require('../models/RolePermission');
const FeatureAuditLog = require('../models/FeatureAuditLog');
const { log } = require('../utils/logger');

let cachedPublicConfig = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute fallback TTL

function invalidateFeatureCache() {
    cachedPublicConfig = null;
    cacheExpiry = 0;
}

/**
 * GET /api/features/config
 * Public/Cached endpoint returning the active feature map and role matrix for clients.
 */
async function getPublicFeatureConfig(req, res) {
    try {
        const now = Date.now();
        if (cachedPublicConfig && now < cacheExpiry) {
            res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
            return res.json(cachedPublicConfig);
        }

        const [features, roles] = await Promise.all([
            FeatureConfig.find({}).sort({ order: 1, key: 1 }).lean(),
            RolePermission.find({}).lean()
        ]);

        const featureMap = {};
        features.forEach(f => {
            featureMap[f.key] = {
                key: f.key,
                name: f.name,
                module: f.module,
                parentKey: f.parentKey,
                enabled: f.enabled,
                visible: f.visible,
                status: f.status,
                maintenanceMessage: f.maintenanceMessage,
                devices: f.devices,
                order: f.order
            };
        });

        const roleMap = {};
        roles.forEach(r => {
            roleMap[r.role] = {
                role: r.role,
                displayName: r.displayName,
                isSystem: r.isSystem,
                permissions: r.permissions || {}
            };
        });

        cachedPublicConfig = {
            features: featureMap,
            roles: roleMap,
            timestamp: new Date().toISOString()
        };
        cacheExpiry = now + CACHE_TTL_MS;

        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(cachedPublicConfig);
    } catch (err) {
        log('error', 'Error fetching public feature config:', err);
        res.status(500).json({ error: 'Failed to load feature configuration.' });
    }
}

/**
 * GET /api/admin/features
 * Returns full administrative feature registry.
 */
async function getAllFeaturesAdmin(req, res) {
    try {
        const features = await FeatureConfig.find({}).sort({ module: 1, order: 1, key: 1 });
        res.json(features);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve features.' });
    }
}

/**
 * POST /api/admin/features
 * Registers a new feature key dynamically.
 */
async function createFeatureAdmin(io) {
    return async (req, res) => {
        try {
            const { key, name, description, module, parentKey, devices, status, enabled, visible } = req.body;
            if (!key || !name || !module) {
                return res.status(400).json({ error: 'Key, Name, and Module are required.' });
            }

            const cleanKey = String(key).trim().toLowerCase();
            const existing = await FeatureConfig.findOne({ key: cleanKey });
            if (existing) {
                return res.status(400).json({ error: `Feature with key "${cleanKey}" already exists.` });
            }

            const newFeature = new FeatureConfig({
                key: cleanKey,
                name: String(name).trim(),
                description: description || '',
                module: String(module).trim().toLowerCase(),
                parentKey: parentKey ? String(parentKey).trim().toLowerCase() : null,
                devices: devices || { desktop: true, tablet: true, mobile: true },
                status: status || 'active',
                enabled: enabled !== false,
                visible: visible !== false,
                isSystem: false
            });

            await newFeature.save();

            // Record audit log
            await FeatureAuditLog.create({
                actor: req.body.adminUsername || 'Admin',
                action: 'CREATE_FEATURE',
                targetType: 'FEATURE',
                targetKey: cleanKey,
                newValue: newFeature.toObject(),
                details: `Registered new feature key: ${cleanKey}`,
                ipAddress: req.ip
            });

            // Invalidate server in-memory cache
            invalidateFeatureCache();

            // Broadcast live update over Socket.IO if available
            if (io) {
                io.emit('feature-config-updated', { key: cleanKey, action: 'CREATE' });
            }

            res.status(201).json(newFeature);
        } catch (err) {
            log('error', 'Error creating feature:', err);
            res.status(500).json({ error: 'Failed to create feature.' });
        }
    };
}

/**
 * PUT /api/admin/features/:key
 * Updates feature enabled state, device rules, maintenance mode, or metadata.
 */
async function updateFeatureAdmin(io) {
    return async (req, res) => {
        try {
            const { key } = req.params;
            const cleanKey = String(key).trim().toLowerCase();
            const feature = await FeatureConfig.findOne({ key: cleanKey });

            if (!feature) {
                return res.status(404).json({ error: `Feature "${cleanKey}" not found.` });
            }

            const oldFeature = feature.toObject();
            const updates = req.body;

            if (updates.name !== undefined) feature.name = updates.name;
            if (updates.description !== undefined) feature.description = updates.description;
            if (updates.enabled !== undefined) feature.enabled = Boolean(updates.enabled);
            if (updates.visible !== undefined) feature.visible = Boolean(updates.visible);
            if (updates.status !== undefined) feature.status = updates.status;
            if (updates.maintenanceMessage !== undefined) feature.maintenanceMessage = updates.maintenanceMessage;
            if (updates.devices !== undefined) {
                feature.devices = {
                    desktop: updates.devices.desktop !== false,
                    tablet: updates.devices.tablet !== false,
                    mobile: updates.devices.mobile !== false
                };
            }

            await feature.save();

            // Log change in audit history
            await FeatureAuditLog.create({
                actor: req.body.adminUsername || 'Admin',
                action: 'UPDATE_FEATURE',
                targetType: 'FEATURE',
                targetKey: cleanKey,
                oldValue: oldFeature,
                newValue: feature.toObject(),
                details: `Updated configuration for "${cleanKey}" (Enabled: ${feature.enabled}, Status: ${feature.status})`,
                ipAddress: req.ip
            });

            // Invalidate server in-memory cache
            invalidateFeatureCache();

            // Broadcast live update over Socket.IO
            if (io) {
                io.emit('feature-config-updated', { key: cleanKey, feature: feature.toObject() });
            }

            res.json(feature);
        } catch (err) {
            log('error', 'Error updating feature:', err);
            res.status(500).json({ error: 'Failed to update feature.' });
        }
    };
}

/**
 * DELETE /api/admin/features/:key
 * Deletes custom non-system feature.
 */
async function deleteFeatureAdmin(io) {
    return async (req, res) => {
        try {
            const { key } = req.params;
            const cleanKey = String(key).trim().toLowerCase();
            const feature = await FeatureConfig.findOne({ key: cleanKey });

            if (!feature) {
                return res.status(404).json({ error: `Feature "${cleanKey}" not found.` });
            }

            if (feature.isSystem) {
                return res.status(400).json({ error: 'System core features cannot be deleted. You can disable them instead.' });
            }

            const deletedState = feature.toObject();
            await FeatureConfig.deleteOne({ key: cleanKey });

            await FeatureAuditLog.create({
                actor: req.body.adminUsername || 'Admin',
                action: 'DELETE_FEATURE',
                targetType: 'FEATURE',
                targetKey: cleanKey,
                oldValue: deletedState,
                details: `Deleted custom feature: ${cleanKey}`,
                ipAddress: req.ip
            });

            // Invalidate server in-memory cache
            invalidateFeatureCache();

            if (io) {
                io.emit('feature-config-updated', { key: cleanKey, action: 'DELETE' });
            }

            res.json({ success: true, message: `Feature "${cleanKey}" removed.` });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete feature.' });
        }
    };
}

/**
 * GET /api/admin/roles
 * Lists all RBAC roles and permission matrices.
 */
async function getRolesAdmin(req, res) {
    try {
        const roles = await RolePermission.find({}).sort({ role: 1 });
        res.json(roles);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve roles.' });
    }
}

/**
 * POST /api/admin/roles
 * Creates a new custom role.
 */
async function createRoleAdmin(req, res) {
    try {
        const { role, displayName, description, permissions } = req.body;
        if (!role || !displayName) {
            return res.status(400).json({ error: 'Role identifier and Display Name are required.' });
        }

        const cleanRole = String(role).trim().toUpperCase();
        const existing = await RolePermission.findOne({ role: cleanRole });
        if (existing) {
            return res.status(400).json({ error: `Role "${cleanRole}" already exists.` });
        }

        const newRole = new RolePermission({
            role: cleanRole,
            displayName: String(displayName).trim(),
            description: description || '',
            isSystem: false,
            permissions: permissions || new Map()
        });

        await newRole.save();

        await FeatureAuditLog.create({
            actor: req.body.adminUsername || 'Admin',
            action: 'CREATE_ROLE',
            targetType: 'ROLE',
            targetKey: cleanRole,
            newValue: newRole.toObject(),
            details: `Created new role: ${cleanRole}`,
            ipAddress: req.ip
        });

        // Invalidate server in-memory cache
        invalidateFeatureCache();

        res.status(201).json(newRole);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create role.' });
    }
}

/**
 * PUT /api/admin/roles/:roleName
 * Updates permission matrix for a role.
 */
async function updateRolePermissionsAdmin(io) {
    return async (req, res) => {
        try {
            const { roleName } = req.params;
            const cleanRole = String(roleName).trim().toUpperCase();
            const roleDoc = await RolePermission.findOne({ role: cleanRole });

            if (!roleDoc) {
                return res.status(404).json({ error: `Role "${cleanRole}" not found.` });
            }

            const oldState = roleDoc.toObject();
            const { displayName, description, permissions } = req.body;

            if (displayName) roleDoc.displayName = displayName;
            if (description !== undefined) roleDoc.description = description;
            if (permissions) roleDoc.permissions = permissions;

            await roleDoc.save();

            await FeatureAuditLog.create({
                actor: req.body.adminUsername || 'Admin',
                action: 'UPDATE_ROLE_PERMISSIONS',
                targetType: 'ROLE',
                targetKey: cleanRole,
                oldValue: oldState,
                newValue: roleDoc.toObject(),
                details: `Updated permissions for role: ${cleanRole}`,
                ipAddress: req.ip
            });

            // Invalidate server in-memory cache
            invalidateFeatureCache();

            if (io) {
                io.emit('feature-config-updated', { role: cleanRole, action: 'UPDATE_ROLE' });
            }

            res.json(roleDoc);
        } catch (err) {
            log('error', 'Error updating role permissions:', err);
            res.status(500).json({ error: 'Failed to update role permissions.' });
        }
    };
}

/**
 * GET /api/admin/audit-logs
 * Retrieves audit history log entries with pagination and filtering.
 */
async function getAuditLogsAdmin(req, res) {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = parseInt(req.query.limit || '50', 10);
        const skip = (page - 1) * limit;

        const [logs, total] = await Promise.all([
            FeatureAuditLog.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit),
            FeatureAuditLog.countDocuments({})
        ]);

        res.json({
            logs,
            total,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch audit logs.' });
    }
}

module.exports = {
    getPublicFeatureConfig,
    getAllFeaturesAdmin,
    createFeatureAdmin,
    updateFeatureAdmin,
    deleteFeatureAdmin,
    getRolesAdmin,
    createRoleAdmin,
    updateRolePermissionsAdmin,
    getAuditLogsAdmin
};
