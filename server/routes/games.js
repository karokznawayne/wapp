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

// Get My Active Games (Personal + Group)
router.get('/my-active', authenticateToken, async (req, res) => {
    try {
        const sql = `
            SELECT g.id, g.game_type, g.status, g.group_id
            FROM games g
            LEFT JOIN group_members gm ON g.group_id = gm.group_id AND gm.user_id = $1
            WHERE ((g.player1_id = $1 OR g.player2_id = $1) OR (g.group_id IS NOT NULL AND gm.id IS NOT NULL))
            AND g.status = 'active'
            ORDER BY g.updated_at DESC
        `;
        const result = await db.query(sql, [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Start Group Game
router.post('/start-group', authenticateToken, async (req, res) => {
    const { groupId, gameType } = req.body;
    try {
        // Check if member
        const member = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, req.user.id]);
        if (member.rows.length === 0) return res.status(403).json({ error: 'Not a group member' });

        let initialState = {};
        if (gameType === 'quick-math') {
            const num1 = Math.floor(Math.random() * 50) + 1;
            const num2 = Math.floor(Math.random() * 50) + 1;
            initialState = { 
                problem: `${num1} + ${num2}`, 
                answer: num1 + num2,
                scores: {} // userId: score
            };
        }

        const gameRes = await db.query(
            `INSERT INTO games (game_type, group_id, status, state) 
             VALUES ($1, $2, 'active', $3) RETURNING id`,
            [gameType, groupId, JSON.stringify(initialState)]
        );
        res.json({ gameId: gameRes.rows[0].id });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send Game Invite
router.post('/invite', authenticateToken, async (req, res) => {
    const { guestId, groupId, gameType } = req.body; // groupId is optional (for group games)
    try {
        const result = await db.query(
            'INSERT INTO game_invites (host_id, guest_id, group_id, game_type) VALUES ($1, $2, $3, $4) RETURNING id',
            [req.user.id, guestId || null, groupId || null, gameType]
        );
        res.json({ inviteId: result.rows[0].id, message: 'Game invite sent' });
    } catch (err) { res.status(500).json({ error: err.message }); }
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

// Respond to Invite (1v1)
router.post('/invite/:id/respond', authenticateToken, async (req, res) => {
    const { action } = req.body;
    const inviteId = req.params.id;

    try {
        const inviteRes = await db.query('SELECT * FROM game_invites WHERE id = $1 AND guest_id = $2', [inviteId, req.user.id]);
        if (inviteRes.rows.length === 0) return res.status(404).json({ error: 'Invite not found' });
        const invite = inviteRes.rows[0];

        if (action === 'accepted') {
            let initialState = { board: [] };
            let currentTurnId = invite.host_id;

            if (invite.game_type === 'tic-tac-toe') initialState.board = Array(9).fill(null);
            else if (invite.game_type === 'connect-four') initialState.board = Array(42).fill(null);
            else if (invite.game_type === 'rock-paper-scissors') { initialState = { p1_move: null, p2_move: null }; currentTurnId = null; }
            else if (invite.game_type === 'chess') {
                initialState = { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' };
            }

            const gameRes = await db.query(
                `INSERT INTO games (game_type, player1_id, player2_id, current_turn_id, state) 
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [invite.game_type, invite.host_id, req.user.id, currentTurnId, JSON.stringify(initialState)]
            );
            
            await db.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['accepted', inviteId]);
            res.json({ message: 'Game started', gameId: gameRes.rows[0].id });
        } else {
            await db.query('UPDATE game_invites SET status = $1 WHERE id = $2', ['rejected', inviteId]);
            res.json({ message: 'Invite rejected' });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Game State
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const sql = `
            SELECT g.*, 
                   u1.username as player1_name, u1.avatar_color as player1_color,
                   u2.username as player2_name, u2.avatar_color as player2_color,
                   grp.name as group_name
            FROM games g
            LEFT JOIN users u1 ON g.player1_id = u1.id
            LEFT JOIN users u2 ON g.player2_id = u2.id
            LEFT JOIN groups grp ON g.group_id = grp.id
            WHERE g.id = $1
        `;
        const result = await db.query(sql, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        const game = result.rows[0];

        // Security: check if player or group member
        if (game.group_id) {
            const member = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [game.group_id, req.user.id]);
            if (member.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });
        } else if (game.player1_id !== req.user.id && game.player2_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json(game);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Move Logic Router
router.post('/:id/move', authenticateToken, async (req, res) => {
    const { index, col, move, answer } = req.body;
    try {
        const result = await db.query('SELECT * FROM games WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        const game = result.rows[0];

        if (game.status !== 'active') return res.status(400).json({ error: 'Game over' });
        if (game.current_turn_id !== null && game.current_turn_id !== req.user.id && game.game_type !== 'quick-math') {
            return res.status(400).json({ error: 'Not your turn' });
        }

        let state = typeof game.state === 'string' ? JSON.parse(game.state) : game.state;
        let winnerId = game.winner_id;
        let status = 'active';

        if (game.game_type === 'quick-math') {
            if (parseInt(answer) === state.answer) {
                winnerId = req.user.id;
                status = 'completed';
            } else {
                return res.status(400).json({ error: 'Wrong answer!' });
            }
        } else if (game.game_type === 'tic-tac-toe' || game.game_type === 'connect-four') {
            const symbol = game.player1_id === req.user.id ? 'X' : 'O';
            if (game.game_type === 'tic-tac-toe') {
                if (state.board[index] !== null) return res.status(400).json({ error: 'Taken' });
                state.board[index] = symbol;
                const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
                for (const p of wins) if (state.board[p[0]] && state.board[p[0]] === state.board[p[1]] && state.board[p[0]] === state.board[p[2]]) { winnerId = req.user.id; status = 'completed'; break; }
                if (!winnerId && !state.board.includes(null)) status = 'draw';
            } else {
                const COLS = 7, ROWS = 6;
                let row = -1;
                for (let r = ROWS - 1; r >= 0; r--) if (state.board[r * COLS + col] === null) { row = r; break; }
                if (row === -1) return res.status(400).json({ error: 'Full' });
                state.board[row * COLS + col] = symbol;
                const check = (r, c, dr, dc) => {
                    let count = 0;
                    for (let i = 0; i < 4; i++) {
                        const nr = r + i * dr, nc = c + i * dc;
                        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && state.board[nr * COLS + nc] === symbol) count++;
                        else break;
                    }
                    return count === 4;
                };
                outer: for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (check(r,c,0,1)||check(r,c,1,0)||check(r,c,1,1)||check(r,c,1,-1)) { winnerId = req.user.id; status = 'completed'; break outer; }
                if (!winnerId && !state.board.includes(null)) status = 'draw';
            }
        } else if (game.game_type === 'rock-paper-scissors') {
            const isP1 = req.user.id === game.player1_id;
            if (isP1) { if (state.p1_move) return res.status(400).json({ error: 'Already moved' }); state.p1_move = move; }
            else { if (state.p2_move) return res.status(400).json({ error: 'Already moved' }); state.p2_move = move; }
            if (state.p1_move && state.p2_move) {
                const p1 = state.p1_move, p2 = state.p2_move;
                if (p1 === p2) status = 'draw';
                else if ((p1==='rock'&&p2==='scissors') || (p1==='paper'&&p2==='rock') || (p1==='scissors'&&p2==='paper')) { winnerId = game.player1_id; status = 'completed'; }
                else { winnerId = game.player2_id; status = 'completed'; }
            }
        } else if (game.game_type === 'chess') {
            // Very basic chess move (no validation for now, just updating FEN)
            state.fen = move; 
        }

        let nextTurnId = null;
        if (status === 'active') {
            if (game.game_type === 'quick-math') nextTurnId = null;
            else if (game.game_type === 'chess') nextTurnId = (game.player1_id === req.user.id ? game.player2_id : game.player1_id);
            else if (game.game_type === 'rock-paper-scissors') nextTurnId = null;
            else nextTurnId = (game.player1_id === req.user.id ? game.player2_id : game.player1_id);
        }

        await db.query('UPDATE games SET state = $1, status = $2, current_turn_id = $3, winner_id = $4, updated_at = NOW() WHERE id = $5',
            [JSON.stringify(state), status, nextTurnId, winnerId, req.params.id]);

        res.json({ state, status, winnerId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
