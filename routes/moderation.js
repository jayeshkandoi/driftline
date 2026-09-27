// routes/moderation.js
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { muteUser, banUser, unbanUser, canModerate } = require('../services/moderation');

// The socket server is attached to req.app so moderation actions taken
// over REST (e.g. from an admin dashboard) can still notify connected
// clients in real time - see server.js.
const router = express.Router();

function getUserOr404(res, id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) res.status(404).json({ error: 'User not found' });
  return user;
}

// Mute a user, either in one channel or server-wide (omit channel_id)
router.post('/mute', requireAuth, requireRole('mod', 'admin'), (req, res) => {
  const { user_id, channel_id, minutes, reason } = req.body || {};
  const target = getUserOr404(res, user_id);
  if (!target) return;
  if (!canModerate(req.user, target)) return res.status(403).json({ error: "You can't moderate this user" });
  if (!minutes || minutes <= 0 || minutes > 10080) {
    return res.status(400).json({ error: 'minutes must be between 1 and 10080 (7 days)' });
  }

  const expiresAt = muteUser({ userId: target.id, channelId: channel_id || null, minutes, reason, mutedBy: req.user.id });
  req.app.get('io').to(`channel:${channel_id || 'global'}`).emit('user_muted', {
    userId: target.id, channelId: channel_id || null, expiresAt, reason,
  });
  res.json({ ok: true, expires_at: expiresAt });
});

// Kick a user out of a channel's live socket room (they can rejoin unless also muted/banned)
router.post('/kick', requireAuth, requireRole('mod', 'admin'), (req, res) => {
  const { user_id, channel_id, reason } = req.body || {};
  const target = getUserOr404(res, user_id);
  if (!target) return;
  if (!canModerate(req.user, target)) return res.status(403).json({ error: "You can't moderate this user" });

  req.app.get('io').to(`channel:${channel_id}`).emit('user_kicked', { userId: target.id, channelId: channel_id, reason });
  res.json({ ok: true });
});

// Ban a user account. Omit minutes for a permanent ban.
router.post('/ban', requireAuth, requireRole('mod', 'admin'), (req, res) => {
  const { user_id, minutes, reason } = req.body || {};
  const target = getUserOr404(res, user_id);
  if (!target) return;
  if (!canModerate(req.user, target)) return res.status(403).json({ error: "You can't moderate this user" });

  const until = banUser({ userId: target.id, minutes: minutes || null, reason, bannedBy: req.user.id });
  req.app.get('io').emit('user_banned', { userId: target.id, until, reason });
  res.json({ ok: true, banned_until: until });
});

router.post('/unban', requireAuth, requireRole('mod', 'admin'), (req, res) => {
  const target = getUserOr404(res, req.body?.user_id);
  if (!target) return;
  unbanUser(target.id);
  res.json({ ok: true });
});

// Soft-delete a message (content is hidden, row is kept for audit purposes)
router.delete('/messages/:id', requireAuth, requireRole('mod', 'admin'), (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  db.prepare('UPDATE messages SET deleted = 1, deleted_by = ? WHERE id = ?').run(req.user.id, message.id);
  req.app.get('io').to(`channel:${message.channel_id}`).emit('message_deleted', { messageId: message.id });
  res.json({ ok: true });
});

// Change a user's role (admins only)
router.post('/role', requireAuth, requireRole('admin'), (req, res) => {
  const { user_id, role } = req.body || {};
  if (!['member', 'mod', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const target = getUserOr404(res, user_id);
  if (!target) return;

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  res.json({ ok: true });
});

// --- Reports: any member can file one, mods/admins can review them ---

router.post('/reports', requireAuth, (req, res) => {
  const { message_id, reported_user_id, reason } = req.body || {};
  if (!reported_user_id) return res.status(400).json({ error: 'reported_user_id is required' });

  db.prepare(
    'INSERT INTO reports (message_id, reported_user_id, reported_by, reason) VALUES (?, ?, ?, ?)'
  ).run(message_id || null, reported_user_id, req.user.id, reason || null);
  res.status(201).json({ ok: true });
});

router.get('/reports', requireAuth, requireRole('mod', 'admin'), (req, res) => {
  const status = req.query.status || 'open';
  const reports = db
    .prepare(
      `SELECT r.*, u.username as reported_username, m.content as message_content
       FROM reports r
       JOIN users u ON u.id = r.reported_user_id
       LEFT JOIN messages m ON m.id = r.message_id
       WHERE r.status = ?
       ORDER BY r.created_at DESC`
    )
    .all(status);
  res.json({ reports });
});

router.post('/reports/:id/resolve', requireAuth, requireRole('mod', 'admin'), (req, res) => {
  const { status } = req.body || {}; // 'resolved' | 'dismissed'
  if (!['resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
