const bcrypt = require('bcrypt');
const getPool = require('../config/db');
const { sendOTPEmail } = require('../utils/mailer');

// ─── Step 1: Request OTP ─────────────────────────────────────────────────────
// POST /api/auth/forgot-password
// Body: { email }
exports.requestOTP = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email is required.' });

        const pool = await getPool;

        // Check if user with this email exists
        const [users] = await pool.query('SELECT id FROM Students WHERE email = ?', [email]);
        if (users.length === 0) {
            // Return success anyway to avoid leaking which emails are registered
            return res.json({ message: 'If that email is registered, an OTP has been sent.' });
        }

        // Generate 6-digit OTP
        const otp = String(Math.floor(100000 + Math.random() * 900000));

        // Hash the OTP before storing (extra security)
        const salt = await bcrypt.genSalt(10);
        const otpHash = await bcrypt.hash(otp, salt);

        // Set expiry = now + 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Delete any previous unused OTPs for this email
        await pool.query('DELETE FROM Password_Reset_OTPs WHERE email = ?', [email]);

        // Store new OTP
        await pool.query(
            'INSERT INTO Password_Reset_OTPs (email, otp_hash, expires_at) VALUES (?, ?, ?)',
            [email, otpHash, expiresAt]
        );

        // Send email
        await sendOTPEmail(email, otp);

        res.json({ message: 'If that email is registered, an OTP has been sent.' });

    } catch (error) {
        console.error('Request OTP Error:', error);
        res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
    }
};

// ─── Step 2: Verify OTP ───────────────────────────────────────────────────────
// POST /api/auth/verify-otp
// Body: { email, otp }
// Returns a short-lived reset_token that is required for the final password reset.
exports.verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required.' });

        const pool = await getPool;

        const [rows] = await pool.query(
            'SELECT * FROM Password_Reset_OTPs WHERE email = ? AND used = FALSE ORDER BY created_at DESC LIMIT 1',
            [email]
        );

        if (rows.length === 0) {
            return res.status(400).json({ message: 'No active OTP found. Please request a new one.' });
        }

        const record = rows[0];

        // Check expiry
        if (new Date() > new Date(record.expires_at)) {
            return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
        }

        // Compare OTP
        const isMatch = await bcrypt.compare(otp, record.otp_hash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect OTP. Please try again.' });
        }

        // Mark OTP as used
        await pool.query('UPDATE Password_Reset_OTPs SET used = TRUE WHERE id = ?', [record.id]);

        // Issue a short-lived reset token (5 min) so only verified users can call reset
        const jwt = require('jsonwebtoken');
        const resetToken = jwt.sign(
            { email, purpose: 'password_reset' },
            process.env.JWT_SECRET,
            { expiresIn: '5m' }
        );

        res.json({ message: 'OTP verified.', reset_token: resetToken });

    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Step 3: Reset Password ───────────────────────────────────────────────────
// POST /api/auth/reset-password
// Body: { reset_token, new_password }
exports.resetPassword = async (req, res) => {
    try {
        const { reset_token, new_password } = req.body;
        if (!reset_token || !new_password) {
            return res.status(400).json({ message: 'Reset token and new password are required.' });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters.' });
        }

        // Verify the reset token
        const jwt = require('jsonwebtoken');
        let decoded;
        try {
            decoded = jwt.verify(reset_token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ message: 'Reset link has expired. Please start again.' });
        }

        if (decoded.purpose !== 'password_reset') {
            return res.status(401).json({ message: 'Invalid reset token.' });
        }

        const pool = await getPool;

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(new_password, salt);

        // Update in database
        await pool.query('UPDATE Students SET password_hash = ? WHERE email = ?', [newHash, decoded.email]);

        res.json({ message: 'Password has been reset successfully. You can now log in.' });

    } catch (error) {
        console.error('Reset Password Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
