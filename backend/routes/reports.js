// ============================================
// AGENTFLOW — Reports Routes
// ============================================

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getLeadsByUser, getListingsByUser, getBookingsByUser } = require('../config/db');
const { sendEmail } = require('../config/email');

// GET /api/reports/weekly — Get weekly stats
router.get('/weekly', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [allLeads, allListings, allBookings] = await Promise.all([
      getLeadsByUser(userId),
      getListingsByUser(userId),
      getBookingsByUser(userId)
    ]);

    const weekLeads    = allLeads.filter(l => new Date(l.created_at) >= weekAgo).length;
    const weekListings = allListings.filter(l => new Date(l.created_at) >= weekAgo).length;
    const weekBookings = allBookings.filter(b => new Date(b.created_at) >= weekAgo).length;
    const hoursSaved   = (weekListings * 2) + (weekLeads * 0.5) + (weekBookings * 0.5);

    res.json({
      period: { start: weekAgo.toISOString(), end: now.toISOString() },
      stats: {
        leads: weekLeads,
        listings: weekListings,
        bookings: weekBookings,
        followups_sent: weekLeads * 3,
        email_open_rate: 68,
        hours_saved: Math.round(hoursSaved)
      },
      ai_insight: generateInsight(weekLeads, weekListings, weekBookings)
    });
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/reports/all-time — Total stats
router.get('/all-time', authMiddleware, async (req, res) => {
  const userId = req.userId;
  const [allLeads, allListings, allBookings] = await Promise.all([
    getLeadsByUser(userId),
    getListingsByUser(userId),
    getBookingsByUser(userId)
  ]);
  res.json({
    total_leads: allLeads.length,
    total_listings: allListings.length,
    total_bookings: allBookings.length,
    total_hours_saved: Math.round((allListings.length * 2) + (allLeads.length * 0.5) + (allBookings.length * 0.5))
  });
});

// POST /api/reports/send — Manually send report to email
// FIX: getWeeklyStats is now async and queries Supabase via getLeadsByUser etc.
// so stats are correct even after a server restart (no longer in-memory only)
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const stats = await getWeeklyStats(req.userId);

    await sendEmail({
      to: user.email,
      subject: `📊 Your AgentFlow Weekly Report`,
      html: buildReportEmail(user.name, stats)
    });

    res.json({ message: 'Report sent to ' + user.email });
  } catch (err) {
    console.error('Send report error:', err);
    res.status(500).json({ error: 'Failed to send report' });
  }
});

// FIX: now async — uses getLeadsByUser/getListingsByUser/getBookingsByUser
// which query Supabase, so data is correct after server restarts
async function getWeeklyStats(userId) {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [allLeads, allListings, allBookings] = await Promise.all([
    getLeadsByUser(userId),
    getListingsByUser(userId),
    getBookingsByUser(userId)
  ]);

  const weekLeads    = allLeads.filter(l => new Date(l.created_at) >= weekAgo).length;
  const weekListings = allListings.filter(l => new Date(l.created_at) >= weekAgo).length;
  const weekBookings = allBookings.filter(b => new Date(b.created_at) >= weekAgo).length;

  return {
    leads:       weekLeads,
    listings:    weekListings,
    bookings:    weekBookings,
    hours_saved: Math.round((weekListings * 2) + (weekLeads * 0.5) + (weekBookings * 0.5))
  };
}

function generateInsight(leads, listings, bookings) {
  if (leads === 0 && listings === 0) return 'No activity recorded this week. Make sure your chatbot is live on your website and your listing generator is connected.';
  if (leads > 10) return `Strong lead week with ${leads} new leads captured. Your follow-up sequence is running automatically. Consider sharing your booking link on Instagram to convert more leads into viewings.`;
  if (listings > 3) return `You generated ${listings} listings this week, saving approximately ${listings * 2} hours. Your listing quality is directly driving enquiries.`;
  return `Your automations saved you approximately ${Math.round((listings * 2) + (leads * 0.5) + (bookings * 0.5))} hours this week. Keep your chatbot active to capture more leads around the clock.`;
}

function buildReportEmail(name, stats) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#080c14;color:#e8eaf0;margin:0;padding:40px 20px;">
  <div style="max-width:600px;margin:0 auto;">
    <h1 style="color:#fff;margin-bottom:4px;">Agent<span style="color:#c9a84c;">Flow</span></h1>
    <p style="color:#8892a4;margin-top:0;">Weekly Performance Report</p>
    <h2 style="color:#c9a84c;">Hi ${name} 👋</h2>
    <p style="color:#8892a4;">Here's what your automations did this week:</p>
    <div style="display:flex;gap:12px;margin:24px 0;flex-wrap:wrap;">
      <div style="flex:1;min-width:120px;background:#0d1420;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:2rem;color:#c9a84c;font-weight:700;">${stats.leads}</div>
        <div style="color:#8892a4;font-size:0.8rem;margin-top:4px;">Leads</div>
      </div>
      <div style="flex:1;min-width:120px;background:#0d1420;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:2rem;color:#c9a84c;font-weight:700;">${stats.bookings}</div>
        <div style="color:#8892a4;font-size:0.8rem;margin-top:4px;">Viewings</div>
      </div>
      <div style="flex:1;min-width:120px;background:#0d1420;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:2rem;color:#c9a84c;font-weight:700;">${stats.listings}</div>
        <div style="color:#8892a4;font-size:0.8rem;margin-top:4px;">Listings</div>
      </div>
      <div style="flex:1;min-width:120px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:2rem;color:#c9a84c;font-weight:700;">${stats.hours_saved}h</div>
        <div style="color:#c9a84c;font-size:0.8rem;margin-top:4px;">Saved</div>
      </div>
    </div>
    <a href="${process.env.FRONTEND_URL || 'https://getagentflow.co'}/pages/dashboard.html" style="background:#c9a84c;color:#000;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">View Dashboard →</a>
    <p style="color:#8892a4;font-size:0.78rem;margin-top:32px;">AgentFlow · getagentflow.co</p>
  </div></body></html>`;
}

module.exports = router;
