const getPool = require('../config/db');
const { formatAnswer, isAnswerCorrect } = require('../utils/answerKey');
const { examServes, studentDepartments } = require('../utils/departments');

/**
 * mockController.js — the randomised mock-exam flow.
 *
 * The older Tests/Questions tables hold fixed papers: a test owns its questions,
 * and a student can only sit it once. Mock exams work the other way round. A
 * `Mock_Exams` row owns no questions at all — only a *blueprint* (its
 * `Mock_Exam_Sections` rows) saying how many questions to draw from which pools
 * of `Question_Bank`. The paper is materialised the moment a student presses
 * start, into `Exam_Attempts` + `Attempt_Questions`, and is never reused.
 *
 * That gives the two properties the portal needs: every attempt is a different
 * 50 questions, and a student can re-attempt the same exam as often as they like.
 * Storing the drawn paper (rather than re-drawing on every page load) is what
 * makes a refresh mid-exam safe.
 */

// A short grace period past the deadline so a submit fired by the client's own
// expiring timer isn't rejected by a slightly faster server clock.
const SUBMIT_GRACE_SECONDS = 30;

function toArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** Do two section labels name the same thing, ignoring spacing and case? */
function sameSection(a, b) {
    const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm(a) === norm(b);
}

/**
 * When this attempt started, as true epoch milliseconds.
 *
 * Deliberately NOT `new Date(row.started_at)`. MySQL returns a TIMESTAMP as a
 * wall-clock string in *its* session time zone, and the driver parses that
 * string in *Node's* time zone. When the two differ — a UTC database server
 * with the app running in IST is the usual case — every attempt looks hours
 * old the moment it is created, and the exam auto-submits before the student
 * can answer anything. So the queries ask MySQL for `UNIX_TIMESTAMP()`, which
 * is time-zone independent, and this reads that instead.
 */
function startedAtMs(attempt) {
    const ms = Number(attempt.started_at_ms);
    if (Number.isFinite(ms) && ms > 0) return ms;

    // No epoch column in this row (an attempt created before this fix, or a
    // query that didn't select it). Falling back to the parsed datetime risks
    // the skew above, so treat the attempt as having just started: a clock
    // that is generous is far better than one that is stuck at zero.
    console.warn(`Attempt ${attempt.id}: no started_at_ms; assuming it just started.`);
    return Date.now();
}

/** Seconds left before this attempt's deadline (never negative). */
function secondsRemaining(attempt) {
    const deadline = startedAtMs(attempt) + attempt.duration_minutes * 60 * 1000;
    return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
}

// ---------------------------------------------------------------------------
// GET /api/tests/mock  — the published mock exams of this student's
// department(s), with their history. A dual-major student gets both majors'.
// ---------------------------------------------------------------------------
exports.listMockExams = async (req, res) => {
    try {
        const pool = await getPool;
        const studentId = req.user.id;
        const departments = await studentDepartments(pool, studentId);
        const primary = departments[0];

        const [allExams] = await pool.query(
            `SELECT e.id, e.code, e.department, e.title, e.description,
                    e.duration_minutes, e.total_questions, e.disciplines,
                    COUNT(DISTINCT s.id) AS section_count,
                    (SELECT COUNT(*) FROM Question_Bank qb
                      WHERE qb.is_active = 1
                        AND (qb.department = e.department
                             OR qb.department IN (SELECT s2.source_department FROM Mock_Exam_Sections s2
                                                   WHERE s2.exam_id = e.id))) AS bank_size
             FROM Mock_Exams e
             LEFT JOIN Mock_Exam_Sections s ON s.exam_id = e.id
             WHERE e.is_active = 1
             GROUP BY e.id
             ORDER BY e.title`
        );
        const exams = allExams.filter(e => examServes(e, departments));

        const [history] = await pool.query(
            `SELECT exam_id,
                    COUNT(*) AS attempts,
                    MAX(score) AS best_score,
                    MAX(submitted_at) AS last_attempt_at
             FROM Exam_Attempts
             WHERE student_id = ? AND status = 'submitted'
             GROUP BY exam_id`,
            [studentId]
        );
        const byExam = Object.fromEntries(history.map(h => [h.exam_id, h]));

        // An unfinished attempt is offered as "Resume" rather than a fresh start.
        const [inProgress] = await pool.query(
            `SELECT id, exam_id, started_at FROM Exam_Attempts
             WHERE student_id = ? AND status = 'in_progress'`,
            [studentId]
        );
        const openByExam = Object.fromEntries(inProgress.map(a => [a.exam_id, a]));

        const payload = exams.map(e => {
            const open = openByExam[e.id];
            return {
                id: e.id,
                code: e.code,
                title: e.title,
                description: e.description,
                duration_minutes: e.duration_minutes,
                total_questions: e.total_questions,
                section_count: e.section_count,
                bank_size: e.bank_size,
                // Every exam listed is the student's; for a dual major, false
                // marks the one that is there for their second major.
                is_my_department: Boolean(primary && examServes(e, [primary])),
                attempts: byExam[e.id]?.attempts || 0,
                best_score: byExam[e.id]?.best_score ?? null,
                last_attempt_at: byExam[e.id]?.last_attempt_at ?? null,
                in_progress_attempt_id: open ? open.id : null
            };
        });

        payload.sort((a, b) => (b.is_my_department - a.is_my_department) || a.title.localeCompare(b.title));

        res.json({ exams: payload });
    } catch (error) {
        console.error('List Mock Exams Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// POST /api/tests/mock/:examId/start  — draw a fresh paper
// ---------------------------------------------------------------------------
exports.startAttempt = async (req, res) => {
    const pool = await getPool;
    let conn;

    try {
        const examId = parseInt(req.params.examId, 10);
        const studentId = req.user.id;

        const [[exam]] = await pool.query(
            'SELECT * FROM Mock_Exams WHERE id = ? AND is_active = 1', [examId]
        );
        if (!exam) return res.status(404).json({ message: 'Mock exam not found' });

        // The dashboard only lists the student's own department's exams; this
        // stops a hand-made request from starting anyone else's.
        if (!examServes(exam, await studentDepartments(pool, studentId))) {
            return res.status(403).json({ message: 'This mock test is not for your department.' });
        }

        // Resume rather than start over if this student already has one open.
        const [[open]] = await pool.query(
            `SELECT id FROM Exam_Attempts
             WHERE student_id = ? AND exam_id = ? AND status = 'in_progress'
             ORDER BY id DESC LIMIT 1`,
            [studentId, examId]
        );
        if (open) {
            return res.json({ attemptId: open.id, resumed: true });
        }

        const [sections] = await pool.query(
            'SELECT * FROM Mock_Exam_Sections WHERE exam_id = ? ORDER BY sort_order, id', [examId]
        );
        if (!sections.length) {
            return res.status(500).json({ message: 'This exam has no sections configured. Run database/import_question_bank.js.' });
        }

        // Draw each section's questions. ORDER BY RAND() on a few thousand rows is
        // well within budget and gives a genuinely different paper every time.
        const drawn = [];
        for (const section of sections) {
            const sourceSections = toArray(section.source_sections);

            // A section may draw from another department's bank (EE's paper
            // includes EC and IN sections); NULL means the exam's own bank.
            let sql = `SELECT id, marks, negative_marks FROM Question_Bank
                       WHERE department = ? AND is_active = 1`;
            const params = [section.source_department || exam.department];

            if (sourceSections.length) {
                sql += ` AND section IN (${sourceSections.map(() => '?').join(',')})`;
                params.push(...sourceSections);
            }
            sql += ' ORDER BY RAND() LIMIT ?';
            params.push(section.question_count);

            const [rows] = await pool.query(sql, params);

            if (rows.length < section.question_count) {
                return res.status(500).json({
                    message: `Not enough questions in the bank for section "${section.section_name}" (${rows.length} of ${section.question_count}). Re-run database/import_question_bank.js.`
                });
            }

            rows.forEach(q => drawn.push({ ...q, section }));
        }

        const maxScore = drawn.reduce((sum, q) => sum + parseFloat(q.marks), 0);

        conn = await pool.getConnection();
        await conn.beginTransaction();

        const [result] = await conn.query(
            `INSERT INTO Exam_Attempts (student_id, exam_id, status, total_questions, max_score)
             VALUES (?, ?, 'in_progress', ?, ?)`,
            [studentId, examId, drawn.length, maxScore]
        );
        const attemptId = result.insertId;

        await conn.query(
            `INSERT INTO Attempt_Questions (attempt_id, question_id, section_name, section_order, position)
             VALUES ?`,
            [drawn.map((q, i) => [attemptId, q.id, q.section.section_name, q.section.sort_order, i + 1])]
        );

        await conn.commit();
        res.json({ attemptId, resumed: false });

    } catch (error) {
        if (conn) { try { await conn.rollback(); } catch { /* connection already gone */ } }
        console.error('Start Attempt Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        if (conn) conn.release();
    }
};

// ---------------------------------------------------------------------------
// GET /api/tests/mock/attempt/:attemptId  — the paper, without any answer key
// ---------------------------------------------------------------------------
exports.getAttempt = async (req, res) => {
    try {
        const pool = await getPool;
        const attemptId = parseInt(req.params.attemptId, 10);

        const [[attempt]] = await pool.query(
            `SELECT a.*, UNIX_TIMESTAMP(a.started_at) * 1000 AS started_at_ms,
                    e.title, e.code, e.duration_minutes, e.description
             FROM Exam_Attempts a JOIN Mock_Exams e ON e.id = a.exam_id
             WHERE a.id = ? AND a.student_id = ?`,
            [attemptId, req.user.id]
        );

        if (!attempt) return res.status(404).json({ message: 'Attempt not found' });
        if (attempt.status === 'submitted') {
            return res.status(409).json({ message: 'This attempt has already been submitted', attemptId });
        }

        // A page refresh drops the arena's in-memory violation count along
        // with it, so violations are persisted server-side the moment they
        // happen (see logViolation below) instead of only reaching the
        // server inside the final /submit call. If this attempt somehow
        // already has 2+ recorded violations but was never actually
        // submitted — the student refreshed at exactly the wrong moment and
        // escaped the client's own auto-submit — finalize it here rather
        // than handing back the exam paper and letting them keep going.
        if ((attempt.violation_count || 0) >= 2) {
            await gradeAndFinalize(pool, attempt, {
                clientAnswers: {},
                allowClientAnswers: false,
                violationCount: attempt.violation_count,
                autoSubmitted: true
            });
            return res.status(409).json({ message: 'This attempt has already been submitted', attemptId });
        }

        const [rows] = await pool.query(
            `SELECT aq.position, aq.section_name, aq.section_order, aq.submitted_answer,
                    qb.id AS question_id, qb.image_url, qb.question_type, qb.marks, qb.negative_marks
             FROM Attempt_Questions aq
             JOIN Question_Bank qb ON qb.id = aq.question_id
             WHERE aq.attempt_id = ?
             ORDER BY aq.section_order, aq.position`,
            [attemptId]
        );

        // Group into sections, preserving blueprint order.
        const sections = [];
        const byName = new Map();
        const savedAnswers = {};

        for (const r of rows) {
            if (!byName.has(r.section_name)) {
                const section = { section_name: r.section_name, questions: [] };
                byName.set(r.section_name, section);
                sections.push(section);
            }
            byName.get(r.section_name).questions.push({
                id: r.question_id,
                position: r.position,
                image_url: r.image_url,
                question_type: r.question_type,
                marks: parseFloat(r.marks),
                negative_marks: parseFloat(r.negative_marks),
                // The option text lives inside the question image; the arena only
                // needs to know which radio letters to draw beneath it.
                options: r.question_type === 'MCQ' ? ['A', 'B', 'C', 'D'] : null
            });
            if (r.submitted_answer !== null && r.submitted_answer !== '') {
                savedAnswers[r.question_id] = r.submitted_answer;
            }
        }

        res.json({
            attempt: {
                id: attempt.id,
                exam_id: attempt.exam_id,
                title: attempt.title,
                code: attempt.code,
                duration_minutes: attempt.duration_minutes,
                total_questions: attempt.total_questions,
                max_score: parseFloat(attempt.max_score),
                started_at: attempt.started_at,
                // The clock is authoritative on the server, so closing the tab or
                // reloading cannot buy extra time.
                seconds_remaining: secondsRemaining(attempt),
                // Likewise authoritative for violations — see logViolation.
                // The arena restores its counter from this instead of always
                // starting a refreshed page back at 0.
                violation_count: attempt.violation_count || 0
            },
            sections,
            savedAnswers
        });
    } catch (error) {
        console.error('Get Attempt Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// POST /api/tests/mock/attempt/:attemptId/answer  — autosave a single answer
// ---------------------------------------------------------------------------
exports.saveAnswer = async (req, res) => {
    try {
        const pool = await getPool;
        const attemptId = parseInt(req.params.attemptId, 10);
        const { questionId, answer } = req.body;

        const [[attempt]] = await pool.query(
            `SELECT id, status FROM Exam_Attempts WHERE id = ? AND student_id = ?`,
            [attemptId, req.user.id]
        );
        if (!attempt) return res.status(404).json({ message: 'Attempt not found' });
        if (attempt.status !== 'in_progress') {
            return res.status(409).json({ message: 'This attempt is already submitted' });
        }

        const value = (answer === null || answer === undefined || String(answer).trim() === '')
            ? null
            : String(answer).trim().slice(0, 255);

        await pool.query(
            'UPDATE Attempt_Questions SET submitted_answer = ? WHERE attempt_id = ? AND question_id = ?',
            [value, attemptId, questionId]
        );

        res.json({ saved: true });
    } catch (error) {
        console.error('Save Answer Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

/**
 * Grades an attempt's Attempt_Questions against the Question_Bank answer key
 * and marks the attempt submitted. Shared by the normal submit flow below and
 * the server-side lockout in getAttempt above — an attempt whose violation
 * count already reached 2 gets finalized there even if the student's own tab
 * never got to call /submit (e.g. they refreshed at exactly that moment).
 *
 * `clientAnswers` (a live in-browser answers map) only overrides what was
 * already autosaved when `allowClientAnswers` is true; the lockout path
 * passes false so a finalize triggered by getAttempt can only ever use what
 * was already safely saved to the server, never anything the caller supplies.
 */
async function gradeAndFinalize(pool, attempt, { clientAnswers = {}, allowClientAnswers, violationCount, autoSubmitted }) {
    const [rows] = await pool.query(
        `SELECT aq.id AS row_id, aq.question_id, aq.submitted_answer,
                qb.question_type, qb.correct_answer, qb.answer_min, qb.answer_max,
                qb.marks, qb.negative_marks
         FROM Attempt_Questions aq
         JOIN Question_Bank qb ON qb.id = aq.question_id
         WHERE aq.attempt_id = ?`,
        [attempt.id]
    );

    let score = 0;
    let totalAnswered = 0;
    let totalCorrect = 0;
    let totalWrong = 0;
    const updates = [];

    for (const q of rows) {
        const clientAnswer = clientAnswers[q.question_id];
        const chosen = (allowClientAnswers && clientAnswer !== undefined && clientAnswer !== null && String(clientAnswer).trim() !== '')
            ? String(clientAnswer).trim()
            : q.submitted_answer;

        const answered = chosen !== null && chosen !== undefined && String(chosen).trim() !== '';
        let awarded = 0;
        let correct = null;

        if (answered) {
            totalAnswered++;
            correct = isAnswerCorrect(q, chosen);
            if (correct) {
                awarded = parseFloat(q.marks);
                totalCorrect++;
            } else {
                awarded = -parseFloat(q.negative_marks);
                totalWrong++;
            }
            score += awarded;
        }

        updates.push([q.row_id, answered ? String(chosen).slice(0, 255) : null, correct === null ? null : (correct ? 1 : 0), awarded]);
    }

    const elapsed = Math.floor((Date.now() - startedAtMs(attempt)) / 1000);
    const timeTaken = Math.min(elapsed, attempt.duration_minutes * 60 + SUBMIT_GRACE_SECONDS);

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        for (const [rowId, answer, correct, awarded] of updates) {
            await conn.query(
                'UPDATE Attempt_Questions SET submitted_answer = ?, is_correct = ?, marks_awarded = ? WHERE id = ?',
                [answer, correct, awarded, rowId]
            );
        }

        await conn.query(
            `UPDATE Exam_Attempts
             SET status = 'submitted', score = ?, total_answered = ?, total_correct = ?,
                 total_wrong = ?, time_taken_seconds = ?, violation_count = ?,
                 auto_submitted = ?, submitted_at = NOW()
             WHERE id = ?`,
            [score, totalAnswered, totalCorrect, totalWrong, timeTaken,
             violationCount, autoSubmitted ? 1 : 0, attempt.id]
        );

        // Keep the existing proctoring log working for mock attempts too.
        if (violationCount > 0) {
            await conn.query(
                `INSERT INTO Test_Violations (student_id, test_id, attempt_id, result_id, violation_type, violation_count, auto_submitted)
                 VALUES (?, NULL, ?, NULL, 'tab_switch_or_fullscreen_exit', ?, ?)`,
                [attempt.student_id, attempt.id, violationCount, autoSubmitted ? 1 : 0]
            );
        }

        await conn.commit();
    } catch (err) {
        try { await conn.rollback(); } catch { /* connection already gone */ }
        throw err;
    } finally {
        conn.release();
    }

    return { score, maxScore: parseFloat(attempt.max_score), totalAnswered, totalCorrect, totalWrong };
}

// ---------------------------------------------------------------------------
// POST /api/tests/mock/attempt/:attemptId/violation — persist a proctoring
// violation the instant it happens.
//
// Previously violation_count only ever reached the server inside the final
// /submit call, so in the meantime it lived purely in a page-scoped JS
// variable. A refresh reset that variable to 0 — the exam paper, saved
// answers and remaining time all survive a refresh by design (so a crashed
// tab doesn't lose an honest attempt), but the violation count silently did
// not. A student about to be auto-submitted for a 2nd violation, or who
// simply wanted a clean-looking proctoring record, could refresh and carry
// on with no violation on record at all. This writes every violation to
// Exam_Attempts the moment it's detected, so the count survives a refresh
// (or a closed tab) and getAttempt/submitAttempt above trust the server's
// number, not whatever the client happens to send.
// ---------------------------------------------------------------------------
exports.logViolation = async (req, res) => {
    try {
        const pool = await getPool;
        const attemptId = parseInt(req.params.attemptId, 10);

        const [result] = await pool.query(
            `UPDATE Exam_Attempts SET violation_count = violation_count + 1
             WHERE id = ? AND student_id = ? AND status = 'in_progress'`,
            [attemptId, req.user.id]
        );
        if (!result.affectedRows) {
            return res.status(404).json({ message: 'Attempt not found or already submitted' });
        }

        const [[row]] = await pool.query(
            'SELECT violation_count FROM Exam_Attempts WHERE id = ?', [attemptId]
        );
        res.json({ violation_count: row.violation_count });
    } catch (error) {
        console.error('Log Violation Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// POST /api/tests/mock/attempt/:attemptId/submit  — grade and close
// ---------------------------------------------------------------------------
exports.submitAttempt = async (req, res) => {
    try {
        const pool = await getPool;
        const attemptId = parseInt(req.params.attemptId, 10);
        const { answers = {}, violation_count, auto_submitted } = req.body;

        const [[attempt]] = await pool.query(
            `SELECT a.*, UNIX_TIMESTAMP(a.started_at) * 1000 AS started_at_ms,
                    e.duration_minutes
             FROM Exam_Attempts a
             JOIN Mock_Exams e ON e.id = a.exam_id
             WHERE a.id = ? AND a.student_id = ?`,
            [attemptId, req.user.id]
        );
        if (!attempt) return res.status(404).json({ message: 'Attempt not found' });
        if (attempt.status === 'submitted') {
            return res.status(409).json({ message: 'This attempt has already been submitted', attemptId });
        }

        const expired = secondsRemaining(attempt) <= 0;

        // The server's own persisted count (bumped live by logViolation) is
        // authoritative — a client that was tampered with, or one that just
        // missed a beat, should never be able to report FEWER violations than
        // the server already recorded.
        const clientViolationCount = parseInt(violation_count, 10) || 0;
        const finalViolationCount = Math.max(attempt.violation_count || 0, clientViolationCount);

        const graded = await gradeAndFinalize(pool, attempt, {
            clientAnswers: answers,
            allowClientAnswers: !expired,
            violationCount: finalViolationCount,
            autoSubmitted: Boolean(auto_submitted) || finalViolationCount >= 2
        });

        res.json({
            message: 'Attempt submitted and graded successfully',
            attemptId,
            ...graded
        });

    } catch (error) {
        console.error('Submit Attempt Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// GET /api/tests/mock/attempt/:attemptId/review  — full paper with answer key
// ---------------------------------------------------------------------------
exports.getAttemptReview = async (req, res) => {
    try {
        const pool = await getPool;
        const attemptId = parseInt(req.params.attemptId, 10);

        const [[attempt]] = await pool.query(
            `SELECT a.*, e.title, e.code, e.duration_minutes
             FROM Exam_Attempts a JOIN Mock_Exams e ON e.id = a.exam_id
             WHERE a.id = ? AND a.student_id = ?`,
            [attemptId, req.user.id]
        );
        if (!attempt) return res.status(404).json({ message: 'Attempt not found or access denied' });
        if (attempt.status !== 'submitted') {
            return res.status(409).json({ message: 'This attempt has not been submitted yet' });
        }

        // Only what's needed to compute section-wise stats. Question text,
        // images, options, and per-question answers are intentionally not
        // selected/returned here, so students cannot access individual
        // questions or answers after submission -- only section-wise and
        // overall scores are exposed by this endpoint.
        const [rows] = await pool.query(
            `SELECT aq.section_name, aq.submitted_answer, aq.is_correct, aq.marks_awarded,
                    qb.marks
             FROM Attempt_Questions aq
             JOIN Question_Bank qb ON qb.id = aq.question_id
             WHERE aq.attempt_id = ?
             ORDER BY aq.section_order, aq.position`,
            [attemptId]
        );

        const sectionStats = {};
        for (const r of rows) {
            if (!sectionStats[r.section_name]) {
                sectionStats[r.section_name] = { name: r.section_name, score: 0, maxScore: 0, correct: 0, wrong: 0, skipped: 0 };
            }
            const stat = sectionStats[r.section_name];
            stat.maxScore += parseFloat(r.marks);
            stat.score += parseFloat(r.marks_awarded || 0);

            const answered = r.submitted_answer !== null && r.submitted_answer !== '';
            if (!answered) stat.skipped++;
            else if (r.is_correct) stat.correct++;
            else stat.wrong++;
        }

        // How this attempt compares to everyone else's on the same exam.
        const [[avg]] = await pool.query(
            `SELECT AVG(score) AS avg_score, COUNT(*) AS n
             FROM Exam_Attempts WHERE exam_id = ? AND status = 'submitted'`,
            [attempt.exam_id]
        );

        res.json({
            attempt: {
                id: attempt.id,
                exam_id: attempt.exam_id,
                title: attempt.title,
                code: attempt.code,
                score: parseFloat(attempt.score),
                max_score: parseFloat(attempt.max_score),
                total_questions: attempt.total_questions,
                total_answered: attempt.total_answered,
                total_correct: attempt.total_correct,
                total_wrong: attempt.total_wrong,
                time_taken_seconds: attempt.time_taken_seconds,
                submitted_at: attempt.submitted_at
            },
            stats: {
                totalCorrect: attempt.total_correct,
                totalWrong: attempt.total_wrong,
                totalSkipped: attempt.total_questions - (attempt.total_answered || 0),
                sectionScores: Object.values(sectionStats),
                averageScore: avg.avg_score !== null ? parseFloat(parseFloat(avg.avg_score).toFixed(2)) : 0,
                attemptsOnThisExam: avg.n
            }
        });
    } catch (error) {
        console.error('Attempt Review Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

// ---------------------------------------------------------------------------
// POST /api/tests/mock/attempt/:attemptId/abandon  — discard an open attempt
// ---------------------------------------------------------------------------
exports.abandonAttempt = async (req, res) => {
    try {
        const pool = await getPool;
        const attemptId = parseInt(req.params.attemptId, 10);

        const [result] = await pool.query(
            `DELETE FROM Exam_Attempts WHERE id = ? AND student_id = ? AND status = 'in_progress'`,
            [attemptId, req.user.id]
        );

        if (!result.affectedRows) {
            return res.status(404).json({ message: 'No open attempt to discard' });
        }
        res.json({ discarded: true });
    } catch (error) {
        console.error('Abandon Attempt Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
