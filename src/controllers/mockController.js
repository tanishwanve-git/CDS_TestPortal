const getPool = require('../config/db');
const { formatAnswer, isAnswerCorrect } = require('../utils/answerKey');

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

/** Seconds left before this attempt's deadline (never negative). */

function secondsRemaining(attempt) {
    const started = new Date(attempt.started_at).getTime();
    const deadline = started + attempt.duration_minutes * 60 * 1000;
    return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
}

// ---------------------------------------------------------------------------
// GET /api/tests/mock  — every published mock exam, with this student's history
// ---------------------------------------------------------------------------
exports.listMockExams = async (req, res) => {
    try {
        const pool = await getPool;
        const studentId = req.user.id;

        const [exams] = await pool.query(
            `SELECT e.id, e.code, e.department, e.title, e.description,
                    e.duration_minutes, e.total_questions, e.disciplines,
                    COUNT(DISTINCT s.id) AS section_count,
                    (SELECT COUNT(*) FROM Question_Bank qb
                      WHERE qb.department = e.department AND qb.is_active = 1) AS bank_size
             FROM Mock_Exams e
             LEFT JOIN Mock_Exam_Sections s ON s.exam_id = e.id
             WHERE e.is_active = 1
             GROUP BY e.id
             ORDER BY e.title`
        );

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

        // Used only to sort the student's own department to the top of the list.
        const [[student]] = await pool.query(
            'SELECT discipline, branch FROM Students WHERE id = ?', [studentId]
        );
        const myDiscipline = String(student?.discipline || student?.branch || '').trim().toUpperCase();

        const payload = exams.map(e => {
            const disciplines = String(e.disciplines || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
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
                is_my_department: Boolean(myDiscipline && (disciplines.includes(myDiscipline) || e.department.toUpperCase() === myDiscipline)),
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

            let sql = `SELECT id, marks, negative_marks FROM Question_Bank
                       WHERE department = ? AND is_active = 1`;
            const params = [exam.department];

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
            `SELECT a.*, e.title, e.code, e.duration_minutes, e.description
             FROM Exam_Attempts a JOIN Mock_Exams e ON e.id = a.exam_id
             WHERE a.id = ? AND a.student_id = ?`,
            [attemptId, req.user.id]
        );

        if (!attempt) return res.status(404).json({ message: 'Attempt not found' });
        if (attempt.status === 'submitted') {
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
                seconds_remaining: secondsRemaining(attempt)
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

// ---------------------------------------------------------------------------
// POST /api/tests/mock/attempt/:attemptId/submit  — grade and close
// ---------------------------------------------------------------------------
exports.submitAttempt = async (req, res) => {
    const pool = await getPool;
    let conn;

    try {
        const attemptId = parseInt(req.params.attemptId, 10);
        const { answers = {}, violation_count, auto_submitted } = req.body;

        const [[attempt]] = await pool.query(
            `SELECT a.*, e.duration_minutes FROM Exam_Attempts a
             JOIN Mock_Exams e ON e.id = a.exam_id
             WHERE a.id = ? AND a.student_id = ?`,
            [attemptId, req.user.id]
        );
        if (!attempt) return res.status(404).json({ message: 'Attempt not found' });
        if (attempt.status === 'submitted') {
            return res.status(409).json({ message: 'This attempt has already been submitted', attemptId });
        }

        const [rows] = await pool.query(
            `SELECT aq.id AS row_id, aq.question_id, aq.submitted_answer,
                    qb.question_type, qb.correct_answer, qb.answer_min, qb.answer_max,
                    qb.marks, qb.negative_marks
             FROM Attempt_Questions aq
             JOIN Question_Bank qb ON qb.id = aq.question_id
             WHERE aq.attempt_id = ?`,
            [attemptId]
        );

        const expired = secondsRemaining(attempt) <= 0;
        let score = 0;
        let totalAnswered = 0;
        let totalCorrect = 0;
        let totalWrong = 0;
        const updates = [];

        for (const q of rows) {
            // Whatever the client sends wins over the autosaved value, except after
            // the clock has run out — then only what was already saved counts.
            const clientAnswer = answers[q.question_id];
            const chosen = (!expired && clientAnswer !== undefined && clientAnswer !== null && String(clientAnswer).trim() !== '')
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

        const elapsed = Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000);
        const timeTaken = Math.min(elapsed, attempt.duration_minutes * 60 + SUBMIT_GRACE_SECONDS);

        conn = await pool.getConnection();
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
             parseInt(violation_count, 10) || 0, auto_submitted ? 1 : 0, attemptId]
        );

        // Keep the existing proctoring log working for mock attempts too.
        const violations = parseInt(violation_count, 10) || 0;
        if (violations > 0) {
            await conn.query(
                `INSERT INTO Test_Violations (student_id, test_id, attempt_id, result_id, violation_type, violation_count, auto_submitted)
                 VALUES (?, NULL, ?, NULL, 'tab_switch_or_fullscreen_exit', ?, ?)`,
                [req.user.id, attemptId, violations, auto_submitted ? 1 : 0]
            );
        }

        await conn.commit();

        res.json({
            message: 'Attempt submitted and graded successfully',
            attemptId,
            score,
            maxScore: parseFloat(attempt.max_score),
            totalAnswered,
            totalCorrect,
            totalWrong
        });

    } catch (error) {
        if (conn) { try { await conn.rollback(); } catch { /* connection already gone */ } }
        console.error('Submit Attempt Error:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    } finally {
        if (conn) conn.release();
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

        const [rows] = await pool.query(
            `SELECT aq.position, aq.section_name, aq.section_order, aq.submitted_answer,
                    aq.is_correct, aq.marks_awarded,
                    qb.id AS question_id, qb.image_url, qb.question_type, qb.correct_answer,
                    qb.answer_min, qb.answer_max, qb.marks, qb.negative_marks, qb.year, qb.section
             FROM Attempt_Questions aq
             JOIN Question_Bank qb ON qb.id = aq.question_id
             WHERE aq.attempt_id = ?
             ORDER BY aq.section_order, aq.position`,
            [attemptId]
        );

        const sectionStats = {};
        const questions = rows.map(r => {
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

            return {
                id: r.question_id,
                position: r.position,
                section_name: r.section_name,
                image_url: r.image_url,
                question_type: r.question_type,
                options: r.question_type === 'MCQ' ? ['A', 'B', 'C', 'D'] : null,
                marks: parseFloat(r.marks),
                negative_marks: parseFloat(r.negative_marks),
                marks_awarded: parseFloat(r.marks_awarded || 0),
                studentAnswer: answered ? r.submitted_answer : null,
                correctAnswer: formatAnswer(r),
                isCorrect: answered && Boolean(r.is_correct),
                isWrong: answered && !r.is_correct,
                isSkipped: !answered,
                // Provenance line under the question number. The bank's raw section
                // is worth showing when it adds something (e.g. "GA" inside a flat
                // paper) but not when it just restates the section already named.
                source: [r.year, sameSection(r.section, r.section_name) ? null : r.section]
                    .filter(Boolean).join(' · ')
            };
        });

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
            questions,
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
