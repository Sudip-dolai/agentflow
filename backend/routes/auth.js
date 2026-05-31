// ============================================
// AGENTFLOW — Auth Routes
// ============================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { users, getUserByEmail, createUser, getUserById } = require('../config/db');
const { sendEmail, welcomeEmail } = require('../config/email');
const { authMiddleware } = require('../middleware/auth');

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, agency, market } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email, and password are required' });

    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existingUser = await getUserByEmail(email.toLowerCase().trim());
    if (existingUser)
      return res.status(409).json({ error: 'An account with this email already exists' });

    const password_hash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    const newUser = {
      name,
      email: email.toLowerCase().trim(),
      password_hash,
      agency: agency || '',
      market: market || 'uae',
      plan: 'trial',
      trial_start: new Date().toISOString(),
      follow_up_channel: 'email',
      openai_key: '',
      gmail_connected: false,
      calendar_connected: false,
      created_at: new Date().toISOString()
    };
    await createUser(userId, newUser);

    const token = jwt.sign(
      { userId },
      process.env.JWT_SECRET || 'agentflow_dev_secret',
      { expiresIn: '30d' }
    );

    // Send welcome email (non-blocking)
    sendEmail({
      to: email,
      subject: 'Welcome to AgentFlow — Your 14-day free trial has started 🎉',
      html: welcomeEmail(name)
    }).catch(err => console.error('Welcome email failed:', err.message));

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: userId, name, email, agency, market, plan: 'trial' }
    });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await getUserByEmail(email.toLowerCase().trim());
    if (!user)
      return res.status(401).json({ error: 'Invalid email or password' });

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid)
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'agentflow_dev_secret',
      { expiresIn: '30d' }
    );

    const { password_hash, ...safeUser } = user;

    res.json({
      message: 'Login successful',
      token,
      user: { ...safeUser, id: user.id }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  const user = await getUserById(req.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const { password_hash, ...safeUser } = user;
  // Include id at top level so frontend can build booking links
  res.json({ ...safeUser, id: req.userId });
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req, res) => {
  // JWT is stateless — client just deletes the token
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;