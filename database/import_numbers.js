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

async function importNumbers() {
    let connection;
    try {
        console.log('Reading .numbers file...');
        const filePath = path.join(__dirname, '../questions/mechanical/gate_mechanical_template.numbers');
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // Ensure 1/2 is not parsed as 0.5 or a date, and read strictly as the formatted string 
        const rows = XLSX.utils.sheet_to_json(sheet, { raw: false });
        console.log(`Parsed ${rows.length} rows from Numbers document.`);

        if (rows.length === 0) {
            console.log('The Numbers file appears to be empty. Ensure you saved data in the first sheet.');
            return;
        }

        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        // Dynamically get the testId from the first parsed row, or default to 5.
        const TARGET_TEST_ID = parseInt(rows[0]['testid']) || 5;

        // Force exactly 30 questions and a 60-minute duration as requested
        const [tests] = await connection.query('SELECT id FROM Tests WHERE id = ?', [TARGET_TEST_ID]);
        if (tests.length === 0) {
            await connection.query(
                'INSERT INTO Tests (id, title, duration_minutes, total_questions) VALUES (?, ?, ?, ?)',
                [TARGET_TEST_ID, `Section Wise Test - ${TARGET_TEST_ID}`, 60, 30]
            );
            console.log(`Created new Test ID ${TARGET_TEST_ID}`);
        } else {
            await connection.query('UPDATE Tests SET duration_minutes = 60, total_questions = 30 WHERE id = ?', [TARGET_TEST_ID]);
        }

        // Wipe existing questions on this specific test ID to prevent duplicates if ran multiple times
        await connection.query('DELETE FROM Questions WHERE test_id = ?', [TARGET_TEST_ID]);

        const sectionMap = {};

        for (const row of rows) {
            // Read specific mapped columns detailed by user - fallbacks for different syntaxes
            const section_name = row['section']?.trim() || row['section_name']?.trim() || 'Default Section';
            const integer_ans = row['integer_ans']?.toString().trim() || row['int_ans']?.toString().trim() || row['integer based answer']?.toString().trim() || null;

            // Core rule: If integer_ans exists, it's NAT, otherwise MCQ.
            const question_type = integer_ans ? 'NAT' : 'MCQ';

            const questionText = row['question_text']?.trim() || row['question']?.trim() || '';
            let rawImageUrl = row['question_img']?.trim() || row['image_url']?.trim() || row['question image(if there is can be null)']?.trim() || null;
            let imageUrl = rawImageUrl;
            if (imageUrl) {
                imageUrl = imageUrl.replace(/\/images\/mech-gate\//g, '/questions/mechanical/images/');
                imageUrl = imageUrl.replace(/\/mech-gate\//g, '/questions/mechanical/images/');
                if (!imageUrl.startsWith('/questions/mechanical/images/')) {
                    const filename = path.basename(imageUrl);
                    imageUrl = `/questions/mechanical/images/${filename}`;
                }
                if (!imageUrl.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
                    imageUrl += '.png';
                }
            }

            // Skip totally empty artifact rows
            if (!questionText && !imageUrl) continue;

            // Hardcode grading rules for this module
            const marks = parseFloat(row['marks']) || parseFloat(row['Marks']) || 4;
            const negative_marks = parseFloat(row['negative_marks']) || parseFloat(row['Negative_Marks']) || 1;

            let correctAnswer;
            if (question_type === 'NAT') {
                correctAnswer = integer_ans;
            } else {
                correctAnswer = (row['correct answer']?.toString() || row['correct_answer']?.toString() || row['correct answer (for mcq)']?.toString() || 'A').trim().toUpperCase();
            }

            // Options mapping (only matters for MCQ)
            const options = {};
            if (question_type === 'MCQ') {
                const optA = row['option a'] || row['option_a'];
                const optB = row['option b'] || row['option_b'] || row['b'];
                const optC = row['option c'] || row['option_c'] || row['c'];
                const optD = row['option d'] || row['option_d'] || row['d'];

                if (optA?.toString().trim()) options['A'] = optA.toString().trim();
                if (optB?.toString().trim()) options['B'] = optB.toString().trim();
                if (optC?.toString().trim()) options['C'] = optC.toString().trim();
                if (optD?.toString().trim()) options['D'] = optD.toString().trim();
            }

            // Section Handling
            let section_id = sectionMap[section_name];
            if (!section_id) {
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

        console.log('✅ Exam Import finished successfully!');
        process.exit(0);

    } catch (err) {
        console.error('❌ Error during import:', err);
        process.exit(1);
    }
}

importNumbers();
