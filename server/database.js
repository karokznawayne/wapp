const { Pool } = require('pg');
require('dotenv').config();

// Use POSTGRES_URL or DATABASE_URL from Vercel/Render/Local
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error("❌ ERROR: No Database Connection String found. Please set POSTGRES_URL or DATABASE_URL.");
    // We don't exit process here to allow build steps to pass, but runtime will fail if no DB.
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
        `CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'user',
            mfa_secret VARCHAR(255),
            mfa_enabled BOOLEAN DEFAULT FALSE
        )`,
        `CREATE TABLE IF NOT EXISTS groups (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            created_by INTEGER REFERENCES users(id)
        )`,
        `CREATE TABLE IF NOT EXISTS group_members (
            id SERIAL PRIMARY KEY,
            group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(50) DEFAULT 'pending', -- pending, approved, invited
            role VARCHAR(50) DEFAULT 'member' -- admin, member
        )`,
        `CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            sender_id INTEGER REFERENCES users(id),
            receiver_id INTEGER REFERENCES users(id), -- Nullable for group chats
            group_id INTEGER REFERENCES groups(id),   -- Nullable for DMs
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read_status BOOLEAN DEFAULT FALSE
        )`,
        `CREATE TABLE IF NOT EXISTS friendships (
            id SERIAL PRIMARY KEY,
            user_id_1 INTEGER REFERENCES users(id),
            user_id_2 INTEGER REFERENCES users(id),
            status VARCHAR(50) DEFAULT 'pending'
        )`
    ];

    const executeSchemas = async () => {
        try {
            for (const query of queries) {
                await pool.query(query);
            }
            console.log('✅ Database Schema Initialized');

            // Promote 'kz' to admin
            await pool.query("UPDATE users SET role = 'admin' WHERE username = 'kz'");
            console.log('✅ Admin user set: kz');
        } catch (err) {
            console.error('❌ Error initializing schema:', err);
        }
    };

    executeSchemas();
}

module.exports = {
  query: (text, params) => pool.query(text, params),
};
