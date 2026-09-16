const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cds_portal',
    port: process.env.DB_PORT || 3306
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
        )`
    ];

    for (let query of tableQueries) {
        await pool.query(query);
    }
    console.log('✅ Base Database Tables Initialized');
}

module.exports = createPool();
