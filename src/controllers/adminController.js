const getPool = require('../config/db');

// ─── Overview ────────────────────────────────────────────────────────────────

exports.getOverview = async (req, res) => {
    try {
        const pool = await getPool;

        const [[{ total_students }]] = await pool.query('SELECT COUNT(*) AS total_students FROM Students');
        const [[{ total_violations }]] = await pool.query('SELECT COUNT(*) AS total_violations FROM Test_Violations');

        // Two kinds of test coexist: legacy fixed papers (Tests/Test_Results) and
        // randomised mock exams (Mock_Exams/Exam_Attempts). Every figure below
        // covers both so the console never under-reports activity.
        const [[{ total_tests }]] = await pool.query(
            `SELECT (SELECT COUNT(*) FROM Tests)
                  + (SELECT COUNT(*) FROM Mock_Exams WHERE is_active = 1) AS total_tests`
        );

        const [[scoreStats]] = await pool.query(`
            SELECT COUNT(*) AS total_attempts,
                   ROUND(AVG(score), 2) AS avg_score,
                   MAX(score) AS max_score,
                   MIN(score) AS min_score
            FROM (
                SELECT score FROM Test_Results
                UNION ALL
                SELECT score FROM Exam_Attempts WHERE status = 'submitted'
            ) AS all_scores
        `);
        const { total_attempts, avg_score, max_score, min_score } = scoreStats;

        // Attempts per test for chart data
        const [attemptsPerTest] = await pool.query(`
            SELECT t.title, COUNT(r.id) AS attempt_count, ROUND(AVG(r.score), 2) AS avg_score
            FROM Tests t
            LEFT JOIN Test_Results r ON t.id = r.test_id
            GROUP BY t.id, t.title

            UNION ALL

            SELECT e.title, COUNT(a.id) AS attempt_count, ROUND(AVG(a.score), 2) AS avg_score
            FROM Mock_Exams e
            LEFT JOIN Exam_Attempts a ON a.exam_id = e.id AND a.status = 'submitted'
            WHERE e.is_active = 1
            GROUP BY e.id, e.title

            ORDER BY attempt_count DESC
        `);

        // Recent 10 attempts across both kinds
        const [recentAttempts] = await pool.query(`
            SELECT * FROM (
                SELECT r.id, 'legacy' AS kind, s.name AS student_name, s.roll_number,
                       t.title AS test_title, r.score, r.created_at
                FROM Test_Results r
                JOIN Students s ON r.student_id = s.id
                JOIN Tests t ON r.test_id = t.id

                UNION ALL

                SELECT a.id, 'mock' AS kind, s.name AS student_name, s.roll_number,
                       e.title AS test_title, a.score, a.submitted_at AS created_at
                FROM Exam_Attempts a
                JOIN Students s ON a.student_id = s.id
                JOIN Mock_Exams e ON a.exam_id = e.id
                WHERE a.status = 'submitted'
            ) AS recent
            ORDER BY created_at DESC
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
            SELECT t.id, 'legacy' AS kind, t.title, t.duration_minutes, t.total_questions,
                   t.created_at,
                   COUNT(DISTINCT r.student_id) AS unique_students,
                   COUNT(r.id) AS attempt_count,
                   ROUND(AVG(r.score), 2) AS avg_score,
                   MAX(r.score) AS max_score,
                   MIN(r.score) AS min_score,
                   (SELECT COUNT(*) FROM Questions q WHERE q.test_id = t.id) AS question_count
            FROM Tests t
            LEFT JOIN Test_Results r ON t.id = r.test_id
            GROUP BY t.id

            UNION ALL

            -- A mock exam's "question count" is its bank size, not a fixed paper:
            -- that is the pool each attempt's 50 questions are drawn from.
            SELECT e.id, 'mock' AS kind, e.title, e.duration_minutes, e.total_questions,
                   e.created_at,
                   COUNT(DISTINCT a.student_id) AS unique_students,
                   COUNT(a.id) AS attempt_count,
                   ROUND(AVG(a.score), 2) AS avg_score,
                   MAX(a.score) AS max_score,
                   MIN(a.score) AS min_score,
                   (SELECT COUNT(*) FROM Question_Bank qb
                     WHERE qb.department = e.department AND qb.is_active = 1) AS question_count
            FROM Mock_Exams e
            LEFT JOIN Exam_Attempts a ON a.exam_id = e.id AND a.status = 'submitted'
            WHERE e.is_active = 1
            GROUP BY e.id

            ORDER BY created_at DESC
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

        // `test_id` from the filter dropdown is prefixed to say which kind it is
        // ("mock:3" / "legacy:2"), so one filter can drive both halves of the union.
        const filter = String(test_id || '');
        const filterKind = filter.includes(':') ? filter.split(':')[0] : null;
        const filterId = filter.includes(':') ? filter.split(':')[1] : filter;

        const legacyWhere = ['1=1'];
        const legacyParams = [];
        const mockWhere = ["a.status = 'submitted'"];
        const mockParams = [];

        if (filter) {
            // A filter naming one kind blanks the other half of the union.
            if (filterKind === 'mock') {
                legacyWhere.push('1=0');
                mockWhere.push('a.exam_id = ?');
                mockParams.push(filterId);
            } else if (filterKind === 'legacy') {
                mockWhere.push('1=0');
                legacyWhere.push('r.test_id = ?');
                legacyParams.push(filterId);
            } else {
                // Unprefixed id (older UI) — match either side.
                legacyWhere.push('r.test_id = ?');
                legacyParams.push(filterId);
                mockWhere.push('a.exam_id = ?');
                mockParams.push(filterId);
            }
        }
        if (student_id) {
            legacyWhere.push('r.student_id = ?');
            legacyParams.push(student_id);
            mockWhere.push('a.student_id = ?');
            mockParams.push(student_id);
        }

        const unionSql = `
            SELECT r.id, 'legacy' AS kind, s.name AS student_name, s.roll_number, s.branch,
                   t.title AS test_title, r.score,
                   t.total_questions * 4 AS max_score,
                   r.time_taken_seconds, r.created_at,
                   CASE WHEN v.id IS NOT NULL THEN 1 ELSE 0 END AS has_violation
            FROM Test_Results r
            JOIN Students s ON r.student_id = s.id
            JOIN Tests t ON r.test_id = t.id
            LEFT JOIN Test_Violations v ON v.result_id = r.id
            WHERE ${legacyWhere.join(' AND ')}

            UNION ALL

            SELECT a.id, 'mock' AS kind, s.name AS student_name, s.roll_number, s.branch,
                   e.title AS test_title, a.score,
                   a.max_score,
                   a.time_taken_seconds, a.submitted_at AS created_at,
                   CASE WHEN a.violation_count > 0 THEN 1 ELSE 0 END AS has_violation
            FROM Exam_Attempts a
            JOIN Students s ON a.student_id = s.id
            JOIN Mock_Exams e ON a.exam_id = e.id
            WHERE ${mockWhere.join(' AND ')}
        `;

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM (${unionSql}) AS all_attempts`,
            [...legacyParams, ...mockParams]
        );

        const [attempts] = await pool.query(
            `SELECT * FROM (${unionSql}) AS all_attempts
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [...legacyParams, ...mockParams, parseInt(limit), offset]
        );

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

        // Mock attempts live in a different pair of tables; same response shape.
        if (req.query.kind === 'mock') {
            return getMockAttemptDetail(pool, resultId, res);
        }

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


/**
 * Admin view of one mock attempt. Returns the same { result, questions } shape as
 * the legacy detail above so the console renders both through one code path.
 * Questions here are images, so `question_text` carries a readable label instead.
 */
async function getMockAttemptDetail(pool, attemptId, res) {
    const [[result]] = await pool.query(`
        SELECT a.id, a.student_id, a.exam_id, a.score, a.max_score, a.total_questions,
               a.total_correct, a.total_wrong, a.total_answered, a.time_taken_seconds,
               a.violation_count, a.auto_submitted, a.submitted_at AS created_at,
               s.name AS student_name, s.roll_number, s.email, e.title AS test_title
        FROM Exam_Attempts a
        JOIN Students s ON a.student_id = s.id
        JOIN Mock_Exams e ON a.exam_id = e.id
        WHERE a.id = ? AND a.status = 'submitted'
    `, [attemptId]);

    if (!result) return res.status(404).json({ message: 'Attempt not found' });

    const [rows] = await pool.query(`
        SELECT aq.position, aq.section_name, aq.submitted_answer, aq.is_correct, aq.marks_awarded,
               qb.id, qb.image_url, qb.image_filename, qb.question_type, qb.correct_answer,
               qb.marks, qb.negative_marks, qb.year, qb.section AS source_section
        FROM Attempt_Questions aq
        JOIN Question_Bank qb ON qb.id = aq.question_id
        WHERE aq.attempt_id = ?
        ORDER BY aq.section_order, aq.position
    `, [attemptId]);

    const questions = rows.map(q => ({
        id: q.id,
        // No question text exists for these — the question is the PNG. The source
        // filename is the most useful thing an admin can look a question up by.
        question_text: `${q.image_filename}${q.year ? ` (${q.year})` : ''}`,
        image_url: q.image_url,
        options: null,
        correct_answer: q.correct_answer,
        question_type: q.question_type,
        marks: parseFloat(q.marks),
        negative_marks: parseFloat(q.negative_marks),
        section_name: q.section_name,
        student_answer: q.submitted_answer,
        is_correct: q.submitted_answer === null ? null : Boolean(q.is_correct),
        is_skipped: q.submitted_answer === null
    }));

    res.json({ result, answers: {}, questions });
}

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

        // A mock-exam violation has no row in Tests (it points at an attempt
        // instead), so both joins have to be outer or those rows vanish from the
        // list while still being counted in the totals above.
        const [violations] = await pool.query(`
            SELECT v.id, s.name AS student_name, s.roll_number, s.email, s.branch,
                   COALESCE(t.title, e.title, 'Unknown test') AS test_title,
                   v.violation_type, v.violation_count,
                   v.auto_submitted, v.created_at
            FROM Test_Violations v
            JOIN Students s ON v.student_id = s.id
            LEFT JOIN Tests t ON v.test_id = t.id
            LEFT JOIN Exam_Attempts a ON v.attempt_id = a.id
            LEFT JOIN Mock_Exams e ON a.exam_id = e.id
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
        // Values are prefixed with the kind so getAttempts/getWarnings can tell a
        // legacy test id from a mock exam id (they're separate id spaces).
        const [tests] = await pool.query(`
            SELECT CONCAT('legacy:', id) AS id, title FROM Tests
            UNION ALL
            SELECT CONCAT('mock:', id) AS id, title FROM Mock_Exams WHERE is_active = 1
            ORDER BY title
        `);
        res.json({ tests });
    } catch (error) {
        console.error('Admin Tests List Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
