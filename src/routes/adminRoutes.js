const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { consoleProtect, adminOnly } = require('../middlewares/adminMiddleware');

// Every route below is open to admins (ADMIN_EMAILS) and to heads of department
// (department_heads). A HOD gets the same screens, but every query is scoped to
// the students of their own department(s) — see `req.access` in the controller.
// Routes that also carry `adminOnly` are closed to HODs entirely.

// Who is signed in, and what they can see
router.get('/me', consoleProtect, adminController.getMe);

// Overview
router.get('/overview', consoleProtect, adminController.getOverview);

// Students — roster-first compliance (includes students who never signed in)
router.get('/students', consoleProtect, adminController.getStudents);
router.get('/filter-options', consoleProtect, adminController.getFilterOptions);
router.get('/exam-coverage', consoleProtect, adminController.getExamCoverage);
// :studentId accepts a numeric Students.id or an email, so roster members with
// no Students row can still be opened.
router.get('/students/:studentId', consoleProtect, adminController.getStudentDetail);

// Allow list — the roster that gates sign-in
router.get('/allowlist', consoleProtect, adminController.getAllowlist);
router.post('/allowlist', consoleProtect, adminController.createAllowedStudent);
router.put('/allowlist/:id', consoleProtect, adminController.updateAllowedStudent);
router.delete('/allowlist/:id', consoleProtect, adminController.deleteAllowedStudent);

// Departments and their heads — admin only
router.get('/departments', consoleProtect, adminOnly, adminController.getDepartments);
router.post('/hods', consoleProtect, adminOnly, adminController.createHod);
router.put('/hods/:id', consoleProtect, adminOnly, adminController.updateHod);
router.delete('/hods/:id', consoleProtect, adminOnly, adminController.deleteHod);

// Tests
router.get('/tests', consoleProtect, adminController.getTests);
router.get('/tests-list', consoleProtect, adminController.getTestsList);

// Attempts
router.get('/attempts', consoleProtect, adminController.getAttempts);
router.get('/attempts/:resultId', consoleProtect, adminController.getAttemptDetail);

// Warnings / Violations
router.get('/warnings', consoleProtect, adminController.getWarnings);

// Questions analytics
router.get('/questions', consoleProtect, adminController.getQuestions);

// Export — xlsx by default, ?format=csv for the flat file.
// Types: roster | matrix | coverage | attempts | violations
router.get('/export/:type', consoleProtect, adminController.exportData);

module.exports = router;
