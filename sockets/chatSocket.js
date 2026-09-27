// sockets/chatSocket.js
const db = require('../db');
const { verifySocketToken } = require('../middleware/auth');
const { isUserMuted } = require('../services/moderation');

// Simple in-memory sliding-window rate limit: N messages per WINDOW_MS per user.
// Fine for a single server instance; move to Redis if you ever scale to multiple nodes.
const RATE_LIMIT = 8;
const WINDOW_MS = 10_000;
const messageLog = new Map(); // userId -> array of timestamps

function isRateLimited(userId) {
  const now = Date.now();
  const timestamps = (messageLog.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  messageLog.set(userId, timestamps);
  return timestamps.length > RATE_LIMIT;
}

function attachChat(io) {
  // Auth handshake: client connects with `io(url, { auth: { token } })`
  io.use((socket, next) => {
    try {
      const user = verifySocketToken(socket.handshake.auth?.token);
      socket.user = { id: user.id, username: user.username, role: user.role };
      next();
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join_channel', ({ channelId }) => {
      const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
      if (!channel) return socket.emit('error_message', { error: 'Channel not found' });

      socket.join(`channel:${channelId}`);
      socket.to(`channel:${channelId}`).emit('presence', {
        type: 'joined', userId: socket.user.id, username: socket.user.username,
      });
    });

    socket.on('leave_channel', ({ channelId }) => {
      socket.leave(`channel:${channelId}`);
      socket.to(`channel:${channelId}`).emit('presence', {
        type: 'left', userId: socket.user.id, username: socket.user.username,
      });
    });

    socket.on('typing', ({ channelId }) => {
      socket.to(`channel:${channelId}`).emit('typing', { userId: socket.user.id, username: socket.user.username });
    });

    socket.on('send_message', ({ channelId, content }) => {
      if (typeof content !== 'string' || !content.trim()) return;
      if (content.length > 2000) {
        return socket.emit('error_message', { error: 'Message is too long (2000 char max)' });
      }

      const mute = isUserMuted(socket.user.id, channelId);
      if (mute) {
        return socket.emit('error_message', { error: 'You are muted', until: mute.expires_at });
      }
      if (isRateLimited(socket.user.id)) {
        return socket.emit('error_message', { error: "You're sending messages too fast - slow down a bit" });
      }

      const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
      if (!channel) return socket.emit('error_message', { error: 'Channel not found' });

      const trimmed = content.trim();
      const info = db
        .prepare('INSERT INTO messages (channel_id, user_id, content) VALUES (?, ?, ?)')
        .run(channelId, socket.user.id, trimmed);

      const message = {
        id: info.lastInsertRowid,
        channelId,
        content: trimmed,
        created_at: Date.now(),
        author: { id: socket.user.id, username: socket.user.username, role: socket.user.role },
      };

      io.to(`channel:${channelId}`).emit('message', message);
    });

    socket.on('disconnect', () => {
      // Room membership is cleaned up automatically by socket.io.
      // Nothing else to do here for this simple version.
    });
  });
}

module.exports = { attachChat };
