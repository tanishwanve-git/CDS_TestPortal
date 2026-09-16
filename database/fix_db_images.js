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

async function fixImages() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        const [questions] = await connection.query('SELECT id, image_url, options FROM Questions');

        for (const q of questions) {
            let updated = false;
            let newImageUrl = q.image_url;
            let newOptions = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || {});

            const fixString = (str) => {
                if (!str) return str;
                let s = str;
                if (s.includes('mech-gate') || s.includes('images')) {
                    s = s.replace(/\/images\/mech-gate\//g, '/questions/mechanical/images/');
                    s = s.replace(/\/mech-gate\//g, '/questions/mechanical/images/');
                    if (!s.startsWith('/questions/mechanical/images/')) {
                        const filename = path.basename(s);
                        s = `/questions/mechanical/images/${filename}`;
                    }
                    // Add .png extension if missing
                    if (!s.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
                        s += '.png';
                    }
                }
                return s;
            };

            // Fix main image
            const originalImageUrl = q.image_url;
            newImageUrl = fixString(newImageUrl);
            if (newImageUrl !== originalImageUrl) updated = true;

            // Fix options
            for (const key of Object.keys(newOptions)) {
                const originalOpt = newOptions[key];
                const fixedOpt = fixString(originalOpt);
                if (fixedOpt !== originalOpt) {
                    newOptions[key] = fixedOpt;
                    updated = true;
                }
            }

            if (updated) {
                await connection.query(
                    'UPDATE Questions SET image_url = ?, options = ? WHERE id = ?',
                    [newImageUrl, JSON.stringify(newOptions), q.id]
                );
                console.log(`Fixed images for Question ID ${q.id}`);
            }
        }

        console.log('✅ All images correctly mapped to paths like /mech-gate/img1.png');
    } catch (err) {
        console.error('❌ Error during database alter:', err);
    } finally {
        if (connection) await connection.end();
    }
}

fixImages();
