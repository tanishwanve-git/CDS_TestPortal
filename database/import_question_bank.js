#!/usr/bin/env node
/**
 * import_question_bank.js — builds the mock-exam question bank in MySQL from the
 * image bank in ./questions/Question_Bank_Images/Question_Bank_Images.
 *
 * Run it once after cloning (and again whenever the image bank or
 * database/exam_blueprints.js changes):
 *
 *     node database/import_question_bank.js              # import everything
 *     node database/import_question_bank.js --dry-run    # validate, touch no DB
 *     node database/import_question_bank.js --only=CE,ME # one or more departments
 *     node database/import_question_bank.js --reset      # wipe the bank first
 *     node database/import_question_bank.js --verbose    # list every skipped row
 *
 * What it does:
 *   1. Reads every department's metadata.csv named in exam_blueprints.js.
 *   2. Drops rows that can't be served to a student — MSQ questions, rows the
 *      bank itself flags unusable, rows with a sentinel/ambiguous answer key, and
 *      rows whose PNG is missing from disk.
 *   3. Upserts what survives into `Question_Bank`, keyed on the image's path so
 *      re-running is idempotent and never duplicates a question.
 *   4. Creates/updates one `Mock_Exams` row per department plus its
 *      `Mock_Exam_Sections` blueprint rows.
 *   5. Verifies every section has enough questions to actually fill a paper.
 *
 * Papers themselves are NOT stored — they are drawn fresh from this bank each
 * time a student starts an attempt (see src/controllers/mockController.js).
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const blueprints = require('./exam_blueprints');
const { parseMcqAnswer, parseNatAnswer } = require('../src/utils/answerKey');

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cds_portal',
    port: process.env.DB_PORT || 3306
};

// ---------- CLI flags ----------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RESET = args.includes('--reset');
const VERBOSE = args.includes('--verbose');
const onlyArg = args.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : null;

// ---------- Minimal CSV reader ----------
// The bank's metadata.csv files are plain comma-separated with quoted fields; a
// 30-line reader avoids a stream dependency and keeps this script synchronous.
function parseCsv(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field); field = '';
        } else if (ch === '\n') {
            row.push(field); rows.push(row); row = []; field = '';
        } else if (ch !== '\r') {
            field += ch;
        }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }

    if (!rows.length) return [];
    const header = rows[0].map(h => h.trim());
    return rows.slice(1)
        .filter(r => r.some(c => c.trim() !== ''))
        .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// ---------- Row filtering ----------
function buildQuestionRow(csvRow, dept, stats) {
    const type = (csvRow.question_type || '').trim().toUpperCase();
    const answer = (csvRow.correct_answer || '').trim();
    const relPath = (csvRow.relative_path || '').trim().split('\\').join('/');

    const drop = (reason) => {
        stats.skipped[reason] = (stats.skipped[reason] || 0) + 1;
        if (VERBOSE) stats.skippedRows.push(`${dept.code} ${csvRow.image_filename}: ${reason} (answer="${answer}", type=${type})`);
        return null;
    };

    if (!blueprints.allowedTypes.includes(type)) return drop(`question type ${type || 'blank'} not supported`);

    // CSE is the one subject carrying a `usable` column; it flags questions whose
    // text references a program/figure/matrix that never made it into the image.
    if ((csvRow.usable || 'yes').toLowerCase() === 'no') return drop('flagged unusable by the bank');

    if (!relPath) return drop('no relative_path');
    if (!fs.existsSync(path.join(blueprints.bankRoot, relPath))) return drop('image file missing on disk');

    let correct = null;
    let natMin = null;
    let natMax = null;

    if (type === 'MCQ') {
        correct = parseMcqAnswer(answer);
        // Rejects UNKNOWN, MTA, '*', 'C or D', 'No option is correct', etc.
        if (!correct) return drop('MCQ answer key is a sentinel or ambiguous');
    } else {
        const parsed = parseNatAnswer(answer);
        if (!parsed) return drop('NAT answer key could not be parsed as a number or range');
        natMin = parsed.min;
        natMax = parsed.max;
        correct = parsed.min === parsed.max ? String(parsed.min) : `${parsed.min} to ${parsed.max}`;
    }

    const isNat = type === 'NAT';

    return {
        department: dept.code,
        section: (csvRow.section || dept.code).trim(),
        source_subject: (csvRow.subject || dept.code).trim(),
        year: (csvRow.year || '').trim() || null,
        source_question_no: parseInt(csvRow.question_no, 10) || null,
        question_type: type,
        correct_answer: correct,
        answer_min: natMin,
        answer_max: natMax,
        marks: blueprints.marking.correct,
        negative_marks: isNat ? blueprints.marking.negativeForNat : blueprints.marking.negative,
        image_filename: (csvRow.image_filename || path.basename(relPath)).trim(),
        relative_path: relPath,
        image_url: `${blueprints.imageWebRoot}/${relPath}`
    };
}

// ---------- Schema ----------
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS Question_Bank (
        id INT AUTO_INCREMENT PRIMARY KEY,
        department VARCHAR(20) NOT NULL,
        section VARCHAR(100) NOT NULL,
        source_subject VARCHAR(20) NOT NULL,
        year VARCHAR(16) NULL,
        source_question_no INT NULL,
        question_type VARCHAR(10) NOT NULL,
        correct_answer VARCHAR(255) NOT NULL,
        answer_min DECIMAL(18,6) NULL,
        answer_max DECIMAL(18,6) NULL,
        marks DECIMAL(5,2) NOT NULL DEFAULT 4,
        negative_marks DECIMAL(5,2) NOT NULL DEFAULT 1,
        image_filename VARCHAR(255) NOT NULL,
        relative_path VARCHAR(255) NOT NULL,
        image_url VARCHAR(512) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_relative_path (relative_path),
        KEY idx_pool (department, section, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS Mock_Exams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL,
        department VARCHAR(20) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        duration_minutes INT NOT NULL DEFAULT 90,
        total_questions INT NOT NULL DEFAULT 50,
        disciplines VARCHAR(255) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS Mock_Exam_Sections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        exam_id INT NOT NULL,
        section_name VARCHAR(150) NOT NULL,
        source_sections TEXT NULL,
        question_count INT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        FOREIGN KEY (exam_id) REFERENCES Mock_Exams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS Exam_Attempts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        exam_id INT NOT NULL,
        status ENUM('in_progress','submitted') NOT NULL DEFAULT 'in_progress',
        total_questions INT NOT NULL DEFAULT 0,
        max_score DECIMAL(8,2) NOT NULL DEFAULT 0,
        score DECIMAL(8,2) NULL,
        total_answered INT NULL,
        total_correct INT NULL,
        total_wrong INT NULL,
        time_taken_seconds INT NULL,
        violation_count INT NOT NULL DEFAULT 0,
        auto_submitted TINYINT(1) NOT NULL DEFAULT 0,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at DATETIME NULL,
        FOREIGN KEY (student_id) REFERENCES Students(id) ON DELETE CASCADE,
        FOREIGN KEY (exam_id) REFERENCES Mock_Exams(id) ON DELETE CASCADE,
        KEY idx_student (student_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS Attempt_Questions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        attempt_id INT NOT NULL,
        question_id INT NOT NULL,
        section_name VARCHAR(150) NOT NULL,
        section_order INT NOT NULL DEFAULT 0,
        position INT NOT NULL,
        submitted_answer VARCHAR(255) NULL,
        is_correct TINYINT(1) NULL,
        marks_awarded DECIMAL(6,2) NULL,
        FOREIGN KEY (attempt_id) REFERENCES Exam_Attempts(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES Question_Bank(id) ON DELETE CASCADE,
        UNIQUE KEY uq_attempt_position (attempt_id, position),
        KEY idx_attempt (attempt_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

// ---------- Main ----------
async function main() {
    const departments = blueprints.departments.filter(d => !ONLY || ONLY.includes(d.code));

    if (!departments.length) {
        console.error(`❌ No departments matched --only=${ONLY.join(',')}. Known codes: ${blueprints.departments.map(d => d.code).join(', ')}`);
        process.exit(1);
    }

    console.log(`\n📚 CDS Test Portal — question bank import${DRY_RUN ? ' (DRY RUN — no database writes)' : ''}`);
    console.log(`   Bank root: ${blueprints.bankRoot}`);
    console.log(`   Departments: ${departments.map(d => d.code).join(', ')}\n`);

    if (!fs.existsSync(blueprints.bankRoot)) {
        console.error(`❌ Image bank not found at ${blueprints.bankRoot}`);
        console.error('   Check that questions/Question_Bank_Images/Question_Bank_Images exists (see README).');
        process.exit(1);
    }

    // --- Phase 1: read + validate every CSV before touching the database ---
    const parsed = [];
    const stats = { skipped: {}, skippedRows: [] };
    let fatal = false;

    for (const dept of departments) {
        const csvPath = path.join(blueprints.bankRoot, dept.metadata);
        if (!fs.existsSync(csvPath)) {
            console.error(`❌ ${dept.code}: metadata not found at ${csvPath}`);
            fatal = true;
            continue;
        }

        const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
        const questions = rows.map(r => buildQuestionRow(r, dept, stats)).filter(Boolean);

        // Count what each blueprint section can actually draw from.
        const bySection = {};
        for (const q of questions) bySection[q.section] = (bySection[q.section] || 0) + 1;

        const sectionReport = dept.sections.map(sec => {
            const pool = sec.sourceSections.length
                ? sec.sourceSections.reduce((n, s) => n + (bySection[s] || 0), 0)
                : questions.length;
            return { ...sec, pool };
        });

        const totalWanted = dept.sections.reduce((n, s) => n + s.count, 0);
        const short = sectionReport.filter(s => s.pool < s.count);

        console.log(`  ${dept.code.padEnd(4)} ${String(rows.length).padStart(5)} rows → ${String(questions.length).padStart(5)} usable   (paper: ${totalWanted} questions across ${dept.sections.length} section${dept.sections.length > 1 ? 's' : ''})`);
        for (const sec of sectionReport) {
            const flag = sec.pool < sec.count ? ' ❌ NOT ENOUGH QUESTIONS' : '';
            console.log(`         · ${sec.name.padEnd(38)} draw ${String(sec.count).padStart(2)} from pool of ${String(sec.pool).padStart(5)}${flag}`);
        }

        if (short.length) fatal = true;
        parsed.push({ dept, questions, totalWanted });
    }

    const totalSkipped = Object.values(stats.skipped).reduce((a, b) => a + b, 0);
    if (totalSkipped) {
        console.log(`\n  Skipped ${totalSkipped} source rows:`);
        for (const [reason, n] of Object.entries(stats.skipped).sort((a, b) => b[1] - a[1])) {
            console.log(`         · ${String(n).padStart(4)}  ${reason}`);
        }
        if (VERBOSE) {
            console.log('\n  Skipped rows in detail:');
            stats.skippedRows.forEach(r => console.log(`         · ${r}`));
        }
    }

    const grandTotal = parsed.reduce((n, p) => n + p.questions.length, 0);
    console.log(`\n  ${grandTotal} questions ready to import.\n`);

    if (fatal) {
        console.error('❌ Aborting: at least one section cannot be filled, or a metadata file is missing.');
        console.error('   Fix the counts in database/exam_blueprints.js (or the bank) and re-run.');
        process.exit(1);
    }

    if (DRY_RUN) {
        console.log('✅ Dry run complete — everything validates. Re-run without --dry-run to write to the database.\n');
        return;
    }

    // --- Phase 2: write ---
    let conn;
    try {
        conn = await mysql.createConnection({ ...dbConfig, multipleStatements: false });
        console.log('✅ Connected to MySQL');
    } catch (err) {
        console.error('❌ Could not connect to MySQL:', err.message);
        console.error('   Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in your .env file.');
        process.exit(1);
    }

    try {
        for (const stmt of SCHEMA) await conn.query(stmt);
        console.log('✅ Bank & attempt tables ready');

        if (RESET) {
            // Attempts reference Question_Bank; clear them first so the FK holds.
            await conn.query('SET FOREIGN_KEY_CHECKS = 0');
            for (const code of departments.map(d => d.code)) {
                await conn.query(
                    `DELETE aq FROM Attempt_Questions aq
                     JOIN Question_Bank qb ON aq.question_id = qb.id
                     WHERE qb.department = ?`, [code]
                );
                await conn.query('DELETE FROM Question_Bank WHERE department = ?', [code]);
            }
            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
            console.log(`🧹 Reset: cleared existing bank rows for ${departments.map(d => d.code).join(', ')}`);
        }

        for (const { dept, questions, totalWanted } of parsed) {
            // Insert in batches — 1,900 rows in one statement exceeds max_allowed_packet
            // on a default MySQL install.
            const BATCH = 500;
            let written = 0;

            for (let i = 0; i < questions.length; i += BATCH) {
                const chunk = questions.slice(i, i + BATCH);
                const values = chunk.map(q => [
                    q.department, q.section, q.source_subject, q.year, q.source_question_no,
                    q.question_type, q.correct_answer, q.answer_min, q.answer_max,
                    q.marks, q.negative_marks, q.image_filename, q.relative_path, q.image_url
                ]);

                const [res] = await conn.query(
                    `INSERT INTO Question_Bank
                        (department, section, source_subject, year, source_question_no,
                         question_type, correct_answer, answer_min, answer_max,
                         marks, negative_marks, image_filename, relative_path, image_url)
                     VALUES ?
                     ON DUPLICATE KEY UPDATE
                        department = VALUES(department),
                        section = VALUES(section),
                        source_subject = VALUES(source_subject),
                        year = VALUES(year),
                        source_question_no = VALUES(source_question_no),
                        question_type = VALUES(question_type),
                        correct_answer = VALUES(correct_answer),
                        answer_min = VALUES(answer_min),
                        answer_max = VALUES(answer_max),
                        marks = VALUES(marks),
                        negative_marks = VALUES(negative_marks),
                        image_filename = VALUES(image_filename),
                        image_url = VALUES(image_url),
                        is_active = 1`,
                    [values]
                );
                written += res.affectedRows;
            }

            // Upsert the exam itself.
            await conn.query(
                `INSERT INTO Mock_Exams (code, department, title, description, duration_minutes, total_questions, disciplines, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE
                    department = VALUES(department),
                    title = VALUES(title),
                    description = VALUES(description),
                    duration_minutes = VALUES(duration_minutes),
                    total_questions = VALUES(total_questions),
                    disciplines = VALUES(disciplines),
                    is_active = 1`,
                [dept.code, dept.code, dept.title, dept.description || null,
                 dept.durationMinutes, totalWanted, (dept.disciplines || []).join(',')]
            );

            const [[exam]] = await conn.query('SELECT id FROM Mock_Exams WHERE code = ?', [dept.code]);

            // Section blueprint is small and fully derived from the config file, so
            // replace it wholesale rather than diffing.
            await conn.query('DELETE FROM Mock_Exam_Sections WHERE exam_id = ?', [exam.id]);
            for (let i = 0; i < dept.sections.length; i++) {
                const sec = dept.sections[i];
                await conn.query(
                    `INSERT INTO Mock_Exam_Sections (exam_id, section_name, source_sections, question_count, sort_order)
                     VALUES (?, ?, ?, ?, ?)`,
                    [exam.id, sec.name, JSON.stringify(sec.sourceSections || []), sec.count, i]
                );
            }

            console.log(`  ✅ ${dept.code.padEnd(4)} bank upserted (${questions.length} questions, ${written} rows touched) · exam #${exam.id} with ${dept.sections.length} section(s)`);
        }

        // Final sanity check straight from the database.
        console.log('\n📊 Bank in database:');
        const [summary] = await conn.query(
            `SELECT department, COUNT(*) AS total,
                    SUM(question_type = 'MCQ') AS mcq,
                    SUM(question_type = 'NAT') AS nat
             FROM Question_Bank WHERE is_active = 1
             GROUP BY department ORDER BY department`
        );
        for (const r of summary) {
            console.log(`   ${String(r.department).padEnd(5)} ${String(r.total).padStart(5)} questions  (${r.mcq} MCQ, ${r.nat} NAT)`);
        }

        const [exams] = await conn.query(
            `SELECT e.code, e.title, e.total_questions, e.duration_minutes, COUNT(s.id) AS sections
             FROM Mock_Exams e LEFT JOIN Mock_Exam_Sections s ON s.exam_id = e.id
             WHERE e.is_active = 1 GROUP BY e.id ORDER BY e.code`
        );
        console.log('\n🧪 Mock exams available on the portal:');
        for (const e of exams) {
            console.log(`   ${String(e.code).padEnd(5)} ${e.total_questions} Q · ${e.duration_minutes} min · ${e.sections} section(s) — ${e.title}`);
        }

        console.log('\n✅ Import complete. Start the server and the mock tests will appear on the student dashboard.\n');

    } catch (err) {
        console.error('\n❌ Import failed:', err.message);
        console.error(err);
        process.exitCode = 1;
    } finally {
        if (conn) await conn.end();
    }
}

main();
