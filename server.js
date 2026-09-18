const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
// Support static files for root and subpaths
app.use(express.static('public'));
app.use(['/mock'], express.static('public'));
app.use(['/questions', '/mock/questions'], express.static(path.join(__dirname, 'questions')));

// Import Routes
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const testRoutes = require('./src/routes/testRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

// API Routes (supports direct port 5000, or reverse proxy with/without prefix strip)
app.use(['/api/auth', '/mock/api/auth'], authRoutes);
app.use(['/api/users', '/mock/api/users'], userRoutes);
app.use(['/api/tests', '/mock/api/tests'], testRoutes);
app.use(['/api/admin', '/mock/api/admin'], adminRoutes);

// Database Initialization Check (from config)
require('./src/config/db');

// Health check route
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'CDS Portal API is running' });
});

// Serve the Admin Dashboard SPA for /admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
