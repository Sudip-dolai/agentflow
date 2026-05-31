// ============================================
// AGENTFLOW — Main Server
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ---- SECURITY MIDDLEWARE ----
app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Dodo webhook needs raw body — MUST be before express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- SERVE FRONTEND ----
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.static(path.join(process.cwd(), 'frontend')));
app.use(express.static(path.join(process.cwd(), '../frontend')));
// ---- API ROUTES ----
// Auth and payments are always open
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/payments', require('./routes/payments'));

// Auth + plan gate for private dashboard routes
const { authMiddleware, planGate } = require('./middleware/auth');
const gated = [authMiddleware, planGate];

app.use('/api/listings', ...gated, require('./routes/listings'));
app.use('/api/leads',    ...gated, require('./routes/leads'));
app.use('/api/chatbot',  ...gated, require('./routes/chatbot'));
app.use('/api/reports',  ...gated, require('./routes/reports'));
app.use('/api/user',     ...gated, require('./routes/user'));

// Bookings: registered WITHOUT gated so public routes work on the book.html page
// (/agent/:id, /slots/:id, /book, /link/:id — all called by unauthenticated visitors).
// The routes that ARE private (GET /, POST /, PUT /:id, availability) each have
// authMiddleware applied individually inside bookings.js.
app.use('/api/bookings', require('./routes/bookings'));

// WhatsApp webhook is PUBLIC — Twilio calls it with no auth token
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/profile',  require('./routes/profile'));
// Calendar: /slots/:userId is PUBLIC (called by book.html), rest is gated inside the router
app.use("/api/calendar", require("./routes/calendar"));
app.use('/api/gmail',    ...gated, require('./routes/gmail'));

// ---- HEALTH CHECK ----
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'AgentFlow API is running',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// ---- AGENT PROFILE SHORTLINKS ----
app.get('/agent/:username', (req, res) => {
 res.sendFile(path.join(process.cwd(), 'frontend/pages/profile.html'));
});

// ---- CATCH ALL → SERVE FRONTEND ----
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'frontend/index.html'));
});

// ---- ERROR HANDLER ----
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// ---- START CRON JOBS ----
require('./config/cron');

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════╗
  ║       AgentFlow API Running       ║
  ║   http://localhost:${PORT}           ║
  ╚═══════════════════════════════════╝
  `);
});

module.exports = app;
