const XLSX = require('xlsx');
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cds_portal',
    port: process.env.DB_PORT || 3306
};

// Default test details. Change these as needed.
const TARGET_TEST_ID = 5; // A new ID for the Gate Mechanical test
const TEST_TITLE = 'GATE Mechanical Custom Test';
const TEST_DURATION = 180; // minutes

async function importExcel() {
    let connection;
    try {
        console.log('Reading Excel file...');
        const filePath = path.join(__dirname, '../questions/mechanical/gate_mechanical_template.xlsx');
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const rows = XLSX.utils.sheet_to_json(sheet);
        console.log(`Parsed ${rows.length} rows from Excel. Note: empty templates show 0 rows.`);

        if (rows.length === 0) {
            console.log('The Excel file is empty. Please add some questions first.');
            return;
        }

        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        // Create or Update Test entry
        const [tests] = await connection.query('SELECT id FROM Tests WHERE id = ?', [TARGET_TEST_ID]);
        if (tests.length === 0) {
            await connection.query(
                'INSERT INTO Tests (id, title, duration_minutes, total_questions) VALUES (?, ?, ?, ?)',
                [TARGET_TEST_ID, TEST_TITLE, TEST_DURATION, rows.length]
            );
            console.log(`Created new Test ID ${TARGET_TEST_ID}`);
        } else {
            await connection.query('UPDATE Tests SET total_questions = ? WHERE id = ?', [rows.length, TARGET_TEST_ID]);
        }

        const sectionMap = {};

        for (const row of rows) {
            const section_name = row['section']?.trim() || 'Default Section';
            const question_type = row['type']?.trim().toUpperCase() === 'NAT' ? 'NAT' : 'MCQ';
            const marks = parseFloat(row['marks']) || 4;
            const negative_marks = parseFloat(row['negative_marks']) || 1;

            const questionText = row['question']?.trim();
            if (!questionText) continue; // Skip empty rows

            const imageUrl = row['question image(if there is can be null)']?.trim() || null;

            let correctAnswer;
            if (question_type === 'NAT') {
                correctAnswer = row['integer based answer']?.toString().trim();
            } else {
                correctAnswer = row['correct answer (for mcq)']?.toString().trim().toUpperCase();
            }

            // Options mapping
            const options = {};
            if (question_type === 'MCQ') {
                if (row['option a']?.toString().trim()) options['A'] = row['option a'].toString().trim();
                if (row['option b']?.toString().trim()) options['B'] = row['option b'].toString().trim();
                if (row['option c']?.toString().trim()) options['C'] = row['option c'].toString().trim();
                if (row['option d']?.toString().trim()) options['D'] = row['option d'].toString().trim();
            }

            // Section Handling
            let section_id = sectionMap[section_name];
            if (!section_id) {
                // Check DB
                const [secRows] = await connection.query(
                    'SELECT id FROM Test_Sections WHERE test_id = ? AND section_name = ?',
                    [TARGET_TEST_ID, section_name]
                );
                if (secRows.length > 0) {
                    section_id = secRows[0].id;
                } else {
                    const [insertRes] = await connection.query(
                        'INSERT INTO Test_Sections (test_id, section_name, duration_minutes) VALUES (?, ?, 60)',
                        [TARGET_TEST_ID, section_name]
                    );
                    section_id = insertRes.insertId;
                    console.log(`Created new section: ${section_name} (ID: ${section_id})`);
                }
                sectionMap[section_name] = section_id;
            }

            await connection.query(
                `INSERT INTO Questions 
                (test_id, section_id, question_text, image_url, options, correct_answer, question_type, marks, negative_marks) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [TARGET_TEST_ID, section_id, questionText, imageUrl, JSON.stringify(options), correctAnswer, question_type, marks, negative_marks]
            );
        }

        console.log('✅ Excel Import finished successfully!');

    } catch (err) {
        console.error('❌ Error during import:', err);
    } finally {
        if (connection) await connection.end();
    }
}

importExcel();
