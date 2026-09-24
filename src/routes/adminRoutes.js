const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { adminProtect } = require('../middlewares/adminMiddleware');

// All routes below are protected by the admin middleware.
// Any request without a valid JWT belonging to an ADMIN_EMAILS address will be rejected.

// Overview
router.get('/overview', adminProtect, adminController.getOverview);

// Students — roster-first compliance (includes students who never signed in)
router.get('/students', adminProtect, adminController.getStudents);
router.get('/filter-options', adminProtect, adminController.getFilterOptions);
router.get('/exam-coverage', adminProtect, adminController.getExamCoverage);
// :studentId accepts a numeric Students.id or an email, so roster members with
// no Students row can still be opened.
router.get('/students/:studentId', adminProtect, adminController.getStudentDetail);

// Tests
router.get('/tests', adminProtect, adminController.getTests);
router.get('/tests-list', adminProtect, adminController.getTestsList);

// Attempts
router.get('/attempts', adminProtect, adminController.getAttempts);
router.get('/attempts/:resultId', adminProtect, adminController.getAttemptDetail);

// Warnings / Violations
router.get('/warnings', adminProtect, adminController.getWarnings);

// Questions analytics
router.get('/questions', adminProtect, adminController.getQuestions);

// Export — xlsx by default, ?format=csv for the flat file.
// Types: roster | matrix | coverage | attempts | violations
router.get('/export/:type', adminProtect, adminController.exportData);

module.exports = router;
