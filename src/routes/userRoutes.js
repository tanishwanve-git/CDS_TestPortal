const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');

// Get current user profile
router.get('/profile', protect, userController.getProfile);

// Get dashboard data (history + available tests)
router.get('/dashboard', protect, userController.getDashboardData);

module.exports = router;
