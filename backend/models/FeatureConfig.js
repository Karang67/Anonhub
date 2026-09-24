/**
 * @file models/FeatureConfig.js
 * @description Mongoose schema for centralized Feature Flags & Configurations.
 * Defines hierarchical modules, device visibility rules, global kill switches, and maintenance modes.
 */

const mongoose = require('mongoose');

const featureConfigSchema = new mongoose.Schema({
    key: { 
        type: String, 
        required: true, 
        unique: true, 
        trim: true, 
        lowercase: true,
        index: true 
    },
    name: { 
        type: String, 
        required: true, 
        trim: true 
    },
    description: { 
        type: String, 
        default: '' 
    },
    module: { 
        type: String, 
        required: true, 
        trim: true,
        lowercase: true,
        index: true 
    },
    parentKey: { 
        type: String, 
        default: null,
        lowercase: true,
        index: true 
    },
    enabled: { 
        type: Boolean, 
        default: true 
    },
    visible: { 
        type: Boolean, 
        default: true 
    },
    status: { 
        type: String, 
        enum: ['active', 'disabled', 'maintenance'], 
        default: 'active' 
    },
    maintenanceMessage: { 
        type: String, 
        default: 'This feature is temporarily unavailable due to scheduled maintenance. Please check back shortly.' 
    },
    devices: {
        desktop: { type: Boolean, default: true },
        tablet:  { type: Boolean, default: true },
        mobile:  { type: Boolean, default: true }
    },
    isSystem: { 
        type: Boolean, 
        default: true 
    },
    order: { 
        type: Number, 
        default: 0 
    }
}, { 
    timestamps: true 
});

module.exports = mongoose.model('FeatureConfig', featureConfigSchema);
