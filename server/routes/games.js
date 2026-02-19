const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Get Recent Players
router.get('/recent-players', authenticateToken, async (req, res) => {
    try {
        const sql = `
            SELECT DISTINCT u.id, u.username, u.avatar_color
            FROM users u
            JOIN games g ON (g.player1_id = u.id OR g.player2_id = u.id)
            WHERE (g.player1_id = $1 OR g.player2_id = $1) AND u.id != $1
            ORDER BY u.username ASC
            LIMIT 10
        `;
        const result = await db.query(sql, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send Game Invite
router.post('/invite', authenticateToken, async (req, res) => {
    const { guestId, gameType } = req.body;
    try {
        const result = await db.query(
            'INSERT INTO game_invites (host_id, guest_id, game_type) VALUES ($1, $2, $3) RETURNING id',
            [req.user.id, guestId, gameType]
        );
        res.json({ inviteId: result.rows[0].id, message: 'Game invite sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get My Invites
router.get('/invites', authenticateToken, async (req, res) => {
    try {
        const sql = `
            SELECT i.*, u.username as host_name, u.avatar_color as host_color
            FROM game_invites i
            JOIN users u ON i.host_id = u.id
            WHERE i.guest_id = $1 AND i.status = 'pending'
        `;
        const result = await db.query(sql, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Respond to Invite
router.post('/invite/:id/respond', authenticateToken, async (req, res) => {
    const { action } = req.body; // 'accepted' or 'rejected'
    const inviteId = req.params.id;

    try {
        const inviteRes = await db.query('SELECT * FROM game_invites WHERE id = $1 AND guest_id = $2', [inviteId, req.user.id]);
        if (inviteRes.rows.length === 0) return res.status(404).json({ error: 'Invite not found' });
        const invite = inviteRes.rows[0];

        if (action === 'accepted') {
            // Create the game
            const gameRes = await db.query(
                `INSERT INTO games (game_type, player1_id, player2_id, current_turn_id, state) 
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [invite.game_type, invite.host_id, req.user.id, invite.host_id, JSON.stringify({ board: Array(9).fill(null) })]
            );
            
            await db.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['accepted', inviteId]);
            res.json({ message: 'Game started', gameId: gameRes.rows[0].id });
        } else {
            await db.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['rejected', inviteId]);
            res.json({ message: 'Invite rejected' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Game State
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const sql = `
            SELECT g.*, 
                   u1.username as player1_name, u1.avatar_color as player1_color,
                   u2.username as player2_name, u2.avatar_color as player2_color
            FROM games g
            JOIN users u1 ON g.player1_id = u1.id
            JOIN users u2 ON g.player2_id = u2.id
            WHERE g.id = $1 AND (g.player1_id = $2 OR g.player2_id = $2)
        `;
        const result = await db.query(sql, [req.params.id, req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Tic-Tac-Toe Move
router.post('/:id/move', authenticateToken, async (req, res) => {
    const { index } = req.body;
    try {
        const result = await db.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        const game = result.rows[0];

        if (game.status !== 'active') return res.status(400).json({ error: 'Game is not active' });
        if (game.current_turn_id !== req.user.id) return res.status(400).json({ error: 'Not your turn' });

        const state = typeof game.state === 'string' ? JSON.parse(game.state) : game.state;
        if (state.board[index] !== null) return res.status(400).json({ error: 'Square already taken' });

        const symbol = game.player1_id === req.user.id ? 'X' : 'O';
        state.board[index] = symbol;

        // Check Winner
        const winPatterns = [
            [0,1,2], [3,4,5], [6,7,8], // rows
            [0,3,6], [1,4,7], [2,5,8], // cols
            [0,4,8], [2,4,6]           // diags
        ];
        
        let winnerId = null;
        let status = 'active';

        for (const pattern of winPatterns) {
            const [a, b, c] = pattern;
            if (state.board[a] && state.board[a] === state.board[b] && state.board[a] === state.board[c]) {
                winnerId = req.user.id;
                status = 'completed';
                break;
            }
        }

        if (!winnerId && !state.board.includes(null)) {
            status = 'draw';
        }

        const nextTurnId = status === 'active' 
            ? (game.player1_id === req.user.id ? game.player2_id : game.player1_id) 
            : null;

        await db.query(
            'UPDATE games SET state = $1, status = $2, current_turn_id = $3, winner_id = $4, updated_at = NOW() WHERE id = $5',
            [JSON.stringify(state), status, nextTurnId, winnerId, req.params.id]
        );

        res.json({ message: 'Move made', state, status, winnerId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
