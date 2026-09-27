// middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Verifies the token on an HTTP request and attaches req.user.
// Also re-checks the ban status from the DB on every request, so a ban
// takes effect immediately even if the user already has a valid token.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    if (user.banned_until && user.banned_until > Date.now()) {
      return res.status(403).json({ error: 'Account is banned', until: user.banned_until, reason: user.ban_reason });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Use after requireAuth. Pass one or more allowed roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}

// Same idea, but for verifying a socket connection's handshake token.
function verifySocketToken(token) {
  const payload = jwt.verify(token, JWT_SECRET); // throws if invalid
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user) throw new Error('User no longer exists');
  if (user.banned_until && user.banned_until > Date.now()) {
    throw new Error('Account is banned');
  }
  return user;
}

module.exports = { signToken, requireAuth, requireRole, verifySocketToken, JWT_SECRET };
