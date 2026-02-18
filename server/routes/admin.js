const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Middleware to check admin role
const isAdmin = async (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    next();
};

router.use(authenticateToken, isAdmin);

// Dashboard Stats
router.get('/stats', async (req, res) => {
    try {
        const users = await db.query('SELECT COUNT(*) as count FROM users');
        const groups = await db.query('SELECT COUNT(*) as count FROM groups');
        const messages = await db.query('SELECT COUNT(*) as count FROM messages');
        
        // Postgres returns count as string (bigint), parse it
        res.json({
            users: parseInt(users.rows[0].count),
            groups: parseInt(groups.rows[0].count),
            messages: parseInt(messages.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
