const getPool = require('../config/db');
const cm = require('../utils/companyMock');
const { sendWorkbook } = require('./adminController');

/**
 * companyMockController.js — company mock tests.
 *
 * Admin side (routes under /api/admin/company-mocks): create, edit, delete and
 * see results. Heads of department get the list and the results read-only,
 * limited to their own department's students.
 *
 * Student side (/api/tests/company and the company branch of
 * mockController.startAttempt): list the tests a roll number is eligible for,
 * and start one. Everything after start — the arena, autosave, the clock,
 * proctoring, grading, review — is the ordinary mock-exam flow.
 */

const LIMITS = { title: 255, questions: 200, duration: 600, attempts: 50, instructions: 20000 };

// Fields that shape the paper or the clock. Once anyone has started the test
// these are frozen, so every attempt is sat under the same conditions.
const LOCKED_AFTER_ATTEMPT = ['question_source', 'total_questions', 'duration_minutes', 'starts_at'];

function handleError(res, error, label) {
    if (error instanceof cm.UserError) {
        return res.status(error.status).json({ message: error.message, ...(error.details || {}) });
    }
    console.error(`${label} Error:`, error);
    return res.status(500).json({ message: 'Internal Server Error' });
}

// The columns every company-mock query reads, with the times as both form
// values (IST wall clock) and true epoch ms.
const EXAM_COLUMNS = `
    e.id, e.code, e.title, e.instructions, e.question_source, e.total_questions,
    e.duration_minutes, e.max_attempts, e.is_active, e.created_by, e.created_at,
    DATE_FORMAT(e.starts_at, '%Y-%m-%dT%H:%i') AS starts_at,
    DATE_FORMAT(e.ends_at, '%Y-%m-%dT%H:%i')   AS ends_at,
    UNIX_TIMESTAMP(e.starts_at) * 1000         AS starts_at_ms,
    UNIX_TIMESTAMP(e.ends_at) * 1000           AS ends_at_ms,
    CASE WHEN e.is_active = 0 THEN 'inactive'
         WHEN NOW() < e.starts_at THEN 'upcoming'
         WHEN NOW() >= e.ends_at THEN 'closed'
         ELSE 'open' END                       AS state`;

function shapeExam(e) {
    return {
        ...e,
        is_active: Boolean(e.is_active),
        starts_at_ms: Number(e.starts_at_ms),
        ends_at_ms: Number(e.ends_at_ms)
    };
}

async function loadExam(db, id, { forUpdate = false } = {}) {
    const [[exam]] = await db.query(
        `SELECT ${EXAM_COLUMNS} FROM Mock_Exams e
          WHERE e.id = ? AND e.kind = 'company'${forUpdate ? ' FOR UPDATE' : ''}`,
        [id]
    );
    return exam ? shapeExam(exam) : null;
}

// For a HOD, a roll number counts only if the student is in their department
// (primary or second major) — the same rule as the rest of the console.
function rosterFilter(req, alias = 'al') {
    if (req.access.role === 'admin') return { sql: '1 = 1', params: [] };
    return {
        sql: `(${alias}.discipline IN (?) OR ${alias}.secondary_discipline IN (?))`,
        params: [req.access.departments, req.access.departments]
    };
}

/**
 * Validates a create/update body. `current` is the stored exam on update.
 * Returns the clean values plus the resolved roll list.
 */
async function validateBody(db, body, recipes, current = null) {
    const errors = [];
    const pick = (key, fallback) => (body[key] !== undefined ? body[key] : fallback);

    const title = String(pick('title', current?.title) || '').trim();
    if (!title) errors.push('Title is required.');
    if (title.length > LIMITS.title) errors.push(`Title must be at most ${LIMITS.title} characters.`);

    const source = String(pick('question_source', current?.question_source) || '').trim().toUpperCase();
    if (source !== cm.OWN && !recipes.has(source)) {
        errors.push(`Choose where the questions come from: own department or one of ${[...recipes.keys()].join(', ')}.`);
    }

    const intIn = (value, min, max) => {
        const n = Number(value);
        return Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    const totalQuestions = intIn(pick('total_questions', current?.total_questions), 1, LIMITS.questions);
    if (totalQuestions === null) errors.push(`Number of questions must be a whole number from 1 to ${LIMITS.questions}.`);
    const duration = intIn(pick('duration_minutes', current?.duration_minutes), 1, LIMITS.duration);
    if (duration === null) errors.push(`Duration must be a whole number of minutes from 1 to ${LIMITS.duration}.`);
    const maxAttempts = intIn(pick('max_attempts', current?.max_attempts ?? 1), 1, LIMITS.attempts);
    if (maxAttempts === null) errors.push(`Attempts allowed must be a whole number from 1 to ${LIMITS.attempts}.`);

    const startsAt = cm.normalizeDateTime(pick('starts_at', current?.starts_at));
    const endsAt = cm.normalizeDateTime(pick('ends_at', current?.ends_at));
    if (!startsAt) errors.push('Start date and time is required.');
    if (!endsAt) errors.push('End date and time is required.');
    if (startsAt && endsAt && startsAt >= endsAt) errors.push('The end time must be after the start time.');

    const instructions = String(pick('instructions', current?.instructions ?? cm.DEFAULT_INSTRUCTIONS) || '').trim();
    if (!instructions) errors.push('Instructions cannot be empty.');
    if (instructions.length > LIMITS.instructions) errors.push('Instructions are too long.');

    const isActive = body.is_active !== undefined ? Boolean(body.is_active) : (current ? current.is_active : true);

    const rollsInput = body.roll_numbers !== undefined ? body.roll_numbers : null;
    let rolls = null;
    if (rollsInput !== null) {
        rolls = await cm.resolveRolls(db, rollsInput, source, recipes);
        const total = rolls.valid.length + rolls.unknown.length + rolls.inactive.length + rolls.no_bank.length;
        if (!total) errors.push('Enter at least one roll number.');
        if (rolls.unknown.length) errors.push(`${rolls.unknown.length} roll number(s) are not on the allow list.`);
        if (rolls.inactive.length) errors.push(`${rolls.inactive.length} roll number(s) are deactivated on the allow list.`);
        if (rolls.no_bank.length) errors.push(`${rolls.no_bank.length} student(s) belong to a department with no question bank.`);
    } else if (!current) {
        errors.push('Enter at least one roll number.');
    }

    if (errors.length) {
        throw new cm.UserError(errors.join(' '), 400, {
            errors,
            unknown: rolls?.unknown || [],
            inactive: rolls?.inactive || [],
            no_bank: (rolls?.no_bank || []).map(r => `${r.roll_number} (${r.discipline || 'no department'})`)
        });
    }

    return {
        values: {
            title, question_source: source, total_questions: totalQuestions,
            duration_minutes: duration, max_attempts: maxAttempts,
            starts_at: startsAt, ends_at: endsAt, instructions, is_active: isActive
        },
        rolls
    };
}

/** The paper keys the stored eligible list needs. */
async function neededPaperKeys(db, examId, source, recipes) {
    if (source !== cm.OWN) return [source];
    const [rows] = await db.query(
        `SELECT al.discipline FROM Company_Mock_Eligible ce
           JOIN allowed_students al ON al.roll_number = ce.roll_number
          WHERE ce.exam_id = ?`,
        [examId]
    );
    return [...new Set(rows.map(r => cm.paperKeyFor(recipes, r.discipline)).filter(Boolean))];
}

async function replaceEligible(conn, examId, validRolls) {
    await conn.query('DELETE FROM Company_Mock_Eligible WHERE exam_id = ?', [examId]);
    if (validRolls.length) {
        await conn.query(
            'INSERT INTO Company_Mock_Eligible (exam_id, roll_number) VALUES ?',
            [validRolls.map(r => [examId, r.roll_number])]
        );
    }
}

// ─── Admin: form defaults ────────────────────────────────────────────────────

exports.getDefaults = async (req, res) => {
    try {
        const pool = await getPool;
        const recipes = await cm.departmentRecipes(pool);
        res.json({
            instructions: cm.DEFAULT_INSTRUCTIONS,
            sources: [
                { value: cm.OWN, label: "Student's own department" },
                ...[...recipes.values()].map(r => ({
                    value: r.exam.code,
                    label: `${r.exam.code} — ${r.exam.title.replace(/ Mock Test$/i, '')}`
                }))
            ]
        });
    } catch (error) {
        handleError(res, error, 'Company Mock Defaults');
    }
};

// ─── Admin: check a pasted roll list ─────────────────────────────────────────

exports.validateRolls = async (req, res) => {
    try {
        const pool = await getPool;
        const recipes = await cm.departmentRecipes(pool);
        const source = String(req.body.question_source || cm.OWN).toUpperCase();
        const rolls = await cm.resolveRolls(pool, req.body.roll_numbers, source, recipes);
        res.json(rolls);
    } catch (error) {
        handleError(res, error, 'Company Mock Validate Rolls');
    }
};

// ─── Admin + HOD: list ───────────────────────────────────────────────────────

exports.listCompanyMocks = async (req, res) => {
    try {
        const pool = await getPool;
        const scope = rosterFilter(req);

        const [exams] = await pool.query(
            `SELECT ${EXAM_COLUMNS},
                    (SELECT COUNT(*) FROM Company_Mock_Eligible ce
                       JOIN allowed_students al ON al.roll_number = ce.roll_number
                      WHERE ce.exam_id = e.id AND ${scope.sql}) AS eligible_count,
                    (SELECT COUNT(DISTINCT a.student_id) FROM Exam_Attempts a
                       JOIN Students s ON s.id = a.student_id
                       JOIN allowed_students al ON LOWER(al.email) = LOWER(s.email)
                      WHERE a.exam_id = e.id AND a.status = 'submitted' AND ${scope.sql}) AS submitted_count,
                    (SELECT COUNT(*) FROM Exam_Attempts a WHERE a.exam_id = e.id) AS attempt_rows
               FROM Mock_Exams e
              WHERE e.kind = 'company'
              ORDER BY e.starts_at DESC, e.id DESC`,
            [...scope.params, ...scope.params]
        );

        let list = exams.map(e => ({
            ...shapeExam(e),
            eligible_count: Number(e.eligible_count),
            submitted_count: Number(e.submitted_count),
            has_attempts: Number(e.attempt_rows) > 0
        }));
        // A HOD only sees tests that include at least one of their students.
        if (req.access.role !== 'admin') list = list.filter(e => e.eligible_count > 0 || e.submitted_count > 0);

        res.json({ tests: list });
    } catch (error) {
        handleError(res, error, 'Company Mock List');
    }
};

// ─── Admin + HOD: one test with its results ──────────────────────────────────

async function resultRows(pool, req, examId) {
    const scope = rosterFilter(req);

    // Everyone eligible, plus anyone who attempted but has since been taken
    // off the list — their marks still count.
    const [people] = await pool.query(
        `SELECT al.roll_number, al.name, al.email, al.discipline, al.secondary_discipline,
                s.id AS student_id, ce.id IS NOT NULL AS is_eligible
           FROM allowed_students al
           LEFT JOIN Students s ON LOWER(s.email) = LOWER(al.email)
           LEFT JOIN Company_Mock_Eligible ce ON ce.exam_id = ? AND ce.roll_number = al.roll_number
          WHERE (ce.id IS NOT NULL
                 OR s.id IN (SELECT a.student_id FROM Exam_Attempts a WHERE a.exam_id = ?))
            AND ${scope.sql}`,
        [examId, examId, ...scope.params]
    );

    const [attempts] = await pool.query(
        `SELECT id, student_id, status, score, max_score, total_answered, total_correct,
                total_wrong, time_taken_seconds, violation_count, auto_submitted, submitted_at
           FROM Exam_Attempts WHERE exam_id = ?
          ORDER BY id`,
        [examId]
    );
    const byStudent = new Map();
    for (const a of attempts) {
        if (!byStudent.has(a.student_id)) byStudent.set(a.student_id, []);
        byStudent.get(a.student_id).push(a);
    }

    const rows = people.map(p => {
        const mine = byStudent.get(p.student_id) || [];
        const submitted = mine.filter(a => a.status === 'submitted');
        const best = submitted.reduce((top, a) => (!top || Number(a.score) > Number(top.score) ? a : top), null);
        const status = submitted.length ? 'submitted'
            : mine.some(a => a.status === 'in_progress') ? 'in_progress'
                : 'not_started';
        return {
            roll_number: p.roll_number,
            name: p.name,
            email: p.email,
            discipline: p.discipline,
            secondary_discipline: p.secondary_discipline,
            is_eligible: Boolean(p.is_eligible),
            status,
            attempts: submitted.length,
            best_attempt_id: best ? best.id : null,
            score: best ? Number(best.score) : null,
            max_score: best ? Number(best.max_score) : null,
            total_correct: best ? best.total_correct : null,
            total_wrong: best ? best.total_wrong : null,
            total_answered: best ? best.total_answered : null,
            time_taken_seconds: best ? best.time_taken_seconds : null,
            violations: mine.reduce((n, a) => n + (a.violation_count || 0), 0),
            auto_submitted: best ? Boolean(best.auto_submitted) : false,
            submitted_at: best ? best.submitted_at : null
        };
    });

    // Highest score first; then in progress, then not started; ties by roll.
    const rank = { submitted: 0, in_progress: 1, not_started: 2 };
    rows.sort((a, b) => (rank[a.status] - rank[b.status])
        || ((b.score ?? -Infinity) - (a.score ?? -Infinity))
        || String(a.roll_number).localeCompare(String(b.roll_number)));
    let position = 0;
    let lastScore = null;
    rows.forEach((r, i) => {
        if (r.status !== 'submitted') { r.rank = null; return; }
        if (r.score !== lastScore) { position = i + 1; lastScore = r.score; }
        r.rank = position;
    });
    return rows;
}

exports.getCompanyMock = async (req, res) => {
    try {
        const pool = await getPool;
        const examId = parseInt(req.params.id, 10);
        const exam = await loadExam(pool, examId);
        if (!exam) return res.status(404).json({ message: 'Company mock test not found' });

        const results = await resultRows(pool, req, examId);
        if (req.access.role !== 'admin' && !results.length) {
            return res.status(404).json({ message: 'Company mock test not found' });
        }

        const [[{ attempt_rows }]] = await pool.query(
            'SELECT COUNT(*) AS attempt_rows FROM Exam_Attempts WHERE exam_id = ?', [examId]
        );
        const [papers] = await pool.query(
            `SELECT paper_key, COUNT(*) AS questions FROM Company_Mock_Papers
              WHERE exam_id = ? GROUP BY paper_key ORDER BY paper_key`,
            [examId]
        );

        const payload = {
            test: { ...exam, has_attempts: Number(attempt_rows) > 0, papers },
            results
        };
        // The full roll list is the admin's to edit; a HOD sees only the
        // results rows of their own students.
        if (req.access.role === 'admin') {
            const [eligible] = await pool.query(
                'SELECT roll_number FROM Company_Mock_Eligible WHERE exam_id = ? ORDER BY roll_number', [examId]
            );
            payload.test.roll_numbers = eligible.map(r => r.roll_number);
        }
        res.json(payload);
    } catch (error) {
        handleError(res, error, 'Company Mock Detail');
    }
};

// ─── Admin: create ───────────────────────────────────────────────────────────

exports.createCompanyMock = async (req, res) => {
    const pool = await getPool;
    let conn;
    try {
        const recipes = await cm.departmentRecipes(pool);
        const { values, rolls } = await validateBody(pool, req.body, recipes);

        conn = await pool.getConnection();
        await conn.beginTransaction();

        // `code` is unique and NOT NULL; a placeholder is swapped for CO-<id>.
        const tempCode = `CO-T${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);
        const [ins] = await conn.query(
            `INSERT INTO Mock_Exams
                (code, department, title, description, duration_minutes, total_questions, disciplines,
                 is_active, kind, instructions, question_source, starts_at, ends_at, max_attempts, created_by)
             VALUES (?, 'COMPANY', ?, NULL, ?, ?, NULL, ?, 'company', ?, ?, ?, ?, ?, ?)`,
            [tempCode, values.title, values.duration_minutes, values.total_questions,
             values.is_active ? 1 : 0, values.instructions, values.question_source,
             values.starts_at, values.ends_at, values.max_attempts, req.user.email || null]
        );
        const examId = ins.insertId;
        await conn.query('UPDATE Mock_Exams SET code = ? WHERE id = ?', [`CO-${examId}`, examId]);

        await replaceEligible(conn, examId, rolls.valid);
        const keys = values.question_source === cm.OWN
            ? rolls.valid.map(r => r.paper_key)
            : [values.question_source];
        await cm.ensurePapers(conn, examId, values.total_questions, keys, recipes);

        await conn.commit();
        res.status(201).json({ id: examId, message: 'Company mock test created' });
    } catch (error) {
        if (conn) { try { await conn.rollback(); } catch { /* connection gone */ } }
        handleError(res, error, 'Company Mock Create');
    } finally {
        if (conn) conn.release();
    }
};

// ─── Admin: update ───────────────────────────────────────────────────────────

exports.updateCompanyMock = async (req, res) => {
    const pool = await getPool;
    let conn;
    try {
        const examId = parseInt(req.params.id, 10);
        const recipes = await cm.departmentRecipes(pool);

        conn = await pool.getConnection();
        await conn.beginTransaction();

        // Locking the exam row serialises this against a student's start,
        // which also locks it — so "has anyone started?" can't change under us.
        const current = await loadExam(conn, examId, { forUpdate: true });
        if (!current) {
            await conn.rollback();
            return res.status(404).json({ message: 'Company mock test not found' });
        }

        // No new list sent: re-check the stored one, since a change of question
        // source can change which students have a bank.
        const body = { ...req.body };
        if (body.roll_numbers === undefined) {
            const [stored] = await conn.query(
                'SELECT roll_number FROM Company_Mock_Eligible WHERE exam_id = ?', [examId]
            );
            body.roll_numbers = stored.map(r => r.roll_number);
        }
        const { values, rolls } = await validateBody(conn, body, recipes, current);

        const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM Exam_Attempts WHERE exam_id = ?', [examId]);
        const locked = Number(n) > 0;
        if (locked) {
            const changed = LOCKED_AFTER_ATTEMPT.filter(key => {
                const before = key === 'starts_at' ? cm.normalizeDateTime(current.starts_at) : current[key];
                return String(values[key]) !== String(before);
            });
            if (changed.length) {
                throw new cm.UserError(
                    'Students have already started this test, so the question source, number of questions, ' +
                    'duration and start time can no longer be changed. You can still change the title, roll ' +
                    'numbers, instructions, end time, attempts allowed and whether it is active.', 409);
            }
        }

        await conn.query(
            `UPDATE Mock_Exams
                SET title = ?, duration_minutes = ?, total_questions = ?, is_active = ?,
                    instructions = ?, question_source = ?, starts_at = ?, ends_at = ?, max_attempts = ?
              WHERE id = ?`,
            [values.title, values.duration_minutes, values.total_questions, values.is_active ? 1 : 0,
             values.instructions, values.question_source, values.starts_at, values.ends_at,
             values.max_attempts, examId]
        );

        if (rolls) await replaceEligible(conn, examId, rolls.valid);

        // Before anyone has started, a change to the question settings redraws
        // every paper. Afterwards papers are only ever added (for a department
        // newly brought in by added roll numbers), never replaced.
        const paperChanged = !locked && (values.question_source !== current.question_source
            || values.total_questions !== current.total_questions);
        const keys = await neededPaperKeys(conn, examId, values.question_source, recipes);
        await cm.ensurePapers(conn, examId, values.total_questions, keys, recipes, { replace: paperChanged });

        await conn.commit();
        res.json({ id: examId, message: 'Company mock test updated', papers_redrawn: paperChanged });
    } catch (error) {
        if (conn) { try { await conn.rollback(); } catch { /* connection gone */ } }
        handleError(res, error, 'Company Mock Update');
    } finally {
        if (conn) conn.release();
    }
};

// ─── Admin: delete ───────────────────────────────────────────────────────────

exports.deleteCompanyMock = async (req, res) => {
    try {
        const pool = await getPool;
        const examId = parseInt(req.params.id, 10);
        const exam = await loadExam(pool, examId);
        if (!exam) return res.status(404).json({ message: 'Company mock test not found' });

        const [result] = await pool.query(
            `DELETE FROM Mock_Exams
              WHERE id = ? AND kind = 'company'
                AND NOT EXISTS (SELECT 1 FROM Exam_Attempts a WHERE a.exam_id = ?)`,
            [examId, examId]
        );
        if (!result.affectedRows) {
            return res.status(409).json({
                message: 'This test already has attempts, so it cannot be deleted. Mark it inactive instead to hide it from students.'
            });
        }
        res.json({ deleted: true });
    } catch (error) {
        handleError(res, error, 'Company Mock Delete');
    }
};

// ─── Admin + HOD: results export ─────────────────────────────────────────────

exports.exportCompanyMock = async (req, res) => {
    try {
        const pool = await getPool;
        const examId = parseInt(req.params.id, 10);
        const exam = await loadExam(pool, examId);
        if (!exam) return res.status(404).json({ message: 'Company mock test not found' });

        const rows = await resultRows(pool, req, examId);
        const statusLabel = { submitted: 'Submitted', in_progress: 'In progress', not_started: 'Not started' };
        const safeTitle = exam.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'company-mock';

        sendWorkbook(res, {
            sheetName: 'Results',
            filename: `${safeTitle}_results`,
            format: req.query.format === 'csv' ? 'csv' : 'xlsx',
            rows,
            columns: [
                { header: 'Rank', key: 'rank', width: 6 },
                { header: 'Roll number', key: 'roll_number', width: 14 },
                { header: 'Name', key: 'name', width: 30 },
                { header: 'Department', map: r => [r.discipline, r.secondary_discipline].filter(Boolean).join(' + '), width: 22 },
                { header: 'Status', map: r => statusLabel[r.status] + (r.is_eligible ? '' : ' (removed from list)'), width: 14 },
                { header: 'Score', key: 'score', width: 8 },
                { header: 'Max score', key: 'max_score', width: 10 },
                { header: 'Correct', key: 'total_correct', width: 9 },
                { header: 'Wrong', key: 'total_wrong', width: 8 },
                { header: 'Answered', key: 'total_answered', width: 10 },
                { header: 'Time taken (min)', map: r => (r.time_taken_seconds == null ? '' : Math.round(r.time_taken_seconds / 6) / 10), width: 16 },
                { header: 'Attempts', key: 'attempts', width: 9 },
                { header: 'Violations', key: 'violations', width: 10 },
                { header: 'Auto-submitted', map: r => (r.status === 'submitted' ? (r.auto_submitted ? 'Yes' : 'No') : ''), width: 14 },
                { header: 'Email', key: 'email', width: 30 }
            ]
        });
    } catch (error) {
        handleError(res, error, 'Company Mock Export');
    }
};

// ─── Student: the company tests I'm eligible for ─────────────────────────────

exports.listForStudent = async (req, res) => {
    try {
        const pool = await getPool;
        const studentId = req.user.id;
        const me = await cm.studentIdentity(pool, studentId);
        if (!me.roll_number) return res.json({ tests: [] });

        const [exams] = await pool.query(
            `SELECT ${EXAM_COLUMNS}
               FROM Mock_Exams e
               JOIN Company_Mock_Eligible ce ON ce.exam_id = e.id AND ce.roll_number = ?
              WHERE e.kind = 'company' AND e.is_active = 1
              ORDER BY e.starts_at DESC`,
            [me.roll_number]
        );
        if (!exams.length) return res.json({ tests: [] });

        const [attempts] = await pool.query(
            `SELECT id, exam_id, status, score, max_score, submitted_at FROM Exam_Attempts
              WHERE student_id = ? AND exam_id IN (?) ORDER BY id`,
            [studentId, exams.map(e => e.id)]
        );

        const tests = exams.map(raw => {
            const e = shapeExam(raw);
            const mine = attempts.filter(a => a.exam_id === e.id);
            const submitted = mine.filter(a => a.status === 'submitted');
            const open = mine.find(a => a.status === 'in_progress');
            const best = submitted.reduce((top, a) => (!top || Number(a.score) > Number(top.score) ? a : top), null);
            return {
                id: e.id,
                title: e.title,
                total_questions: e.total_questions,
                duration_minutes: e.duration_minutes,
                starts_at_ms: e.starts_at_ms,
                ends_at_ms: e.ends_at_ms,
                state: e.state,
                max_attempts: e.max_attempts,
                attempts_used: submitted.length,
                attempts_left: Math.max(0, (e.max_attempts || 1) - submitted.length),
                best_score: best ? Number(best.score) : null,
                max_score: best ? Number(best.max_score) : null,
                best_attempt_id: best ? best.id : null,
                in_progress_attempt_id: open ? open.id : null,
                instructions: cm.fillInstructions(e.instructions, e)
            };
        });

        // Open first, then upcoming (soonest first), then closed.
        const order = { open: 0, upcoming: 1, closed: 2 };
        tests.sort((a, b) => (order[a.state] - order[b.state])
            || (a.state === 'upcoming' ? a.starts_at_ms - b.starts_at_ms : b.ends_at_ms - a.ends_at_ms));

        res.json({ tests, server_now_ms: Date.now() });
    } catch (error) {
        handleError(res, error, 'Company Mock Student List');
    }
};

// ─── Student: start (called from mockController.startAttempt) ────────────────

/**
 * Starts (or resumes) a company mock attempt. `examRow` is the Mock_Exams row
 * already loaded by startAttempt. Responds itself.
 */
exports.startCompanyAttempt = async (req, res, pool, examRow) => {
    let conn;
    try {
        const examId = examRow.id;
        const studentId = req.user.id;
        const me = await cm.studentIdentity(pool, studentId);

        const [[eligible]] = await pool.query(
            'SELECT id FROM Company_Mock_Eligible WHERE exam_id = ? AND roll_number = ?',
            [examId, me.roll_number || '']
        );
        if (!eligible) throw new cm.UserError('This test is not available for your roll number.', 403);

        conn = await pool.getConnection();
        await conn.beginTransaction();

        // One start at a time per test: two quick clicks can't create two
        // attempts, and the first start of a department can't draw two papers.
        const exam = await loadExam(conn, examId, { forUpdate: true });

        const [[open]] = await conn.query(
            `SELECT id FROM Exam_Attempts
              WHERE student_id = ? AND exam_id = ? AND status = 'in_progress'
              ORDER BY id DESC LIMIT 1`,
            [studentId, examId]
        );
        if (open) {
            await conn.commit();
            return res.json({ attemptId: open.id, resumed: true });
        }

        if (exam.state === 'upcoming') throw new cm.UserError(`This test opens at ${cm.formatIst(exam.starts_at_ms)}.`, 403);
        if (exam.state === 'closed') throw new cm.UserError('This test has closed.', 403);
        if (exam.state !== 'open') throw new cm.UserError('This test is not available.', 403);

        if (req.body?.acknowledged !== true) {
            throw new cm.UserError('Please confirm that you have read and will follow the instructions.', 400);
        }

        const [[{ used }]] = await conn.query(
            `SELECT COUNT(*) AS used FROM Exam_Attempts
              WHERE student_id = ? AND exam_id = ? AND status = 'submitted'`,
            [studentId, examId]
        );
        if (Number(used) >= (exam.max_attempts || 1)) {
            throw new cm.UserError(
                exam.max_attempts > 1
                    ? `You have used all ${exam.max_attempts} attempts for this test.`
                    : 'You have already attempted this test.', 403);
        }

        const recipes = await cm.departmentRecipes(conn);
        const paperKey = exam.question_source === cm.OWN
            ? cm.paperKeyFor(recipes, me.discipline)
            : exam.question_source;
        if (!paperKey) {
            throw new cm.UserError('There is no question bank for your department. Please contact the admin.', 403);
        }
        // Normally drawn when the admin saved; this covers a student whose
        // department changed on the roster since.
        await cm.ensurePapers(conn, examId, exam.total_questions, [paperKey], recipes);

        const [paper] = await conn.query(
            `SELECT p.question_id, p.section_name, p.section_order, p.position, qb.marks
               FROM Company_Mock_Papers p
               JOIN Question_Bank qb ON qb.id = p.question_id
              WHERE p.exam_id = ? AND p.paper_key = ?
              ORDER BY p.position`,
            [examId, paperKey]
        );
        if (!paper.length) throw new cm.UserError('This test has no questions yet. Please contact the admin.', 500);

        const shuffled = cm.shufflePaper(paper);
        const maxScore = shuffled.reduce((sum, q) => sum + parseFloat(q.marks), 0);

        const [ins] = await conn.query(
            `INSERT INTO Exam_Attempts (student_id, exam_id, status, total_questions, max_score, instructions_accepted_at)
             VALUES (?, ?, 'in_progress', ?, ?, NOW())`,
            [studentId, examId, shuffled.length, maxScore]
        );
        const attemptId = ins.insertId;
        await conn.query(
            `INSERT INTO Attempt_Questions (attempt_id, question_id, section_name, section_order, position)
             VALUES ?`,
            [shuffled.map(q => [attemptId, q.question_id, q.section_name, q.section_order, q.position])]
        );

        await conn.commit();
        res.json({ attemptId, resumed: false });
    } catch (error) {
        if (conn) { try { await conn.rollback(); } catch { /* connection gone */ } }
        handleError(res, error, 'Company Mock Start');
    } finally {
        if (conn) conn.release();
    }
};
