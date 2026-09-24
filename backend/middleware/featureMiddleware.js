/**
 * @file middleware/featureMiddleware.js
 * @description Express middleware to guard backend endpoints against disabled features or unauthorized roles.
 */

const FeatureConfig = require('../models/FeatureConfig');
const RolePermission = require('../models/RolePermission');
const { generateAdminSessionToken } = require('./auth');
const { ADMIN_SESSION_COOKIE, ADMIN_PAGE_KEY } = require('../config/db');

/**
 * Detect device type from User-Agent string.
 */
function detectDeviceType(userAgent = '') {
    const ua = String(userAgent).toLowerCase();
    if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
        return 'tablet';
    }
    if (/mobile|iphone|ipod|blackberry|opera mini|iemobile|wpdesktop/i.test(ua)) {
        return 'mobile';
    }
    return 'desktop';
}

const { timingSafeMatch } = require('../utils/helpers');

/**
 * Determine caller role from verified session cookies or admin key.
 */
function resolveCallerRole(req) {
    const sessionToken = req.cookies ? req.cookies[ADMIN_SESSION_COOKIE] : undefined;
    const adminKey = req.headers?.['x-admin-key'];

    const validSession = sessionToken && timingSafeMatch(sessionToken, generateAdminSessionToken());
    const validKey = adminKey && timingSafeMatch(String(adminKey), ADMIN_PAGE_KEY);

    if (validSession || validKey) {
        return 'ADMIN';
    }

    return 'USER';
}

/**
 * Express middleware factory enforcing feature availability and role permission.
 * @param {string} featureKey - Key of the feature (e.g. 'chat.video_call')
 * @param {string} requiredAction - Required permission action (e.g. 'USE', 'CREATE', 'MANAGE')
 */
function requireFeature(featureKey, requiredAction = 'USE') {
    return async (req, res, next) => {
        try {
            const role = resolveCallerRole(req);
            const userAgent = req.headers['user-agent'] || '';
            const deviceType = detectDeviceType(userAgent);

            // Admins & Developers bypass checks for system inspection
            if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'DEVELOPER') {
                return next();
            }

            // 1. Fetch feature config
            const feature = await FeatureConfig.findOne({ key: featureKey.toLowerCase() }).lean();
            if (!feature) {
                // If feature key is unconfigured, allow by default
                return next();
            }

            // 2. Check global kill switch
            if (!feature.enabled || feature.status === 'disabled') {
                return res.status(403).json({
                    error: `The feature "${feature.name}" is currently disabled by the system administrator.`,
                    featureKey,
                    code: 'FEATURE_DISABLED'
                });
            }

            // 3. Check maintenance mode
            if (feature.status === 'maintenance') {
                return res.status(503).json({
                    error: feature.maintenanceMessage || 'This feature is temporarily under maintenance.',
                    featureKey,
                    code: 'FEATURE_MAINTENANCE'
                });
            }

            // 4. Check parent feature status if hierarchical
            if (feature.parentKey) {
                const parent = await FeatureConfig.findOne({ key: feature.parentKey.toLowerCase() }).lean();
                if (parent && (!parent.enabled || parent.status === 'disabled')) {
                    return res.status(403).json({
                        error: `The parent module "${parent.name}" is disabled.`,
                        featureKey,
                        code: 'PARENT_FEATURE_DISABLED'
                    });
                }
            }

            // 5. Check device visibility / restriction
            if (feature.devices && feature.devices[deviceType] === false) {
                return res.status(403).json({
                    error: `This feature is not supported or is disabled on ${deviceType} devices.`,
                    featureKey,
                    deviceType,
                    code: 'DEVICE_RESTRICTED'
                });
            }

            // 6. Check Role Permissions
            const roleDoc = await RolePermission.findOne({ role }).lean();
            if (roleDoc && roleDoc.permissions) {
                const allowedActions = roleDoc.permissions[featureKey] || roleDoc.permissions[feature.parentKey] || [];
                if (!allowedActions.includes(requiredAction) && !allowedActions.includes('ADMIN')) {
                    return res.status(403).json({
                        error: `Your role (${role}) does not have permission to ${requiredAction} this feature.`,
                        featureKey,
                        requiredAction,
                        code: 'ROLE_UNAUTHORIZED'
                    });
                }
            }

            return next();
        } catch (err) {
            console.error(`[FEATURE-MIDDLEWARE] Error evaluating ${featureKey}:`, err);
            return next(); // Fail-open to avoid breaking core traffic
        }
    };
}

module.exports = {
    requireFeature,
    detectDeviceType,
    resolveCallerRole
};
