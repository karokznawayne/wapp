const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Register
router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const hashedPassword = await bcrypt.hash(password, 8);
        
        // Postgres: Use $1, $2 and RETURNING id
        const result = await db.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id',
            [username, hashedPassword]
        );
        
        const userId = result.rows[0].id;
        const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, username, userId });

    } catch (err) {
        if (err.code === '23505') { // Unique violation code in Postgres
             return res.status(400).json({ error: 'Username already exists' });
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

        if (!user) return res.status(400).json({ error: 'User not found' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Invalid password' });

        // MFA Check
        if (user.mfa_enabled) {
            if (!mfaToken) return res.json({ mfaRequired: true });
            const isValid = authenticator.check(mfaToken, user.mfa_secret);
            if (!isValid) return res.status(400).json({ error: 'Invalid MFA Token' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, username: user.username, userId: user.id });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Setup MFA
const { authenticateToken } = require('../middleware/auth');

router.post('/mfa/setup', authenticateToken, async (req, res) => {
    const secret = authenticator.generateSecret();
    
    try {
        await db.query('UPDATE users SET mfa_secret = $1 WHERE id = $2', [secret, req.user.id]);
        
        const otpauth = authenticator.keyuri(req.user.username, 'SocialApp', secret);
        qrcode.toDataURL(otpauth, (err, imageUrl) => {
            if (err) return res.status(500).json({ error: 'Error generating QR code' });
            res.json({ secret, qrCode: imageUrl });
        });
    } catch (err) {
         res.status(500).json({ error: err.message });
    }
});

router.post('/mfa/verify', authenticateToken, async (req, res) => {
    const { token } = req.body;
    
    try {
        const result = await db.query('SELECT mfa_secret FROM users WHERE id = $1', [req.user.id]);
        const user = result.rows[0];

        const isValid = authenticator.check(token, user.mfa_secret);
        if (!isValid) return res.status(400).json({ error: 'Invalid Token' });

        await db.query('UPDATE users SET mfa_enabled = TRUE WHERE id = $1', [req.user.id]);
        res.json({ message: 'MFA Enabled' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
