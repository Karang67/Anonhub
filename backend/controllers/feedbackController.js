/**
 * @file controllers/feedbackController.js
 * @description User feedback submission, admin listing, and email notification.
 */

const nodemailer = require('nodemailer');
const { body } = require('express-validator');
const Feedback = require('../models/Feedback');
const { handleValidation } = require('../utils/helpers');
const { log } = require('../utils/logger');
const {
    ADMIN_EMAIL, WEB3FORMS_ACCESS_KEY,
    MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_BASE_URL,
    SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM
} = require('../config/db');

// ─── Mail transport setup ─────────────────────────────────────────────────────

let mailTransport = null;
let mailDeliveryEnabled = false;
let useMailgunApi = false;
let useWeb3Forms = false;

if (WEB3FORMS_ACCESS_KEY) {
    useWeb3Forms = true;
    mailDeliveryEnabled = true;
    log('info', 'Web3Forms API configured for email delivery.');
} else if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
    useMailgunApi = true;
    mailDeliveryEnabled = true;
    log('info', 'Mailgun API configured for email delivery.');
} else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    mailTransport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    mailTransport.verify()
        .then(() => { mailDeliveryEnabled = true; log('info', 'SMTP transport verified.'); })
        .catch(err => {
            mailTransport = null;
            mailDeliveryEnabled = false;
            log('warn', 'SMTP transport verification failed; feedback email delivery disabled.', err);
        });
} else {
    log('info', 'Mailgun, Web3Forms, and SMTP not configured — feedback emails will not be sent.');
}

async function sendFeedbackEmail(mailOpts, fbDetails = {}) {
    if (useWeb3Forms && WEB3FORMS_ACCESS_KEY) {
        const payload = {
            access_key: WEB3FORMS_ACCESS_KEY,
            subject: mailOpts.subject || 'New Feedback Received',
            from_name: 'Trinetra Feedback',
            name: fbDetails.name || 'Anonymous User',
            email: fbDetails.email || 'no-reply@trinetra.app',
            rating: fbDetails.rating ? `${fbDetails.rating} / 5` : 'N/A',
            message: fbDetails.message || mailOpts.text
        };
        const response = await fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Trinetra-App/1.0' },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        let data = {};
        try { data = JSON.parse(text); } catch (_) {
            if (!response.ok) throw new Error(`Web3Forms HTTP ${response.status}: ${text.slice(0, 100)}`);
        }
        if (!response.ok || (data && data.success === false)) {
            throw new Error(`Web3Forms send failed: ${data.message || text || response.statusText}`);
        }
        return data;
    }
    if (useMailgunApi) {
        const form = new URLSearchParams();
        form.append('from', mailOpts.from);
        form.append('to', mailOpts.to);
        form.append('subject', mailOpts.subject);
        form.append('text', mailOpts.text);
        form.append('html', mailOpts.html);
        const response = await fetch(`${MAILGUN_BASE_URL}/messages`, {
            method: 'POST',
            headers: { Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}` },
            body: form
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Mailgun send failed: ${response.status} ${body}`);
        }
        return response.text();
    }
    if (mailTransport) {
        return mailTransport.sendMail(mailOpts);
    }
    throw new Error('No mail transport configured.');
}

// ─── Helpers & Controllers ────────────────────────────────────────────────────

function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * POST /api/feedback
 * Saves feedback to DB and optionally emails the admin.
 */
async function submitFeedback(req, res) {
    if (!handleValidation(req, res)) return;
    try {
        const { name, email, message, rating } = req.body;
        const fb = new Feedback({
            name: name ? String(name).trim() : undefined,
            email: email ? String(email).trim() : undefined,
            message: String(message).trim(),
            rating: rating ? Number(rating) : undefined
        });
        await fb.save();

        if (ADMIN_EMAIL && mailDeliveryEnabled) {
            try {
                const safeName = escapeHtml(fb.name || '—');
                const safeEmail = escapeHtml(fb.email || '—');
                const safeRating = escapeHtml(fb.rating ? String(fb.rating) : '—');
                const safeMsg = escapeHtml(fb.message || '').replace(/\n/g, '<br/>');

                const mailOpts = {
                    from: MAIL_FROM,
                    to: ADMIN_EMAIL,
                    subject: 'New feedback received',
                    text: `Name: ${fb.name || '—'}\nEmail: ${fb.email || '—'}\nRating: ${fb.rating || '—'}\n\nMessage:\n${fb.message}`,
                    html: `<p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Rating:</strong> ${safeRating}</p><hr/><p>${safeMsg}</p>`
                };
                await sendFeedbackEmail(mailOpts, { name: fb.name, email: fb.email, rating: fb.rating, message: fb.message });
                log('info', 'Feedback notification dispatched successfully.');
            } catch (err) {
                log('warn', 'Feedback notification failed; feedback stored without notification.', err);
            }
        } else {
            log('debug', 'Email delivery disabled or not configured; feedback saved only to database.');
        }
        res.json({ success: true });
    } catch (err) {
        log('error', 'Failed to save feedback:', err);
        res.status(500).json({ error: 'Failed to save feedback.' });
    }
}

/**
 * GET /api/admin/feedback
 * Lists the latest 200 feedback entries (admin only).
 */
async function listFeedback(req, res) {
    try {
        const feedback = await Feedback.find().sort({ createdAt: -1 }).limit(200).lean().exec();
        res.json(feedback.map(item => ({
            id: item._id,
            name: item.name || 'Anonymous',
            email: item.email || 'N/A',
            rating: item.rating || null,
            message: item.message,
            createdAt: item.createdAt,
        })));
    } catch (err) {
        log('error', 'Admin feedback list error:', err);
        res.status(500).json({ error: 'Failed to load feedback.' });
    }
}

/**
 * GET /api/admin/feedback/status
 * Returns current email delivery configuration status.
 */
function feedbackStatus(req, res) {
    res.json({
        emailDeliveryEnabled: mailDeliveryEnabled,
        emailProvider: useWeb3Forms ? 'web3forms' : (useMailgunApi ? 'mailgun' : (mailTransport ? 'smtp' : 'none')),
        // adminEmail intentionally omitted — do not expose admin contact in API responses
        message: mailDeliveryEnabled
            ? `Email notifications are enabled (via ${useWeb3Forms ? 'Web3Forms' : (useMailgunApi ? 'Mailgun' : 'SMTP')}).`
            : 'Email notifications are disabled. Feedback is still stored in the database.'
    });
}

/** Validation rules for submitFeedback */
const feedbackValidation = [
    body('name').optional({ checkFalsy: true }).isString().trim().isLength({ max: 100 }).withMessage('Name is too long.'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email address.'),
    body('message').isString().trim().notEmpty().isLength({ max: 2000 }).withMessage('Message is required and must be under 2000 characters.'),
    body('rating').optional({ checkFalsy: true }).isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5.'),
];

module.exports = { submitFeedback, listFeedback, feedbackStatus, feedbackValidation };
