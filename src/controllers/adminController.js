const getPool = require('../config/db');

// ─── Overview ────────────────────────────────────────────────────────────────

exports.getOverview = async (req, res) => {
    try {
        const pool = await getPool;

        const [[{ total_students }]] = await pool.query('SELECT COUNT(*) AS total_students FROM Students');
        const [[{ total_tests }]] = await pool.query('SELECT COUNT(*) AS total_tests FROM Tests');
        const [[{ total_attempts }]] = await pool.query('SELECT COUNT(*) AS total_attempts FROM Test_Results');
        const [[{ avg_score }]] = await pool.query('SELECT ROUND(AVG(score), 2) AS avg_score FROM Test_Results');
        const [[{ max_score }]] = await pool.query('SELECT MAX(score) AS max_score FROM Test_Results');
        const [[{ min_score }]] = await pool.query('SELECT MIN(score) AS min_score FROM Test_Results');
        const [[{ total_violations }]] = await pool.query('SELECT COUNT(*) AS total_violations FROM Test_Violations');

        // Attempts per test for chart data
        const [attemptsPerTest] = await pool.query(`
            SELECT t.title, COUNT(r.id) AS attempt_count, ROUND(AVG(r.score), 2) AS avg_score
            FROM Tests t
            LEFT JOIN Test_Results r ON t.id = r.test_id
            GROUP BY t.id, t.title
            ORDER BY t.id
        `);

        // Recent 10 attempts
        const [recentAttempts] = await pool.query(`
            SELECT r.id, s.name AS student_name, s.roll_number, t.title AS test_title,
                   r.score, r.created_at
            FROM Test_Results r
            JOIN Students s ON r.student_id = s.id
            JOIN Tests t ON r.test_id = t.id
            ORDER BY r.created_at DESC
            LIMIT 10
        `);

        res.json({
            stats: {
                total_students,
                total_tests,
                total_attempts,
                avg_score: avg_score || 0,
                max_score: max_score || 0,
                min_score: min_score || 0,
                total_violations
            },
            attemptsPerTest,
            recentAttempts
        });
    } catch (error) {
        console.error('Admin Overview Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Students ─────────────────────────────────────────────────────────────────

exports.getStudents = async (req, res) => {
    try {
        const pool = await getPool;
        const { search, branch, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const conditions = ['1=1'];
        const params = [];

        if (search) {
            conditions.push('(s.name LIKE ? OR s.email LIKE ? OR s.roll_number LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (branch) {
            conditions.push('s.branch = ?');
            params.push(branch);
        }

        const whereClause = 'WHERE ' + conditions.join(' AND ');

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM Students s ${whereClause}`,
            params
        );

        const [students] = await pool.query(`
            SELECT s.id, s.name, s.email, s.roll_number, s.branch, s.created_at,
                   COUNT(DISTINCT r.test_id) AS tests_attempted,
                   ROUND(AVG(r.score), 2) AS avg_score,
                   MAX(r.score) AS best_score
            FROM Students s
            LEFT JOIN Test_Results r ON s.id = r.student_id
            ${whereClause}
            GROUP BY s.id
            ORDER BY s.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        // Branch distribution
        const [branchDist] = await pool.query(
            'SELECT branch, COUNT(*) AS count FROM Students GROUP BY branch ORDER BY count DESC'
        );

        res.json({ total, students, branchDist });
    } catch (error) {
        console.error('Admin Students Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getStudentDetail = async (req, res) => {
    try {
        const pool = await getPool;
        const studentId = req.params.studentId;

        const [students] = await pool.query(
            'SELECT id, name, email, roll_number, branch, created_at FROM Students WHERE id = ?',
            [studentId]
        );
        if (students.length === 0) return res.status(404).json({ message: 'Student not found' });

        const [attempts] = await pool.query(`
            SELECT r.id, t.title, r.score, r.time_taken_seconds, r.created_at,
                   (SELECT COUNT(*) FROM Questions WHERE test_id = t.id) AS total_questions
            FROM Test_Results r
            JOIN Tests t ON r.test_id = t.id
            WHERE r.student_id = ?
            ORDER BY r.created_at DESC
        `, [studentId]);

        const [violations] = await pool.query(`
            SELECT v.*, t.title AS test_title
            FROM Test_Violations v
            JOIN Tests t ON v.test_id = t.id
            WHERE v.student_id = ?
            ORDER BY v.created_at DESC
        `, [studentId]);

        res.json({ student: students[0], attempts, violations });
    } catch (error) {
        console.error('Admin Student Detail Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Tests ────────────────────────────────────────────────────────────────────

exports.getTests = async (req, res) => {
    try {
        const pool = await getPool;

        const [tests] = await pool.query(`
            SELECT t.id, t.title, t.duration_minutes, t.total_questions, t.created_at,
                   COUNT(DISTINCT r.student_id) AS unique_students,
                   COUNT(r.id) AS attempt_count,
                   ROUND(AVG(r.score), 2) AS avg_score,
                   MAX(r.score) AS max_score,
                   MIN(r.score) AS min_score,
                   (SELECT COUNT(*) FROM Questions q WHERE q.test_id = t.id) AS question_count
            FROM Tests t
            LEFT JOIN Test_Results r ON t.id = r.test_id
            GROUP BY t.id
            ORDER BY t.created_at DESC
        `);

        res.json({ tests });
    } catch (error) {
        console.error('Admin Tests Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Attempts ─────────────────────────────────────────────────────────────────

exports.getAttempts = async (req, res) => {
    try {
        const pool = await getPool;
        const { test_id, student_id, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let where = 'WHERE 1=1';
        const params = [];

        if (test_id) { where += ' AND r.test_id = ?'; params.push(test_id); }
        if (student_id) { where += ' AND r.student_id = ?'; params.push(student_id); }

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM Test_Results r ${where}`,
            params
        );

        const [attempts] = await pool.query(`
            SELECT r.id, s.name AS student_name, s.roll_number, s.branch,
                   t.title AS test_title, r.score, r.time_taken_seconds, r.created_at,
                   t.total_questions,
                   CASE WHEN v.id IS NOT NULL THEN 1 ELSE 0 END AS has_violation
            FROM Test_Results r
            JOIN Students s ON r.student_id = s.id
            JOIN Tests t ON r.test_id = t.id
            LEFT JOIN Test_Violations v ON v.result_id = r.id
            ${where}
            ORDER BY r.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        res.json({ total, attempts });
    } catch (error) {
        console.error('Admin Attempts Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getAttemptDetail = async (req, res) => {
    try {
        const pool = await getPool;
        const resultId = req.params.resultId;

        const [results] = await pool.query(`
            SELECT r.*, s.name AS student_name, s.roll_number, s.email, t.title AS test_title
            FROM Test_Results r
            JOIN Students s ON r.student_id = s.id
            JOIN Tests t ON r.test_id = t.id
            WHERE r.id = ?
        `, [resultId]);

        if (results.length === 0) return res.status(404).json({ message: 'Attempt not found' });
        const resultData = results[0];

        // Fetch the student's submitted answers
        const [answerRows] = await pool.query(
            'SELECT answers FROM Test_Result_Answers WHERE result_id = ?',
            [resultId]
        );
        const submittedAnswers = answerRows.length > 0
            ? (typeof answerRows[0].answers === 'string' ? JSON.parse(answerRows[0].answers) : answerRows[0].answers)
            : {};

        // Fetch all questions for this test with correct answers (admin can see them)
        const [questions] = await pool.query(`
            SELECT q.id, q.question_text, q.options, q.correct_answer, q.question_type,
                   q.marks, q.negative_marks, s.section_name
            FROM Questions q
            LEFT JOIN Test_Sections s ON q.section_id = s.id
            WHERE q.test_id = ?
            ORDER BY s.id, q.id
        `, [resultData.test_id]);

        const annotated = questions.map(q => {
            const studentAns = submittedAnswers[q.id];
            const isCorrect = (q.question_type === 'NAT')
                ? String(studentAns || '').trim() === String(q.correct_answer).trim()
                : studentAns === q.correct_answer;
            return {
                ...q,
                student_answer: studentAns || null,
                is_correct: studentAns ? isCorrect : null,
                is_skipped: !studentAns
            };
        });

        res.json({ result: resultData, answers: submittedAnswers, questions: annotated });
    } catch (error) {
        console.error('Admin Attempt Detail Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Warnings ─────────────────────────────────────────────────────────────────

exports.getWarnings = async (req, res) => {
    try {
        const pool = await getPool;
        const { test_id, student_id, auto_submitted, page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let where = 'WHERE 1=1';
        const params = [];

        if (test_id) { where += ' AND v.test_id = ?'; params.push(test_id); }
        if (student_id) { where += ' AND v.student_id = ?'; params.push(student_id); }
        if (auto_submitted === '1' || auto_submitted === 'true') {
            where += ' AND v.auto_submitted = 1';
        }

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM Test_Violations v ${where}`,
            params
        );

        const [violations] = await pool.query(`
            SELECT v.id, s.name AS student_name, s.roll_number, s.email, s.branch,
                   t.title AS test_title, v.violation_type, v.violation_count,
                   v.auto_submitted, v.created_at
            FROM Test_Violations v
            JOIN Students s ON v.student_id = s.id
            JOIN Tests t ON v.test_id = t.id
            ${where}
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        // Summary stats
        const [[{ total_violations }]] = await pool.query('SELECT COUNT(*) AS total_violations FROM Test_Violations');
        const [[{ auto_submitted_count }]] = await pool.query('SELECT COUNT(*) AS auto_submitted_count FROM Test_Violations WHERE auto_submitted = 1');

        res.json({ total, violations, summary: { total_violations, auto_submitted_count } });
    } catch (error) {
        console.error('Admin Warnings Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Questions Analytics ──────────────────────────────────────────────────────

exports.getQuestions = async (req, res) => {
    try {
        const pool = await getPool;
        const { test_id, page = 1, limit = 30 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        let where = test_id ? 'WHERE q.test_id = ?' : '';
        const params = test_id ? [test_id] : [];

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM Questions q ${where}`,
            params
        );

        // For each question, compute attempt count and accuracy from Test_Result_Answers
        const [questions] = await pool.query(`
            SELECT q.id, q.question_text, q.question_type, q.marks, q.negative_marks,
                   q.correct_answer, t.title AS test_title, s.section_name
            FROM Questions q
            JOIN Tests t ON q.test_id = t.id
            LEFT JOIN Test_Sections s ON q.section_id = s.id
            ${where}
            ORDER BY q.test_id, q.id
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        // Fetch answer data for accuracy computation
        const [answerRows] = await pool.query(`
            SELECT tra.answers, tr.test_id
            FROM Test_Result_Answers tra
            JOIN Test_Results tr ON tra.result_id = tr.id
            ${test_id ? 'WHERE tr.test_id = ?' : ''}
        `, test_id ? [test_id] : []);

        // Build per-question stats
        const qStats = {}; // { qId: { attempts, correct } }
        for (const row of answerRows) {
            const answers = typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers;
            for (const [qId, ans] of Object.entries(answers)) {
                if (!qStats[qId]) qStats[qId] = { attempts: 0, correct: 0 };
                if (ans) {
                    qStats[qId].attempts++;
                    // We need the correct answer — find it from questions array
                    const qDef = questions.find(q => String(q.id) === String(qId));
                    if (qDef) {
                        const isCorrect = qDef.question_type === 'NAT'
                            ? String(ans).trim() === String(qDef.correct_answer).trim()
                            : ans === qDef.correct_answer;
                        if (isCorrect) qStats[qId].correct++;
                    }
                }
            }
        }

        const annotated = questions.map(q => {
            const s = qStats[q.id] || { attempts: 0, correct: 0 };
            const accuracy = s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : null;
            return {
                ...q,
                attempt_count: s.attempts,
                correct_count: s.correct,
                accuracy_pct: accuracy,
                difficulty: accuracy === null ? 'unattempted'
                    : accuracy >= 70 ? 'easy'
                    : accuracy >= 40 ? 'medium'
                    : 'hard'
            };
        });

        res.json({ total, questions: annotated });
    } catch (error) {
        console.error('Admin Questions Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── CSV Export ───────────────────────────────────────────────────────────────

exports.exportCSV = async (req, res) => {
    try {
        const pool = await getPool;
        const { type } = req.params;

        let rows, headers;

        if (type === 'students') {
            [rows] = await pool.query(`
                SELECT s.id, s.name, s.email, s.roll_number, s.branch, s.created_at,
                       COUNT(r.id) AS tests_attempted, ROUND(AVG(r.score), 2) AS avg_score
                FROM Students s
                LEFT JOIN Test_Results r ON s.id = r.student_id
                GROUP BY s.id
                ORDER BY s.name
            `);
            headers = ['ID', 'Name', 'Email', 'Roll Number', 'Branch', 'Registered At', 'Tests Attempted', 'Avg Score'];
        } else if (type === 'attempts') {
            [rows] = await pool.query(`
                SELECT r.id, s.name, s.roll_number, s.branch, t.title, r.score,
                       r.time_taken_seconds, r.created_at,
                       CASE WHEN v.id IS NOT NULL THEN 'Yes' ELSE 'No' END AS had_violation
                FROM Test_Results r
                JOIN Students s ON r.student_id = s.id
                JOIN Tests t ON r.test_id = t.id
                LEFT JOIN Test_Violations v ON v.result_id = r.id
                ORDER BY r.created_at DESC
            `);
            headers = ['Result ID', 'Student', 'Roll No', 'Branch', 'Test', 'Score', 'Time (sec)', 'Date', 'Had Violation'];
        } else if (type === 'violations') {
            [rows] = await pool.query(`
                SELECT v.id, s.name, s.roll_number, s.email, s.branch, t.title,
                       v.violation_type, v.violation_count, v.auto_submitted, v.created_at
                FROM Test_Violations v
                JOIN Students s ON v.student_id = s.id
                JOIN Tests t ON v.test_id = t.id
                ORDER BY v.created_at DESC
            `);
            headers = ['ID', 'Student', 'Roll No', 'Email', 'Branch', 'Test', 'Type', 'Count', 'Auto-Submitted', 'Date'];
        } else {
            return res.status(400).json({ message: 'Invalid export type' });
        }

        // Build CSV
        const escape = v => {
            if (v === null || v === undefined) return '';
            const str = String(v);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvRows = [headers.join(',')];
        for (const row of rows) {
            csvRows.push(Object.values(row).map(escape).join(','));
        }

        const csv = csvRows.join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${type}_${Date.now()}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Admin Export Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Tests list (for filter dropdowns) ───────────────────────────────────────

exports.getTestsList = async (req, res) => {
    try {
        const pool = await getPool;
        const [tests] = await pool.query('SELECT id, title FROM Tests ORDER BY title');
        res.json({ tests });
    } catch (error) {
        console.error('Admin Tests List Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
