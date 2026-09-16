const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'cds_super_secret_key_2026';

// Parse the comma-separated ADMIN_EMAILS env variable into a Set for O(1) lookup.
const ADMIN_EMAILS = new Set(
    (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean)
);

/**
 * adminProtect middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Validates the Bearer JWT (same secret as regular protect middleware).
 * 2. Checks that the authenticated user's email is in the ADMIN_EMAILS whitelist.
 * 3. Only then calls next(). Otherwise returns 401 or 403.
 */
exports.adminProtect = (req, res, next) => {
    let token = req.headers.authorization;

    if (token && token.startsWith('Bearer')) {
        token = token.split(' ')[1];
    } else {
        return res.status(401).json({ message: 'Not authorized. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;

        // Check admin whitelist
        if (!decoded.email || !ADMIN_EMAILS.has(decoded.email.toLowerCase())) {
            return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
        }

        next();
    } catch (error) {
        return res.status(401).json({ message: 'Not authorized. Invalid or expired token.' });
    }
};
