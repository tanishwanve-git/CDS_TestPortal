/**
 * companyMock.js — the building blocks of company mock tests.
 *
 * A company mock is a Mock_Exams row with kind = 'company'. Unlike a department
 * mock, it is not offered by department but to an explicit list of roll numbers
 * (Company_Mock_Eligible), it opens and closes at set times, and every student
 * of a department sits the SAME paper (Company_Mock_Papers), shuffled per
 * attempt, so marks can be compared fairly.
 *
 * `starts_at`/`ends_at` are a START window: a student may begin (or re-attempt)
 * only between them, but once begun gets the full duration, even if that runs
 * past `ends_at`.
 *
 * Where the questions come from is `question_source`:
 *   'OWN'          — each student's paper is their own (primary) department's;
 *   a dept code    — everyone gets that department's paper ('ME', 'CSE', …).
 *
 * Either way a paper follows a department mock's *recipe*: its
 * Mock_Exam_Sections, scaled down (or up) to the company test's question
 * count. So a 30-question ME paper keeps the ME mock's 5:45 split of General
 * Aptitude to core — 3 + 27 — and an EE paper still includes EC and IN
 * questions the way the EE mock does.
 */

const { examServes, disciplineCode } = require('./departments');

const OWN = 'OWN';

const DEFAULT_INSTRUCTIONS = [
    '1. This test has {N} questions and a duration of {T} minutes.',
    '2. Marking: +4 for every correct answer, -1 for every wrong MCQ answer. Numerical (NAT) questions carry no negative marking. Unanswered questions get 0.',
    '3. The test runs in fullscreen. Switching tabs, minimising the window or leaving fullscreen is recorded. The second violation submits your test automatically.',
    '4. You can start the test any time between {START} and {END}. Once you start, you get the full {T} minutes.',
    "5. Your answers are saved automatically. Click 'Submit final test' when you are done.",
    '6. Your marks will be shared in the WhatsApp group.',
    '7. Do not use any unfair means: no phones, no other people, no AI tools, no searching online. Any malpractice will lead to disqualification.'
].join('\n');

/** An error whose message is safe to show the admin/student as-is. */
class UserError extends Error {
    constructor(message, status = 400, details = undefined) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

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

/**
 * The active department mocks and their section recipes, keyed by code.
 * Map<code, { exam, sections }>
 */
async function departmentRecipes(db) {
    const [exams] = await db.query(
        `SELECT id, code, department, disciplines, title FROM Mock_Exams
          WHERE kind = 'department' AND is_active = 1
          ORDER BY code`
    );
    const recipes = new Map();
    if (!exams.length) return recipes;

    const [sections] = await db.query(
        `SELECT * FROM Mock_Exam_Sections WHERE exam_id IN (?) ORDER BY sort_order, id`,
        [exams.map(e => e.id)]
    );
    for (const exam of exams) {
        recipes.set(exam.code, { exam, sections: sections.filter(s => s.exam_id === exam.id) });
    }
    return recipes;
}

/**
 * Apportions `n` questions across `sections` in proportion to their
 * question_count (largest-remainder method), so the result always sums to
 * exactly `n`. Sections that end up with nothing are dropped.
 */
function scaleSections(sections, n) {
    const total = sections.reduce((sum, s) => sum + Number(s.question_count), 0);
    if (!total || n <= 0) return [];

    const shares = sections.map((s, i) => {
        const exact = (Number(s.question_count) * n) / total;
        return { section: s, i, count: Math.floor(exact), frac: exact - Math.floor(exact) };
    });
    let left = n - shares.reduce((sum, s) => sum + s.count, 0);
    // Hand the leftover questions to the largest fractions; ties go to the
    // earlier section so the result is deterministic.
    [...shares].sort((a, b) => (b.frac - a.frac) || (a.i - b.i)).forEach(s => {
        if (left > 0) { s.count++; left--; }
    });

    return shares.filter(s => s.count > 0).map(s => ({ ...s.section, question_count: s.count }));
}

/**
 * Which department paper a student with this (primary) discipline sits, or
 * null when no department mock serves them (HSS, Physics, …).
 */
function paperKeyFor(recipes, discipline) {
    const code = disciplineCode(discipline);
    if (!code) return null;
    if (recipes.has(code)) return code;
    for (const [key, recipe] of recipes) {
        if (examServes(recipe.exam, [discipline])) return key;
    }
    return null;
}

/** Splits a pasted list on commas, semicolons and whitespace; de-duplicates. */
function parseRolls(input) {
    const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
    const seen = new Set();
    const out = [];
    for (const token of raw.split(/[\s,;]+/)) {
        const roll = token.trim();
        if (!roll) continue;
        const key = roll.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(roll);
    }
    return out;
}

/**
 * Checks a pasted roll list against the allow list.
 *
 *   valid    — on the allow list and active, with the paper they would sit
 *   unknown  — not on the allow list
 *   inactive — on it, but deactivated (they cannot sign in)
 *   no_bank  — only when source is OWN: their department has no question bank
 */
async function resolveRolls(db, rollsInput, source, recipes) {
    const rolls = parseRolls(rollsInput);
    const result = { valid: [], unknown: [], inactive: [], no_bank: [] };
    if (!rolls.length) return result;

    const [rows] = await db.query(
        `SELECT roll_number, name, email, discipline, secondary_discipline, is_active
           FROM allowed_students WHERE roll_number IN (?)`,
        [rolls]
    );
    const byRoll = new Map(rows.map(r => [String(r.roll_number).toUpperCase(), r]));

    for (const roll of rolls) {
        const row = byRoll.get(roll.toUpperCase());
        if (!row) { result.unknown.push(roll); continue; }
        if (!row.is_active) { result.inactive.push(row.roll_number); continue; }

        const paperKey = source === OWN ? paperKeyFor(recipes, row.discipline) : source;
        const entry = {
            roll_number: row.roll_number,
            name: row.name,
            discipline: row.discipline,
            paper_key: paperKey
        };
        if (!paperKey) result.no_bank.push(entry);
        else result.valid.push(entry);
    }
    return result;
}

/**
 * Draws one department paper of `n` questions following `recipe`.
 * Returns rows ready for Company_Mock_Papers, positions 1..n in section order.
 */
async function drawPaper(db, recipe, n) {
    const scaled = scaleSections(recipe.sections, n);
    if (!scaled.length) {
        throw new UserError(`The ${recipe.exam.code} mock has no sections configured.`);
    }

    const rows = [];
    for (let order = 0; order < scaled.length; order++) {
        const section = scaled[order];
        const sourceSections = toArray(section.source_sections);
        let sql = `SELECT id FROM Question_Bank WHERE department = ? AND is_active = 1`;
        const params = [section.source_department || recipe.exam.department];
        if (sourceSections.length) {
            sql += ` AND section IN (${sourceSections.map(() => '?').join(',')})`;
            params.push(...sourceSections);
        }
        sql += ' ORDER BY RAND() LIMIT ?';
        params.push(section.question_count);

        const [picked] = await db.query(sql, params);
        if (picked.length < section.question_count) {
            throw new UserError(
                `Not enough questions in the ${recipe.exam.code} bank for "${section.section_name}" ` +
                `(${picked.length} available, ${section.question_count} needed). Reduce the number of questions.`
            );
        }
        for (const q of picked) {
            rows.push({ question_id: q.id, section_name: section.section_name, section_order: order });
        }
    }
    return rows.map((r, i) => ({ ...r, position: i + 1 }));
}

/**
 * Makes sure exam `examId` has a stored paper for every key in `paperKeys`.
 * With `replace`, every existing paper is thrown away and redrawn first.
 * Must run on a connection inside a transaction.
 */
async function ensurePapers(conn, examId, n, paperKeys, recipes, { replace = false } = {}) {
    if (replace) {
        await conn.query('DELETE FROM Company_Mock_Papers WHERE exam_id = ?', [examId]);
    }
    const [existing] = await conn.query(
        'SELECT DISTINCT paper_key FROM Company_Mock_Papers WHERE exam_id = ?', [examId]
    );
    const have = new Set(existing.map(r => r.paper_key));

    for (const key of new Set(paperKeys)) {
        if (have.has(key)) continue;
        const recipe = recipes.get(key);
        if (!recipe) throw new UserError(`There is no active ${key} department mock to build a paper from.`);
        const paper = await drawPaper(conn, recipe, n);
        await conn.query(
            `INSERT INTO Company_Mock_Papers (exam_id, paper_key, section_name, section_order, position, question_id)
             VALUES ?`,
            [paper.map(p => [examId, key, p.section_name, p.section_order, p.position, p.question_id])]
        );
    }
}

/** Fisher–Yates, in place. */
function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/**
 * A stored paper in a fresh order: sections stay in recipe order, questions
 * are shuffled within each section. Positions are renumbered 1..n.
 */
function shufflePaper(paperRows) {
    const bySection = new Map();
    for (const row of paperRows) {
        if (!bySection.has(row.section_order)) bySection.set(row.section_order, []);
        bySection.get(row.section_order).push(row);
    }
    const ordered = [...bySection.keys()].sort((a, b) => a - b)
        .flatMap(order => shuffle([...bySection.get(order)]));
    return ordered.map((r, i) => ({ ...r, position: i + 1 }));
}

/** An IST wall-clock label, e.g. "15 Nov 2026, 12:00 pm". */
function formatIst(ms) {
    if (!ms) return '';
    return new Date(Number(ms)).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/** Fills the {N}, {T}, {END} and {START} placeholders of an instruction text. */
function fillInstructions(text, exam) {
    return String(text || '')
        .replace(/\{N\}/g, String(exam.total_questions))
        .replace(/\{T\}/g, String(exam.duration_minutes))
        .replace(/\{END\}/g, formatIst(exam.ends_at_ms))
        .replace(/\{START\}/g, formatIst(exam.starts_at_ms));
}

/**
 * Accepts "2026-11-15T10:00", "2026-11-15 10:00" or with seconds; returns
 * "2026-11-15 10:00:00" (IST wall clock, as the DB session stores it) or null.
 */
function normalizeDateTime(value) {
    const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s = '00'] = m;
    const check = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || +h > 23 || +mi > 59) return null;
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/**
 * The signed-in student's roll number and primary discipline. The allow list
 * is the source of truth; the Students copy is a fallback.
 */
async function studentIdentity(db, studentId) {
    const [[row]] = await db.query(
        `SELECT COALESCE(al.roll_number, s.roll_number) AS roll_number,
                COALESCE(al.discipline, s.discipline, s.branch) AS discipline
           FROM Students s
           LEFT JOIN allowed_students al ON LOWER(al.email) = LOWER(s.email)
          WHERE s.id = ?`,
        [studentId]
    );
    return row || { roll_number: null, discipline: null };
}

module.exports = {
    OWN,
    DEFAULT_INSTRUCTIONS,
    UserError,
    departmentRecipes,
    scaleSections,
    paperKeyFor,
    parseRolls,
    resolveRolls,
    drawPaper,
    ensurePapers,
    shufflePaper,
    fillInstructions,
    formatIst,
    normalizeDateTime,
    studentIdentity
};
