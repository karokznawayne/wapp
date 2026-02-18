const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Search Users
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
    const { userId } = req.body;
    
    try {
        // Check if exists
        const check = await db.query(
            'SELECT * FROM friendships WHERE (user_id_1 = $1 AND user_id_2 = $2) OR (user_id_1 = $2 AND user_id_2 = $1)',
            [req.user.id, userId]
        );
        
        if (check.rows.length > 0) return res.status(400).json({ error: 'Friend request already sent or exists' });

        await db.query(
            'INSERT INTO friendships (user_id_1, user_id_2, status) VALUES ($1, $2, $3)',
            [req.user.id, userId, 'pending']
        );
        res.json({ message: 'Friend request sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List Friends
router.get('/friends', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT f.id, u.username, u.id as friend_id, f.status,
            CASE WHEN f.user_id_1 = $1 THEN 'sent' ELSE 'received' END as direction
            FROM friendships f
            JOIN users u ON (u.id = f.user_id_1 OR u.id = f.user_id_2)
            WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1) AND u.id != $1
        `, [req.user.id]);
        
        const friends = result.rows.map(r => ({
            id: r.friend_id,
            friendshipId: r.id,
            username: r.username,
            status: r.status,
            direction: r.direction
        }));
        res.json(friends);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Accept Friend Request
router.post('/friends/accept', authenticateToken, async (req, res) => {
    const { friendshipId } = req.body;
    try {
        await db.query('UPDATE friendships SET status = $1 WHERE id = $2', ['accepted', friendshipId]);
        res.json({ message: 'Friend request accepted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
