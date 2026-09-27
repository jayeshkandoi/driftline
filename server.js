require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

// Routes
const authRoutes = require("./routes/auth");
const channelRoutes = require("./routes/channels");
const moderationRoutes = require("./routes/moderation");

// Socket
const { attachChat } = require("./sockets/chatSocket");

const app = express();
const server = http.createServer(app);

// =========================
// Middleware
// =========================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
const corsOrigins = (
  process.env.CORS_ORIGIN || "http://localhost:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// =========================
// Serve frontend
// =========================

app.use(express.static(path.join(__dirname, "public")));

// =========================
// API Routes
// =========================

app.use("/api/auth", authRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/moderation", moderationRoutes);

// =========================
// Socket.IO
// =========================

const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

attachChat(io);

// =========================
// Frontend fallback
// =========================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// 404 handler
// =========================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// =========================
// Error handler
// =========================

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// =========================
// Start server
// =========================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving frontend from: ${path.join(__dirname, "public")}`);
});
