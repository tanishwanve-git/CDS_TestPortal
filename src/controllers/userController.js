const getPool = require('../config/db');

// Fetch user profile
exports.getProfile = async (req, res) => {
    try {
        const userId = req.user.id; // from authMiddleware
        const pool = await getPool;

        const [users] = await pool.query(
            'SELECT id, name, email, roll_number, branch, created_at FROM Students WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ profile: users[0] });
    } catch (error) {
        console.error('Profile Fetch Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// Fetch user's test history and available tests
exports.getDashboardData = async (req, res) => {
    try {
        const userId = req.user.id;
        const pool = await getPool;

        // Get past results
        const [results] = await pool.query(`
            SELECT r.id, r.score, r.time_taken_seconds, r.created_at, t.title, t.total_questions
            FROM Test_Results r
            JOIN Tests t ON r.test_id = t.id
            WHERE r.student_id = ?
            ORDER BY r.created_at DESC
        `, [userId]);

        // Get available tests (all tests for now, maybe exclude ones already taken)
        const [availableTests] = await pool.query(`
            SELECT t.id, t.title, t.duration_minutes, t.total_questions, t.created_at
            FROM Tests t
            WHERE t.id NOT IN (
                SELECT test_id FROM Test_Results WHERE student_id = ?
            )
            ORDER BY t.created_at DESC
        `, [userId]);

        // Mock-exam attempt history (the randomised papers drawn from Question_Bank).
        // Kept separate from `history` above because a mock exam can be re-attempted
        // any number of times, while a legacy Test can be sat only once.
        const [mockHistory] = await pool.query(`
            SELECT a.id AS attempt_id, a.exam_id, a.score, a.max_score, a.total_questions,
                   a.total_correct, a.total_wrong, a.total_answered,
                   a.time_taken_seconds, a.submitted_at, e.title, e.code
            FROM Exam_Attempts a
            JOIN Mock_Exams e ON e.id = a.exam_id
            WHERE a.student_id = ? AND a.status = 'submitted'
            ORDER BY a.submitted_at DESC
            LIMIT 100
        `, [userId]);

        res.json({
            history: results,
            availableTests: availableTests,
            mockHistory: mockHistory
        });
    } catch (error) {
        console.error('Dashboard Data Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
