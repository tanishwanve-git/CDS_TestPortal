const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const passwordController = require('../controllers/passwordController');
const { protect } = require('../middlewares/authMiddleware');

// Get Public Auth Configuration (e.g. Google Client ID)
router.get('/config', authController.getConfig);

// Complete Profile Route for Google Login Users
router.post('/complete-profile', protect, authController.completeProfile);

// Registration Route
router.post('/register', authController.register);

// Login Route
router.post('/login', authController.login);

// Verify Email / Allowed Student Route
router.post('/verify', authController.verifyEmail);
router.get('/verify', authController.verifyEmail);

// Google Sign-In Route
router.post('/google', authController.googleLogin);

// ── Forgot / Reset Password ──────────────────────────────────
// Step 1: Send OTP to registered email
router.post('/forgot-password', passwordController.requestOTP);

// Step 2: Verify OTP — returns a short-lived reset_token
router.post('/verify-otp', passwordController.verifyOTP);

// Step 3: Use reset_token to set a new password
router.post('/reset-password', passwordController.resetPassword);

module.exports = router;
