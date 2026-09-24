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

/**
 * The compliance query, shared by the on-screen roster and every export so the
 * two can never disagree.
 *
 * It is deliberately ROSTER-FIRST: it starts from `allowed_students`, not from
 * `Students`. `Students` only holds people who have signed in at least once, so
 * anchoring on it hides precisely the group an admin is chasing — the students
 * who have never shown up at all.
 *
 * Exam and date filters are applied to the LEFT JOIN, not to WHERE. In WHERE
 * they would discard every student with no matching attempt, which again is the
 * exact population the report exists to surface.
 */
function buildRosterQuery(q, { ignoreStatus = false } = {}) {
    const where = ['al.is_active = TRUE'];
    const whereParams = [];

    if (q.search) {
        where.push('(al.name LIKE ? OR al.email LIKE ? OR al.roll_number LIKE ?)');
        const like = `%${q.search}%`;
        whereParams.push(like, like, like);
    }
    if (q.programme) { where.push('al.programme = ?'); whereParams.push(q.programme); }
    if (q.discipline) { where.push('al.discipline = ?'); whereParams.push(q.discipline); }

    // ── Which attempts count towards the numbers ──────────────────────────
    const joinCond = ["a.status = 'submitted'"];
    const joinParams = [];
    if (q.exam_id) { joinCond.push('a.exam_id = ?'); joinParams.push(parseInt(q.exam_id, 10)); }
    if (q.from) { joinCond.push('a.submitted_at >= ?'); joinParams.push(`${q.from} 00:00:00`); }
    if (q.to) { joinCond.push('a.submitted_at <= ?'); joinParams.push(`${q.to} 23:59:59`); }

    // ── Post-aggregation filters ──────────────────────────────────────────
    const having = [];
    const havingParams = [];

    if (!ignoreStatus) {
        const target = parseInt(q.target, 10) || 1;
        switch (q.status) {
            case 'never_logged_in':
                having.push('student_id IS NULL'); break;
            case 'registered_no_attempt':
                having.push('student_id IS NOT NULL AND attempts = 0'); break;
            case 'not_attempted':
                having.push('attempts = 0'); break;
            case 'attempted':
                having.push('attempts > 0'); break;
            case 'below_target':
                having.push('attempts < ?'); havingParams.push(target); break;
            case 'met_target':
                having.push('attempts >= ?'); havingParams.push(target); break;
            default: break;
        }
        if (q.min_attempts) { having.push('attempts >= ?'); havingParams.push(parseInt(q.min_attempts, 10)); }
        if (q.max_attempts) { having.push('attempts <= ?'); havingParams.push(parseInt(q.max_attempts, 10)); }
        if (q.min_pct) { having.push('best_pct >= ?'); havingParams.push(parseFloat(q.min_pct)); }
        if (q.max_pct) { having.push('best_pct <= ?'); havingParams.push(parseFloat(q.max_pct)); }
    }

    const sql = `
        SELECT al.roll_number, al.name, al.email, al.programme, al.discipline,
               s.id            AS student_id,
               s.created_at    AS registered_at,
               COUNT(a.id)                  AS attempts,
               COUNT(DISTINCT a.exam_id)    AS exams_attempted,
               MAX(a.score)                 AS best_score,
               ROUND(AVG(a.score), 2)       AS avg_score,
               ROUND(MAX(a.score / NULLIF(a.max_score, 0)) * 100, 1) AS best_pct,
               ROUND(AVG(a.score / NULLIF(a.max_score, 0)) * 100, 1) AS avg_pct,
               MAX(a.submitted_at)          AS last_attempt_at,
               COALESCE(SUM(a.violation_count), 0) AS violations
        FROM allowed_students al
        LEFT JOIN Students s ON LOWER(s.email) = LOWER(al.email)
        LEFT JOIN Exam_Attempts a ON a.student_id = s.id AND ${joinCond.join(' AND ')}
        WHERE ${where.join(' AND ')}
        GROUP BY al.id, al.roll_number, al.name, al.email, al.programme,
                 al.discipline, s.id, s.created_at
        ${having.length ? 'HAVING ' + having.join(' AND ') : ''}
    `;

    // Placeholder order must follow the SQL text: JOIN, then WHERE, then HAVING.
    return { sql, params: [...joinParams, ...whereParams, ...havingParams] };
}

// Whitelisted so the sort key can never reach SQL as raw input.
const ROSTER_SORTS = {
    attempts_asc:  'attempts ASC, name ASC',
    attempts_desc: 'attempts DESC, name ASC',
    name_asc:      'name ASC',
    roll_asc:      'roll_number ASC',
    best_desc:     'best_pct DESC, name ASC',
    best_asc:      'best_pct IS NULL, best_pct ASC, name ASC',
    last_desc:     'last_attempt_at IS NULL, last_attempt_at DESC',
    last_asc:      'last_attempt_at IS NULL, last_attempt_at ASC'
};

exports.getStudents = async (req, res) => {
    try {
        const pool = await getPool;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const offset = (page - 1) * limit;
        const target = parseInt(req.query.target, 10) || 1;

        const { sql, params } = buildRosterQuery(req.query);

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM (${sql}) AS r`, params
        );

        const orderBy = ROSTER_SORTS[req.query.sort] || ROSTER_SORTS.attempts_asc;
        const [students] = await pool.query(
            `SELECT * FROM (${sql}) AS r ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        // The summary ignores the status filter so the cards always show the full
        // breakdown of the current search, not just the slice being viewed.
        const base = buildRosterQuery(req.query, { ignoreStatus: true });
        const [[summary]] = await pool.query(`
            SELECT COUNT(*)                                  AS roster,
                   SUM(student_id IS NULL)                   AS never_logged_in,
                   SUM(attempts = 0)                         AS not_attempted,
                   SUM(attempts > 0)                         AS attempted,
                   SUM(attempts >= ?)                        AS met_target,
                   ROUND(AVG(best_pct), 1)                   AS avg_best_pct,
                   COALESCE(SUM(attempts), 0)                AS total_attempts
            FROM (${base.sql}) AS r
        `, [target, ...base.params]);

        res.json({ total, page, limit, students, summary, target });
    } catch (error) {
        console.error('Admin Roster Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Per-exam coverage: who has sat each mock, and who still has not ─────────

exports.getExamCoverage = async (req, res) => {
    try {
        const pool = await getPool;
        const [exams] = await pool.query(`
            SELECT e.id, e.code, e.title, e.department, e.duration_minutes, e.total_questions,
                   (SELECT COUNT(*) FROM allowed_students al
                     WHERE al.is_active = TRUE
                       AND (e.disciplines IS NULL OR e.disciplines = ''
                            OR FIND_IN_SET(al.discipline, e.disciplines))) AS eligible,
                   COUNT(DISTINCT a.student_id) AS students_attempted,
                   COUNT(a.id)                  AS attempts,
                   ROUND(AVG(a.score / NULLIF(a.max_score, 0)) * 100, 1) AS avg_pct,
                   MAX(a.submitted_at)          AS last_attempt_at
            FROM Mock_Exams e
            LEFT JOIN Exam_Attempts a ON a.exam_id = e.id AND a.status = 'submitted'
            WHERE e.is_active = 1
            GROUP BY e.id
            ORDER BY e.title
        `);
        res.json({ exams });
    } catch (error) {
        console.error('Admin Exam Coverage Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ─── Values for the roster filter dropdowns ─────────────────────────────────

exports.getFilterOptions = async (req, res) => {
    try {
        const pool = await getPool;
        const [programmes] = await pool.query(
            `SELECT programme AS value, COUNT(*) AS count FROM allowed_students
              WHERE is_active = TRUE AND programme IS NOT NULL AND programme <> ''
              GROUP BY programme ORDER BY programme`
        );
        const [disciplines] = await pool.query(
            `SELECT discipline AS value, COUNT(*) AS count FROM allowed_students
              WHERE is_active = TRUE AND discipline IS NOT NULL AND discipline <> ''
              GROUP BY discipline ORDER BY discipline`
        );
        const [exams] = await pool.query(
            `SELECT id, title FROM Mock_Exams WHERE is_active = 1 ORDER BY title`
        );
        res.json({ programmes, disciplines, exams });
    } catch (error) {
        console.error('Admin Filter Options Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

/**
 * One student, drilled down.
 *
 * Accepts either a numeric `Students.id` or an email, because a roster member
 * who has never signed in has no `Students` row to key on — and those are the
 * students most likely to be looked up.
 */
exports.getStudentDetail = async (req, res) => {
    try {
        const pool = await getPool;
        const key = decodeURIComponent(req.params.studentId || '');
        const byEmail = key.includes('@');

        // Roster record is the source of truth for identity; the Students row may
        // not exist yet.
        const [[roster]] = await pool.query(
            byEmail
                ? `SELECT al.*, s.id AS student_id, s.created_at AS registered_at
                     FROM allowed_students al
                     LEFT JOIN Students s ON LOWER(s.email) = LOWER(al.email)
                    WHERE LOWER(al.email) = LOWER(?)`
                : `SELECT al.*, s.id AS student_id, s.created_at AS registered_at
                     FROM Students s
                     LEFT JOIN allowed_students al ON LOWER(s.email) = LOWER(al.email)
                    WHERE s.id = ?`,
            [byEmail ? key : parseInt(key, 10)]
        );

        if (!roster) return res.status(404).json({ message: 'Student not found' });
        const studentId = roster.student_id || null;

        // Every active mock exam, whether or not this student has sat it — a row
        // of zeroes is the most useful row on this screen.
        const [examStats] = await pool.query(`
            SELECT e.id, e.code, e.title, e.total_questions, e.duration_minutes,
                   COUNT(a.id)                  AS attempts,
                   MAX(a.score)                 AS best_score,
                   ROUND(AVG(a.score), 2)       AS avg_score,
                   MAX(a.max_score)             AS max_score,
                   ROUND(MAX(a.score / NULLIF(a.max_score, 0)) * 100, 1) AS best_pct,
                   MAX(a.submitted_at)          AS last_attempt_at,
                   COALESCE(SUM(a.violation_count), 0) AS violations
            FROM Mock_Exams e
            LEFT JOIN Exam_Attempts a
                   ON a.exam_id = e.id AND a.status = 'submitted' AND a.student_id = ?
            WHERE e.is_active = 1
            GROUP BY e.id
            ORDER BY e.title
        `, [studentId]);

        let attempts = [];
        let violations = [];

        if (studentId) {
            [attempts] = await pool.query(`
                SELECT a.id, 'mock' AS kind, e.title, a.score, a.max_score,
                       a.total_correct, a.total_wrong, a.total_answered,
                       a.time_taken_seconds, a.violation_count, a.auto_submitted,
                       a.submitted_at AS created_at
                  FROM Exam_Attempts a
                  JOIN Mock_Exams e ON e.id = a.exam_id
                 WHERE a.student_id = ? AND a.status = 'submitted'
                UNION ALL
                SELECT r.id, 'legacy' AS kind, t.title, r.score, t.total_questions * 4 AS max_score,
                       NULL, NULL, NULL,
                       r.time_taken_seconds, 0, 0,
                       r.created_at
                  FROM Test_Results r
                  JOIN Tests t ON t.id = r.test_id
                 WHERE r.student_id = ?
                 ORDER BY created_at DESC
            `, [studentId, studentId]);

            // test_id is NULL for mock violations, so this must LEFT JOIN Tests.
            [violations] = await pool.query(`
                SELECT v.id, v.violation_type, v.violation_count, v.auto_submitted, v.created_at,
                       COALESCE(t.title, e.title, '—') AS test_title
                  FROM Test_Violations v
                  LEFT JOIN Tests t ON t.id = v.test_id
                  LEFT JOIN Exam_Attempts a ON a.id = v.attempt_id
                  LEFT JOIN Mock_Exams e ON e.id = a.exam_id
                 WHERE v.student_id = ?
                 ORDER BY v.created_at DESC
            `, [studentId]);
        }

        res.json({
            student: {
                id: studentId,
                name: roster.name,
                email: roster.email,
                roll_number: roster.roll_number,
                programme: roster.programme,
                discipline: roster.discipline,
                registered_at: roster.registered_at,
                has_signed_in: Boolean(studentId)
            },
            examStats,
            attempts,
            violations
        });
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

/**
 * Exports.
 *
 * Every type is driven by the SAME query the screen uses, with the same filters,
 * so a downloaded sheet always matches what the admin was looking at. Columns
 * are declared explicitly rather than relying on SELECT order, which silently
 * mis-aligns headers the moment a query changes.
 *
 * `?format=xlsx` (default) returns a real workbook; `?format=csv` the flat file.
 */

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

const fmtDateCell = v => {
    if (!v) return '';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ');
};

const yesNo = v => (Number(v) ? 'Yes' : 'No');

function sendWorkbook(res, { sheetName, columns, rows, filename, format }) {
    const header = columns.map(c => c.header);
    const body = rows.map(r => columns.map(c => {
        const raw = c.map ? c.map(r) : r[c.key];
        return raw === null || raw === undefined ? '' : raw;
    }));

    if (format === 'csv') {
        const escape = v => {
            const str = String(v);
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        };
        const csv = [header, ...body].map(line => line.map(escape).join(',')).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        // BOM so Excel opens UTF-8 names correctly on Windows.
        return res.send('﻿' + csv);
    }

    const XLSX = require('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
    sheet['!cols'] = columns.map(c => ({ wch: c.width || 16 }));
    // Autofilter gives the header row dropdowns so the office can slice the sheet
    // without touching the portal. (Freeze panes are not written by xlsx 0.18.x,
    // so there is no point setting '!freeze' here.)
    sheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({
            s: { r: 0, c: 0 },
            e: { r: body.length, c: columns.length - 1 }
        })
    };

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
}

exports.exportData = async (req, res) => {
    try {
        const pool = await getPool;
        const { type } = req.params;
        const format = req.query.format === 'csv' ? 'csv' : 'xlsx';

        // ── Roster / compliance: the filtered screen, as a sheet ──────────
        if (type === 'roster' || type === 'students') {
            const { sql, params } = buildRosterQuery(req.query);
            const orderBy = ROSTER_SORTS[req.query.sort] || ROSTER_SORTS.attempts_asc;
            const [rows] = await pool.query(`SELECT * FROM (${sql}) AS r ORDER BY ${orderBy}`, params);

            return sendWorkbook(res, {
                sheetName: 'Compliance',
                filename: `mock-compliance_${stamp()}`,
                format,
                rows,
                columns: [
                    { header: 'Roll No', key: 'roll_number', width: 14 },
                    { header: 'Name', key: 'name', width: 26 },
                    { header: 'Email', key: 'email', width: 30 },
                    { header: 'Programme', key: 'programme', width: 14 },
                    { header: 'Discipline', key: 'discipline', width: 14 },
                    { header: 'Signed In', width: 11, map: r => yesNo(r.student_id) },
                    { header: 'Mocks Taken', key: 'attempts', width: 13 },
                    { header: 'Distinct Exams', key: 'exams_attempted', width: 15 },
                    { header: 'Best Score', key: 'best_score', width: 12 },
                    { header: 'Best %', key: 'best_pct', width: 10 },
                    { header: 'Avg Score', key: 'avg_score', width: 12 },
                    { header: 'Avg %', key: 'avg_pct', width: 10 },
                    { header: 'Last Attempt', width: 18, map: r => fmtDateCell(r.last_attempt_at) },
                    { header: 'Violations', key: 'violations', width: 11 }
                ]
            });
        }

        // ── Every roster student against every exam ───────────────────────
        // One row per student per mock, including the zero rows. This is the
        // sheet to sort and send to a department office.
        if (type === 'matrix') {
            const where = ['al.is_active = TRUE'];
            const params = [];
            if (req.query.programme) { where.push('al.programme = ?'); params.push(req.query.programme); }
            if (req.query.discipline) { where.push('al.discipline = ?'); params.push(req.query.discipline); }
            if (req.query.exam_id) { where.push('e.id = ?'); params.push(parseInt(req.query.exam_id, 10)); }

            const [rows] = await pool.query(`
                SELECT al.roll_number, al.name, al.email, al.programme, al.discipline,
                       e.title AS exam_title, e.code AS exam_code,
                       s.id AS student_id,
                       COUNT(a.id)            AS attempts,
                       MAX(a.score)           AS best_score,
                       MAX(a.max_score)       AS max_score,
                       ROUND(MAX(a.score / NULLIF(a.max_score, 0)) * 100, 1) AS best_pct,
                       ROUND(AVG(a.score), 2) AS avg_score,
                       MAX(a.submitted_at)    AS last_attempt_at
                FROM allowed_students al
                CROSS JOIN Mock_Exams e
                LEFT JOIN Students s ON LOWER(s.email) = LOWER(al.email)
                LEFT JOIN Exam_Attempts a
                       ON a.student_id = s.id AND a.exam_id = e.id AND a.status = 'submitted'
                WHERE ${where.join(' AND ')} AND e.is_active = 1
                GROUP BY al.id, e.id, al.roll_number, al.name, al.email,
                         al.programme, al.discipline, e.title, e.code, s.id
                ORDER BY al.name, e.title
            `, params);

            return sendWorkbook(res, {
                sheetName: 'Student x Exam',
                filename: `student-exam-matrix_${stamp()}`,
                format,
                rows,
                columns: [
                    { header: 'Roll No', key: 'roll_number', width: 14 },
                    { header: 'Name', key: 'name', width: 26 },
                    { header: 'Email', key: 'email', width: 30 },
                    { header: 'Programme', key: 'programme', width: 14 },
                    { header: 'Discipline', key: 'discipline', width: 14 },
                    { header: 'Exam', key: 'exam_title', width: 40 },
                    { header: 'Attempted', width: 11, map: r => yesNo(r.attempts) },
                    { header: 'Attempts', key: 'attempts', width: 10 },
                    { header: 'Best Score', key: 'best_score', width: 12 },
                    { header: 'Out Of', key: 'max_score', width: 10 },
                    { header: 'Best %', key: 'best_pct', width: 10 },
                    { header: 'Avg Score', key: 'avg_score', width: 12 },
                    { header: 'Last Attempt', width: 18, map: r => fmtDateCell(r.last_attempt_at) }
                ]
            });
        }

        // ── Per-exam coverage summary ─────────────────────────────────────
        if (type === 'coverage') {
            const [rows] = await pool.query(`
                SELECT e.title, e.code, e.department, e.total_questions, e.duration_minutes,
                       (SELECT COUNT(*) FROM allowed_students al
                         WHERE al.is_active = TRUE
                           AND (e.disciplines IS NULL OR e.disciplines = ''
                                OR FIND_IN_SET(al.discipline, e.disciplines))) AS eligible,
                       COUNT(DISTINCT a.student_id) AS students_attempted,
                       COUNT(a.id)                  AS attempts,
                       ROUND(AVG(a.score / NULLIF(a.max_score, 0)) * 100, 1) AS avg_pct,
                       MAX(a.submitted_at)          AS last_attempt_at
                FROM Mock_Exams e
                LEFT JOIN Exam_Attempts a ON a.exam_id = e.id AND a.status = 'submitted'
                WHERE e.is_active = 1
                GROUP BY e.id
                ORDER BY e.title
            `);

            return sendWorkbook(res, {
                sheetName: 'Exam coverage',
                filename: `exam-coverage_${stamp()}`,
                format,
                rows,
                columns: [
                    { header: 'Exam', key: 'title', width: 40 },
                    { header: 'Code', key: 'code', width: 10 },
                    { header: 'Department', key: 'department', width: 14 },
                    { header: 'Questions', key: 'total_questions', width: 11 },
                    { header: 'Duration (min)', key: 'duration_minutes', width: 14 },
                    { header: 'Eligible Students', key: 'eligible', width: 17 },
                    { header: 'Students Attempted', key: 'students_attempted', width: 19 },
                    { header: 'Not Attempted', width: 15, map: r => Math.max(0, r.eligible - r.students_attempted) },
                    { header: 'Coverage %', width: 12, map: r => (r.eligible ? Math.round((r.students_attempted / r.eligible) * 1000) / 10 : 0) },
                    { header: 'Total Attempts', key: 'attempts', width: 14 },
                    { header: 'Avg %', key: 'avg_pct', width: 10 },
                    { header: 'Last Attempt', width: 18, map: r => fmtDateCell(r.last_attempt_at) }
                ]
            });
        }

        // ── Individual attempts (mock + legacy) ───────────────────────────
        if (type === 'attempts') {
            const where = ["a.status = 'submitted'"];
            const params = [];
            if (req.query.exam_id) { where.push('a.exam_id = ?'); params.push(parseInt(req.query.exam_id, 10)); }
            if (req.query.from) { where.push('a.submitted_at >= ?'); params.push(`${req.query.from} 00:00:00`); }
            if (req.query.to) { where.push('a.submitted_at <= ?'); params.push(`${req.query.to} 23:59:59`); }

            const [rows] = await pool.query(`
                SELECT a.id, 'Mock' AS kind, s.name, s.roll_number, s.email, s.branch,
                       e.title AS test_title, a.score, a.max_score,
                       a.total_correct, a.total_wrong, a.total_answered, a.total_questions,
                       a.time_taken_seconds, a.violation_count, a.auto_submitted,
                       a.submitted_at AS created_at
                  FROM Exam_Attempts a
                  JOIN Students s ON s.id = a.student_id
                  JOIN Mock_Exams e ON e.id = a.exam_id
                 WHERE ${where.join(' AND ')}
                UNION ALL
                SELECT r.id, 'Legacy', s.name, s.roll_number, s.email, s.branch,
                       t.title, r.score, t.total_questions * 4,
                       NULL, NULL, NULL, t.total_questions,
                       r.time_taken_seconds, 0, 0, r.created_at
                  FROM Test_Results r
                  JOIN Students s ON s.id = r.student_id
                  JOIN Tests t ON t.id = r.test_id
                 ORDER BY created_at DESC
            `, params);

            return sendWorkbook(res, {
                sheetName: 'Attempts',
                filename: `attempts_${stamp()}`,
                format,
                rows,
                columns: [
                    { header: 'Attempt ID', key: 'id', width: 11 },
                    { header: 'Kind', key: 'kind', width: 9 },
                    { header: 'Name', key: 'name', width: 26 },
                    { header: 'Roll No', key: 'roll_number', width: 14 },
                    { header: 'Email', key: 'email', width: 30 },
                    { header: 'Branch', key: 'branch', width: 16 },
                    { header: 'Exam', key: 'test_title', width: 40 },
                    { header: 'Score', key: 'score', width: 10 },
                    { header: 'Out Of', key: 'max_score', width: 10 },
                    { header: 'Score %', width: 10, map: r => (r.max_score ? Math.round((r.score / r.max_score) * 1000) / 10 : '') },
                    { header: 'Correct', key: 'total_correct', width: 9 },
                    { header: 'Wrong', key: 'total_wrong', width: 9 },
                    { header: 'Answered', key: 'total_answered', width: 10 },
                    { header: 'Questions', key: 'total_questions', width: 10 },
                    { header: 'Time (min)', width: 11, map: r => Math.round((r.time_taken_seconds || 0) / 60) },
                    { header: 'Violations', key: 'violation_count', width: 11 },
                    { header: 'Auto-Submitted', width: 15, map: r => yesNo(r.auto_submitted) },
                    { header: 'Submitted At', width: 18, map: r => fmtDateCell(r.created_at) }
                ]
            });
        }

        // ── Proctoring violations ─────────────────────────────────────────
        if (type === 'violations') {
            const [rows] = await pool.query(`
                SELECT v.id, s.name, s.roll_number, s.email, s.branch,
                       COALESCE(t.title, e.title, '—') AS test_title,
                       v.violation_type, v.violation_count, v.auto_submitted, v.created_at
                  FROM Test_Violations v
                  JOIN Students s ON s.id = v.student_id
                  LEFT JOIN Tests t ON t.id = v.test_id
                  LEFT JOIN Exam_Attempts a ON a.id = v.attempt_id
                  LEFT JOIN Mock_Exams e ON e.id = a.exam_id
                 ORDER BY v.created_at DESC
            `);

            return sendWorkbook(res, {
                sheetName: 'Violations',
                filename: `violations_${stamp()}`,
                format,
                rows,
                columns: [
                    { header: 'ID', key: 'id', width: 8 },
                    { header: 'Name', key: 'name', width: 26 },
                    { header: 'Roll No', key: 'roll_number', width: 14 },
                    { header: 'Email', key: 'email', width: 30 },
                    { header: 'Branch', key: 'branch', width: 16 },
                    { header: 'Exam', key: 'test_title', width: 40 },
                    { header: 'Type', key: 'violation_type', width: 18 },
                    { header: 'Count', key: 'violation_count', width: 9 },
                    { header: 'Auto-Submitted', width: 15, map: r => yesNo(r.auto_submitted) },
                    { header: 'When', width: 18, map: r => fmtDateCell(r.created_at) }
                ]
            });
        }

        return res.status(400).json({ message: 'Unknown export type' });
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
