// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken } = require('../middleware/auth');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const seedAdmins = (process.env.SEED_ADMIN_USERNAMES || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username is already taken' });

  const passwordHash = await bcrypt.hash(password, 12);
  const role = seedAdmins.includes(username.toLowerCase()) ? 'admin' : 'member';

  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, passwordHash, role);

  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user);
  res.status(201).json({ token, user });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password' });

  if (user.banned_until && user.banned_until > Date.now()) {
    return res.status(403).json({ error: 'Account is banned', until: user.banned_until, reason: user.ban_reason });
  }

  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

module.exports = router;
