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

        res.json({
            history: results,
            availableTests: availableTests
        });
    } catch (error) {
        console.error('Dashboard Data Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
