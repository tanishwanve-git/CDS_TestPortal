const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'cds_super_secret_key_2026';

exports.protect = (req, res, next) => {
    let token = req.headers.authorization;

    if (token && token.startsWith('Bearer')) {
        token = token.split(' ')[1];
    } else {
        return res.status(401).json({ message: 'Not authorized to access this route. No token provided.' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return res.status(401).json({ message: 'Not authorized. Invalid or expired token.' });
    }

    // A head of department who is not also a student signs in with a
    // console-only token that carries no Students id. Every route behind this
    // guard acts on req.user.id, so such a token has nothing to do here.
    if (!decoded.id) {
        return res.status(403).json({ message: 'This account can only open the admin console.' });
    }

    req.user = decoded;
    next();
};

const getPool = require('../config/db');

exports.authenticateStudentAccess = async (req, res, next) => {
    try {
        let email = (req.body && req.body.email) ? req.body.email.trim().toLowerCase() : '';

        // If email not directly in body (e.g., inside google payload handled separately), extract if passed
        if (!email && req.email) {
            email = req.email.trim().toLowerCase();
        }

        if (!email) {
            return res.status(400).json({
                error: 'Email is required for authorization check.',
                message: 'Email is required.'
            });
        }

        // 1. Domain Validation
        if (!email.endsWith('@iitgn.ac.in')) {
            return res.status(403).json({
                error: 'Access restricted to official @iitgn.ac.in email addresses only.',
                message: 'Access restricted to official @iitgn.ac.in email addresses only.'
            });
        }

        // 2. Database Whitelist Lookup
        const pool = await getPool;
        const [rows] = await pool.query('SELECT * FROM allowed_students WHERE LOWER(email) = ? AND is_active = TRUE', [email]);
        if (rows.length === 0) {
            return res.status(403).json({
                error: 'Access Denied: Your email address is not registered for this portal.',
                message: 'Access Denied: Your email address is not registered for this portal.'
            });
        }

        req.studentProfile = rows[0];
        next();
    } catch (err) {
        console.error('authenticateStudentAccess middleware error:', err);
        return res.status(500).json({ error: 'Internal server error during authorization check.', message: 'Internal Server Error' });
    }
};

