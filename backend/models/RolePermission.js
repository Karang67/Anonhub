/**
 * @file models/RolePermission.js
 * @description Mongoose schema for Role-Based Access Control (RBAC).
 * Maps user roles to granular permissions per feature key.
 */

const mongoose = require('mongoose');

const PERMISSION_ACTIONS = [
    'VIEW', 'CREATE', 'READ', 'UPDATE', 'DELETE', 
    'USE', 'SHARE', 'EXPORT', 'MANAGE', 'ADMIN'
];

const rolePermissionSchema = new mongoose.Schema({
    role: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true, 
        uppercase: true,
        index: true 
    },
    displayName: { 
        type: String, 
        required: true 
    },
    description: { 
        type: String, 
        default: '' 
    },
    isSystem: { 
        type: Boolean, 
        default: false 
    },
    // Map of featureKey -> Array of allowed actions (e.g. ['VIEW', 'USE', 'CREATE'])
    permissions: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({})
    }
}, { 
    timestamps: true 
});

module.exports = mongoose.model('RolePermission', rolePermissionSchema);
module.exports.PERMISSION_ACTIONS = PERMISSION_ACTIONS;
