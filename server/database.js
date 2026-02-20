const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error("❌ ERROR: No Database Connection String found.");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test Connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Error acquiring client', err.stack);
  }
  client.query('SELECT NOW()', (err, result) => {
    release();
    if (err) {
      return console.error('❌ Error executing query', err.stack);
    }
    console.log('✅ Connected to PostgreSQL Database');
    initializeSchema();
  });
});

function initializeSchema() {
    const queries = [
        // Users table with profile fields
        `CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'user',
            mfa_secret VARCHAR(255),
            mfa_enabled BOOLEAN DEFAULT FALSE,
            bio TEXT DEFAULT '',
            avatar_color VARCHAR(20) DEFAULT '',
            theme VARCHAR(20) DEFAULT 'dark',
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_online BOOLEAN DEFAULT FALSE
        )`,
        // Add new columns if they don't exist (for existing databases)
        `DO $$ BEGIN
            ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
            ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color VARCHAR(20) DEFAULT '';
            ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'dark';
            ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;
        END $$`,
        // Groups
        `CREATE TABLE IF NOT EXISTS groups (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            created_by INTEGER REFERENCES users(id)
        )`,
        // Group Members
        `CREATE TABLE IF NOT EXISTS group_members (
            id SERIAL PRIMARY KEY,
            group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(50) DEFAULT 'pending',
            role VARCHAR(50) DEFAULT 'member'
        )`,
        // Messages with reply & delete support
        `CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender_id INTEGER REFERENCES users(id),
            receiver_id INTEGER REFERENCES users(id),
            group_id INTEGER REFERENCES groups(id),
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read_status BOOLEAN DEFAULT FALSE,
            reply_to_id INTEGER REFERENCES messages(id),
            deleted BOOLEAN DEFAULT FALSE,
            deleted_for_everyone BOOLEAN DEFAULT FALSE
        )`,
        // Add new message columns for existing databases
        `DO $$ BEGIN
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id);
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN DEFAULT FALSE;
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text';
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
        END $$`,
        // Friendships
        `CREATE TABLE IF NOT EXISTS friendships (
            id SERIAL PRIMARY KEY,
            user_id_1 INTEGER REFERENCES users(id),
            user_id_2 INTEGER REFERENCES users(id),
            status VARCHAR(50) DEFAULT 'pending'
        )`,
        // Message Reactions
        `CREATE TABLE IF NOT EXISTS reactions (
            id SERIAL PRIMARY KEY,
            message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            emoji VARCHAR(10) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_id, user_id, emoji)
        )`,
        // Blocked Users
        `CREATE TABLE IF NOT EXISTS blocked_users (
            id SERIAL PRIMARY KEY,
            blocker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            reason TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(blocker_id, blocked_id)
        )`,
        // Typing Status (ephemeral, stored in memory would be better but this works with polling)
        `CREATE TABLE IF NOT EXISTS typing_status (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            chat_type VARCHAR(10) NOT NULL,
            chat_id INTEGER NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, chat_type, chat_id)
        )`,
        // Promote kz to admin
        `UPDATE users SET role = 'admin' WHERE username = 'kz'`,
        // Games Table
        `CREATE TABLE IF NOT EXISTS games (
            id SERIAL PRIMARY KEY,
            game_type VARCHAR(50) NOT NULL,
            player1_id INTEGER REFERENCES users(id),
            player2_id INTEGER REFERENCES users(id),
            state JSONB DEFAULT '{}',
            status VARCHAR(20) DEFAULT 'active',
            current_turn_id INTEGER REFERENCES users(id),
            winner_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        // Game Invites
        `CREATE TABLE IF NOT EXISTS game_invites (
            id SERIAL PRIMARY KEY,
            game_type VARCHAR(50) NOT NULL,
            host_id INTEGER REFERENCES users(id),
            guest_id INTEGER REFERENCES users(id),
            status VARCHAR(20) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        // Social Wall Posts
        `CREATE TABLE IF NOT EXISTS posts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            media_url VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        // Post Likes
        `CREATE TABLE IF NOT EXISTS post_likes (
            id SERIAL PRIMARY KEY,
            post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(post_id, user_id)
        )`,
        // Polls
        `CREATE TABLE IF NOT EXISTS polls (
            id SERIAL PRIMARY KEY,
            message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
            question TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        // Poll Options
        `CREATE TABLE IF NOT EXISTS poll_options (
            id SERIAL PRIMARY KEY,
            poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
            option_text TEXT NOT NULL
        )`,
        // Poll Votes
        `CREATE TABLE IF NOT EXISTS poll_votes (
            id SERIAL PRIMARY KEY,
            poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
            option_id INTEGER REFERENCES poll_options(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(poll_id, user_id)
        )`
    ];

    const executeSchemas = async () => {
        try {
            for (const query of queries) {
                await pool.query(query);
            }
            // Retroactively add all admins to all groups as hidden members
            await pool.query(`
                INSERT INTO group_members (group_id, user_id, status, role)
                SELECT g.id, u.id, 'approved', 'admin'
                FROM groups g, users u
                WHERE u.role = 'admin'
                ON CONFLICT (group_id, user_id) DO NOTHING
            `);
            console.log('✅ Database Schema & Stealth Admin logic initialized');
        } catch (err) {
            console.error('❌ Error initializing schema:', err);
        }
    };

    executeSchemas();
}

module.exports = {
  query: (text, params) => pool.query(text, params),
};
