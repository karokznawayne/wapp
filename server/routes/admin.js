const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// Get All Users
router.get('/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, role, mfa_enabled FROM users');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Dashboard Stats
router.get('/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const users = await db.query('SELECT COUNT(*) as count FROM users');
        const groups = await db.query('SELECT COUNT(*) as count FROM groups');
        const messages = await db.query('SELECT COUNT(*) as count FROM messages');

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
