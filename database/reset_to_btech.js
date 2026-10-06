/**
 * reset_to_btech.js — wipe every student and all of their activity, then
 * re-seed the allow list with only the BTech students from seed_students.sql.
 *
 * Kept:
 *   - department_heads: the departments and their HODs, untouched.
 *   - All test content: Question_Bank, Mock_Exams, Mock_Exam_Sections and the
 *     legacy Tests / Test_Sections / Questions. Without these there would be no
 *     mock tests left to take.
 *
 * Deleted:
 *   - allowed_students and Students, and everything hanging off them:
 *     Exam_Attempts, Attempt_Questions, Test_Results, Test_Result_Answers,
 *     Test_Violations and Password_Reset_OTPs.
 *
 * "BTech" is every programme with BTech in its name: BTech, Dual Major BTech
 * and BTech - MTech Dual degree.
 *
 * Usage, from the project root with .env pointing at the target database:
 *   node database/reset_to_btech.js          # dry run: shows what would happen
 *   node database/reset_to_btech.js --yes    # actually does it
 *
 * The wipe and re-seed run in one transaction, so a failure part-way leaves the
 * database exactly as it was. Take a backup first anyway:
 *   mysqldump -u <user> -p cds_portal > backup_before_reset.sql
 */

const fs = require('fs');
const path = require('path');
const getPool = require('../src/config/db');
const { examServes } = require('../src/utils/departments');

const EXECUTE = process.argv.includes('--yes');
const SEED_FILE = path.join(__dirname, '..', 'seed_students.sql');

// Child tables before parents, so no delete trips a foreign key.
const WIPE = [
    'Attempt_Questions',
    'Test_Violations',
    'Exam_Attempts',
    'Test_Result_Answers',
    'Test_Results',
    'Password_Reset_OTPs',
    'Students',
    'allowed_students'
];

// One SQL string literal, with '' as an escaped quote.
const STR = "'((?:[^']|'')*)'";
// roll_number, name, email, programme, discipline, secondary_discipline
const SEED_ROW = new RegExp(
    `VALUES \\(${STR}, ${STR}, ${STR}, ${STR}, ${STR}, (NULL|${STR})\\)`
);

function readSeed() {
    const lines = fs.readFileSync(SEED_FILE, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('INSERT INTO allowed_students'));
    if (!lines.length) throw new Error(`No allowed_students rows found in ${SEED_FILE}.`);

    return lines.map(sql => {
        const m = sql.match(SEED_ROW);
        if (!m) {
            throw new Error(`Unrecognised seed row (regenerate seed_students.sql with seed_students.py):\n${sql}`);
        }
        const unq = v => (v === undefined ? null : v.replace(/''/g, "'"));
        return { sql, programme: unq(m[4]), discipline: unq(m[5]), secondary: unq(m[7]) };
    });
}

async function main() {
    const pool = await getPool;
    try {
        const seed = readSeed();
        const btech = seed.filter(r => /btech/i.test(r.programme));

        console.log(`\nDatabase: ${process.env.DB_NAME || 'cds_portal'} on ${process.env.DB_HOST || '127.0.0.1'}`);
        console.log('\nWill delete every row from:');
        for (const table of WIPE) {
            const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
            console.log(`  ${table.padEnd(22)} ${String(n).padStart(7)} rows`);
        }

        const [hods] = await pool.query(
            'SELECT name, email, department, is_active FROM department_heads ORDER BY department, name'
        );
        console.log(`\nWill keep ${hods.length} HOD assignment(s):`);
        for (const h of hods) {
            console.log(`  ${h.department.padEnd(28)} ${h.name} <${h.email}>${h.is_active ? '' : ' (inactive)'}`);
        }

        const programmes = {};
        for (const r of btech) programmes[r.programme] = (programmes[r.programme] || 0) + 1;
        console.log(`\nWill add ${btech.length} of the ${seed.length} students in seed_students.sql:`);
        for (const [p, n] of Object.entries(programmes)) console.log(`  ${p.padEnd(28)} ${n}`);

        if (!EXECUTE) {
            console.log('\nDry run: nothing has been changed. Re-run with --yes to wipe and re-seed.\n');
            return;
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const table of WIPE) await conn.query(`DELETE FROM \`${table}\``);
            for (const row of btech) await conn.query(row.sql);
            await conn.commit();
        } catch (err) {
            try { await conn.rollback(); } catch { /* connection already gone */ }
            throw err;
        } finally {
            conn.release();
        }

        // ── What students and HODs will now see ─────────────────────────
        const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM allowed_students');
        const [[{ second_majors }]] = await pool.query(
            'SELECT COUNT(*) AS second_majors FROM allowed_students WHERE secondary_discipline IS NOT NULL'
        );
        const [exams] = await pool.query(
            'SELECT id, title, department, disciplines FROM Mock_Exams WHERE is_active = 1 ORDER BY title'
        );
        const [depts] = await pool.query(`
            SELECT d.department, COUNT(al.id) AS students
              FROM (SELECT discipline AS department FROM allowed_students
                    UNION
                    SELECT secondary_discipline FROM allowed_students WHERE secondary_discipline IS NOT NULL
                    UNION
                    SELECT department FROM department_heads) AS d
              LEFT JOIN allowed_students al
                     ON al.discipline = d.department OR al.secondary_discipline = d.department
             GROUP BY d.department
             ORDER BY d.department
        `);

        console.log(`\nDone. allowed_students now holds ${total} students (${second_majors} with a second major).`);
        console.log('\nDepartment                    Students  Mock test(s) shown to them and their HOD');
        for (const d of depts) {
            const titles = exams.filter(e => examServes(e, [d.department])).map(e => e.title);
            console.log(`  ${d.department.padEnd(28)} ${String(d.students).padStart(6)}    ${titles.join(', ') || '(none)'}`);
        }

        const key = v => String(v || '').trim().toLowerCase();
        const empty = hods.filter(h => !depts.some(d => key(d.department) === key(h.department) && d.students > 0));
        if (empty.length) {
            console.log('\nNote: these HODs head a department that now has no students:');
            for (const h of empty) console.log(`  ${h.department}: ${h.name} <${h.email}>`);
        }
        console.log('');
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error('\nReset failed:', err);
    process.exit(1);
});
