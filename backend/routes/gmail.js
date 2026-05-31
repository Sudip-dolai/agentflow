// ============================================
// AGENTFLOW — Gmail Integration
// Auto-parses Rightmove/Zoopla enquiry emails
// and creates leads automatically
// ============================================

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { users, leads, updateUser, createLead, getUserById } = require('../config/db');
const { sendEmail, leadFollowupEmail } = require('../config/email');
const { sendWhatsApp, templates } = require('../config/whatsapp');
const { v4: uuidv4 } = require('uuid');

// ---- GMAIL OAUTH SETUP ----
// Uses Google OAuth same credentials as Calendar
// Extra scope: gmail.readonly

function getGmailOAuthClient() {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI_GMAIL || `${process.env.FRONTEND_URL || 'http://localhost:5000'}/api/gmail/callback`
  );
}

// GET /api/gmail/connect — Start OAuth flow for Gmail
router.get('/connect', authMiddleware, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({
      error: 'Google not configured',
      message: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file'
    });
  }

  const oauth2Client = getGmailOAuthClient();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify'
    ],
    state: JSON.stringify({ userId: req.userId, source: 'gmail' })
  });

  res.json({ auth_url: authUrl });
});

// GET /api/gmail/callback — OAuth callback
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('[GMAIL] OAuth error:', error);
    return res.redirect('/pages/dashboard.html?gmail=error');
  }

  let userId;
  try {
    const parsed = JSON.parse(state);
    userId = parsed.userId;
  } catch (e) {
    userId = state;
  }

  if (!code || !userId) {
    return res.redirect('/pages/dashboard.html?gmail=error');
  }

  try {
    const oauth2Client = getGmailOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    await updateUser(userId, {
      gmail_connected: true,
      gmail_tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
        token_type: tokens.token_type
      }
    });

    console.log(`[GMAIL] Connected for user ${userId}`);
    res.redirect('/pages/dashboard.html?gmail=connected');
  } catch (err) {
    console.error('[GMAIL] Token exchange error:', err.message);
    res.redirect('/pages/dashboard.html?gmail=error');
  }
});

// GET /api/gmail/status
router.get('/status', authMiddleware, async (req, res) => {
  // FIX: use getUserById (reads Supabase)
  const user = await getUserById(req.userId);
  res.json({
    connected: !!(user?.gmail_connected && user?.gmail_tokens),
    google_configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  });
});

// DELETE /api/gmail/disconnect
router.delete('/disconnect', authMiddleware, async (req, res) => {
  await updateUser(req.userId, { gmail_connected: false, gmail_tokens: null });
  res.json({ message: 'Gmail disconnected' });
});

// POST /api/gmail/sync — Manually trigger a Gmail scan for this agent
router.post('/sync', authMiddleware, async (req, res) => {
  // FIX: use getUserById (reads Supabase)
  const user = await getUserById(req.userId);
  if (!user?.gmail_connected || !user?.gmail_tokens) {
    return res.status(400).json({ error: 'Gmail not connected' });
  }

  try {
    const count = await scanGmailForLeads(req.userId, user);
    res.json({ message: `Gmail scanned. ${count} new lead(s) captured.`, new_leads: count });
  } catch (err) {
    console.error('[GMAIL] Sync error:', err.message);
    res.status(500).json({ error: 'Gmail sync failed: ' + err.message });
  }
});

// ============================================
// CORE: SCAN GMAIL AND EXTRACT LEADS
// ============================================

async function scanGmailForLeads(userId, user) {
  const { google } = require('googleapis');
  const oauth2Client = getGmailOAuthClient();
  oauth2Client.setCredentials(user.gmail_tokens);

  // Auto refresh tokens
  oauth2Client.on('tokens', async (newTokens) => {
    const updated = { ...user.gmail_tokens, ...newTokens };
    await updateUser(userId, { gmail_tokens: updated });
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Search for unread enquiry emails from portals
  // Rightmove and Zoopla both have distinctive sender patterns
  const query = [
    'is:unread',
    '(',
    'from:rightmove.co.uk OR from:zoopla.co.uk OR',
    'subject:"enquiry" OR subject:"viewing request" OR',
    'subject:"property enquiry" OR subject:"new enquiry"',
    ')'
  ].join(' ');

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 20
  });

  const messages = listRes.data.messages || [];
  let newLeadsCount = 0;

  for (const msg of messages) {
    try {
      const fullMsg = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });

      const lead = parseEnquiryEmail(fullMsg.data);
      if (!lead) continue;

      // Check if we already captured this lead (avoid duplicates via gmail_message_id)
      let alreadyExists = false;
      for (const [, existingLead] of leads) {
        if (existingLead.userId === userId && existingLead.gmail_message_id === msg.id) {
          alreadyExists = true;
          break;
        }
      }
      if (alreadyExists) continue;

      // Create the lead
      const leadId = uuidv4();
      const leadData = {
        userId,
        name: lead.name,
        email: lead.email || '',
        phone: lead.phone || '',
        source: lead.source || 'rightmove',
        status: 'new',
        notes: lead.notes || '',
        property: lead.property || '',
        followup_stage: 0,
        gmail_message_id: msg.id,
        created_at: new Date().toISOString()
      };

      await createLead(leadId, leadData);
      newLeadsCount++;

      console.log(`[GMAIL] New lead captured: ${lead.name} (${lead.email}) from ${lead.source}`);

      // Fire instant follow-up
      const bookingUrl = `${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/book.html?agent=${userId}`;
      const channel = user.follow_up_channel || 'email';

      if ((channel === 'email' || channel === 'both') && lead.email) {
        sendEmail({
          to: lead.email,
          subject: `Thanks for your enquiry — I'll be in touch shortly`,
          html: leadFollowupEmail(user.name, user.agency, bookingUrl)
        }).catch(err => console.error('[GMAIL] Email follow-up failed:', err.message));
      }

      if ((channel === 'whatsapp' || channel === 'both') && lead.phone) {
        sendWhatsApp(lead.phone, templates.welcome(user.name, user.agency, bookingUrl))
          .catch(err => console.error('[GMAIL] WhatsApp follow-up failed:', err.message));
      }

      // Mark email as read so we don't process it again
      await gmail.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: { removeLabelIds: ['UNREAD'] }
      }).catch(console.error);

    } catch (err) {
      console.error(`[GMAIL] Error processing message ${msg.id}:`, err.message);
    }
  }

  return newLeadsCount;
}

// ============================================
// PARSE EMAIL INTO LEAD DATA
// Handles Rightmove + Zoopla email formats
// ============================================

function parseEnquiryEmail(message) {
  try {
    const headers = message.payload?.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const from = getHeader('from');
    const subject = getHeader('subject');
    const body = extractEmailBody(message.payload);

    // Determine source
    let source = 'email';
    if (from.includes('rightmove') || subject.toLowerCase().includes('rightmove')) source = 'rightmove';
    else if (from.includes('zoopla') || subject.toLowerCase().includes('zoopla')) source = 'zoopla';

    // ---- RIGHTMOVE EMAIL FORMAT ----
    // "You have received an enquiry from: John Smith"
    // "Email: john@email.com"
    // "Phone: 07123456789"
    // "Property: 3 bed flat, London"
    // "Message: I would like to arrange a viewing"

    let name = '';
    let email = '';
    let phone = '';
    let property = '';
    let notes = '';

    // Try structured parsing first
    const namePatterns = [
      /enquiry from[:\s]+([A-Za-z\s]+?)[\n\r]/i,
      /name[:\s]+([A-Za-z\s]+?)[\n\r]/i,
      /from[:\s]+([A-Za-z\s]{3,40})[\n\r]/i,
      /contact[:\s]+([A-Za-z\s]+?)[\n\r]/i
    ];

    const emailPatterns = [
      /email[:\s]+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i,
      /reply[:\s]+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i,
      /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/
    ];

    const phonePatterns = [
      /(?:phone|tel|mobile|number)[:\s]+([\d\s\+\(\)\-]{7,20})/i,
      /((?:\+44|0044|0)[\d\s\-]{9,13})/
    ];

    const propertyPatterns = [
      /property[:\s]+(.+?)[\n\r]/i,
      /listing[:\s]+(.+?)[\n\r]/i,
      /address[:\s]+(.+?)[\n\r]/i,
      /regarding[:\s]+(.+?)[\n\r]/i
    ];

    const messagePatterns = [
      /message[:\s]+([\s\S]{10,500}?)(?:\n\n|\r\n\r\n|$)/i,
      /comment[:\s]+([\s\S]{10,300})/i
    ];

    for (const p of namePatterns) {
      const m = body.match(p);
      if (m) { name = m[1].trim(); break; }
    }

    for (const p of emailPatterns) {
      const m = body.match(p);
      // Skip portal's own email
      if (m && !m[1].includes('rightmove') && !m[1].includes('zoopla') && !m[1].includes('noreply')) {
        email = m[1].trim();
        break;
      }
    }

    for (const p of phonePatterns) {
      const m = body.match(p);
      if (m) { phone = m[1].trim().replace(/\s+/g, ' '); break; }
    }

    for (const p of propertyPatterns) {
      const m = body.match(p);
      if (m) { property = m[1].trim(); break; }
    }

    for (const p of messagePatterns) {
      const m = body.match(p);
      if (m) { notes = m[1].trim().substring(0, 500); break; }
    }

    // If we couldn't extract a name, try from "From:" header
    if (!name && from) {
      const fromName = from.replace(/<.*>/, '').trim().replace(/"/g, '');
      if (fromName && !fromName.includes('rightmove') && !fromName.includes('zoopla') && fromName.length > 2) {
        name = fromName;
      }
    }

    // Must have at least a name to create a lead
    if (!name || name.length < 2) return null;

    // Must have email or phone
    if (!email && !phone) return null;

    return { name, email, phone, source, property, notes };

  } catch (err) {
    console.error('[GMAIL] Parse error:', err.message);
    return null;
  }
}

function extractEmailBody(payload) {
  let body = '';

  function decode(data) {
    try {
      return Buffer.from(data, 'base64').toString('utf-8');
    } catch (e) { return ''; }
  }

  function extract(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body += decode(part.body.data) + '\n';
    } else if (part.mimeType === 'text/html' && part.body?.data && !body) {
      // Strip HTML tags as fallback
      const html = decode(part.body.data);
      body += html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') + '\n';
    }
    if (part.parts) {
      for (const subpart of part.parts) extract(subpart);
    }
  }

  extract(payload);
  return body;
}

// Export for use in cron
module.exports = router;
module.exports.scanGmailForLeads = scanGmailForLeads;
