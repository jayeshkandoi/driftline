// services/moderation.js
const db = require('../db');

function isUserMuted(userId, channelId) {
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT id, expires_at FROM mutes
       WHERE user_id = ? AND (channel_id = ? OR channel_id IS NULL) AND expires_at > ?
       ORDER BY expires_at DESC LIMIT 1`
    )
    .get(userId, channelId, now);
  return row || null;
}

function muteUser({ userId, channelId, minutes, reason, mutedBy }) {
  const expiresAt = Date.now() + minutes * 60 * 1000;
  db.prepare(
    'INSERT INTO mutes (user_id, channel_id, expires_at, reason, muted_by) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, channelId ?? null, expiresAt, reason || null, mutedBy);
  return expiresAt;
}

function banUser({ userId, minutes, reason, bannedBy }) {
  // minutes = null means permanent ban
  const until = minutes ? Date.now() + minutes * 60 * 1000 : 9999999999999; // far future = effectively permanent
  db.prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?').run(until, reason || null, userId);
  return until;
}

function unbanUser(userId) {
  db.prepare('UPDATE users SET banned_until = NULL, ban_reason = NULL WHERE id = ?').run(userId);
}

// A user can only moderate someone with a strictly lower rank.
// Prevents a mod from muting/banning another mod or an admin.
const RANK = { member: 0, mod: 1, admin: 2 };
function canModerate(actor, target) {
  return RANK[actor.role] > RANK[target.role];
}

module.exports = { isUserMuted, muteUser, banUser, unbanUser, canModerate };
