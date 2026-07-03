// ============================================
// AGENTFLOW — Chatbot Routes
// ============================================

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { users, getUserById, updateUser } = require('../config/db');

// POST /api/chatbot/config — Save chatbot configuration
router.post('/config', authMiddleware, async (req, res) => {
  const { bot_name, welcome_message, faqs, lead_capture_message } = req.body;
  const user = await getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  await updateUser(req.userId, { chatbot: { bot_name, welcome_message, faqs, lead_capture_message } });

  const embedCode = `<script src="${process.env.FRONTEND_URL || 'https://getagentflow.co'}/js/chatbot-widget.js" data-agent="${req.userId}" data-bot="${(bot_name || 'Alex').toLowerCase().replace(/\s/g, '-')}"><\/script>`;

  res.json({ message: 'Chatbot configured', embed_code: embedCode });
});

// GET /api/chatbot/config — Get chatbot config
router.get('/config', authMiddleware, async (req, res) => {
  const user = await getUserById(req.userId);
  res.json({ chatbot: user?.chatbot || {} });
});

// GET /api/chatbot/widget/:agentId — Public: get chatbot config for widget
router.get('/widget/:agentId', async (req, res) => {
  const user = await getUserById(req.params.agentId);
  if (!user) return res.status(404).json({ error: 'Agent not found' });
  res.json({
    bot_name: user.chatbot?.bot_name || 'Alex',
    welcome_message: user.chatbot?.welcome_message || 'Hi! How can I help you today?',
    faqs: user.chatbot?.faqs || [],
    lead_capture_message: user.chatbot?.lead_capture_message || 'Can I get your name and email?'
  });
});

module.exports = router;
