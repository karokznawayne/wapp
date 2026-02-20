const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Create a Poll
router.post('/', authenticateToken, async (req, res) => {
    const { receiverId, groupId, question, options } = req.body;
    if (!question || !options || options.length < 2) {
        return res.status(400).json({ error: 'Question and at least 2 options required' });
    }

    try {
        // 1. Create message first
        const msgResult = await db.query(
            'INSERT INTO messages (sender_id, receiver_id, group_id, content, message_type) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [req.user.id, receiverId || null, groupId || null, question, 'poll']
        );
        const messageId = msgResult.rows[0].id;

        // 2. Create poll
        const pollResult = await db.query(
            'INSERT INTO polls (message_id, question) VALUES ($1, $2) RETURNING id',
            [messageId, question]
        );
        const pollId = pollResult.rows[0].id;

        // 3. Create options
        for (const opt of options) {
            await db.query('INSERT INTO poll_options (poll_id, option_text) VALUES ($1, $2)', [pollId, opt]);
        }

        res.json({ messageId, pollId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Vote in a Poll
router.post('/:pollId/vote', authenticateToken, async (req, res) => {
    const { optionId } = req.body;
    const pollId = req.params.pollId;

    try {
        // Toggle/Replace vote (one vote per user per poll)
        await db.query(
            'INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3) ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = $2',
            [pollId, optionId, req.user.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Poll Details (including votes)
router.get('/:messageId', authenticateToken, async (req, res) => {
    try {
        const pollResult = await db.query('SELECT * FROM polls WHERE message_id = $1', [req.params.messageId]);
        if (pollResult.rows.length === 0) return res.status(404).json({ error: 'Poll not found' });
        
        const poll = pollResult.rows[0];
        const optionsResult = await db.query(`
            SELECT po.id, po.option_text, 
            (SELECT COUNT(*) FROM poll_votes WHERE option_id = po.id) as votes,
            EXISTS(SELECT 1 FROM poll_votes WHERE option_id = po.id AND user_id = $1) as user_voted
            FROM poll_options po
            WHERE po.poll_id = $2
        `, [req.user.id, poll.id]);

        res.json({
            id: poll.id,
            question: poll.question,
            options: optionsResult.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
