const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const db = require('../database');
const { SECRET_KEY, authenticateToken } = require('../middleware/auth');

// Register
router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const hashedPassword = bcrypt.hashSync(password, 8);
        const mfaSecret = authenticator.generateSecret();

        const result = await db.query(
            'INSERT INTO users (username, password, mfa_secret) VALUES ($1, $2, $3) RETURNING id',
            [username, hashedPassword, mfaSecret]
        );

        const userId = result.rows[0].id;

        // Check if first user, make admin
        const countResult = await db.query('SELECT COUNT(*) as count FROM users');
        const isFirst = parseInt(countResult.rows[0].count) === 1;
        if (isFirst) {
            await db.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', userId]);
        }

        const role = isFirst ? 'admin' : 'user';
        const token = jwt.sign({ id: userId, username, role }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token, userId, role, mfaSetupRequired: true });

    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Username already taken' });
        }
        res.status(500).json({ error: err.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { username, password, mfaToken } = req.body;

    try {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) return res.status(404).json({ error: 'User not found' });

        const passwordIsValid = bcrypt.compareSync(password, user.password);
        if (!passwordIsValid) return res.status(401).json({ token: null, error: 'Invalid Password' });

        if (user.mfa_enabled) {
            if (!mfaToken) {
                return res.status(403).json({ mfaRequired: true, error: 'MFA Token required' });
            }
            try {
                const isValid = authenticator.check(mfaToken, user.mfa_secret);
                if (!isValid) return res.status(401).json({ error: 'Invalid MFA Token' });
            } catch (e) {
                return res.status(401).json({ error: 'Invalid MFA Token format' });
            }
        }

        // Set online
        await db.query('UPDATE users SET is_online = TRUE, last_seen = NOW() WHERE id = $1', [user.id]);

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, {
            expiresIn: '24h'
        });

        res.status(200).json({ auth: true, token, user: { id: user.id, username: user.username, role: user.role, mfaEnabled: !!user.mfa_enabled } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Logout (set offline)
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        await db.query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = $1', [req.user.id]);
        res.json({ message: 'Logged out' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Setup MFA
router.get('/mfa/setup', authenticateToken, async (req, res) => {
    try {
        const result = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
        const row = result.rows[0];
        if (!row) return res.status(404).json({ error: 'User not found' });

        const otpauth = authenticator.keyuri(req.user.username, 'ChatVerse', row.mfa_secret);
        const imageUrl = await QRCode.toDataURL(otpauth);
        res.json({ imageUrl, secret: row.mfa_secret });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Verify and Enable MFA
router.post('/mfa/verify', authenticateToken, async (req, res) => {
    const { token } = req.body;
    try {
        const result = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
        const row = result.rows[0];

        try {
            const isValid = authenticator.check(token, row.mfa_secret);
            if (isValid) {
                await db.query('UPDATE users SET mfa_enabled = TRUE WHERE id = $1', [req.user.id]);
                res.json({ success: true, message: 'MFA Enabled' });
            } else {
                res.status(400).json({ error: 'Invalid Token' });
            }
        } catch (e) {
            res.status(400).json({ error: 'Invalid Token format' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Change Password
router.post('/change-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const result = await db.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];

        if (!bcrypt.compareSync(oldPassword, user.password)) {
            return res.status(401).json({ error: 'Incorrect old password' });
        }

        const hashedPassword = bcrypt.hashSync(newPassword, 8);
        await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Disable MFA
router.post('/mfa/disable', authenticateToken, async (req, res) => {
    const { password } = req.body;
    try {
        const result = await db.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];

        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Incorrect password' });
        }

        await db.query('UPDATE users SET mfa_enabled = FALSE WHERE id = $1', [req.user.id]);
        res.json({ message: 'MFA Disabled' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
