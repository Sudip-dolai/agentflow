// ============================================
// AGENTFLOW — User Routes
// ============================================

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { users, updateUser, getUserById } = require('../config/db');

// GET /api/user/profile
router.get('/profile', authMiddleware, async (req, res) => {
  const { password_hash, ...safeUser } = req.user;
  res.json({ user: safeUser });
});

// PUT /api/user/profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, agency, market, follow_up_channel, whatsapp_number } = req.body;
    // FIX: use getUserById (reads Supabase) so user data is always current after restart
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Only overwrite fields that were actually sent — preserve others
    const updates = {};
    if (name !== undefined)               updates.name               = name || user.name;
    if (agency !== undefined)             updates.agency             = agency;
    if (market !== undefined)             updates.market             = market || user.market;
    if (follow_up_channel !== undefined)  updates.follow_up_channel  = follow_up_channel || user.follow_up_channel || 'email';
    if (whatsapp_number !== undefined)    updates.whatsapp_number    = whatsapp_number;
    await updateUser(req.userId, updates);
    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/user/channel — Update follow-up channel
router.put('/channel', authMiddleware, async (req, res) => {
  try {
    const { channel } = req.body;
    if (!['email', 'whatsapp', 'both'].includes(channel))
      return res.status(400).json({ error: 'Channel must be: email, whatsapp, or both' });
    // FIX: use getUserById (reads Supabase)
    const user = await getUserById(req.userId);
    await updateUser(req.userId, { follow_up_channel: channel });
    res.json({ message: `Follow-up channel set to ${channel}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// PUT /api/user/apikey
router.put('/apikey', authMiddleware, async (req, res) => {
  try {
    const { openai_key } = req.body;
    if (!openai_key || !openai_key.startsWith('sk-'))
      return res.status(400).json({ error: 'Invalid OpenAI API key — must start with sk-' });
    // FIX: use getUserById (reads Supabase)
    const user = await getUserById(req.userId);
    await updateUser(req.userId, { openai_key });
    res.json({ message: 'API key saved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

// PUT /api/user/integrations
router.put('/integrations', authMiddleware, async (req, res) => {
  try {
    const { gmail, hubspot, calendar, make } = req.body;
    // FIX: use getUserById (reads Supabase)
    const user = await getUserById(req.userId);
    await updateUser(req.userId, {
      gmail_connected: gmail !== undefined ? gmail : user.gmail_connected,
      calendar_connected: calendar !== undefined ? calendar : user.calendar_connected
    });
    res.json({ message: 'Integrations updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update integrations' });
  }
});

// GET /api/user/stats
router.get('/stats', authMiddleware, async (req, res) => {
  const { getLeadsByUser, getListingsByUser, getBookingsByUser } = require('../config/db');
  const userId = req.userId;
  const [allLeads, allListings, allBookings] = await Promise.all([
    getLeadsByUser(userId),
    getListingsByUser(userId),
    getBookingsByUser(userId)
  ]);
  const hoursSaved = (allListings.length * 2) + (allLeads.length * 0.5) + (allBookings.length * 0.5);
  res.json({
    leads: allLeads.length,
    listings: allListings.length,
    bookings: allBookings.length,
    followups_sent: allLeads.length * 3,
    hours_saved: Math.round(hoursSaved)
  });
});

module.exports = router;
