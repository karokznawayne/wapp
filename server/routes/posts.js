const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Get all posts for the Social Wall
router.get('/', authenticateToken, async (req, res) => {
    try {
        const sql = `
            SELECT p.*, u.username, u.avatar_color,
            (SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) as likes_count,
            EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = $1) as is_liked
            FROM posts p
            JOIN users u ON p.user_id = u.id
            ORDER BY p.created_at DESC
            LIMIT 50
        `;
        const result = await db.query(sql, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new post
router.post('/', authenticateToken, async (req, res) => {
    const { content, media_url } = req.body;
    if (!content && !media_url) return res.status(400).json({ error: 'Post must have content or media' });

    try {
        const result = await db.query(
            'INSERT INTO posts (user_id, content, media_url) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, content, media_url]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Like/Unlike a post
router.post('/:id/like', authenticateToken, async (req, res) => {
    const postId = req.params.id;
    try {
        // Check if already liked
        const check = await db.query('SELECT * FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, req.user.id]);
        
        if (check.rows.length > 0) {
            // Unlike
            await db.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, req.user.id]);
            res.json({ liked: false });
        } else {
            // Like
            await db.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)', [postId, req.user.id]);
            res.json({ liked: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a post
router.delete('/:id', authenticateToken, async (req, res) => {
    const postId = req.params.id;
    try {
        const check = await db.query('SELECT * FROM posts WHERE id = $1', [postId]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Post not found' });
        
        // Only author or admin can delete
        if (check.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await db.query('DELETE FROM posts WHERE id = $1', [postId]);
        res.json({ message: 'Post deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
