const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Get Messages (Direct or Group)
router.get('/', authenticateToken, async (req, res) => {
    const { userId, groupId } = req.query;
    
    try {
        if (groupId) {
             const result = await db.query(`
                SELECT m.id, m.content, m.timestamp, u.username as sender, m.sender_id, m.read_status
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE m.group_id = $1
                ORDER BY m.timestamp ASC
            `, [groupId]);
            res.json(result.rows);
        } 
        else if (userId) {
            const result = await db.query(`
                SELECT m.id, m.content, m.timestamp, u.username as sender, m.sender_id, m.read_status
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE (m.sender_id = $1 AND m.receiver_id = $2) 
                   OR (m.sender_id = $2 AND m.receiver_id = $1)
                ORDER BY m.timestamp ASC
            `, [req.user.id, userId]);
            res.json(result.rows);
        } 
        else {
            res.status(400).json({ error: 'Missing userId or groupId' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send Message
router.post('/', authenticateToken, async (req, res) => {
    const { receiverId, groupId, content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });
    
    try {
        if (groupId) {
            // Group Message
            const memberCheck = await db.query('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3', [groupId, req.user.id, 'approved']);
            if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Not a member of this group' });

            await db.query('INSERT INTO messages (sender_id, group_id, content) VALUES ($1, $2, $3)', [req.user.id, groupId, content]);
            res.json({ message: 'Sent' });
        } 
        else if (receiverId) {
            // Direct Message
            await db.query('INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3)', [req.user.id, receiverId, content]);
            res.json({ message: 'Sent' });
        }
        else {
            res.status(400).json({ error: 'Missing receiver' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark Read
router.post('/read', authenticateToken, async (req, res) => {
    const { senderId, groupId } = req.body;
    try {
        if (groupId) {
             // In complex apps, we'd track read_by_user logic. For prototype, we might skip or simple update.
             // Postgres update returning is optional but good practice.
             res.json({ message: 'Marked read (group logic placeholder)' });
        } else if (senderId) {
            await db.query('UPDATE messages SET read_status = TRUE WHERE sender_id = $1 AND receiver_id = $2', [senderId, req.user.id]);
            res.json({ message: 'Marked read' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
