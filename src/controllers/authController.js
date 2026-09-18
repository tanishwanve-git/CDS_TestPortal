const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const getPool = require('../config/db');

require('dotenv').config();
const { OAuth2Client } = require('google-auth-library');

const JWT_SECRET = process.env.JWT_SECRET || 'cds_super_secret_key_2026';
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function checkStudentAuthorization(rawEmail, pool) {
    const email = rawEmail ? rawEmail.trim().toLowerCase() : '';
    if (!email.endsWith('@iitgn.ac.in')) {
        return {
            allowed: false,
            status: 403,
            error: 'Access restricted to official @iitgn.ac.in email addresses only.',
            message: 'Access restricted to official @iitgn.ac.in email addresses only.'
        };
    }
    const [rows] = await pool.query('SELECT * FROM allowed_students WHERE LOWER(email) = ? AND is_active = TRUE', [email]);
    if (rows.length === 0) {
        return {
            allowed: false,
            status: 403,
            error: 'Access Denied: Your email address is not registered for this portal.',
            message: 'Access Denied: Your email address is not registered for this portal.'
        };
    }
    return {
        allowed: true,
        profile: rows[0]
    };
}

exports.verifyEmail = async (req, res) => {
    try {
        const email = req.body.email || req.query.email;
        if (!email) {
            return res.status(400).json({ allowed: false, error: 'Email is required' });
        }
        const pool = await getPool;
        const authResult = await checkStudentAuthorization(email, pool);
        if (!authResult.allowed) {
            return res.status(authResult.status).json({
                allowed: false,
                error: authResult.error,
                message: authResult.message
            });
        }
        return res.json({
            allowed: true,
            studentProfile: authResult.profile
        });
    } catch (error) {
        console.error('Verify Email Error:', error);
        res.status(500).json({ allowed: false, error: 'Internal Server Error' });
    }
};

exports.register = async (req, res) => {
    try {
        const { email, name, password, roll_number, branch } = req.body;

        if (!email || !name || !password) {
            return res.status(400).json({ message: 'Email, name, and password are required' });
        }

        const pool = await getPool;

        // Domain & Whitelist Auth Check
        const authCheck = await checkStudentAuthorization(email, pool);
        if (!authCheck.allowed) {
            return res.status(authCheck.status).json({
                error: authCheck.error,
                message: authCheck.message
            });
        }
        const allowedStudent = authCheck.profile;

        const cleanEmail = email.trim().toLowerCase();

        // Check if email already exists
        const [existingEmail] = await pool.query('SELECT id FROM Students WHERE email = ?', [cleanEmail]);
        if (existingEmail.length > 0) {
            return res.status(409).json({ message: 'User already exists with this email' });
        }

        const finalRoll = roll_number || allowedStudent.roll_number;
        const finalBranch = branch || allowedStudent.discipline;

        // Check if roll number already exists
        if (finalRoll) {
            const [existingRoll] = await pool.query('SELECT id FROM Students WHERE roll_number = ?', [finalRoll]);
            if (existingRoll.length > 0) {
                return res.status(409).json({
                    message: 'This Roll Number is already registered. If you believe this is an error, please contact the exam coordinator.'
                });
            }
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert new user
        const [result] = await pool.query(
            'INSERT INTO Students (email, name, password_hash, roll_number, branch, programme, discipline) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [cleanEmail, name || allowedStudent.name, hashedPassword, finalRoll, finalBranch, allowedStudent.programme, allowedStudent.discipline]
        );

        const newUserId = result.insertId;

        // Auto-login: generate token immediately after registration
        const token = jwt.sign(
            { id: newUserId, email: cleanEmail },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: newUserId, name: name || allowedStudent.name, email: cleanEmail, roll_number: finalRoll, branch: finalBranch, programme: allowedStudent.programme, discipline: allowedStudent.discipline }
        });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const pool = await getPool;

        // Domain & Whitelist Auth Check
        const authCheck = await checkStudentAuthorization(email, pool);
        if (!authCheck.allowed) {
            return res.status(authCheck.status).json({
                error: authCheck.error,
                message: authCheck.message
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        // Find user
        const [users] = await pool.query('SELECT * FROM Students WHERE email = ?', [cleanEmail]);
        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = users[0];

        // Check password
        if (!user.password_hash) {
            return res.status(401).json({ message: 'This account uses Google Sign-In. Please click "Sign in with Google".' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({
            message: 'Logged in successfully',
            token,
            user: { id: user.id, name: user.name, email: user.email, roll_number: user.roll_number, branch: user.branch, programme: user.programme, discipline: user.discipline }
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.googleLogin = async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ message: 'Google token is required' });
        }

        const pool = await getPool;

        // Verify the Google token
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;
        const cleanEmail = email ? email.trim().toLowerCase() : '';

        // Domain & Whitelist Auth Check
        const authCheck = await checkStudentAuthorization(cleanEmail, pool);
        if (!authCheck.allowed) {
            return res.status(authCheck.status).json({
                error: authCheck.error,
                message: authCheck.message
            });
        }

        const allowedStudent = authCheck.profile;

        // Check if user exists
        const [users] = await pool.query('SELECT * FROM Students WHERE email = ?', [cleanEmail]);

        let user;

        if (users.length === 0) {
            // Register new user via Google with pre-populated details from allowed_students
            const [result] = await pool.query(
                'INSERT INTO Students (email, name, google_id, roll_number, branch, programme, discipline) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [cleanEmail, allowedStudent.name || name, googleId, allowedStudent.roll_number, allowedStudent.discipline, allowedStudent.programme, allowedStudent.discipline]
            );
            user = { id: result.insertId, email: cleanEmail, name: allowedStudent.name || name, google_id: googleId, roll_number: allowedStudent.roll_number, branch: allowedStudent.discipline, programme: allowedStudent.programme, discipline: allowedStudent.discipline };
        } else {
            user = users[0];
            // Update roll_number/branch/google_id if missing or unlinked
            await pool.query(
                'UPDATE Students SET google_id = ?, roll_number = IFNULL(roll_number, ?), branch = IFNULL(branch, ?), programme = IFNULL(programme, ?), discipline = IFNULL(discipline, ?) WHERE id = ?',
                [googleId, allowedStudent.roll_number, allowedStudent.discipline, allowedStudent.programme, allowedStudent.discipline, user.id]
            );
            user.roll_number = user.roll_number || allowedStudent.roll_number;
            user.branch = user.branch || allowedStudent.discipline;
            user.programme = user.programme || allowedStudent.programme;
            user.discipline = user.discipline || allowedStudent.discipline;
        }

        // Generate our own JWT for session management
        const sessionToken = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({
            message: 'Logged in with Google successfully',
            token: sessionToken,
            user: { id: user.id, name: user.name, email: user.email, roll_number: user.roll_number, branch: user.branch, programme: user.programme, discipline: user.discipline }
        });
    } catch (error) {
        console.error('Google Login Error:', error);
        res.status(401).json({ message: 'Invalid Google token or authorization failure.' });
    }
};

exports.completeProfile = async (req, res) => {
    try {
        const { name, roll_number, branch } = req.body;
        const userId = req.user.id; // from protect middleware

        if (!name || !roll_number || !branch) {
            return res.status(400).json({ message: 'Name, roll number, and branch are required.' });
        }

        const pool = await getPool;

        // Check if this roll number is taken by ANOTHER user
        const [existingRoll] = await pool.query(
            'SELECT id FROM Students WHERE roll_number = ? AND id != ?',
            [roll_number, userId]
        );
        if (existingRoll.length > 0) {
            return res.status(409).json({
                message: 'Roll Number already assigned to another account. Please verify your details or contact support.'
            });
        }

        await pool.query(
            'UPDATE Students SET name = ?, roll_number = ?, branch = ? WHERE id = ?',
            [name, roll_number, branch, userId]
        );

        // Fetch updated user to return
        const [users] = await pool.query('SELECT * FROM Students WHERE id = ?', [userId]);
        const user = users[0];

        res.json({
            message: 'Profile completed successfully',
            user: { id: user.id, name: user.name, email: user.email, roll_number: user.roll_number, branch: user.branch }
        });
    } catch (error) {
        console.error('Complete Profile Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getConfig = (req, res) => {
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID || ''
    });
};
