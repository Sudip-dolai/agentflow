// ============================================
// AGENTFLOW — Calendar Routes
// Google Calendar OAuth + Slot Generation
// ============================================

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { users, updateUser, getUserById } = require('../config/db');
const googleCalendar = require('../config/google');

// ---- CONNECT GOOGLE CALENDAR ----
// GET /api/calendar/connect
// Agent clicks "Connect Google Calendar" → redirected to Google
router.get('/connect', authMiddleware, (req, res) => {
  if (!googleCalendar.isConfigured()) {
    return res.status(503).json({
      error: 'Google Calendar not configured',
      message: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file',
      setup_guide: 'https://console.cloud.google.com'
    });
  }
  const authUrl = googleCalendar.getAuthUrl(req.userId);
  res.json({ auth_url: authUrl });
});

// ---- OAUTH CALLBACK ----
// GET /api/calendar/callback
// Google redirects here after agent approves
router.get('/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error) {
    console.error('[CALENDAR] OAuth error:', error);
    return res.redirect('/pages/dashboard.html?calendar=error');
  }

  if (!code || !userId) {
    return res.redirect('/pages/dashboard.html?calendar=error');
  }

  try {
    const tokens = await googleCalendar.exchangeCodeForTokens(code);
    // FIX: use getUserById (reads Supabase) — users.get fails after restart
    const user = await getUserById(userId);
    if (!user) return res.redirect('/pages/dashboard.html?calendar=error');

    // Store tokens against user
    await updateUser(userId, {
      calendar_connected: true,
      google_tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
        token_type: tokens.token_type
      },
      calendar_timezone: user.market === 'uk' ? 'Europe/London' : 'Asia/Dubai'
    });

    console.log(`[CALENDAR] Connected for user ${userId}`);
    res.redirect('/pages/dashboard.html?calendar=connected');
  } catch (err) {
    console.error('[CALENDAR] Token exchange error:', err.message);
    res.redirect('/pages/dashboard.html?calendar=error');
  }
});

// ---- GET STATUS ----
// GET /api/calendar/status
router.get('/status', authMiddleware, async (req, res) => {
  // FIX: read from Supabase so status is correct after restart
  const user = await getUserById(req.userId);
  res.json({
    connected: !!(user?.calendar_connected && user?.google_tokens),
    google_configured: googleCalendar.isConfigured(),
    timezone: user?.calendar_timezone || (user?.market === 'uk' ? 'Europe/London' : 'Asia/Dubai')
  });
});

// ---- DISCONNECT ----
// DELETE /api/calendar/disconnect
router.delete('/disconnect', authMiddleware, async (req, res) => {
  // FIX: updateUser writes to Supabase
  await updateUser(req.userId, { calendar_connected: false, google_tokens: null });
  res.json({ message: 'Google Calendar disconnected' });
});

// ---- GET AVAILABLE SLOTS WITH GOOGLE CALENDAR CHECK ----
// GET /api/calendar/slots/:userId?date=2026-06-02
// Public endpoint — called by book.html
router.get('/slots/:userId', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

  // FIX: use getUserById (reads Supabase) so slots work after restart
  const user = await getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Agent not found' });

  // Get agent availability settings
  const avail = user.availability || {};
  const startHour = parseInt(avail.start_hour) || 9;
  const endHour = parseInt(avail.end_hour) || 18;
  const slotDuration = parseInt(avail.slot_duration) || 60;
  const buffer = parseInt(avail.buffer) || 15;
  const timezone = user.calendar_timezone || (user.market === 'uk' ? 'Europe/London' : 'Asia/Dubai');

  // Check day of week against working days
  const dateObj = new Date(date + 'T12:00:00');
  const dayOfWeek = dateObj.getDay(); // 0=Sun, 6=Sat
  const workingDays = avail.days_available || (user.market === 'uk' ? 'uk' : 'uae');

  let allowedDays;
  if (workingDays === 'uae') allowedDays = [0,1,2,3,4];       // Sun-Thu
  else if (workingDays === 'uk') allowedDays = [1,2,3,4,5];   // Mon-Fri
  else if (workingDays === 'all') allowedDays = [1,2,3,4,5,6]; // Mon-Sat
  else allowedDays = [0,1,2,3,4,5,6];                          // All 7

  if (!allowedDays.includes(dayOfWeek)) {
    return res.json({ date, slots: [], reason: 'Agent not available on this day' });
  }

  // Get existing AgentFlow bookings for this date (prevent double booking)
  const { bookings } = require('../config/db');
  const agentFlowBookings = new Set();
  for (const [, booking] of bookings) {
    if (booking.userId === req.params.userId && booking.date === date && booking.status !== 'cancelled') {
      agentFlowBookings.add(booking.time);
    }
  }

  // Get Google Calendar busy slots if connected
  let busySlots = [];
  if (user.calendar_connected && user.google_tokens) {
    busySlots = await googleCalendar.getBusySlots(user.google_tokens, date, timezone);
    console.log(`[CALENDAR] ${busySlots.length} busy slots from Google for ${date}`);
  }

  // Generate all possible slots
  const slots = [];
  const step = slotDuration + buffer;
  const totalMinutes = (endHour - startHour) * 60;

  for (let minuteOffset = 0; minuteOffset < totalMinutes; minuteOffset += step) {
    const totalMin = startHour * 60 + minuteOffset;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h >= endHour) break;

    const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

    // Check if slot is taken by existing AgentFlow booking
    const takenByAgentFlow = agentFlowBookings.has(timeStr);

    // Check if slot conflicts with Google Calendar
    const takenByGoogle = googleCalendar.slotConflictsWithBusy(
      timeStr, date, slotDuration, busySlots
    );

    // Check advance notice (minimum 2 hours ahead)
    const slotDateTime = new Date(`${date}T${timeStr}:00`);
    const tooSoon = (slotDateTime - new Date()) < (2 * 60 * 60 * 1000);

    slots.push({
      time: timeStr,
      available: !takenByAgentFlow && !takenByGoogle && !tooSoon,
      reason: takenByAgentFlow ? 'booked' : takenByGoogle ? 'busy' : tooSoon ? 'too_soon' : null
    });
  }

  res.json({
    date,
    slots,
    agent_name: user.name,
    timezone,
    google_connected: !!(user.calendar_connected && user.google_tokens),
    slot_duration: slotDuration
  });
});

// ---- UPDATE TIMEZONE ----
router.put('/timezone', authMiddleware, async (req, res) => {
  const { timezone } = req.body;
  // FIX: use getUserById (reads Supabase)
  const user = await getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await updateUser(req.userId, { calendar_timezone: timezone });
  res.json({ message: 'Timezone updated', timezone });
});

module.exports = router;
