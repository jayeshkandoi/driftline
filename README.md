# Chatroom backend

A Discord-style community chatroom backend: accounts, channels, real-time
messaging over WebSockets, and moderation tools (mute, kick, ban, delete
message, reports, roles).

## Stack
- Node.js + Express (REST API)
- Socket.io (real-time messaging)
- better-sqlite3 (single-file database, `chat.db`)
- JWT for auth, bcrypt for password hashing

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set JWT_SECRET to a long random string, set CORS_ORIGIN to your frontend's URL
npm start
```

The server listens on `http://localhost:3000` by default. A `#general`
channel is created automatically on first run.

To make your own account a full admin, add your username to
`SEED_ADMIN_USERNAMES` in `.env` **before** registering it.

## Roles

`member` < `mod` < `admin`. A user can only moderate someone with a
strictly lower rank (mods can't touch other mods or admins).

## REST API

All routes except `/api/auth/*` require `Authorization: Bearer <token>`.

| Method | Path | Who | Description |
|---|---|---|---|
| POST | `/api/auth/register` | anyone | `{ username, password }` -> `{ token, user }` |
| POST | `/api/auth/login` | anyone | `{ username, password }` -> `{ token, user }` |
| GET | `/api/channels` | any user | list channels |
| POST | `/api/channels` | mod/admin | `{ name, topic }` create a channel |
| DELETE | `/api/channels/:id` | admin | delete a channel (not #general) |
| GET | `/api/channels/:id/messages` | any user | `?limit=&before=` paginated history |
| POST | `/api/moderation/mute` | mod/admin | `{ user_id, channel_id?, minutes, reason }` |
| POST | `/api/moderation/kick` | mod/admin | `{ user_id, channel_id, reason }` |
| POST | `/api/moderation/ban` | mod/admin | `{ user_id, minutes?, reason }` (omit minutes = permanent) |
| POST | `/api/moderation/unban` | mod/admin | `{ user_id }` |
| DELETE | `/api/moderation/messages/:id` | mod/admin | soft-delete a message |
| POST | `/api/moderation/role` | admin | `{ user_id, role }` |
| POST | `/api/moderation/reports` | any user | `{ message_id?, reported_user_id, reason }` file a report |
| GET | `/api/moderation/reports` | mod/admin | `?status=open` list reports |
| POST | `/api/moderation/reports/:id/resolve` | mod/admin | `{ status: 'resolved'|'dismissed' }` |

## Socket.io events

Connect with the JWT from login/register:

```js
const socket = io('http://localhost:3000', { auth: { token } });
```

**Client -> server**
- `join_channel { channelId }`
- `leave_channel { channelId }`
- `typing { channelId }`
- `send_message { channelId, content }`

**Server -> client**
- `message { id, channelId, content, created_at, author }`
- `presence { type: 'joined'|'left', userId, username }`
- `typing { userId, username }`
- `message_deleted { messageId }`
- `user_muted { userId, channelId, expiresAt, reason }`
- `user_kicked { userId, channelId, reason }`
- `user_banned { userId, until, reason }`
- `error_message { error }`

Messages are rate-limited to 8 per 10 seconds per user; muted users are
rejected server-side even if their client doesn't disable the input.

## What this does NOT include yet

This is a solid starting point, not a production-hardened service. Before
running this for a real public community, you'd still want:

- HTTPS/WSS termination (put it behind nginx/Caddy or a platform that does this)
- Refresh tokens / logout-everywhere (current tokens are valid until they expire)
- Automated content filtering, not just human reports
- Structured logging + monitoring, and backups of `chat.db`
- Horizontal scaling support (swap the in-memory rate limiter and
  socket.io adapter for a Redis-backed version if you run multiple instances)
