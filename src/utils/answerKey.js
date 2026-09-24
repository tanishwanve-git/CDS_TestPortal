/**
 * answerKey.js — parsing and grading of question-bank answer keys.
 *
 * The bank's `correct_answer` column is not uniform: it comes from nine different
 * source pipelines and carries GATE's own conventions. MCQ answers are usually a
 * bare letter but sometimes a sentinel (`UNKNOWN`, `MTA`, `*`) or an unresolved
 * alternative (`C or D`). NAT answers are usually an accepted *range* rather than
 * a single value, written a dozen different ways:
 *
 *     2 to 2
 *     0.95 to 1.05
 *     (9)
 *     0.5 (0.49 to 0.51)
 *     28.5 (28.0 : 29.0)
 *     ≈ 3.86 m   (accepted range: 3.7 to 3.9)
 *
 * Anything this module cannot resolve to an unambiguous key is rejected at import
 * time rather than guessed at — a question with an uncertain answer never reaches
 * a student's paper.
 */

// Digits, optionally signed. Sources use four different unicode dashes for minus.
const DASHES = '−‐‒–';
const NUM = `[-+${DASHES}]?\\d+(?:\\.\\d+)?`;

function toNumber(raw) {
    let s = String(raw);
    for (const ch of DASHES) s = s.split(ch).join('-');
    return parseFloat(s.replace(/\+/g, ''));
}

/**
 * Normalise an MCQ answer to a single uppercase letter A-D.
 * Returns null for sentinels, multi-letter answers and anything ambiguous.
 */
function parseMcqAnswer(raw) {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim().toUpperCase().replace(/[()\s.]/g, '');
    return /^[A-D]$/.test(s) ? s : null;
}

/**
 * Parse a NAT answer into an inclusive accepted range { min, max }.
 * Returns null when no numeric range can be recovered.
 */
function parseNatAnswer(raw) {
    if (raw === undefined || raw === null) return null;
    // Collapse whitespace; drop thousands separators so "40,000" parses.
    const s = String(raw).trim().replace(/,/g, '').replace(/\s+/g, ' ');
    if (!s) return null;

    // 1. A trailing parenthesised range is the most explicit form and wins:
    //    "0.5 (0.49 to 0.51)", "28.5 (28.0 : 29.0)"
    let m = s.match(new RegExp(`\\(\\s*(${NUM})\\s*(?:to|:)\\s*(${NUM})\\s*\\)$`));
    if (m) return range(m[1], m[2]);

    // 2. A leading bare range: "0.95 to 1.05"
    m = s.match(new RegExp(`^(${NUM})\\s*to\\s*(${NUM})(?:\\s|$)`));
    if (m) return range(m[1], m[2]);

    // 3. A range anywhere in the text, last one wins:
    //    "≈ 3.86 m (accepted range: 3.7 to 3.9)"
    const all = [...s.matchAll(new RegExp(`(${NUM})\\s*to\\s*(${NUM})`, 'g'))];
    if (all.length) {
        const last = all[all.length - 1];
        return range(last[1], last[2]);
    }

    // 4. A single exact value, optionally wrapped in parentheses: "(9)", "3.5"
    const bare = s.replace(/^\((.*)\)$/, '$1').trim();
    if (new RegExp(`^${NUM}$`).test(bare)) return range(bare, bare);

    return null;
}

function range(a, b) {
    const lo = toNumber(a);
    const hi = toNumber(b);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
}

/**
 * Human-readable form of the stored key, used on the review screen.
 */
function formatAnswer(question) {
    if (question.question_type === 'NAT') {
        const lo = parseFloat(question.answer_min);
        const hi = parseFloat(question.answer_max);
        if (!Number.isFinite(lo)) return String(question.correct_answer ?? '');
        return lo === hi ? String(lo) : `${lo} to ${hi}`;
    }
    return String(question.correct_answer ?? '');
}

/**
 * Is a student's submitted answer correct for this question?
 *
 * `question` is a Question_Bank row (needs question_type, correct_answer and,
 * for NAT, answer_min / answer_max). `submitted` is the raw string the arena sent.
 * An unanswered question is never correct and is never penalised — the caller
 * decides that by checking for a blank answer first.
 */
function isAnswerCorrect(question, submitted) {
    if (submitted === undefined || submitted === null || String(submitted).trim() === '') {
        return false;
    }

    if (question.question_type === 'NAT') {
        const value = toNumber(String(submitted).trim());
        if (!Number.isFinite(value)) return false;

        const lo = parseFloat(question.answer_min);
        const hi = parseFloat(question.answer_max);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
            // No stored range (shouldn't happen for imported rows) — fall back to
            // an exact string comparison rather than accepting everything.
            return String(submitted).trim() === String(question.correct_answer).trim();
        }
        // Tiny epsilon so a key of "0.33 to 0.33" still accepts 0.33 typed back
        // after a float round-trip.
        const eps = 1e-9;
        return value >= lo - eps && value <= hi + eps;
    }

    return String(submitted).trim().toUpperCase() === String(question.correct_answer).trim().toUpperCase();
}

module.exports = { parseMcqAnswer, parseNatAnswer, formatAnswer, isAnswerCorrect, toNumber };
