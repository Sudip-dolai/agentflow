// ============================================
// AGENTFLOW — WhatsApp Routes (Twilio)
// Inbound webhook: captures leads + auto DM
// ============================================

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { leads, users, getUserById, createLead, updateLead, supabase } = require('../config/db');
const { sendWhatsApp, templates } = require('../config/whatsapp');
const { sendEmail, leadFollowupEmail }  = require('../config/email');

// ============================================
// KEYWORD RESPONSES
// Sent when existing lead sends a keyword
// ============================================
const KEYWORD_RESPONSES = {
  hi:        (agent) => `Hi! 👋 ${agent.name} here. How can I help you today? Are you looking to buy, rent, or invest?`,
  hello:     (agent) => `Hello! 😊 I'm ${agent.name}. Looking for a property in ${agent.market === 'uk' ? 'the UK' : 'Dubai/UAE'}? I'm here to help!`,
  yes:       (agent, bookingUrl) => `Great! 🏡 Let me send you some matching properties.\n\nYou can also book a viewing call here:\n📅 ${bookingUrl}`,
  viewing:   (agent, bookingUrl) => `📅 Book your viewing here — pick any available slot:\n\n${bookingUrl}\n\nIt only takes 2 minutes!`,
  price:     (agent) => `Happy to discuss pricing! Reply with the area and property type you're interested in and I'll get you the latest figures. 🏠`,
  stop:      () => `You've been unsubscribed from property updates. Reply START to re-subscribe.`,
  start:     (agent) => `Welcome back! 👋 I'm ${agent.name}. Send me a message anytime to continue your property search.`,
  help:      (agent, bookingUrl) => `Here's what I can help with:\n\n🏠 Property search\n📅 Book a viewing → ${bookingUrl}\n💬 Answer your questions\n\nJust send me a message!`,
};

// ============================================
// INCOMING WHATSAPP WEBHOOK
// POST /api/whatsapp/webhook
//
// Set this URL in Twilio Console:
// Messaging → Settings → WhatsApp Sandbox
// "When a message comes in" →
// https://yourdomain.com/api/whatsapp/webhook
// ============================================

router.post('/webhook', async (req, res) => {
  // Twilio MUST get TwiML back immediately — send before any async work
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  try {
    const { From, Body, ProfileName, To } = req.body;
    if (!From || !Body) return;

    const phone       = From.replace('whatsapp:', '').trim();
    const messageText = (Body || '').trim();
    const keyword     = messageText.toLowerCase().split(/\s+/)[0];

    console.log(`[WHATSAPP] Incoming from ${phone} (${ProfileName || 'Unknown'}): "${messageText.substring(0, 80)}"`);

    // ---- FIND WHICH AGENT OWNS THIS TWILIO NUMBER ----
    const toNumber = (To || '').replace('whatsapp:', '').trim();
    let assignedUserId = null;
    let assignedUser   = null;

    // FIX: load active WA agents from Supabase (in-memory empty after restart)
    let waAgents = [];
    if (supabase) {
      const { data } = await supabase.from('users').select('*')
        .in('plan', ['trial','active'])
        .in('follow_up_channel', ['whatsapp','both'])
        .catch(() => ({ data: [] }));
      if (data?.length) waAgents = data.map(u => [u.id, u]);
    }
    if (!waAgents.length) {
      waAgents = [...users.entries()].filter(([,u]) =>
        (u.plan === 'trial' || u.plan === 'active') &&
        (u.follow_up_channel === 'whatsapp' || u.follow_up_channel === 'both')
      );
    }

    for (const [uid, user] of waAgents) {
      const agentTwilio = (user.whatsapp_business_number || process.env.TWILIO_WHATSAPP_FROM || '')
        .replace('whatsapp:', '').trim();
      if (toNumber && agentTwilio && toNumber === agentTwilio) {
        assignedUserId = uid;
        assignedUser   = { id: uid, ...user };
        break;
      }
      if (!assignedUserId) {
        assignedUserId = uid;
        assignedUser   = { id: uid, ...user };
      }
    }

    // Last fallback: any active agent
    if (!assignedUserId) {
      let allAgents = [];
      if (supabase) {
        const { data } = await supabase.from('users').select('*').in('plan', ['trial','active']).limit(1).catch(() => ({ data: [] }));
        if (data?.length) allAgents = data.map(u => [u.id, u]);
      }
      if (!allAgents.length) allAgents = [...users.entries()].filter(([,u]) => u.plan === 'trial' || u.plan === 'active');
      if (allAgents.length) {
        const [uid, user] = allAgents[0];
        assignedUserId = uid;
        assignedUser   = { id: uid, ...user };
      }
    }

    if (!assignedUserId || !assignedUser) {
      console.log('[WHATSAPP] No active agent found — ignoring message');
      return;
    }

    const bookingUrl = `${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/book.html?agent=${assignedUserId}`;

    // ---- CHECK IF ALREADY A LEAD ----
    const cleanPhone = phone.replace(/\s+/g, '').replace(/[^+\d]/g, '');
    let existingLeadId = null;
    let existingLead   = null;

    // FIX: check Supabase for existing lead (in-memory empty after restart)
    if (supabase) {
      const { data } = await supabase.from('leads')
        .select('*').eq('user_id', assignedUserId)
        .ilike('phone', `%${cleanPhone.slice(-9)}%`).limit(1)
        .catch(() => ({ data: [] }));
      if (data?.length) {
        existingLeadId = data[0].id;
        existingLead   = { ...data[0], userId: data[0].user_id };
      }
    }
    // Fallback to in-memory
    if (!existingLead) {
      for (const [lid, lead] of leads) {
        if (lead.userId !== assignedUserId) continue;
        const cleanLeadPhone = (lead.phone || '').replace(/\s+/g, '').replace(/[^+\d]/g, '');
        if (cleanLeadPhone === cleanPhone || cleanLeadPhone === cleanPhone.replace('+', '')) {
          existingLeadId = lid;
          existingLead   = lead;
          break;
        }
      }
    }

    // ---- EXISTING LEAD: update notes + respond to keyword ----
    if (existingLead) {
      console.log(`[WHATSAPP] Known lead ${phone} — updating last message`);

      // Update lead record with latest message
      await updateLead(existingLeadId, {
        last_whatsapp: messageText,
        last_contact:  new Date().toISOString()
      });

      // Respond to keywords
      if (KEYWORD_RESPONSES[keyword]) {
        const reply = KEYWORD_RESPONSES[keyword](assignedUser, bookingUrl);
        await sendWhatsApp(phone, reply).catch(err =>
          console.error('[WHATSAPP] Keyword reply failed:', err.message)
        );
      }
      return; // Don't create duplicate lead
    }

    // ---- NEW LEAD: create + fire instant follow-up ----
    const name   = ProfileName || `WhatsApp ${phone.slice(-4)}`;
    const leadId = uuidv4();

    await createLead(leadId, {
      userId:          assignedUserId,
      name,
      email:           '',
      phone,
      source:          'whatsapp',
      status:          'new',
      notes:           `First WhatsApp message: "${messageText.substring(0, 300)}"`,
      followup_stage:  0,
      last_whatsapp:   messageText,
      last_contact:    new Date().toISOString(),
      created_at:      new Date().toISOString()
    });

    console.log(`[WHATSAPP] ✅ New lead: ${name} (${phone}) → agent ${assignedUser.name}`);

    // 1. Instant WhatsApp reply to the lead
    await sendWhatsApp(phone, templates.welcome(
      assignedUser.name,
      assignedUser.agency,
      bookingUrl
    )).catch(err => console.error('[WHATSAPP] Instant reply failed:', err.message));

    // 2. Notify agent by email
    if (assignedUser.email) {
      sendEmail({
        to:      assignedUser.email,
        subject: `📱 New WhatsApp Lead — ${name}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;padding:32px;background:#080c14;color:#e8eaf0;">
  <h2 style="color:#c9a84c;">New WhatsApp Lead! 📱</h2>
  <p style="color:#8892a4;">Someone messaged you on WhatsApp and has been added to your leads automatically.</p>
  <div style="background:#0d1420;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin:20px 0;">
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>WhatsApp:</strong> ${phone}</p>
    <p style="margin-top:12px;"><strong>Message:</strong></p>
    <p style="color:#8892a4;font-style:italic;">"${messageText.substring(0, 300)}"</p>
  </div>
  <p style="color:#8892a4;font-size:0.85rem;">An instant follow-up has been sent automatically. The Day 1, 3, and 7 sequence will run automatically.</p>
  <a href="${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html"
     style="background:#c9a84c;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px;">
    View in Dashboard →
  </a>
</div>`
      }).catch(err => console.error('[WHATSAPP] Agent email notify failed:', err.message));
    }

    // 3. Notify agent on WhatsApp too (if they have a personal WA number set)
    if (assignedUser.whatsapp_number && assignedUser.whatsapp_number !== phone) {
      sendWhatsApp(
        assignedUser.whatsapp_number,
        `📱 New WhatsApp lead!\n\nName: ${name}\nPhone: ${phone}\nMessage: "${messageText.substring(0, 150)}"\n\n✅ Instant follow-up sent automatically.`
      ).catch(console.error);
    }

  } catch (err) {
    console.error('[WHATSAPP] Webhook handler error:', err.message, err.stack);
    // TwiML already sent — Twilio won't retry
  }
});

// ============================================
// POST /api/whatsapp/send — Manual send
// ============================================
router.post('/send', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message)
      return res.status(400).json({ error: 'to and message required' });
    const result = await sendWhatsApp(to, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/whatsapp/status — Config check
// ============================================
router.get('/status', (req, res) => {
  const configured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  res.json({
    configured,
    from_number:  process.env.TWILIO_WHATSAPP_FROM || 'not set',
    webhook_url:  `${process.env.FRONTEND_URL || 'https://yourdomain.com'}/api/whatsapp/webhook`,
    setup_guide:  'Set the webhook URL above in Twilio Console → Messaging → WhatsApp Sandbox Settings'
  });
});

module.exports = router;
