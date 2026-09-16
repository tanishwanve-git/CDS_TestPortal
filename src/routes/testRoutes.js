const express = require('express');
const router = express.Router();
const testController = require('../controllers/testController');
const { protect } = require('../middlewares/authMiddleware');

// Fetch test questions securely (without correct answers)
router.get('/:testId', protect, testController.getTestArenaData);

// Receive answers and grade the test
router.post('/:testId/submit', protect, testController.submitTest);

// Fetch a specific result's review (with correct answers revealed)
router.get('/result/:resultId/review', protect, testController.getReview);

module.exports = router;
