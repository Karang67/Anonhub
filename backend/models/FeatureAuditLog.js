/**
 * @file models/FeatureAuditLog.js
 * @description Mongoose schema for recording feature management and permission audit history.
 */

const mongoose = require('mongoose');

const featureAuditLogSchema = new mongoose.Schema({
    actor: { 
        type: String, 
        required: true, 
        default: 'System Admin' 
    },
    action: { 
        type: String, 
        required: true 
    },
    targetType: { 
        type: String, 
        enum: ['FEATURE', 'ROLE', 'SYSTEM'], 
        default: 'FEATURE' 
    },
    targetKey: { 
        type: String, 
        required: true 
    },
    oldValue: { 
        type: mongoose.Schema.Types.Mixed, 
        default: null 
    },
    newValue: { 
        type: mongoose.Schema.Types.Mixed, 
        default: null 
    },
    details: { 
        type: String, 
        default: '' 
    },
    ipAddress: { 
        type: String, 
        default: '' 
    }
}, { 
    timestamps: true 
});

featureAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('FeatureAuditLog', featureAuditLogSchema);
