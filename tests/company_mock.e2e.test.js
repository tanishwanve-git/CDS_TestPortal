// End-to-end tests for company mock tests, against a real MySQL server.
//
// It builds a throwaway database (DB_NAME, default cds_portal_test; it refuses
// any name not ending in _test), creates it with the PREVIOUS release's schema
// and data, then starts the new server on it — so the automatic migration is
// exercised exactly as it will be on production — and drives the API.
//
//   DB_USER=root DB_PASSWORD=... node --test tests/company_mock.e2e.test.js
//
// Set KEEP_DB=1 to leave the database behind for inspection.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const DB = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'cds_portal_test'
};
if (!/_test$/.test(DB.database)) {
    throw new Error(`Refusing to run against "${DB.database}": the database name must end in _test.`);
}
// The schema the currently deployed release creates. Defaults to main.
const BASE_REF = process.env.BASE_REF || 'main';
const PORT = Number(process.env.TEST_PORT || 5099);
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'company_mock_test_secret';
const ADMIN_EMAIL = 'admin.test@iitgn.ac.in';
const HOD_EMAIL = 'hod.me@iitgn.ac.in';

const SERVER_ENV = {
    ...process.env,
    PORT: String(PORT),
    DB_HOST: DB.host, DB_USER: DB.user, DB_PASSWORD: DB.password,
    DB_PORT: String(DB.port), DB_NAME: DB.database,
    JWT_SECRET, ADMIN_EMAILS: ADMIN_EMAIL
};

let db;           // pool on the test database
let server;       // child process
let serverLog = '';
const students = {}; // key -> { id, email, roll, token }
let adminToken;
let hodToken;

// ── helpers ─────────────────────────────────────────────────────────────────

const ist = minutesFromNow =>
    new Date(Date.now() + minutesFromNow * 60000 + 330 * 60000).toISOString().slice(0, 16);

async function api(method, url, token, body) {
    const res = await fetch(`${BASE}${url}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: data, type };
}

async function startServer() {
    serverLog = '';
    server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: SERVER_ENV });
    server.stdout.on('data', d => { serverLog += d; });
    server.stderr.on('data', d => { serverLog += d; });
    for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw new Error(`Server exited:\n${serverLog}`);
        try {
            const res = await fetch(`${BASE}/api/health`);
            // Health answers before the DB bootstrap finishes; wait for it.
            if (res.ok && serverLog.includes('Database tables')) return;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`Server did not start:\n${serverLog}`);
}

async function stopServer() {
    if (!server || server.exitCode !== null) return;
    const exited = new Promise(r => server.once('exit', r));
    server.kill();
    await exited;
}

async function insertBank(department, section, count, type = 'MCQ') {
    const rows = [];
    for (let i = 1; i <= count; i++) {
        const rel = `${department}/${section}/${type}_${i}.png`;
        rows.push([department, section, department, type, type === 'MCQ' ? 'A' : '5 to 5',
            type === 'NAT' ? 5 : null, type === 'NAT' ? 5 : null, 4, type === 'NAT' ? 0 : 1,
            `${i}.png`, rel, `/questions/${rel}`]);
    }
    await db.query(
        `INSERT INTO Question_Bank (department, section, source_subject, question_type, correct_answer,
            answer_min, answer_max, marks, negative_marks, image_filename, relative_path, image_url)
         VALUES ?`, [rows]);
}

async function insertExam(code, disciplines, sections) {
    const total = sections.reduce((n, s) => n + s.count, 0);
    const [r] = await db.query(
        `INSERT INTO Mock_Exams (code, department, title, duration_minutes, total_questions, disciplines)
         VALUES (?, ?, ?, 90, ?, ?)`, [code, code, `${code} Mock Test`, total, disciplines]);
    for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        await db.query(
            `INSERT INTO Mock_Exam_Sections (exam_id, section_name, source_department, source_sections, question_count, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [r.insertId, s.name, s.bank || code, JSON.stringify(s.from), s.count, i]);
    }
    return r.insertId;
}

const ROSTER = [
    // key, roll, discipline, active
    ['me1', '23110001', 'Mechanical', true],
    ['me2', '23110002', 'Mechanical', true],
    ['cs', '23110003', 'Computer Science', true],
    ['ph', '23110004', 'Physics', true],
    ['off', '23110005', 'Mechanical', false],
    ['ee', '23110006', 'Electrical', true],
    ['ai', '23110007', 'Artificial Intelligence', true],
    ['me3', '23110008', 'Mechanical', true]
];

async function createCompany(overrides = {}) {
    return api('POST', '/api/admin/company-mocks', adminToken, {
        title: 'Acme placement mock',
        question_source: 'OWN',
        total_questions: 20,
        duration_minutes: 60,
        max_attempts: 1,
        starts_at: ist(-60),
        ends_at: ist(120),
        is_active: true,
        roll_numbers: '23110001, 23110002\n23110003 23110006;23110007',
        instructions: 'Read carefully. {N} questions in {T} minutes, closes {END}.',
        ...overrides
    });
}

// ── setup: previous release's schema + data, then the new server ────────────

before(async () => {
    const admin = await mysql.createConnection({ host: DB.host, user: DB.user, password: DB.password, port: DB.port });
    await admin.query(`DROP DATABASE IF EXISTS \`${DB.database}\``);
    await admin.query(`CREATE DATABASE \`${DB.database}\``);
    await admin.end();

    // Build the schema with the deployed release's own bootstrap code.
    const oldDb = path.join(os.tmpdir(), `cds_old_db_${process.pid}.js`);
    fs.writeFileSync(oldDb, execFileSync('git', ['show', `${BASE_REF}:src/config/db.js`], { cwd: ROOT }));
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(oldDb)}).then(p => p.end())`], {
        cwd: ROOT, env: { ...SERVER_ENV, NODE_PATH: path.join(ROOT, 'node_modules') }, stdio: 'pipe'
    });
    fs.unlinkSync(oldDb);

    db = mysql.createPool({ ...DB, timezone: '+05:30', connectionLimit: 4 });
    db.on('connection', c => c.query(`SET time_zone = '+05:30'`));

    const [cols] = await db.query(`SHOW COLUMNS FROM Mock_Exams LIKE 'kind'`);
    assert.equal(cols.length, 0, 'the base schema should predate company mocks');

    await insertBank('ME', 'GA', 20);
    await insertBank('ME', 'ME', 50);
    await insertBank('ME', 'ME', 10, 'NAT');
    await insertBank('CSE', 'CSE', 60);
    await insertBank('EE', 'GA', 10);
    await insertBank('EE', 'EE', 40);
    await insertBank('EC', 'EC', 20);
    await insertBank('IN', 'IN', 20);

    await insertExam('ME', 'ME', [
        { name: 'General Aptitude', from: ['GA'], count: 5 },
        { name: 'Mechanical Engineering', from: ['ME'], count: 45 }]);
    await insertExam('CSE', 'CSE,CS,AI,ICDT,CG', [
        { name: 'Computer Science & Engineering', from: [], count: 50 }]);
    await insertExam('EE', 'EE,EC,ECE,IN', [
        { name: 'General Aptitude', from: ['GA'], count: 5 },
        { name: 'Electrical Engineering', from: ['EE'], count: 25 },
        { name: 'Electronics & Communication', bank: 'EC', from: ['EC'], count: 10 },
        { name: 'Instrumentation Engineering', bank: 'IN', from: ['IN'], count: 10 }]);

    for (const [key, roll, discipline, active] of ROSTER) {
        const email = `${key}@iitgn.ac.in`;
        await db.query(
            `INSERT INTO allowed_students (roll_number, name, email, programme, discipline, is_active)
             VALUES (?, ?, ?, 'BTech', ?, ?)`, [roll, `Student ${key}`, email, discipline, active]);
        const [r] = await db.query(
            `INSERT INTO Students (email, name, roll_number, discipline) VALUES (?, ?, ?, ?)`,
            [email, `Student ${key}`, roll, discipline]);
        students[key] = { id: r.insertId, email, roll, token: jwt.sign({ id: r.insertId, email }, JWT_SECRET) };
    }

    // A department-mock attempt from before the upgrade, which must survive.
    const [[meExam]] = await db.query(`SELECT id FROM Mock_Exams WHERE code = 'ME'`);
    await db.query(
        `INSERT INTO Exam_Attempts (student_id, exam_id, status, total_questions, max_score, score, submitted_at)
         VALUES (?, ?, 'submitted', 50, 200, 123, NOW())`, [students.me1.id, meExam.id]);

    await startServer();

    await db.query(`INSERT INTO department_heads (name, email, department) VALUES ('HOD ME', ?, 'Mechanical')`, [HOD_EMAIL]);
    adminToken = jwt.sign({ id: null, email: ADMIN_EMAIL }, JWT_SECRET);
    hodToken = jwt.sign({ id: null, email: HOD_EMAIL }, JWT_SECRET);
});

after(async () => {
    await stopServer();
    if (db) {
        if (!process.env.KEEP_DB) await db.query(`DROP DATABASE IF EXISTS \`${DB.database}\``);
        await db.end();
    }
});

// ── migration ───────────────────────────────────────────────────────────────

test('migration adds the new columns/tables and leaves existing data alone', async () => {
    const [kinds] = await db.query(`SELECT code, kind, is_active FROM Mock_Exams ORDER BY code`);
    assert.deepEqual(kinds.map(k => [k.code, k.kind, k.is_active]),
        [['CSE', 'department', 1], ['EE', 'department', 1], ['ME', 'department', 1]]);

    const [[old]] = await db.query(`SELECT score, status FROM Exam_Attempts WHERE student_id = ?`, [students.me1.id]);
    assert.equal(Number(old.score), 123);
    assert.equal(old.status, 'submitted');

    const [tables] = await db.query(`SHOW TABLES LIKE 'Company_Mock_%'`);
    assert.equal(tables.length, 2);
    const [col] = await db.query(`SHOW COLUMNS FROM Exam_Attempts LIKE 'instructions_accepted_at'`);
    assert.equal(col.length, 1);
});

test('restarting the server re-runs the migration harmlessly', async () => {
    await stopServer();
    await startServer();
    assert.doesNotMatch(serverLog, /Database connection failed|Error/);
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM Mock_Exams`);
    assert.equal(n, 3);
});

// ── access control ──────────────────────────────────────────────────────────

test('only admins can create; HODs and students cannot', async () => {
    assert.equal((await api('GET', '/api/admin/company-mocks/defaults', adminToken)).status, 200);
    assert.equal((await api('POST', '/api/admin/company-mocks', hodToken, {})).status, 403);
    assert.equal((await api('POST', '/api/admin/company-mocks', students.me1.token, {})).status, 403);
    assert.equal((await api('POST', '/api/admin/company-mocks', null, {})).status, 401);
});

test('form defaults list own-department plus each department mock', async () => {
    const { body } = await api('GET', '/api/admin/company-mocks/defaults', adminToken);
    assert.deepEqual(body.sources.map(s => s.value), ['OWN', 'CSE', 'EE', 'ME']);
    assert.match(body.instructions, /WhatsApp/);
});

// ── validation ──────────────────────────────────────────────────────────────

test('roll check reports unknown, deactivated and bank-less students', async () => {
    const { body } = await api('POST', '/api/admin/company-mocks/validate-rolls', adminToken, {
        roll_numbers: '23110001 99999999 23110005 23110004 23110007', question_source: 'OWN'
    });
    assert.deepEqual(body.valid.map(v => [v.roll_number, v.paper_key]), [['23110001', 'ME'], ['23110007', 'CSE']]);
    assert.deepEqual(body.unknown, ['99999999']);
    assert.deepEqual(body.inactive, ['23110005']);
    assert.deepEqual(body.no_bank.map(v => v.roll_number), ['23110004']);

    // With a fixed department, a Physics student is fine.
    const fixed = await api('POST', '/api/admin/company-mocks/validate-rolls', adminToken, {
        roll_numbers: '23110004', question_source: 'ME'
    });
    assert.deepEqual(fixed.body.valid.map(v => v.paper_key), ['ME']);
});

test('create is rejected with the offending roll numbers listed', async () => {
    const res = await createCompany({ roll_numbers: '23110001 99999999 23110004 23110005' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body.unknown, ['99999999']);
    assert.deepEqual(res.body.inactive, ['23110005']);
    assert.equal(res.body.no_bank.length, 1);
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM Mock_Exams WHERE kind = 'company'`);
    assert.equal(n, 0, 'nothing is saved');
});

test('create is rejected for bad fields', async () => {
    const cases = [
        { title: '' },
        { question_source: 'XYZ' },
        { total_questions: 0 },
        { total_questions: 2.5 },
        { duration_minutes: 0 },
        { max_attempts: 0 },
        { starts_at: 'nope' },
        { starts_at: ist(60), ends_at: ist(30) },
        { instructions: '   ' },
        { roll_numbers: '' }
    ];
    for (const c of cases) {
        const res = await createCompany(c);
        assert.equal(res.status, 400, JSON.stringify(c));
    }
});

test('create is rejected when the bank is too small, and rolls back', async () => {
    // 100 ME questions -> 10 GA + 90 ME, but the ME section has only 50 MCQs + 10 NAT.
    const res = await createCompany({ question_source: 'ME', total_questions: 100 });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Not enough questions/);
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM Mock_Exams WHERE kind = 'company'`);
    assert.equal(n, 0);
});

// ── the main flow ───────────────────────────────────────────────────────────

let mainId;

test('create (own department) draws one fixed paper per department', async () => {
    const res = await createCompany();
    assert.equal(res.status, 201, JSON.stringify(res.body));
    mainId = res.body.id;

    const [[exam]] = await db.query(`SELECT * FROM Mock_Exams WHERE id = ?`, [mainId]);
    assert.equal(exam.kind, 'company');
    assert.equal(exam.code, `CO-${mainId}`);
    assert.equal(exam.department, 'COMPANY');
    assert.equal(exam.created_by, ADMIN_EMAIL);

    const [papers] = await db.query(
        `SELECT paper_key, section_name, COUNT(*) AS n FROM Company_Mock_Papers
          WHERE exam_id = ? GROUP BY paper_key, section_name, section_order
          ORDER BY paper_key, section_order`, [mainId]);
    assert.deepEqual(papers.map(p => [p.paper_key, p.section_name, Number(p.n)]), [
        ['CSE', 'Computer Science & Engineering', 20],
        ['EE', 'General Aptitude', 2],
        ['EE', 'Electrical Engineering', 10],
        ['EE', 'Electronics & Communication', 4],
        ['EE', 'Instrumentation Engineering', 4],
        ['ME', 'General Aptitude', 2],
        ['ME', 'Mechanical Engineering', 18]
    ]);

    const [[{ dup }]] = await db.query(
        `SELECT COUNT(*) - COUNT(DISTINCT question_id) AS dup FROM Company_Mock_Papers WHERE exam_id = ? AND paper_key = 'ME'`,
        [mainId]);
    assert.equal(Number(dup), 0, 'no question repeats within a paper');
});

test('company mocks stay out of department-mock screens and HOD exam scope', async () => {
    const dept = await api('GET', '/api/tests/mock', students.me1.token);
    assert.deepEqual(dept.body.exams.map(e => e.code), ['ME']);

    const coverage = await api('GET', '/api/admin/exam-coverage', adminToken);
    assert.equal(coverage.status, 200);
    assert.ok(!JSON.stringify(coverage.body).includes('Acme'), 'coverage excludes company mocks');

    const tests = await api('GET', '/api/admin/tests', adminToken);
    assert.ok(!JSON.stringify(tests.body).includes('Acme'), 'tests tab excludes company mocks');

    const hodTests = await api('GET', '/api/admin/tests', hodToken);
    assert.ok(!JSON.stringify(hodTests.body).includes('Acme'));
});

test('only eligible students see the test, with instructions filled in', async () => {
    const outsider = await api('GET', '/api/tests/company', students.me3.token);
    assert.deepEqual(outsider.body.tests, []);

    const me = await api('GET', '/api/tests/company', students.me1.token);
    assert.equal(me.body.tests.length, 1);
    const t = me.body.tests[0];
    assert.equal(t.state, 'open');
    assert.equal(t.attempts_left, 1);
    assert.match(t.instructions, /^Read carefully\. 20 questions in 60 minutes, closes \d{2} \w{3} \d{4}/);
    assert.doesNotMatch(t.instructions, /\{N\}|\{T\}|\{END\}/);
});

test('start needs the instructions acknowledged, and only for eligible students', async () => {
    const noAck = await api('POST', `/api/tests/mock/${mainId}/start`, students.me1.token, {});
    assert.equal(noAck.status, 400);
    assert.match(noAck.body.message, /instructions/);

    const falseAck = await api('POST', `/api/tests/mock/${mainId}/start`, students.me1.token, { acknowledged: 'yes' });
    assert.equal(falseAck.status, 400);

    const outsider = await api('POST', `/api/tests/mock/${mainId}/start`, students.me3.token, { acknowledged: true });
    assert.equal(outsider.status, 403);

    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM Exam_Attempts WHERE exam_id = ?`, [mainId]);
    assert.equal(n, 0);
});

const attempts = {};

test('students of one department get the same questions in a different order', async () => {
    for (const key of ['me1', 'me2', 'cs']) {
        const res = await api('POST', `/api/tests/mock/${mainId}/start`, students[key].token, { acknowledged: true });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.resumed, false);
        attempts[key] = res.body.attemptId;
    }
    const paper = async key => (await api('GET', `/api/tests/mock/attempt/${attempts[key]}`, students[key].token)).body;
    const p1 = await paper('me1');
    const p2 = await paper('me2');
    const pcs = await paper('cs');

    const ids = p => p.sections.flatMap(s => s.questions.map(q => q.id));
    assert.deepEqual(p1.sections.map(s => s.section_name), ['General Aptitude', 'Mechanical Engineering']);
    assert.equal(ids(p1).length, 20);
    assert.deepEqual([...ids(p1)].sort(), [...ids(p2)].sort(), 'same question set');
    assert.notDeepEqual(ids(p1), ids(p2), 'different order (1 in 18!·2 chance of a false failure)');
    assert.equal(ids(pcs).length, 20);
    assert.equal(ids(pcs).filter(id => ids(p1).includes(id)).length, 0, 'CSE paper is a different paper');

    assert.ok(p1.attempt.seconds_remaining > 3590 && p1.attempt.seconds_remaining <= 3600);
    assert.equal(p1.attempt.max_score, 80);

    const [[row]] = await db.query(`SELECT instructions_accepted_at FROM Exam_Attempts WHERE id = ?`, [attempts.me1]);
    assert.ok(row.instructions_accepted_at, 'acknowledgement is recorded');
});

test('starting again resumes the open attempt', async () => {
    const res = await api('POST', `/api/tests/mock/${mainId}/start`, students.me1.token, {});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { attemptId: attempts.me1, resumed: true });
});

test('a company attempt cannot be abandoned', async () => {
    const res = await api('POST', `/api/tests/mock/attempt/${attempts.me1}/abandon`, students.me1.token);
    assert.equal(res.status, 404);
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM Exam_Attempts WHERE id = ?`, [attempts.me1]);
    assert.equal(n, 1);
});

test('grading uses +4 / -1 and the attempt limit holds', async () => {
    const { body } = await api('GET', `/api/tests/mock/attempt/${attempts.me1}`, students.me1.token);
    const qs = body.sections.flatMap(s => s.questions);
    const answers = {};
    // All correct except: one MCQ wrong, one left blank.
    const mcqs = qs.filter(q => q.question_type === 'MCQ');
    qs.forEach(q => { answers[q.id] = q.question_type === 'MCQ' ? 'A' : '5'; });
    answers[mcqs[0].id] = 'B';
    delete answers[mcqs[1].id];
    const expected = (qs.length - 2) * 4 - 1;

    const sub = await api('POST', `/api/tests/mock/attempt/${attempts.me1}/submit`, students.me1.token, { answers });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal(sub.body.score, expected);
    assert.equal(sub.body.totalWrong, 1);

    const again = await api('POST', `/api/tests/mock/${mainId}/start`, students.me1.token, { acknowledged: true });
    assert.equal(again.status, 403);
    assert.match(again.body.message, /already attempted/);

    const list = await api('GET', '/api/tests/company', students.me1.token);
    const t = list.body.tests[0];
    assert.equal(t.attempts_used, 1);
    assert.equal(t.attempts_left, 0);
    assert.equal(t.best_score, expected);
    assert.equal(t.best_attempt_id, attempts.me1);

    const review = await api('GET', `/api/tests/mock/attempt/${attempts.me1}/review`, students.me1.token);
    assert.equal(review.body.attempt.kind, 'company');
    assert.equal(review.body.attempt.score, expected);
});

test('admin results rank students and the export is a real workbook', async () => {
    const { status, body } = await api('GET', `/api/admin/company-mocks/${mainId}`, adminToken);
    assert.equal(status, 200);
    assert.equal(body.test.has_attempts, true);
    assert.deepEqual(body.test.roll_numbers, ['23110001', '23110002', '23110003', '23110006', '23110007']);
    const byRoll = Object.fromEntries(body.results.map(r => [r.roll_number, r]));
    assert.equal(body.results[0].roll_number, '23110001');
    assert.equal(byRoll['23110001'].rank, 1);
    assert.equal(byRoll['23110001'].status, 'submitted');
    assert.equal(byRoll['23110002'].status, 'in_progress');
    assert.equal(byRoll['23110006'].status, 'not_started');

    const list = await api('GET', '/api/admin/company-mocks', adminToken);
    const row = list.body.tests.find(t => t.id === mainId);
    assert.equal(row.eligible_count, 5);
    assert.equal(row.submitted_count, 1);
    assert.equal(row.state, 'open');

    const xl = await api('GET', `/api/admin/company-mocks/${mainId}/export`, adminToken);
    assert.equal(xl.status, 200);
    assert.match(xl.type, /spreadsheetml/);
    const sheet = XLSX.read(xl.body).Sheets.Results;
    const rows = XLSX.utils.sheet_to_json(sheet);
    assert.equal(rows.length, 5);
    assert.equal(rows[0]['Roll number'], '23110001');
    assert.equal(rows[0].Rank, 1);
});

test('a HOD sees only their own students, read-only', async () => {
    const list = await api('GET', '/api/admin/company-mocks', hodToken);
    assert.equal(list.status, 200);
    const row = list.body.tests.find(t => t.id === mainId);
    assert.equal(row.eligible_count, 2, 'two Mechanical students');

    const detail = await api('GET', `/api/admin/company-mocks/${mainId}`, hodToken);
    assert.deepEqual(detail.body.results.map(r => r.roll_number).sort(), ['23110001', '23110002']);
    assert.equal(detail.body.test.roll_numbers, undefined, 'the full roll list is admin-only');

    const xl = await api('GET', `/api/admin/company-mocks/${mainId}/export`, hodToken);
    assert.equal(XLSX.utils.sheet_to_json(XLSX.read(xl.body).Sheets.Results).length, 2);

    assert.equal((await api('PUT', `/api/admin/company-mocks/${mainId}`, hodToken, {})).status, 403);
    assert.equal((await api('DELETE', `/api/admin/company-mocks/${mainId}`, hodToken)).status, 403);
});

test('after the first attempt, paper settings are locked but other fields can change', async () => {
    const locked = await api('PUT', `/api/admin/company-mocks/${mainId}`, adminToken, { total_questions: 10 });
    assert.equal(locked.status, 409);
    const lockedStart = await api('PUT', `/api/admin/company-mocks/${mainId}`, adminToken, { starts_at: ist(-30) });
    assert.equal(lockedStart.status, 409);

    // Add a Mechanical student (ME paper exists) and change free fields.
    const ok = await api('PUT', `/api/admin/company-mocks/${mainId}`, adminToken, {
        title: 'Acme placement mock (round 1)',
        instructions: 'New rules for {N} questions.',
        max_attempts: 2,
        ends_at: ist(180),
        roll_numbers: '23110001 23110002 23110003 23110006 23110007 23110008'
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.papers_redrawn, false);

    const late = await api('GET', '/api/tests/company', students.me3.token);
    assert.equal(late.body.tests.length, 1);
    assert.equal(late.body.tests[0].instructions, 'New rules for 20 questions.');

    // The raised limit lets me1 sit the same paper again, reshuffled.
    const before = await db.query(
        `SELECT question_id FROM Attempt_Questions WHERE attempt_id = ? ORDER BY question_id`, [attempts.me1]);
    const re = await api('POST', `/api/tests/mock/${mainId}/start`, students.me1.token, { acknowledged: true });
    assert.equal(re.status, 200);
    const [againRows] = await db.query(
        `SELECT question_id FROM Attempt_Questions WHERE attempt_id = ? ORDER BY question_id`, [re.body.attemptId]);
    assert.deepEqual(againRows.map(r => r.question_id), before[0].map(r => r.question_id));
});

test('a test with attempts cannot be deleted', async () => {
    const res = await api('DELETE', `/api/admin/company-mocks/${mainId}`, adminToken);
    assert.equal(res.status, 409);
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM Mock_Exams WHERE id = ?`, [mainId]);
    assert.equal(n, 1);
});

// ── windows ─────────────────────────────────────────────────────────────────

test('a late starter only gets the time left until the end time', async () => {
    const res = await createCompany({
        title: 'Short window', question_source: 'ME', roll_numbers: '23110004',
        starts_at: ist(-30), ends_at: ist(10), duration_minutes: 60
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const start = await api('POST', `/api/tests/mock/${res.body.id}/start`, students.ph.token, { acknowledged: true });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const paper = await api('GET', `/api/tests/mock/attempt/${start.body.attemptId}`, students.ph.token);
    const left = paper.body.attempt.seconds_remaining;
    assert.ok(left > 530 && left <= 600, `seconds_remaining=${left}`);
});

let upcomingId;

test('an upcoming test is listed but cannot be started; a closed one too', async () => {
    const up = await createCompany({ title: 'Next week', roll_numbers: '23110002', starts_at: ist(60 * 24), ends_at: ist(60 * 26) });
    assert.equal(up.status, 201);
    upcomingId = up.body.id;
    const closed = await createCompany({ title: 'Last week', roll_numbers: '23110002', starts_at: ist(-60 * 26), ends_at: ist(-60 * 24) });
    assert.equal(closed.status, 201);

    const list = await api('GET', '/api/tests/company', students.me2.token);
    const states = Object.fromEntries(list.body.tests.map(t => [t.title, t.state]));
    assert.equal(states['Next week'], 'upcoming');
    assert.equal(states['Last week'], 'closed');

    const s1 = await api('POST', `/api/tests/mock/${upcomingId}/start`, students.me2.token, { acknowledged: true });
    assert.equal(s1.status, 403);
    assert.match(s1.body.message, /opens at/);
    const s2 = await api('POST', `/api/tests/mock/${closed.body.id}/start`, students.me2.token, { acknowledged: true });
    assert.equal(s2.status, 403);
    assert.match(s2.body.message, /closed/);
});

test('an inactive test disappears from the student list', async () => {
    const res = await api('PUT', `/api/admin/company-mocks/${upcomingId}`, adminToken, { is_active: false });
    assert.equal(res.status, 200);
    const list = await api('GET', '/api/tests/company', students.me2.token);
    assert.ok(!list.body.tests.some(t => t.id === upcomingId));
});

test('before any attempt, changing the question count redraws the papers', async () => {
    const res = await api('PUT', `/api/admin/company-mocks/${upcomingId}`, adminToken, { total_questions: 10 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.papers_redrawn, true);
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM Company_Mock_Papers WHERE exam_id = ?`, [upcomingId]);
    assert.equal(n, 10);
});

test('a test without attempts can be deleted, with its papers and roll list', async () => {
    const res = await api('DELETE', `/api/admin/company-mocks/${upcomingId}`, adminToken);
    assert.equal(res.status, 200);
    for (const table of ['Mock_Exams', 'Company_Mock_Papers', 'Company_Mock_Eligible']) {
        const col = table === 'Mock_Exams' ? 'id' : 'exam_id';
        const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, [upcomingId]);
        assert.equal(n, 0, table);
    }
});

// ── department mocks unaffected ─────────────────────────────────────────────

test('department mocks still start, resume and abandon as before', async () => {
    const [[meExam]] = await db.query(`SELECT id FROM Mock_Exams WHERE code = 'ME'`);
    const start = await api('POST', `/api/tests/mock/${meExam.id}/start`, students.me3.token, {});
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const paper = await api('GET', `/api/tests/mock/attempt/${start.body.attemptId}`, students.me3.token);
    assert.equal(paper.body.attempt.total_questions, 50);
    assert.ok(paper.body.attempt.seconds_remaining > 5390);
    const abandon = await api('POST', `/api/tests/mock/attempt/${start.body.attemptId}/abandon`, students.me3.token);
    assert.equal(abandon.status, 200);

    const wrongDept = await api('POST', `/api/tests/mock/${meExam.id}/start`, students.cs.token, {});
    assert.equal(wrongDept.status, 403);
});

test('the real question-bank importer never retires company mocks', async () => {
    // Runs database/import_question_bank.js for real against the test DB. It
    // retires every department exam missing from the blueprint; company mocks
    // must come through untouched.
    execFileSync(process.execPath, ['database/import_question_bank.js', '--only=ME'], {
        cwd: ROOT, env: SERVER_ENV, stdio: 'pipe', timeout: 300000
    });
    const [rows] = await db.query(`SELECT kind, COUNT(*) AS n, SUM(is_active) AS active
                                     FROM Mock_Exams GROUP BY kind ORDER BY kind`);
    const byKind = Object.fromEntries(rows.map(r => [r.kind, r]));
    // Main, "Short window" and "Last week" remain ("Next week" was deleted).
    assert.equal(Number(byKind.company.n), 3);
    assert.equal(Number(byKind.company.active), 3);
    const [[main]] = await db.query(`SELECT is_active FROM Mock_Exams WHERE id = ?`, [mainId]);
    assert.equal(main.is_active, 1);
});
