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

async function seed() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        // Insert new dummy test
        const [testRes] = await connection.query(
            "INSERT INTO Tests (title, duration_minutes, total_questions) VALUES ('GATE Mechanical Mock 2026', 180, 30)"
        );
        const testId = testRes.insertId;

        // Create 2 sections
        const [sec1Res] = await connection.query(
            "INSERT INTO Test_Sections (test_id, section_name, duration_minutes) VALUES (?, 'Engineering Math', 60)", [testId]
        );
        const sec1Id = sec1Res.insertId;

        const [sec2Res] = await connection.query(
            "INSERT INTO Test_Sections (test_id, section_name, duration_minutes) VALUES (?, 'Core Mechanics', 120)", [testId]
        );
        const sec2Id = sec2Res.insertId;

        console.log(`Created test ${testId} with sections ${sec1Id} and ${sec2Id}. Adding 35 questions...`);

        // Insert 35 questions (15 in sect1, 20 in sect2)
        for (let i = 1; i <= 35; i++) {
            const secId = i <= 15 ? sec1Id : sec2Id;
            const qtext = `GATE Question ${i}: What is the value of X?`;
            const options = JSON.stringify({ A: "10", B: "20", C: "30", D: "40" });
            const correct = ["A", "B", "C", "D"][i % 4];

            await connection.query(
                `INSERT INTO Questions (test_id, section_id, question_text, options, correct_answer) 
                 VALUES (?, ?, ?, ?, ?)`,
                [testId, secId, qtext, options, correct]
            );
        }

        console.log('✅ 35 GATE Mechanical questions seeded successfully!');

    } catch (err) {
        console.error('❌ Error during seed:', err);
    } finally {
        if (connection) await connection.end();
    }
}

seed();
