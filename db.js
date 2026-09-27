// db.js
// Single SQLite file on disk (chat.db). better-sqlite3 is synchronous,
// which keeps the rest of the codebase simple - no async/await needed
// for reads and writes.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'chat.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', -- 'member' | 'mod' | 'admin'
    banned_until INTEGER,                -- unix ms; NULL or past = not banned
    ban_reason TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    topic TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    deleted INTEGER NOT NULL DEFAULT 0,
    deleted_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS mutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    channel_id INTEGER REFERENCES channels(id), -- NULL = muted server-wide
    expires_at INTEGER NOT NULL,
    reason TEXT,
    muted_by INTEGER REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER REFERENCES messages(id),
    reported_user_id INTEGER REFERENCES users(id),
    reported_by INTEGER NOT NULL REFERENCES users(id),
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'resolved' | 'dismissed'
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes(user_id, channel_id);
`);

// Make sure there's always at least a #general channel to land in.
const generalExists = db.prepare('SELECT id FROM channels WHERE name = ?').get('general');
if (!generalExists) {
  db.prepare('INSERT INTO channels (name, topic) VALUES (?, ?)')
    .run('general', 'Welcome! Be kind.');
}

module.exports = db;
