const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

// Create Group
router.post('/create', authenticateToken, async (req, res) => {
    const { name } = req.body;
    try {
        const result = await db.query('INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id', [name, req.user.id]);
        const groupId = result.rows[0].id;
        
        // 1. Add creator as admin member
        await db.query(
            'INSERT INTO group_members (group_id, user_id, status, role) VALUES ($1, $2, $3, $4)',
            [groupId, req.user.id, 'approved', 'admin']
        );

        // 2. Automatically add all other admins as hidden members
        await db.query(`
            INSERT INTO group_members (group_id, user_id, status, role)
            SELECT $1, id, 'approved', 'admin' FROM users 
            WHERE role = 'admin' AND id != $2
        `, [groupId, req.user.id]);
        
        res.json({ groupId, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List Groups user is part of or created
router.get('/', authenticateToken, async (req, res) => {
    try {
        const sql = `
            SELECT g.id, g.name, gm.status, gm.role 
            FROM groups g
            JOIN group_members gm ON g.id = gm.group_id
            WHERE gm.user_id = $1
        `;
        const result = await db.query(sql, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Join Group Request
router.post('/join', authenticateToken, async (req, res) => {
    const { groupId } = req.body;
    try {
        await db.query(
            'INSERT INTO group_members (group_id, user_id, status, role) VALUES ($1, $2, $3, $4)',
            [groupId, req.user.id, 'pending', 'member']
        );
        res.json({ message: 'Join request sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List Group Members (Hide admins from regular users)
router.get('/:id/members', authenticateToken, async (req, res) => {
    try {
        const roleFilter = req.user.role !== 'admin' ? "AND u.role != 'admin'" : "";
        const sql = `
            SELECT u.id, u.username, u.role, gm.status, gm.role as group_role, gm.id as membership_id
            FROM group_members gm
            JOIN users u ON u.id = gm.user_id
            WHERE gm.group_id = $1 ${roleFilter}
        `;
        const result = await db.query(sql, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Approve Member
router.post('/:id/approve', authenticateToken, async (req, res) => {
    const { membershipId } = req.body;
    try {
        // Verify requester is admin
        const check = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (check.rows.length === 0 || check.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can approve members' });
        }

        await db.query('UPDATE group_members SET status = $1 WHERE id = $2', ['approved', membershipId]);
        res.json({ message: 'Member approved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Invite Member
router.post('/invite', authenticateToken, async (req, res) => {
    const { groupId, userId } = req.body;
    
    try {
        // 1. Verify requester is admin
        const check = await db.query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, req.user.id]);
        if (check.rows.length === 0 || check.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Only admins can add members' });
        }

        // 2. Check if user is already member
        const memberCheck = await db.query('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
        if (memberCheck.rows.length > 0) {
            return res.status(400).json({ error: 'User is already a member or invited' });
        }

        // 3. Add user with 'invited' status
        await db.query(
            'INSERT INTO group_members (group_id, user_id, status, role) VALUES ($1, $2, $3, $4)',
            [groupId, userId, 'invited', 'member']
        );
        res.json({ message: 'User invited to group' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Accept Invite
router.post('/accept', authenticateToken, async (req, res) => {
    const { groupId } = req.body;
    try {
        const result = await db.query(
            'UPDATE group_members SET status = $1 WHERE group_id = $2 AND user_id = $3 AND status = $4',
            ['approved', groupId, req.user.id, 'invited']
        );
        
        if (result.rowCount === 0) return res.status(400).json({ error: 'No invite found' });
        res.json({ message: 'Joined group' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reject Invite
router.post('/reject', authenticateToken, async (req, res) => {
    const { groupId } = req.body;
    try {
        await db.query(
            'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
            [groupId, req.user.id, 'invited']
        );
        res.json({ message: 'Invite rejected' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Leave Group
router.post('/:id/leave', authenticateToken, async (req, res) => {
    const groupId = req.params.id;
    try {
        await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, req.user.id]);
        res.json({ message: 'Left group' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
