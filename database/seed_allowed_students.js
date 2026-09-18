const fs = require('fs');
const path = require('path');
const getPool = require('../src/config/db');

async function seed() {
    try {
        console.log('Connecting to DB and initializing tables...');
        const pool = await getPool;

        const sqlFilePath = path.join(__dirname, '..', 'seed_students.sql');
        const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

        // Split by newlines, ignoring comments and empty lines
        const lines = sqlContent.split('\n');
        let count = 0;

        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('INSERT INTO allowed_students')) {
                await pool.query(line);
                count++;
            }
        }

        console.log(`✅ Successfully inserted/updated ${count} records in allowed_students table.`);

        // Verify count
        const [rows] = await pool.query('SELECT COUNT(*) as total FROM allowed_students');
        console.log(`📊 Total records in allowed_students table: ${rows[0].total}`);

        process.exit(0);
    } catch (err) {
        console.error('❌ Database seeding error:', err);
        process.exit(1);
    }
}

seed();
