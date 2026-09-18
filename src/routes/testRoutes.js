const express = require('express');
const router = express.Router();
const testController = require('../controllers/testController');
const { protect } = require('../middlewares/authMiddleware');

// Fetch a specific result's review (with correct answers revealed)
// IMPORTANT: This MUST be declared before '/:testId' to prevent Express
// from matching 'result' as a :testId wildcard.
router.get('/result/:resultId/review', protect, testController.getReview);

// Fetch test questions securely (without correct answers)
router.get('/:testId', protect, testController.getTestArenaData);

// Receive answers and grade the test
router.post('/:testId/submit', protect, testController.submitTest);

module.exports = router;
