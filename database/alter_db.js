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

async function alterDb() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        // Check if columns exist first by trying to alter.
        // If it fails with duplicate column, it means they already exist.
        try {
            await connection.query("ALTER TABLE Questions ADD COLUMN question_type VARCHAR(20) DEFAULT 'MCQ', ADD COLUMN marks FLOAT DEFAULT 4, ADD COLUMN negative_marks FLOAT DEFAULT 1;");
            console.log('✅ Added question_type, marks, and negative_marks to Questions table.');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('✅ Columns already exist in the Questions table.');
            } else {
                throw e;
            }
        }
    } catch (err) {
        console.error('❌ Error during database alter:', err);
    } finally {
        if (connection) await connection.end();
    }
}

alterDb();
