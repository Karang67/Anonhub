/**
 * @file config/featureRegistry.js
 * @description Default Feature Registry definitions and RBAC bootstrap seeding.
 * Automatically initializes FeatureConfig and RolePermission collections in MongoDB.
 */

const FeatureConfig = require('../models/FeatureConfig');
const RolePermission = require('../models/RolePermission');
const { log } = require('../utils/logger');

const DEFAULT_FEATURES = [
    // ─── Chat Module ──────────────────────────────────────────────────────────
    {
        key: 'chat',
        name: 'Chat Module',
        description: 'Anonymous real-time group chat rooms',
        module: 'chat',
        parentKey: null,
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 10
    },
    {
        key: 'chat.global',
        name: 'Global Anonymous Chat',
        description: 'Single shared public real-time conversation for all visitors',
        module: 'chat',
        parentKey: 'chat',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 11
    },
    {
        key: 'chat.messaging',
        name: 'Text Messaging',
        description: 'Send and receive real-time text chat messages',
        module: 'chat',
        parentKey: 'chat',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 12
    },
    {
        key: 'chat.video_call',
        name: 'Video Calling',
        description: 'Launch embedded peer-to-peer WebRTC video calls',
        module: 'chat',
        parentKey: 'chat',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 12
    },
    {
        key: 'chat.screen_share',
        name: 'Screen Sharing',
        description: 'Broadcast desktop screen or window to call participants',
        module: 'chat',
        parentKey: 'chat',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: false },
        order: 13
    },
    {
        key: 'chat.file_upload',
        name: 'File & Image Sharing',
        description: 'Upload and share documents and media in chat rooms',
        module: 'chat',
        parentKey: 'chat',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 14
    },
    {
        key: 'chat.reactions',
        name: 'Emoji Reactions',
        description: 'React to chat messages with emoji expressions',
        module: 'chat',
        parentKey: 'chat',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 15
    },
    {
        key: 'chat.typing_indicator',
        name: 'Typing Indicator',
        description: 'Live broadcast of active typing status',
        module: 'chat',
        parentKey: 'chat',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 16
    },

    // ─── Project Workspace Module ─────────────────────────────────────────────
    {
        key: 'project',
        name: 'Project Room Workspace',
        description: 'Multi-pane collaborative workspace suite',
        module: 'project',
        parentKey: null,
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 20
    },
    {
        key: 'project.create',
        name: 'Create Project Room',
        description: 'Provision new collaborative project workspaces',
        module: 'project',
        parentKey: 'project',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 21
    },
    {
        key: 'project.document_board',
        name: 'Document Board',
        description: 'Rich text collaborative word processor in projects',
        module: 'project',
        parentKey: 'project',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 22
    },
    {
        key: 'project.code_editor',
        name: 'Coding Board & Sandbox',
        description: 'Monaco code editor with remote multi-language compilation',
        module: 'project',
        parentKey: 'project',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 23
    },
    {
        key: 'project.sketch_board',
        name: 'Sketch Board',
        description: 'Integrated collaborative sketch and whiteboard canvas',
        module: 'project',
        parentKey: 'project',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 24
    },
    {
        key: 'project.smart_notes',
        name: 'Smart Notes',
        description: 'Markdown note captures with AI organization support',
        module: 'project',
        parentKey: 'project',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 25
    },
    {
        key: 'project.polls',
        name: 'Live Team Polls',
        description: 'Real-time voting and consensus tracking',
        module: 'project',
        parentKey: 'project',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 26
    },
    {
        key: 'project.snippets',
        name: 'Code Snippets Library',
        description: 'Shared searchable code library with one-click insertion',
        module: 'project',
        parentKey: 'project',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 27
    },
    {
        key: 'project.attachments',
        name: 'Project Attachments',
        description: 'Upload and download files in project rooms',
        module: 'project',
        parentKey: 'project',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 28
    },

    // ─── OfficeBoard Module ───────────────────────────────────────────────────
    {
        key: 'officeboard',
        name: 'Office Productivity Suite',
        description: 'Collaborative spreadsheets, docs, notes, and kanban',
        module: 'officeboard',
        parentKey: null,
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 30
    },

    // ─── Whiteboard Module ────────────────────────────────────────────────────
    {
        key: 'whiteboard',
        name: 'Multiplayer Whiteboard',
        description: 'Modern infinite canvas collaborative whiteboard',
        module: 'whiteboard',
        parentKey: null,
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 40
    },
    {
        key: 'whiteboard.collaboration',
        name: 'Real-Time Sync & Cursors',
        description: 'Live differential synchronization and multiplayer cursors',
        module: 'whiteboard',
        parentKey: 'whiteboard',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 41
    },
    {
        key: 'whiteboard.export',
        name: 'Canvas Export',
        description: 'Export drawings as PNG, SVG, or JSON snapshots',
        module: 'whiteboard',
        parentKey: 'whiteboard',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 42
    },

    // ─── Dedicated Voice & Video Call Module ──────────────────────────────────
    {
        key: 'call',
        name: 'Dedicated Video Call Suite',
        description: 'Peer-to-peer WebRTC calling room with screen share',
        module: 'call',
        parentKey: null,
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 50
    },
    {
        key: 'call.video',
        name: 'Video Streams',
        description: 'High-definition WebRTC camera feed streaming',
        module: 'call',
        parentKey: 'call',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 51
    },
    {
        key: 'call.screen_share',
        name: 'Call Screen Sharing',
        description: 'Broadcast desktop and app windows in call rooms',
        module: 'call',
        parentKey: 'call',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: false },
        order: 52
    },

    // ─── AI Copilot Module ────────────────────────────────────────────────────
    {
        key: 'ai',
        name: 'AI Intelligence Suite',
        description: 'Gemini-powered workspace AI assistants',
        module: 'ai',
        parentKey: null,
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 60
    },
    {
        key: 'ai.chatbot',
        name: 'Floating AI Chatbot',
        description: 'Application-wide intelligent assistant widget',
        module: 'ai',
        parentKey: 'ai',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 61
    },

    // ─── Admin Module ─────────────────────────────────────────────────────────
    {
        key: 'admin',
        name: 'Admin & Developer Tools',
        description: 'Centralized administration, security, and controls',
        module: 'admin',
        parentKey: null,
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 70
    },
    {
        key: 'admin.feedback',
        name: 'User Feedback Portal',
        description: 'Review and manage submitted feedback entries',
        module: 'admin',
        parentKey: 'admin',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 71
    },
    {
        key: 'admin.features',
        name: 'Feature Management & RBAC',
        description: 'Control every feature, device visibility, and role matrix',
        module: 'admin',
        parentKey: 'admin',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 72
    },
    {
        key: 'admin.audit_logs',
        name: 'Audit Trail Logs',
        description: 'Track all administrative and security actions',
        module: 'admin',
        parentKey: 'admin',
        enabled: true,
        visible: true,
        status: 'active',
        devices: { desktop: true, tablet: true, mobile: true },
        order: 73
    }
];

const DEFAULT_ROLES = [
    {
        role: 'SUPER_ADMIN',
        displayName: 'Super Administrator',
        description: 'Complete system access, feature management, and role configuration',
        isSystem: true,
        allPermissions: true
    },
    {
        role: 'ADMIN',
        displayName: 'Administrator',
        description: 'Full workspace management and administrative oversight',
        isSystem: true,
        allPermissions: true
    },
    {
        role: 'DEVELOPER',
        displayName: 'Developer',
        description: 'Full access to developer tools, code sandbox, and feature controls',
        isSystem: true,
        allPermissions: true
    },
    {
        role: 'MANAGER',
        displayName: 'Manager / Moderator',
        description: 'Manage workspaces, projects, moderation, and team collaboration',
        isSystem: true,
        allowedActions: ['VIEW', 'USE', 'CREATE', 'UPDATE', 'SHARE', 'EXPORT']
    },
    {
        role: 'USER',
        displayName: 'Standard User',
        description: 'Collaborate freely across chat, projects, office suite, and whiteboard',
        isSystem: true,
        allowedActions: ['VIEW', 'USE', 'CREATE', 'UPDATE', 'SHARE', 'EXPORT'],
        blockedModules: ['admin']
    },
    {
        role: 'GUEST',
        displayName: 'Guest / Anonymous',
        description: 'Join rooms via shared link with instant drawing and viewing access',
        isSystem: true,
        allowedActions: ['VIEW', 'USE', 'SHARE'],
        blockedModules: ['admin']
    }
];

const UNUSED_FEATURES_TO_PRUNE = [
    'chat.audio_call',
    'officeboard.excel',
    'officeboard.word',
    'officeboard.notes',
    'officeboard.kanban',
    'officeboard.export',
    'whiteboard.drawing',
    'whiteboard.shapes',
    'whiteboard.sticky_notes',
    'ai.notes_organize'
];

/**
 * Seeds default features and roles into MongoDB if not present and prunes unused features.
 */
async function seedDefaultFeaturesAndRoles() {
    try {
        // 1. Remove obsolete / unused system features from database
        await FeatureConfig.deleteMany({ key: { $in: UNUSED_FEATURES_TO_PRUNE } });

        // 2. Seed / Update Features
        for (const feat of DEFAULT_FEATURES) {
            await FeatureConfig.findOneAndUpdate(
                { key: feat.key },
                { $setOnInsert: feat },
                { upsert: true, new: true }
            );
        }

        // 3. Seed Roles & Clean Obsolete Permissions
        const allKeys = DEFAULT_FEATURES.map(f => f.key);
        const ALL_ACTIONS = ['VIEW', 'CREATE', 'READ', 'UPDATE', 'DELETE', 'USE', 'SHARE', 'EXPORT', 'MANAGE', 'ADMIN'];

        for (const r of DEFAULT_ROLES) {
            let roleDoc = await RolePermission.findOne({ role: r.role });
            if (!roleDoc) {
                const permMap = new Map();

                allKeys.forEach(k => {
                    const moduleName = k.split('.')[0];
                    if (r.allPermissions) {
                        permMap.set(k, ALL_ACTIONS);
                    } else if (r.blockedModules && r.blockedModules.includes(moduleName)) {
                        permMap.set(k, []);
                    } else {
                        permMap.set(k, r.allowedActions || ['VIEW', 'USE']);
                    }
                });

                await RolePermission.create({
                    role: r.role,
                    displayName: r.displayName,
                    description: r.description,
                    isSystem: r.isSystem,
                    permissions: permMap
                });
            } else {
                let modified = false;
                if (roleDoc.permissions) {
                    // Prune obsolete keys from existing role doc
                    for (const obsoleteKey of UNUSED_FEATURES_TO_PRUNE) {
                        if (roleDoc.permissions.has ? roleDoc.permissions.has(obsoleteKey) : roleDoc.permissions[obsoleteKey] !== undefined) {
                            if (roleDoc.permissions.delete) {
                                roleDoc.permissions.delete(obsoleteKey);
                            } else {
                                delete roleDoc.permissions[obsoleteKey];
                            }
                            modified = true;
                        }
                    }

                    // Ensure all current DEFAULT_FEATURES keys are present in role doc
                    for (const k of allKeys) {
                        const hasKey = roleDoc.permissions.has ? roleDoc.permissions.has(k) : (roleDoc.permissions[k] !== undefined);
                        if (!hasKey) {
                            const moduleName = k.split('.')[0];
                            const actions = r.allPermissions
                                ? ALL_ACTIONS
                                : (r.blockedModules && r.blockedModules.includes(moduleName))
                                    ? []
                                    : (r.allowedActions || ['VIEW', 'USE']);

                            if (roleDoc.permissions.set) {
                                roleDoc.permissions.set(k, actions);
                            } else {
                                roleDoc.permissions[k] = actions;
                            }
                            modified = true;
                        }
                    }
                }
                if (modified) {
                    roleDoc.markModified('permissions');
                    await roleDoc.save();
                }
            }
        }

        log('info', '✅ [RBAC] Feature registry & Role permission matrix initialized and pruned.');
    } catch (err) {
        log('error', '❌ [RBAC] Failed to seed default features and roles:', err);
    }
}

module.exports = {
    DEFAULT_FEATURES,
    DEFAULT_ROLES,
    UNUSED_FEATURES_TO_PRUNE,
    seedDefaultFeaturesAndRoles
};
