const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, role, mfa_enabled FROM users WHERE id = $1', [req.user.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search users
router.get('/search', authenticateToken, async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    try {
        const result = await db.query('SELECT id, username FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 10', [`%${q}%`, req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send Friend Request
router.post('/friends/request', authenticateToken, async (req, res) => {
    const { targetUserId } = req.body;
    try {
        await db.query('INSERT INTO friendships (user_id_1, user_id_2, status) VALUES ($1, $2, $3)',
            [req.user.id, targetUserId, 'pending']
        );
        res.json({ message: 'Friend request sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List Friends (with last message + unread count)
router.get('/friends', authenticateToken, async (req, res) => {
    const myId = req.user.id;
    try {
        const sql = `
            SELECT 
                u.id, 
                u.username, 
                f.status, 
                f.user_id_1 as user1_id, 
                f.user_id_2 as user2_id, 
                f.id as friendship_id,
                (SELECT content FROM messages m WHERE (m.sender_id = u.id AND m.receiver_id = $1) OR (m.sender_id = $1 AND m.receiver_id = u.id) ORDER BY m.timestamp DESC LIMIT 1) as last_message,
                (SELECT timestamp FROM messages m WHERE (m.sender_id = u.id AND m.receiver_id = $1) OR (m.sender_id = $1 AND m.receiver_id = u.id) ORDER BY m.timestamp DESC LIMIT 1) as last_message_time,
                (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.receiver_id = $1 AND m.read_status = FALSE) as unread_count
            FROM friendships f
            JOIN users u ON (u.id = f.user_id_1 OR u.id = f.user_id_2)
            WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1) AND u.id != $1
        `;
        const result = await db.query(sql, [myId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Accept Friend Request
router.post('/friends/accept', authenticateToken, async (req, res) => {
    const { friendshipId } = req.body;
    try {
        await db.query('UPDATE friendships SET status = $1 WHERE id = $2 AND user_id_2 = $3',
            ['accepted', friendshipId, req.user.id]
        );
        res.json({ message: 'Friend request accepted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
