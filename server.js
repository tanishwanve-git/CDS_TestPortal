const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend static files
app.use('/questions', express.static(path.join(__dirname, 'questions'))); // Serve question assets

// Import Routes
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const testRoutes = require('./src/routes/testRoutes');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tests', testRoutes);

// Database Initialization Check (from config)
require('./src/config/db');

// Health check route
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'CDS Portal API is running' });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
