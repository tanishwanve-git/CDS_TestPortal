const fs = require('fs');
const csv = require('csv-parser');
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

const TARGET_TEST_ID = 6;
const TEST_TITLE = 'GATE Computer Science & Engineering';
const TEST_DURATION = 180; // 180 minutes
const TOTAL_QUESTIONS_PER_TEST = 50; // Select 50 random questions per test

async function importCS() {
    let connection;
    try {
        console.log('Reading CS CSV template...');
        const csvFilePath = path.join(__dirname, '../questions/cs/gate_cs_template.csv');
        const rows = [];

        await new Promise((resolve, reject) => {
            fs.createReadStream(csvFilePath)
                .pipe(csv())
                .on('data', (data) => rows.push(data))
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`Parsed ${rows.length} questions from CS CSV template.`);

        if (rows.length === 0) {
            console.log('CS CSV file is empty.');
            return;
        }

        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        // Create or Update Test 6
        const [tests] = await connection.query('SELECT id FROM Tests WHERE id = ?', [TARGET_TEST_ID]);
        if (tests.length === 0) {
            await connection.query(
                'INSERT INTO Tests (id, title, duration_minutes, total_questions) VALUES (?, ?, ?, ?)',
                [TARGET_TEST_ID, TEST_TITLE, TEST_DURATION, TOTAL_QUESTIONS_PER_TEST]
            );
            console.log(`Created new Test ID ${TARGET_TEST_ID}: ${TEST_TITLE}`);
        } else {
            await connection.query(
                'UPDATE Tests SET title = ?, duration_minutes = ?, total_questions = ? WHERE id = ?',
                [TEST_TITLE, TEST_DURATION, TOTAL_QUESTIONS_PER_TEST, TARGET_TEST_ID]
            );
            console.log(`Updated Test ID ${TARGET_TEST_ID}`);
        }

        // Wipe existing questions for Test 6 to prevent duplicates
        await connection.query('DELETE FROM Questions WHERE test_id = ?', [TARGET_TEST_ID]);

        // Section handling
        const sectionName = 'Computer Science & Engineering';
        let sectionId;
        const [secRows] = await connection.query(
            'SELECT id FROM Test_Sections WHERE test_id = ? AND section_name = ?',
            [TARGET_TEST_ID, sectionName]
        );
        if (secRows.length > 0) {
            sectionId = secRows[0].id;
        } else {
            const [insertRes] = await connection.query(
                'INSERT INTO Test_Sections (test_id, section_name, duration_minutes) VALUES (?, ?, ?)',
                [TARGET_TEST_ID, sectionName, TEST_DURATION]
            );
            sectionId = insertRes.insertId;
        }

        // Batch insert questions
        for (const row of rows) {
            const questionText = row.question_text?.trim();
            if (!questionText) continue;

            const questionType = row.type?.trim().toUpperCase() === 'NAT' ? 'NAT' : 'MCQ';
            const marks = parseFloat(row.marks) || 4;
            const negativeMarks = parseFloat(row.negative_marks) || 0;
            const imageUrl = row.image_url?.trim() || null;
            const correctAnswer = row.correct_answer?.trim() || 'A';

            const options = {};
            if (questionType === 'MCQ') {
                if (row.option_a?.trim()) options['A'] = row.option_a.trim();
                if (row.option_b?.trim()) options['B'] = row.option_b.trim();
                if (row.option_c?.trim()) options['C'] = row.option_c.trim();
                if (row.option_d?.trim()) options['D'] = row.option_d.trim();
            }

            await connection.query(
                `INSERT INTO Questions 
                (test_id, section_id, question_text, image_url, options, correct_answer, question_type, marks, negative_marks) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [TARGET_TEST_ID, sectionId, questionText, imageUrl, JSON.stringify(options), correctAnswer, questionType, marks, negativeMarks]
            );
        }

        console.log(`✅ CS Quiz Import finished successfully! ${rows.length} questions imported for Test ID ${TARGET_TEST_ID}.`);

    } catch (err) {
        console.error('❌ Error during CS import:', err);
    } finally {
        if (connection) await connection.end();
    }
}

importCS();
