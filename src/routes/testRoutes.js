const express = require('express');
const router = express.Router();
const testController = require('../controllers/testController');
const mockController = require('../controllers/mockController');
const { protect } = require('../middlewares/authMiddleware');

// ─── Mock exams (randomised papers drawn from Question_Bank) ─────────────────
// These are declared before the legacy '/:testId' routes so that 'mock' is never
// swallowed by the wildcard.
router.get('/mock', protect, mockController.listMockExams);
router.post('/mock/:examId/start', protect, mockController.startAttempt);
router.get('/mock/attempt/:attemptId', protect, mockController.getAttempt);
router.post('/mock/attempt/:attemptId/answer', protect, mockController.saveAnswer);
router.post('/mock/attempt/:attemptId/submit', protect, mockController.submitAttempt);
router.get('/mock/attempt/:attemptId/review', protect, mockController.getAttemptReview);
router.post('/mock/attempt/:attemptId/abandon', protect, mockController.abandonAttempt);

// ─── Legacy fixed tests (Tests / Questions tables) ───────────────────────────
// Fetch a specific result's review (with correct answers revealed)
// IMPORTANT: This MUST be declared before '/:testId' to prevent Express
// from matching 'result' as a :testId wildcard.
router.get('/result/:resultId/review', protect, testController.getReview);

// Fetch test questions securely (without correct answers)
router.get('/:testId', protect, testController.getTestArenaData);

// Receive answers and grade the test
router.post('/:testId/submit', protect, testController.submitTest);

module.exports = router;
