const mysql = require('mysql2/promise');
require('dotenv').config();

// This deployment always runs in India (Asia/Kolkata, UTC+5:30). Pinning the
// timezone explicitly here — rather than relying on the app server's and the
// MySQL server's OS-level clocks happening to agree — is what actually fixes
// timestamps for good. Without this, mysql2 defaults to `timezone: 'local'`,
// which parses every DATETIME/TIMESTAMP string MySQL returns as if it were in
// Node's own local timezone, while MySQL itself writes/reads those columns in
// whatever timezone its session happens to be in (normally the OS default,
// SYSTEM, unless set otherwise). When those two don't actually agree — an app
// server left on UTC while "the deployment" is meant to be IST is an easy way
// for that to happen unnoticed — every stored timestamp (exam start time,
// submission time, registration time, etc.) comes out wrong by the offset
// between them. mockController.js has a whole historical note about exactly
// this biting the exam countdown clock; `submitted_at`/`created_at` had the
// same latent bug, just never manifesting as visibly as a dead countdown.
//
// Fixing it here, once, for every timestamp column, beats patching one field
// at a time with a `UNIX_TIMESTAMP(...)` workaround (see mockController.js's
// `started_at_ms`) every time a new date column is added.
const TZ_OFFSET = '+05:30'; // Asia/Kolkata

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cds_portal',
    port: process.env.DB_PORT || 3306,
    // Tells mysql2 to treat every DATETIME/TIMESTAMP string it reads or
    // writes as Asia/Kolkata wall-clock time, instead of guessing from
    // Node's own process timezone.
    timezone: TZ_OFFSET
};

async function createPool() {
    try {
        // First connect without database to ensure it exists
        const connection = await mysql.createConnection({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password,
            port: dbConfig.port
        });

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\`;`);
        await connection.end();

        // Now create full pool
        const pool = mysql.createPool({
            ...dbConfig,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // The `timezone` option above only controls how the Node driver
        // parses/formats dates on the client side. MySQL's own NOW() /
        // CURRENT_TIMESTAMP, and its internal UTC<->session conversion for
        // TIMESTAMP columns, are governed by the *session's* `time_zone`
        // variable — which defaults to the server's OS timezone (SYSTEM) and
        // is otherwise unrelated to anything Node does. Pin every pooled
        // connection's session to the same offset so the two layers can
        // never disagree, regardless of what the underlying OS is set to.
        // NOTE: the 'connection' event hands us the underlying callback-style
        // Connection (not the promise-wrapped one this file otherwise uses),
        // so this must be a callback, not `await`/`.then`.
        pool.on('connection', (conn) => {
            conn.query(`SET time_zone = '${TZ_OFFSET}';`, (err) => {
                if (err) console.error('Could not set session time_zone on a new DB connection:', err);
            });
        });

        // Test connection
        await pool.query('SELECT 1');
        console.log('✅ Connected to MySQL Database');

        // Initialize tables
        await initTables(pool);

        return pool;
    } catch (err) {
        console.error('❌ Database connection failed:', err);
        process.exit(1);
    }
}

async function initTables(pool) {
    const tableQueries = [
        `CREATE TABLE IF NOT EXISTS Students (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            roll_number VARCHAR(50) UNIQUE,
            branch VARCHAR(100),
            password_hash VARCHAR(255),
            google_id VARCHAR(255) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS Tests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            duration_minutes INT NOT NULL,
            total_questions INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS Test_Sections (
            id INT AUTO_INCREMENT PRIMARY KEY,
            test_id INT NOT NULL,
            section_name VARCHAR(255) NOT NULL,
            duration_minutes INT NOT NULL,
            FOREIGN KEY (test_id) REFERENCES Tests(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS Questions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            test_id INT NOT NULL,
            section_id INT,
            question_text TEXT NOT NULL,
            image_url VARCHAR(1024),
            options JSON NOT NULL,
            correct_answer VARCHAR(255) NOT NULL,
            question_type VARCHAR(10) NOT NULL DEFAULT 'MCQ',
            marks DECIMAL(5,2) NOT NULL DEFAULT 4,
            negative_marks DECIMAL(5,2) NOT NULL DEFAULT 1,
            FOREIGN KEY (test_id) REFERENCES Tests(id) ON DELETE CASCADE,
            FOREIGN KEY (section_id) REFERENCES Test_Sections(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS Test_Results (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            test_id INT NOT NULL,
            score INT NOT NULL,
            time_taken_seconds INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES Students(id) ON DELETE CASCADE,
            FOREIGN KEY (test_id) REFERENCES Tests(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS Test_Result_Answers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            result_id INT NOT NULL,
            answers JSON NOT NULL,
            FOREIGN KEY (result_id) REFERENCES Test_Results(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS Password_Reset_OTPs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            otp_hash VARCHAR(255) NOT NULL,
            expires_at DATETIME NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_email (email)
        )`,
        `CREATE TABLE IF NOT EXISTS allowed_students (
            id INT AUTO_INCREMENT PRIMARY KEY,
            roll_number VARCHAR(50) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            programme VARCHAR(100) NOT NULL,
            discipline VARCHAR(100) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS Test_Violations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            test_id INT NOT NULL,
            result_id INT,
            violation_type VARCHAR(100) NOT NULL DEFAULT 'tab_switch',
            violation_count INT NOT NULL DEFAULT 1,
            auto_submitted TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES Students(id) ON DELETE CASCADE,
            FOREIGN KEY (test_id) REFERENCES Tests(id) ON DELETE CASCADE
        )`,
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
        )`,
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
        )`,
        `CREATE TABLE IF NOT EXISTS Mock_Exam_Sections (
            id INT AUTO_INCREMENT PRIMARY KEY,
            exam_id INT NOT NULL,
            section_name VARCHAR(150) NOT NULL,
            source_department VARCHAR(20) NULL,
            source_sections TEXT NULL,
            question_count INT NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            FOREIGN KEY (exam_id) REFERENCES Mock_Exams(id) ON DELETE CASCADE
        )`,
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
        )`,
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
        )`,
        // Heads of department. `department` holds an allowed_students.discipline
        // value — that is what scopes a HOD's console to their own students. One
        // person can head several departments (one row each), and a department
        // can have more than one head.
        `CREATE TABLE IF NOT EXISTS department_heads (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            department VARCHAR(100) NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            last_login_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_head_department (email, department),
            KEY idx_head_email (email)
        )`
    ];

    for (let query of tableQueries) {
        await pool.query(query);
    }

    // Mock-exam attempts have no row in Tests, so the proctoring log has to accept
    // a NULL test_id and point at the attempt instead. Both statements are
    // no-ops once applied.
    try {
        await pool.query('ALTER TABLE Test_Violations MODIFY COLUMN test_id INT NULL;');
    } catch (e) { /* already nullable */ }
    try {
        await pool.query('ALTER TABLE Test_Violations ADD COLUMN attempt_id INT NULL;');
    } catch (e) { /* column already exists */ }

    // Lets a mock-exam section draw from another department's bank. NULL keeps
    // the old behaviour of drawing from the exam's own department.
    try {
        await pool.query('ALTER TABLE Mock_Exam_Sections ADD COLUMN source_department VARCHAR(20) NULL AFTER section_name;');
    } catch (e) { /* column already exists */ }

    // A dual-major student's second department. They see the mock tests of both,
    // and the heads of both see them. NULL for everyone else.
    try {
        await pool.query('ALTER TABLE allowed_students ADD COLUMN secondary_discipline VARCHAR(100) NULL AFTER discipline;');
    } catch (e) { /* column already exists */ }

    // Ensure programme & discipline exist on Students table if used
    try {
        await pool.query(`ALTER TABLE Students ADD COLUMN programme VARCHAR(100) NULL, ADD COLUMN discipline VARCHAR(100) NULL;`);
    } catch (e) {
        // Ignored if columns already exist
    }

    console.log('✅ Database tables (portal + question bank + mock attempts) initialized');
}

module.exports = createPool();
