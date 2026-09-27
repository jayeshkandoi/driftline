// routes/channels.js
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// List all channels
router.get('/', requireAuth, (req, res) => {
  const channels = db.prepare('SELECT id, name, topic, created_at FROM channels ORDER BY name').all();
  res.json({ channels });
});

// Create a channel (mods and admins only)
router.post('/', requireAuth, requireRole('mod', 'admin'), (req, res) => {
  const { name, topic } = req.body || {};
  if (!name || !/^[a-z0-9-]{2,30}$/.test(name)) {
    return res.status(400).json({ error: 'Channel name must be lowercase letters, numbers and hyphens' });
  }
  const existing = db.prepare('SELECT id FROM channels WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'A channel with that name already exists' });

  const info = db
    .prepare('INSERT INTO channels (name, topic, created_by) VALUES (?, ?, ?)')
    .run(name, topic || null, req.user.id);
  const channel = db.prepare('SELECT id, name, topic, created_at FROM channels WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ channel });
});

// Delete a channel (admins only) - keeps #general as a safe default that can't be removed
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (channel.name === 'general') return res.status(400).json({ error: 'The #general channel cannot be deleted' });

  db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
  res.json({ ok: true });
});

// Paginated message history for a channel. Deleted messages come back
// with content replaced so the client can render a "message deleted" placeholder.
router.get('/:id/messages', requireAuth, (req, res) => {
  const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = parseInt(req.query.before, 10) || Date.now();

  const rows = db
    .prepare(
      `SELECT m.id, m.content, m.created_at, m.deleted, u.id as user_id, u.username, u.role
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = ? AND m.created_at < ?
       ORDER BY m.created_at DESC
       LIMIT ?`
    )
    .all(channel.id, before, limit)
    .reverse()
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      author: { id: row.user_id, username: row.username, role: row.role },
      content: row.deleted ? null : row.content,
      deleted: !!row.deleted,
    }));

  res.json({ messages: rows });
});

module.exports = router;
