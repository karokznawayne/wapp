const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Heartbeat - updates last_seen and online status
router.post('/heartbeat', authenticateToken, async (req, res) => {
    try {
        await db.query('UPDATE users SET is_online = TRUE, last_seen = NOW() WHERE id = $1', [req.user.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
    try {
        await db.query('UPDATE users SET is_online = TRUE, last_seen = NOW() WHERE id = $1', [req.user.id]);
        const result = await db.query('SELECT id, username, role, mfa_enabled, bio, avatar_color, theme FROM users WHERE id = $1', [req.user.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update profile
router.put('/profile', authenticateToken, async (req, res) => {
    const { bio, avatar_color, theme } = req.body;
    try {
        await db.query(
            'UPDATE users SET bio = COALESCE($1, bio), avatar_color = COALESCE($2, avatar_color), theme = COALESCE($3, theme) WHERE id = $4',
            [bio, avatar_color, theme, req.user.id]
        );
        const result = await db.query('SELECT id, username, role, bio, avatar_color, theme FROM users WHERE id = $1', [req.user.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search users (with filters and better relevance)
router.get('/search', authenticateToken, async (req, res) => {
    const { q, online, role } = req.query;
    // If no query and no filters, return nothing
    if (!q && !online && !role) return res.json([]);
    
    try {
        let sql = `
            SELECT id, username, avatar_color, role, is_online, bio 
            FROM users 
            WHERE id != $1
        `;
        let params = [req.user.id];
        let paramIndex = 2;

        // Visibility Filter (Stealth Mode)
        if (req.user.role !== 'admin') {
            sql += ` AND role != 'admin'`;
        } else if (role) {
            sql += ` AND role = $${paramIndex++}`;
            params.push(role);
        }

        if (q) {
            sql += ` AND username ILIKE $${paramIndex++}`;
            params.push(`%${q}%`);
        }

        if (online === 'true') {
            sql += ` AND is_online = TRUE`;
        } else if (online === 'false') {
            sql += ` AND is_online = FALSE`;
        }

        // Exclude blocked
        sql += ` AND id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = $1)
                 AND id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = $1)`;

        // Better search: Sort by (starts with) first, then (contains)
        if (q) {
            sql += ` ORDER BY (CASE WHEN username ILIKE $${paramIndex} THEN 0 ELSE 1 END), username ASC`;
            params.push(`${q}%`);
        } else {
            sql += ` ORDER BY username ASC`;
        }
        
        sql += ` LIMIT 30`;

        const result = await db.query(sql, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send Friend Request
router.post('/friends/request', authenticateToken, async (req, res) => {
    const { targetUserId } = req.body;
    try {
        // Check if blocked
        const blocked = await db.query(
            'SELECT id FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
            [req.user.id, targetUserId]
        );
        if (blocked.rows.length > 0) return res.status(403).json({ error: 'Cannot send request to this user' });

        // Check existing
        const existing = await db.query(
            'SELECT id FROM friendships WHERE (user_id_1 = $1 AND user_id_2 = $2) OR (user_id_1 = $2 AND user_id_2 = $1)',
            [req.user.id, targetUserId]
        );
        if (existing.rows.length > 0) return res.status(400).json({ error: 'Friend request already exists' });

        await db.query('INSERT INTO friendships (user_id_1, user_id_2, status) VALUES ($1, $2, $3)',
            [req.user.id, targetUserId, 'pending']
        );
        res.json({ message: 'Friend request sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List Friends (with last message + unread + online status)
router.get('/friends', authenticateToken, async (req, res) => {
    const myId = req.user.id;
    try {
        const adminFilter = req.user.role !== 'admin' ? "AND u.role != 'admin'" : "";
        const sql = `
            SELECT 
                u.id, u.username, u.avatar_color, u.is_online, u.last_seen, u.role,
                f.status, f.user_id_1 as user1_id, f.user_id_2 as user2_id, f.id as friendship_id,
                (SELECT content FROM messages m WHERE ((m.sender_id = u.id AND m.receiver_id = $1) OR (m.sender_id = $1 AND m.receiver_id = u.id)) AND m.deleted = FALSE ORDER BY m.timestamp DESC LIMIT 1) as last_message,
                (SELECT timestamp FROM messages m WHERE ((m.sender_id = u.id AND m.receiver_id = $1) OR (m.sender_id = $1 AND m.receiver_id = u.id)) AND m.deleted = FALSE ORDER BY m.timestamp DESC LIMIT 1) as last_message_time,
                (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.receiver_id = $1 AND m.read_status = FALSE AND m.deleted = FALSE) as unread_count
            FROM friendships f
            JOIN users u ON (u.id = f.user_id_1 OR u.id = f.user_id_2)
            WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1) AND u.id != $1
            ${adminFilter}
            AND u.id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = $1)
            AND u.id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = $1)
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

// Block User
router.post('/block', authenticateToken, async (req, res) => {
    const { userId, reason } = req.body;
    try {
        await db.query(
            'INSERT INTO blocked_users (blocker_id, blocked_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [req.user.id, userId, reason || '']
        );
        // Remove friendship if exists
        await db.query(
            'DELETE FROM friendships WHERE (user_id_1 = $1 AND user_id_2 = $2) OR (user_id_1 = $2 AND user_id_2 = $1)',
            [req.user.id, userId]
        );
        res.json({ message: 'User blocked' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Unblock User
router.post('/unblock', authenticateToken, async (req, res) => {
    const { userId } = req.body;
    try {
        await db.query('DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, userId]);
        res.json({ message: 'User unblocked' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get blocked users
router.get('/blocked', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT b.id, u.username, u.id as user_id, b.reason, b.created_at
            FROM blocked_users b
            JOIN users u ON u.id = b.blocked_id
            WHERE b.blocker_id = $1
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Typing indicator - set
router.post('/typing', authenticateToken, async (req, res) => {
    const { chatType, chatId } = req.body;
    try {
        await db.query(
            `INSERT INTO typing_status (user_id, chat_type, chat_id, updated_at) 
             VALUES ($1, $2, $3, NOW()) 
             ON CONFLICT (user_id, chat_type, chat_id) DO UPDATE SET updated_at = NOW()`,
            [req.user.id, chatType, chatId]
        );
        // Cleanup: this insert might fail on unique constraint since we don't have a composite unique
        // Let's just delete and reinsert
        res.json({ ok: true });
    } catch (err) {
        // Fallback: delete then insert
        try {
            await db.query('DELETE FROM typing_status WHERE user_id = $1 AND chat_type = $2 AND chat_id = $3', [req.user.id, chatType, chatId]);
            await db.query('INSERT INTO typing_status (user_id, chat_type, chat_id, updated_at) VALUES ($1, $2, $3, NOW())', [req.user.id, chatType, chatId]);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
});

// Get who's typing in a chat
router.get('/typing', authenticateToken, async (req, res) => {
    const { chatType, chatId } = req.query;
    try {
        const result = await db.query(`
            SELECT u.username FROM typing_status ts
            JOIN users u ON u.id = ts.user_id
            WHERE ts.chat_type = $1 AND ts.chat_id = $2 AND ts.user_id != $3
            AND ts.updated_at > NOW() - INTERVAL '5 seconds'
        `, [chatType, chatId, req.user.id]);
        res.json(result.rows.map(r => r.username));
    } catch (err) {
        res.json([]);
    }
});

module.exports = router;
