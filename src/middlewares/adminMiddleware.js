const jwt = require('jsonwebtoken');
const getPool = require('../config/db');
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
 * Who may open the console, and how much of it they see.
 *
 *   { role: 'admin', departments: [] }            — everything
 *   { role: 'hod', departments: ['Civil', …] }    — only those departments' students
 *   null                                           — no console access
 *
 * Admins come from ADMIN_EMAILS; HODs from the department_heads table. An
 * address in both is treated as an admin. This is looked up on every request
 * rather than trusted from the JWT, so removing or deactivating a HOD takes
 * effect immediately instead of when their token expires.
 */
async function resolveConsoleAccess(rawEmail) {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email) return null;
    if (ADMIN_EMAILS.has(email)) return { role: 'admin', departments: [] };

    const pool = await getPool;
    const [rows] = await pool.query(
        `SELECT name, department FROM department_heads
          WHERE LOWER(email) = ? AND is_active = TRUE
          ORDER BY department`,
        [email]
    );
    if (!rows.length) return null;
    return { role: 'hod', name: rows[0].name, departments: rows.map(r => r.department) };
}

exports.resolveConsoleAccess = resolveConsoleAccess;

/**
 * consoleProtect middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Validates the Bearer JWT (same secret as regular protect middleware).
 * 2. Resolves the caller to an admin or a HOD; anyone else gets a 403.
 * 3. Leaves the result on req.access, which every console query scopes by.
 */
exports.consoleProtect = async (req, res, next) => {
    let token = req.headers.authorization;

    if (token && token.startsWith('Bearer')) {
        token = token.split(' ')[1];
    } else {
        return res.status(401).json({ message: 'Not authorized. No token provided.' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return res.status(401).json({ message: 'Not authorized. Invalid or expired token.' });
    }
    req.user = decoded;

    try {
        const access = await resolveConsoleAccess(decoded.email);
        if (!access) {
            return res.status(403).json({ message: 'Access denied. Admin or head-of-department privileges required.' });
        }
        req.access = access;
        next();
    } catch (error) {
        console.error('Console access check error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

/**
 * adminOnly middleware — goes after consoleProtect on the routes a HOD must not
 * reach at all (managing HODs themselves).
 */
exports.adminOnly = (req, res, next) => {
    if (!req.access || req.access.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }
    next();
};
