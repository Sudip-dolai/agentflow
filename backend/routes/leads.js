// ============================================
// AGENTFLOW — Leads Routes
// Email + WhatsApp follow-up
// ============================================

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { leads, getUserById, createLead, getLeadsByUser, updateLead, deleteLead, getLeadById } = require('../config/db');
const { sendEmail, leadFollowupEmail } = require('../config/email');
const { sendWhatsApp, templates } = require('../config/whatsapp');


// ---- HELPER: fire instant follow-up ----
async function fireInstantFollowup(lead, user) {
const channel = (user.gmail_connected && user.whatsapp_connected) ? 'both' : user.whatsapp_connected ? 'whatsapp' : 'email';
  const bookingUrl = `${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/book.html?agent=${user.id || lead.userId}`;
  const sourceLabel = lead.source
    ? lead.source.charAt(0).toUpperCase() + lead.source.slice(1)
    : 'Website';

  const promises = [];

  // 1. WhatsApp TO LEAD
  if ((channel === 'whatsapp' || channel === 'both') && lead.phone) {
    promises.push(
      sendWhatsApp(lead.phone, templates.welcome(user.name, user.agency, bookingUrl))
        .catch(err => console.error('[LEAD] WA to lead failed:', err.message))
    );
  }

 // 2. Email TO LEAD (via agent Gmail if connected, else Resend)
if ((channel === 'email' || channel === 'both' || (!lead.phone && channel !== 'whatsapp')) && lead.email) {
  promises.push(
  sendEmail({
    to: lead.email,
    subject: `Thanks for your enquiry — I'll be in touch shortly`,
    html: leadFollowupEmail(user.name, user.agency, bookingUrl)
  }).catch(err => console.error('[LEAD] Email to lead failed:', err.message))
);

  // 3. Notify AGENT by email
  if (user.email) {
    promises.push(
      sendEmail({
        to:      user.email,
        subject: `🔔 New lead — ${lead.name} (${sourceLabel})`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;padding:32px;background:#080c14;color:#e8eaf0;">
  <h2 style="color:#c9a84c;">New Lead! 🔔</h2>
  <p style="color:#8892a4;">A new lead has been captured and an instant follow-up has been sent automatically.</p>
  <div style="background:#0d1420;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin:20px 0;">
    <p><strong>Name:</strong> ${lead.name}</p>
    ${lead.email ? `<p><strong>Email:</strong> ${lead.email}</p>` : ''}
    ${lead.phone ? `<p><strong>Phone/WhatsApp:</strong> ${lead.phone}</p>` : ''}
    <p><strong>Source:</strong> ${sourceLabel}</p>
    ${lead.notes ? `<p><strong>Message:</strong> <span style="color:#8892a4;">${String(lead.notes).substring(0,300)}</span></p>` : ''}
  </div>
  <p style="color:#8892a4;font-size:0.85rem;">✅ Instant follow-up sent. Day 1, 3 and 7 sequences will run automatically.</p>
  <a href="${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html"
     style="background:#c9a84c;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px;">
    View in Dashboard →
  </a>
</div>`
      }).catch(err => console.error('[LEAD] Agent email notify failed:', err.message))
    );
  }

  // 4. Notify AGENT by WhatsApp
  if (user.whatsapp_number) {
    promises.push(
      sendWhatsApp(
        user.whatsapp_number,
        `🔔 New lead!\n\nName: ${lead.name}\n${lead.email ? `Email: ${lead.email}\n` : ''}${lead.phone ? `Phone: ${lead.phone}\n` : ''}Source: ${sourceLabel}\n\n✅ Instant follow-up sent automatically.`
      ).catch(err => console.error('[LEAD] Agent WA notify failed:', err.message))
    );
  }

  const results = await Promise.allSettled(promises);
  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[LEAD] Instant follow-up: ${sent}/${promises.length} messages sent for lead "${lead.name}"`);
}

// POST /api/leads — Add lead manually (dashboard)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, email, phone, source, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Lead name is required' });

    const leadId   = uuidv4();
    const leadData = {
      userId:         req.userId,
      name,
      email:          email  || '',
      phone:          phone  || '',
      source:         source || 'manual',
      status:         'new',
      notes:          notes  || '',
      followup_stage: 0,
      created_at:     new Date().toISOString()
    };
await createLead(leadId, leadData);

try {
  scheduleFollowups(leadId, leadData, req.userId);
} catch(err) {
  console.error('[LEAD] Schedule error:', err.message);
}

    // Fire instant follow-up — await getUserById (async — reads Supabase)
    const user = await getUserById(req.userId);
    if (user) {
      // Fire and forget — don't block response
      fireInstantFollowup({ ...leadData, id: leadId }, { ...user, id: req.userId })
        .catch(err => console.error('[LEAD] Follow-up error:', err.message));
    } else {
      console.warn('[LEAD] Could not find user for follow-up — userId:', req.userId);
    }

    res.status(201).json({ message: 'Lead added and follow-up triggered', id: leadId });
  } catch (err) {
    console.error('[LEAD] Add lead error:', err);
    res.status(500).json({ error: 'Failed to add lead' });
  }
});

// GET /api/leads
router.get('/', authMiddleware, async (req, res) => {
  const result = await getLeadsByUser(req.userId);
  res.json({ leads: result, total: result.length });
});

// PUT /api/leads/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    // FIX: use getLeadById (reads Supabase) — leads.get fails after restart
    const lead = await getLeadById(req.params.id);
    if (!lead || lead.userId !== req.userId)
      return res.status(404).json({ error: 'Lead not found' });
    await updateLead(req.params.id, { ...lead, ...req.body, userId: req.userId });
    res.json({ message: 'Lead updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// DELETE /api/leads/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // FIX: use getLeadById (reads Supabase) — leads.get fails after restart
    const lead = await getLeadById(req.params.id);
    if (!lead || lead.userId !== req.userId)
      return res.status(404).json({ error: 'Lead not found' });
    await deleteLead(req.params.id);
    res.json({ message: 'Lead deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// POST /api/leads/capture — PUBLIC: chatbot/profile page captures a lead
router.post('/capture', async (req, res) => {
  try {
    const { agentId, name, email, phone, source, notes } = req.body;
    if (!agentId || !name) return res.status(400).json({ error: 'agentId and name required' });

    const leadId   = uuidv4();
    const leadData = {
      userId:         agentId,
      name,
      email:          email  || '',
      phone:          phone  || '',
      source:         source || 'chatbot',
      status:         'new',
      notes:          notes  || '',
      followup_stage: 0,
      created_at:     new Date().toISOString()
    };

    // Save to DB properly (not just in-memory leads.set)
    await createLead(leadId, leadData);

    // getUserById is async — must be awaited so Supabase is checked
    const user = await getUserById(agentId);
    if (user) {
      fireInstantFollowup({ ...leadData, id: leadId }, { ...user, id: agentId })
        .catch(err => console.error('[CAPTURE] Follow-up error:', err.message));
    } else {
      console.warn('[CAPTURE] Agent not found for follow-up — agentId:', agentId);
    }

    res.status(201).json({ message: 'Lead captured', id: leadId });
  } catch (err) {
    console.error('[CAPTURE] Error:', err.message);
    res.status(500).json({ error: 'Failed to capture lead' });
  }
});

// POST /api/leads/:id/followup — Manual re-trigger from dashboard
router.post('/:id/followup', authMiddleware, async (req, res) => {
  try {
    // FIX: use getLeadById (reads Supabase) — leads.get fails after restart
    const lead = await getLeadById(req.params.id);
    if (!lead || lead.userId !== req.userId)
      return res.status(404).json({ error: 'Lead not found' });

    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await fireInstantFollowup(lead, { ...user, id: req.userId });
    await updateLead(req.params.id, { ...lead, status: 'contacted' });
    res.json({ message: 'Follow-up sent' });
  } catch (err) {
    console.error('[FOLLOWUP] Error:', err.message);
    res.status(500).json({ error: 'Failed to send follow-up' });
  }
});
function scheduleFollowups(leadId, leadData, userId) {
  const delays = [
    { day: 1, ms: 1 * 24 * 60 * 60 * 1000 },
    { day: 3, ms: 3 * 24 * 60 * 60 * 1000 },
    { day: 7, ms: 7 * 24 * 60 * 60 * 1000 },
  ];

  delays.forEach(({ day, ms }) => {
    setTimeout(async () => {
      try {
        const lead = await getLeadById(leadId);
        const user = await getUserById(userId);
        if (!lead || !user) return;
        if (lead.status === 'converted') return; // stop if already converted

        const bookingUrl = `${process.env.FRONTEND_URL}/pages/book.html?agent=${userId}`;

        if (lead.email) {
          const subjects = {
            1: `I found properties that match what you're looking for`,
            3: `Ready to schedule a viewing? Pick a time that works for you`,
            7: `Still looking? Let me know how I can help`
          };
 await sendEmail({
  to: lead.email,
  subject: subjects[day],
  html: leadFollowupEmail(user.name, user.agency, bookingUrl)
});
          console.log(`[FOLLOWUP] Day ${day} email sent to ${lead.email}`);
        }

        await updateLead(leadId, { ...lead, followup_stage: day });
      } catch (err) {
        console.error(`[FOLLOWUP] Day ${day} error:`, err.message);
      }
    }, ms);
  });
}

module.exports = router;
