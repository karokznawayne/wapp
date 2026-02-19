const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken, isAdmin } = require('../middleware/auth');

// Get All Users
router.get('/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, role, mfa_enabled, is_online, last_seen FROM users ORDER BY id');
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
        const messages = await db.query('SELECT COUNT(*) as count FROM messages WHERE deleted = FALSE');
        const online = await db.query("SELECT COUNT(*) as count FROM users WHERE is_online = TRUE AND last_seen > NOW() - INTERVAL '5 minutes'");

        res.json({
            users: parseInt(users.rows[0].count),
            groups: parseInt(groups.rows[0].count),
            messages: parseInt(messages.rows[0].count),
            online: parseInt(online.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ban user (set role to 'banned')
router.post('/ban', authenticateToken, isAdmin, async (req, res) => {
    const { userId } = req.body;
    try {
        await db.query("UPDATE users SET role = 'banned' WHERE id = $1 AND role != 'admin'", [userId]);
        res.json({ message: 'User banned' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Unban user
router.post('/unban', authenticateToken, isAdmin, async (req, res) => {
    const { userId } = req.body;
    try {
        await db.query("UPDATE users SET role = 'user' WHERE id = $1 AND role = 'banned'", [userId]);
        res.json({ message: 'User unbanned' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin delete message
router.delete('/message/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        await db.query("UPDATE messages SET deleted = TRUE, deleted_for_everyone = TRUE, content = '🚫 Removed by admin' WHERE id = $1", [req.params.id]);
        res.json({ message: 'Message removed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
