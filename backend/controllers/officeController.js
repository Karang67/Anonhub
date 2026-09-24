/**
 * @file controllers/officeController.js
 * @description Create/join office workspace rooms.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const OfficeRoom = require('../models/OfficeRoom');
const { verifyAccessKey } = require('../middleware/auth');
const { handleValidation } = require('../utils/helpers');
const { MIN_KEY_LEN, MAX_KEY_LEN, MAX_NAME_LEN, BCRYPT_ROUNDS } = require('../config/db');
const { log } = require('../utils/logger');

/**
 * POST /create-office
 * Creates a new office room or joins an existing one with a matching key.
 */
async function createOrJoinOffice(req, res) {
    if (!handleValidation(req, res)) return;
    try {
        const officeName = req.body.name.trim();
        const accessKey = req.body.accessKey.trim();

        const existingOffice = await OfficeRoom.findOne({ name: officeName });
        if (existingOffice) {
            if (existingOffice.status === 'inactive') {
                return res.status(410).json({
                    error: 'room_expired',
                    message: 'This room has expired due to 15 days of inactivity and is no longer accessible.'
                });
            }
            const match = await verifyAccessKey(
                accessKey,
                existingOffice.accessKey,
                (newHash) => OfficeRoom.updateOne({ name: officeName }, { accessKey: newHash })
            );
            if (!match) {
                return res.status(403).json({ error: 'Incorrect access key for this Office Board.' });
            }
            return res.status(200).json({ redirectUrl: `/office/${encodeURIComponent(officeName)}` });
        }

        const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
        const ownerToken = crypto.randomBytes(32).toString('hex');
        const newOffice = new OfficeRoom({ name: officeName, accessKey: hashedKey, ownerToken });
        await newOffice.save();
        res.status(201).json({ redirectUrl: `/office/${encodeURIComponent(officeName)}`, ownerToken });
    } catch (err) {
        log('error', 'Office creation/opening error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** Validation rules for createOrJoinOffice */
const createOfficeValidation = [
    body('name')
        .isString().trim().notEmpty().withMessage('Office room name is required.')
        .isLength({ max: MAX_NAME_LEN }).withMessage(`Office room name must not exceed ${MAX_NAME_LEN} characters.`)
        .matches(/^[\w\s\-().]+$/).withMessage('Office room name contains invalid characters.'),
    body('accessKey')
        .isString().trim()
        .isLength({ min: MIN_KEY_LEN, max: MAX_KEY_LEN })
        .withMessage(`Access key must be between ${MIN_KEY_LEN} and ${MAX_KEY_LEN} characters.`)
];

module.exports = { createOrJoinOffice, createOfficeValidation };
