const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Send Message (with multimedia support)
router.post('/', authenticateToken, async (req, res) => {
    const { receiverId, groupId, content, replyToId, messageType, mediaUrl } = req.body;

    if (!content && !mediaUrl) return res.status(400).json({ error: 'Content or Media required' });

    try {
        const result = await db.query(
            'INSERT INTO messages (sender_id, receiver_id, group_id, content, read_status, reply_to_id, message_type, media_url) VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7) RETURNING id, timestamp, read_status',
            [req.user.id, receiverId || null, groupId || null, content || '', replyToId || null, messageType || 'text', mediaUrl || null]
        );
        const row = result.rows[0];

        // Clear typing indicator
        if (receiverId) {
            await db.query('DELETE FROM typing_status WHERE user_id = $1 AND chat_type = $2 AND chat_id = $3', [req.user.id, 'user', receiverId]);
        } else if (groupId) {
            await db.query('DELETE FROM typing_status WHERE user_id = $1 AND chat_type = $2 AND chat_id = $3', [req.user.id, 'group', groupId]);
        }

        res.json({ id: row.id, timestamp: row.timestamp, is_read: row.read_status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Messages (with multimedia fields)
router.get('/', authenticateToken, async (req, res) => {
    const { userId, groupId } = req.query;

    try {
        let sql = `
            SELECT m.id, m.content, m.timestamp, m.read_status as is_read, 
                   m.sender_id, u.username as sender, m.deleted, m.deleted_for_everyone,
                   m.reply_to_id, m.message_type, m.media_url,
                   rm.content as reply_content, ru.username as reply_sender,
                   (SELECT json_build_object(
                       'id', p.id, 
                       'question', p.question, 
                       'options', (
                           SELECT json_agg(json_build_object(
                               'id', po.id, 
                               'text', po.option_text, 
                               'votes', (SELECT COUNT(*) FROM poll_votes WHERE option_id = po.id),
                               'voted', EXISTS(SELECT 1 FROM poll_votes WHERE option_id = po.id AND user_id = $1)
                           )) FROM poll_options po WHERE po.poll_id = p.id
                       )
                   ) FROM polls p WHERE p.message_id = m.id) as poll_data,
                   COALESCE(
                       (SELECT json_agg(json_build_object('emoji', r.emoji, 'username', ru2.username, 'user_id', r.user_id))
                        FROM reactions r JOIN users ru2 ON ru2.id = r.user_id WHERE r.message_id = m.id), '[]'
                   ) as reactions
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            LEFT JOIN messages rm ON m.reply_to_id = rm.id
            LEFT JOIN users ru ON rm.sender_id = ru.id
        `;
        let params = [];

        if (groupId) {
            sql += ` WHERE m.group_id = $1 AND (m.deleted = FALSE OR m.deleted_for_everyone = FALSE) ORDER BY m.timestamp ASC`;
            params = [groupId];
        } else if (userId) {
            // ADMIN SNOOPING: If admin provides a targetId to monitor two other users
            const { adminTargetId } = req.query;
            if (req.user.role === 'admin' && adminTargetId) {
                sql += ` WHERE ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)) AND m.deleted = FALSE ORDER BY m.timestamp ASC`;
                params = [userId, adminTargetId];
            } else {
                sql += ` WHERE ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)) AND m.deleted = FALSE ORDER BY m.timestamp ASC`;
                params = [req.user.id, userId];
            }
        } else {
            return res.status(400).json({ error: 'UserId or GroupId required' });
        }

        const result = await db.query(sql, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search Messages
router.get('/search', authenticateToken, async (req, res) => {
    const { q, userId, groupId } = req.query;
    if (!q) return res.json([]);

    try {
        let sql, params;
        if (groupId) {
            sql = `
                SELECT m.id, m.content, m.timestamp, u.username as sender
                FROM messages m JOIN users u ON m.sender_id = u.id
                WHERE m.group_id = $1 AND m.content ILIKE $2 AND m.deleted = FALSE
                ORDER BY m.timestamp DESC LIMIT 20
            `;
            params = [groupId, `%${q}%`];
        } else if (userId) {
            sql = `
                SELECT m.id, m.content, m.timestamp, u.username as sender
                FROM messages m JOIN users u ON m.sender_id = u.id
                WHERE ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1))
                AND m.content ILIKE $3 AND m.deleted = FALSE
                ORDER BY m.timestamp DESC LIMIT 20
            `;
            params = [req.user.id, userId, `%${q}%`];
        } else {
            // Global search across all user's conversations
            sql = `
                SELECT m.id, m.content, m.timestamp, u.username as sender,
                    CASE WHEN m.group_id IS NOT NULL THEN 'group' ELSE 'user' END as chat_type,
                    COALESCE(g.name, u2.username) as chat_name
                FROM messages m 
                JOIN users u ON m.sender_id = u.id
                LEFT JOIN groups g ON m.group_id = g.id
                LEFT JOIN users u2 ON (m.receiver_id = u2.id OR m.sender_id = u2.id) AND u2.id != $1
                WHERE (m.sender_id = $1 OR m.receiver_id = $1 OR m.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1))
                AND m.content ILIKE $2 AND m.deleted = FALSE
                ORDER BY m.timestamp DESC LIMIT 30
            `;
            params = [req.user.id, `%${q}%`];
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

// Delete message
router.delete('/:id', authenticateToken, async (req, res) => {
    const { forEveryone } = req.query;
    const messageId = req.params.id;

    try {
        // Verify sender
        const msg = await db.query('SELECT sender_id FROM messages WHERE id = $1', [messageId]);
        if (msg.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        if (msg.rows[0].sender_id !== req.user.id) return res.status(403).json({ error: 'Not your message' });

        if (forEveryone === 'true') {
            await db.query('UPDATE messages SET deleted = TRUE, deleted_for_everyone = TRUE, content = $1 WHERE id = $2',
                ['🚫 This message was deleted', messageId]
            );
        } else {
            await db.query('UPDATE messages SET deleted = TRUE WHERE id = $1', [messageId]);
        }
        res.json({ message: 'Message deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add Reaction
router.post('/:id/react', authenticateToken, async (req, res) => {
    const { emoji } = req.body;
    const messageId = req.params.id;

    try {
        // Toggle - remove if exists, add if not
        const existing = await db.query(
            'SELECT id FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
            [messageId, req.user.id, emoji]
        );
        
        if (existing.rows.length > 0) {
            await db.query('DELETE FROM reactions WHERE id = $1', [existing.rows[0].id]);
            res.json({ action: 'removed' });
        } else {
            await db.query(
                'INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)',
                [messageId, req.user.id, emoji]
            );
            res.json({ action: 'added' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
