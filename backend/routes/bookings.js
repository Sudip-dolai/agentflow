// ============================================
// AGENTFLOW — Bookings Routes
// ============================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const googleCalendar = require('../config/google');
const { bookings, users, getUserById, createBooking, getBookingsByUser, updateBooking, updateUser, getBookingById } = require('../config/db');
const { sendEmail } = require('../config/email');

// GET /api/bookings — Get all bookings
router.get('/', authMiddleware, async (req, res) => {
  const result = await getBookingsByUser(req.userId);
  res.json({ bookings: result });
});

// POST /api/bookings — Create booking
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { client_name, client_email, property, date_time } = req.body;
    if (!client_name || !date_time)
      return res.status(400).json({ error: 'Client name and date/time are required' });

    const bookingId = uuidv4();
    // FIX: use createBooking (writes to Supabase) not bookings.set (in-memory only)
    await createBooking(bookingId, {
      userId: req.userId,
      client_name, client_email: client_email || '',
      property: property || 'Property viewing',
      date_time, status: 'confirmed',
      created_at: new Date().toISOString()
    });

    // Send confirmation to client
    if (client_email) {
      const user = await getUserById(req.userId);
      await sendEmail({
        to: client_email,
        subject: `Viewing Confirmed — ${new Date(date_time).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`,
        html: `<div style="font-family:Arial,sans-serif;padding:32px;max-width:600px;">
          <h2>Your viewing is confirmed ✅</h2>
          <p>Hi ${client_name},</p>
          <p>Your property viewing has been confirmed:</p>
          <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0;">
            <strong>Property:</strong> ${property || 'Property viewing'}<br>
            <strong>Date & Time:</strong> ${new Date(date_time).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}<br>
            <strong>Agent:</strong> ${user?.name || 'Your agent'}
          </div>
          <p>We'll send you a reminder 24 hours before your viewing.</p>
          <p>Questions? Reply to this email anytime.</p>
        </div>`
      }).catch(console.error);
    }

    res.status(201).json({ message: 'Booking created', id: bookingId });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// GET /api/bookings/link/:userId — Public booking page info
router.get('/link/:userId', async (req, res) => {
  const user = await getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Agent not found' });
  res.json({
    agent_name: user.name,
    agency: user.agency,
    booking_url: `${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/book.html?agent=${req.params.userId}`
  });
});

// GET /api/bookings/agent/:userId — Public: get agent info for booking page
router.get('/agent/:userId', async (req, res) => {
  const user = await getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Agent not found' });
  const { password_hash, openai_key, ...safeUser } = user;
  res.json({ ...safeUser, id: req.params.userId });
});

// GET /api/bookings/slots/:userId — Public: get available slots for a date
router.get('/slots/:userId', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

  const user = await getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Agent not found' });

  // Get existing bookings for this date
  const existingBookings = new Set();
  for (const [, booking] of bookings) {
    if (booking.userId === req.params.userId && booking.date === date) {
      existingBookings.add(booking.time);
    }
  }

  // Generate slots based on user availability settings or defaults
  const availability = user.availability || {};
  const startHour = parseInt(availability.start_hour) || 9;
  const endHour = parseInt(availability.end_hour) || 18;
  const slotDuration = parseInt(availability.slot_duration) || 60;
  const buffer = parseInt(availability.buffer) || 15;
  const step = slotDuration + buffer;

  const slots = [];
  for (let hour = startHour; hour < endHour; hour += step / 60) {
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    slots.push({
      time: timeStr,
      available: !existingBookings.has(timeStr)
    });
  }

  res.json({ date, slots, agent_name: user.name });
});

// POST /api/bookings/book — Public: client books a slot
router.post('/book', async (req, res) => {
  try {
    const { agent_id, client_name, client_email, client_phone, property, message, date, time, date_time } = req.body;
    if (!agent_id || !client_name || !date || !time)
      return res.status(400).json({ error: 'agent_id, client_name, date, and time are required' });

    // Check slot is still available
    for (const [, booking] of bookings) {
      if (booking.userId === agent_id && booking.date === date && booking.time === time) {
        return res.status(409).json({ error: 'This slot has just been booked. Please select another time.' });
      }
    }

    const bookingId = uuidv4();
    await createBooking(bookingId, {
      userId: agent_id,
      client_name, client_email: client_email || '',
      client_phone: client_phone || '',
      property: property || 'Property viewing',
      message: message || '',
      date, time,
      date_time: date_time || `${date}T${time}:00`,
      status: 'confirmed',
      reminder_sent: false,
      created_at: new Date().toISOString()
    });

    const agent = await getUserById(agent_id);
    const formattedDateTime = new Date(`${date}T${time}:00`).toLocaleDateString('en-GB', {
      weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'
    });

    // Send confirmation to client
    if (client_email) {
      sendEmail({
        to: client_email,
        subject: `Viewing Confirmed — ${formattedDateTime}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;padding:32px;background:#080c14;color:#e8eaf0;">
          <h2 style="color:#c9a84c;">Your viewing is confirmed ✅</h2>
          <p>Hi ${client_name},</p>
          <p>Your property viewing has been confirmed:</p>
          <div style="background:#0d1420;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:20px;margin:20px 0;">
            <p><strong>Property:</strong> ${property}</p>
            <p><strong>Date & Time:</strong> ${formattedDateTime}</p>
            <p><strong>Agent:</strong> ${agent?.name || 'Your Agent'}</p>
            ${agent?.agency ? `<p><strong>Agency:</strong> ${agent.agency}</p>` : ''}
          </div>
          <p style="color:#8892a4;">You'll receive a reminder 24 hours before your viewing.</p>
        </div>`
      }).catch(console.error);
    }

    // Send WhatsApp confirmation to client
    if (client_phone) {
      const { sendWhatsApp } = require('../config/whatsapp');
      sendWhatsApp(client_phone,
        `✅ Viewing confirmed!\n\nHi ${client_name}, your property viewing is confirmed:\n\n📅 ${formattedDateTime}\n🏠 ${property}\n👤 ${agent?.name || 'Your Agent'}\n\nWe'll send you a reminder the day before. See you then!`
      ).catch(console.error);
    }

    // Notify agent by email
    if (agent?.email) {
      sendEmail({
        to: agent.email,
        subject: `📅 New viewing booked — ${client_name}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;padding:32px;background:#080c14;color:#e8eaf0;">
          <h2 style="color:#c9a84c;">New Viewing Booked! 📅</h2>
          <div style="background:#0d1420;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:20px;">
            <p><strong>Client:</strong> ${client_name}</p>
            ${client_email ? `<p><strong>Email:</strong> ${client_email}</p>` : ''}
            ${client_phone ? `<p><strong>Phone/WhatsApp:</strong> ${client_phone}</p>` : ''}
            <p><strong>Property:</strong> ${property}</p>
            <p><strong>Date & Time:</strong> ${formattedDateTime}</p>
            ${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}
          </div>
        </div>`
      }).catch(console.error);
    }

    // Notify agent via WhatsApp
    if (agent?.whatsapp_number) {
      const { sendWhatsApp } = require('../config/whatsapp');
      sendWhatsApp(agent.whatsapp_number,
        `📅 New viewing booked!\n\nClient: ${client_name}\nPhone: ${client_phone || 'not provided'}\nProperty: ${property}\nTime: ${formattedDateTime}`
      ).catch(console.error);
    }

    res.status(201).json({ message: 'Booking confirmed', id: bookingId });
  } catch (err) {
    console.error('Book slot error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PUT /api/bookings/:id — Update booking (handles cancellation)
router.put('/:id', authMiddleware, async (req, res) => {
  // FIX: use getBookingById (reads Supabase) — bookings.get fails after restart
  const booking = await getBookingById(req.params.id);
  if (!booking || booking.userId !== req.userId)
    return res.status(404).json({ error: 'Booking not found' });

  const updated = { ...booking, ...req.body, userId: req.userId };
  await updateBooking(req.params.id, updated);
  bookings.set(req.params.id, updated);

  // If cancelled and has Google Calendar event — delete it
  if (req.body.status === 'cancelled' && booking.google_event_id) {
    const user = await getUserById(req.userId);
    if (user?.google_tokens) {
      googleCalendar.deleteCalendarEvent(user.google_tokens, booking.google_event_id)
        .catch(err => console.error('[BOOKING] Failed to delete calendar event:', err.message));
    }
  }

  res.json({ message: 'Booking updated' });
});

// PUT /api/bookings/availability — Agent saves availability settings
router.put('/availability', authMiddleware, async (req, res) => {
  const { start_hour, end_hour, slot_duration, buffer, days_available } = req.body;
  // FIX: use getUserById (reads Supabase) — users.get fails after restart
  const user = await getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // FIX: use updateUser() so availability persists to Supabase across server restarts
  await updateUser(req.userId, {
    availability: { start_hour, end_hour, slot_duration, buffer, days_available }
  });
  users.set(req.userId, {
    ...user,
    availability: { start_hour, end_hour, slot_duration, buffer, days_available }
  });
  res.json({ message: 'Availability saved' });
});

// GET /api/bookings/availability — Get agent availability
router.get('/availability', authMiddleware, async (req, res) => {
  // FIX: use getUserById (reads Supabase)
  const user = await getUserById(req.userId);
  res.json({ availability: user?.availability || {
    start_hour: 9, end_hour: 18, slot_duration: 60, buffer: 15,
    days_available: [0,1,2,3,4]
  }});
});

// FIX: module.exports moved to the END of the file so all routes are registered
module.exports = router;
