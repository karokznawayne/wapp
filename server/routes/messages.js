const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Send Message
router.post('/', authenticateToken, async (req, res) => {
    const { receiverId, groupId, content } = req.body;

    if (!content) return res.status(400).json({ error: 'Content required' });

    try {
        const result = await db.query(
            'INSERT INTO messages (sender_id, receiver_id, group_id, content, read_status) VALUES ($1, $2, $3, $4, FALSE) RETURNING id, timestamp, read_status',
            [req.user.id, receiverId || null, groupId || null, content]
        );
        const row = result.rows[0];
        res.json({ id: row.id, timestamp: row.timestamp, is_read: row.read_status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Messages
router.get('/', authenticateToken, async (req, res) => {
    const { userId, groupId } = req.query;

    try {
        let sql = `
            SELECT m.id, m.content, m.timestamp, m.read_status as is_read, u.username as sender, m.sender_id
            FROM messages m
            JOIN users u ON m.sender_id = u.id
        `;
        let params = [];

        if (groupId) {
            sql += ` WHERE m.group_id = $1 ORDER BY m.timestamp ASC`;
            params = [groupId];
        } else if (userId) {
            sql += ` WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1) ORDER BY m.timestamp ASC`;
            params = [req.user.id, userId];
        } else {
            return res.status(400).json({ error: 'UserId or GroupId required' });
        }

        const result = await db.query(sql, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark messages as read
router.post('/read', authenticateToken, async (req, res) => {
    const { senderId, groupId } = req.body;

    if (groupId) {
        return res.json({ message: 'Group read status placeholder' });
    } else if (senderId) {
        try {
            await db.query('UPDATE messages SET read_status = TRUE WHERE sender_id = $1 AND receiver_id = $2',
                [senderId, req.user.id]
            );
            res.json({ message: 'Messages marked read' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    } else {
        res.status(400).json({ error: 'SenderId or GroupId required' });
    }
});

module.exports = router;
