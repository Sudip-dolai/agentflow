// ============================================
// AGENTFLOW — WhatsApp Routes (Meta Business API)
// ============================================

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { leads, users, getUserById, createLead, updateLead, updateUser, supabase } = require('../config/db');
const { sendEmail } = require('../config/email');
const OpenAI = require('openai');

// ============================================
// META API HELPER — Send WhatsApp message
// from agent's own connected number
// ============================================
async function sendMetaWhatsApp(phoneNumberId, accessToken, to, message) {
  const cleanTo = to.replace(/\D/g, '');
  const response = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'text',
        text: { body: message }
      })
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Meta API error');
  return data;
}
// ============================================
// AI AUTO REPLY — Generate smart response
// using OpenAI API
// ============================================
async function generateAIReply(agentName, agencyName, buyerMessage, propertyInfo) {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `You are a professional real estate assistant for ${agentName} from ${agencyName || 'a real estate agency'}.

A buyer sent this WhatsApp message: "${buyerMessage}"
${propertyInfo ? `They are enquiring about: ${propertyInfo}` : ''}

Write a short, friendly WhatsApp reply that:
1. Greets them warmly (use their name if known, otherwise "Hi there")
2. Acknowledges their interest in the property
3. NEVER confirms if property is available or not — say agent will confirm shortly
4. Asks ONE qualifying question (budget OR timeline OR financing)
5. Keeps it under 100 words
6. Ends with agent's name signature: "${agentName}"
7. Uses natural conversational tone — NOT formal

Reply in English only. No hashtags. No emojis overload (max 2).`
      }]
    });
    return response.choices[0].message.content;
  } catch (err) {
    console.error('[AI REPLY] Failed:', err.message);
    // Fallback message if AI fails
    return `Hi there! 👋 Thanks for your message. ${agentName} will get back to you shortly to discuss this property and confirm all the details. Quick question — what's your ideal timeline for moving? This helps us find the best options for you.\n\n— ${agentName}`;
  }
}


// ============================================
// GET /api/whatsapp/meta/status
// Check if agent has connected their WhatsApp
// ============================================
router.get('/meta/status', async (req, res) => {
  try {
    // Get user from auth header
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.json({ connected: false });

    const token = authHeader.replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;

    const user = await getUserById(userId);
    if (!user) return res.json({ connected: false });

    const connected = !!(user.meta_connected && user.meta_phone_number_id && user.meta_access_token);

    res.json({
      connected,
      phone_number: user.whatsapp_number || '',
      meta_configured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET),
      webhook_url: `${process.env.FRONTEND_URL || 'https://getagentflow.co'}/api/whatsapp/webhook`
    });
  } catch (err) {
    res.json({ connected: false });
  }
});

// ============================================
// POST /api/whatsapp/meta/embedded-signup-callback
// Handle code from FB.login() JS SDK popup flow
// ============================================
router.post('/meta/embedded-signup-callback', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;

    const { code, phone_number_id, waba_id } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Missing authorization code' });

    // Exchange code for access token
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      `client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&code=${code}`
    );
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) throw new Error(tokenData.error?.message || 'No access token received');

    const accessToken = tokenData.access_token;
    let phoneNumberId = phone_number_id || null;
    let wabaId = waba_id || null;
    let phoneNumber = null;

    // Fetch display phone number if we have a phone_number_id
    if (phoneNumberId) {
      const phoneRes = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number&access_token=${accessToken}`
      );
      const phoneData = await phoneRes.json();
      phoneNumber = phoneData.display_phone_number || null;
    }

    await updateUser(userId, {
      meta_access_token: accessToken,
      meta_waba_id: wabaId || '',
      meta_phone_number_id: phoneNumberId || '',
      meta_connected: true,
      meta_connected_at: new Date().toISOString(),
      whatsapp_number: phoneNumber || ''
    });

    console.log(`[META EMBEDDED SIGNUP] ✅ Agent ${userId} connected WhatsApp: ${phoneNumber || phoneNumberId}`);

    // Subscribe webhook for this agent's number
    if (phoneNumberId) {
      await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      }).catch(err => console.error('[META] Webhook subscribe failed:', err.message));
    }

    res.json({ success: true, phone_number: phoneNumber });
  } catch (err) {
    console.error('[META EMBEDDED SIGNUP CALLBACK] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// GET /api/whatsapp/meta/callback
// Handle Meta OAuth callback after agent connects
// ============================================
router.get('/meta/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.redirect('/pages/dashboard.html?whatsapp=error');

    // Decode state to get userId
    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Exchange code for access token
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = `${process.env.FRONTEND_URL || 'https://getagentflow.co'}/api/whatsapp/meta/callback`;

    const tokenResponse = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${appId}&client_secret=${appSecret}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
    );
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) throw new Error('No access token received');

    const accessToken = tokenData.access_token;

    // Get agent's WhatsApp Business Account details
    const wabaResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/businesses?access_token=${accessToken}`
    );
    const wabaData = await wabaResponse.json();

    // Get phone numbers from WABA
    let phoneNumberId = null;
    let wabaId = null;
    let phoneNumber = null;

    if (wabaData.data?.length) {
      wabaId = wabaData.data[0].id;

      const phonesResponse = await fetch(
        `https://graph.facebook.com/v18.0/${wabaId}/phone_numbers?access_token=${accessToken}`
      );
      const phonesData = await phonesResponse.json();

      if (phonesData.data?.length) {
        phoneNumberId = phonesData.data[0].id;
        phoneNumber = phonesData.data[0].display_phone_number;
      }
    }

    // Save to database
    await updateUser(userId, {
      meta_access_token: accessToken,
      meta_waba_id: wabaId || '',
      meta_phone_number_id: phoneNumberId || '',
      meta_connected: true,
      meta_connected_at: new Date().toISOString(),
      whatsapp_number: phoneNumber || ''
    });

    console.log(`[META] ✅ Agent ${userId} connected WhatsApp: ${phoneNumber}`);

    // Register webhook for this agent's number
    if (phoneNumberId && accessToken) {
      await fetch(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/subscribed_apps`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      ).catch(err => console.error('[META] Webhook subscribe failed:', err.message));
    }

    res.redirect('/pages/dashboard.html?whatsapp=connected');
  } catch (err) {
    console.error('[META CALLBACK] Error:', err.message);
    res.redirect('/pages/dashboard.html?whatsapp=error');
  }
});

// ============================================
// POST /api/whatsapp/meta/disconnect
// Disconnect agent's WhatsApp
// ============================================
router.post('/meta/disconnect', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded.id;

    await updateUser(userId, {
      meta_connected: false,
      meta_access_token: null,
      meta_phone_number_id: null,
      meta_waba_id: null,
      meta_connected_at: null
    });

    res.json({ success: true, message: 'WhatsApp disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/whatsapp/webhook
// Meta webhook verification
// ============================================
router.get('/webhook', (req, res) => {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'agentflow_webhook_verify';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[META WEBHOOK] Verified successfully');
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

// ============================================
// POST /api/whatsapp/webhook
// Receive incoming WhatsApp messages from Meta
// Auto capture leads + AI auto reply
// ============================================
router.post('/webhook', async (req, res) => {
  // Respond immediately to Meta
  res.status(200).json({ status: 'ok' });

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value?.messages;
        if (!messages?.length) continue;

        for (const message of messages) {
          if (message.type !== 'text') continue;

          const fromPhone = message.from; // buyer's phone
          const messageText = message.text?.body || '';
          const buyerName = value.contacts?.[0]?.profile?.name || `WhatsApp ${fromPhone.slice(-4)}`;
          const toNumberId = value.metadata?.phone_number_id; // agent's phone number ID

          console.log(`[META WEBHOOK] Message from ${fromPhone} (${buyerName}): "${messageText.substring(0, 80)}"`);

          // ---- FIND AGENT BY PHONE NUMBER ID ----
          let assignedUser = null;
          let assignedUserId = null;

          if (supabase) {
            const { data } = await supabase.from('users')
              .select('*')
              .eq('meta_phone_number_id', toNumberId)
              .eq('meta_connected', true)
              .limit(1)
              .catch(() => ({ data: [] }));

            if (data?.length) {
              assignedUser = data[0];
              assignedUserId = data[0].id;
            }
          }

          // Fallback — find any connected agent
          if (!assignedUser && supabase) {
            const { data } = await supabase.from('users')
              .select('*')
              .eq('meta_connected', true)
              .in('plan', ['trial', 'active'])
              .limit(1)
              .catch(() => ({ data: [] }));

            if (data?.length) {
              assignedUser = data[0];
              assignedUserId = data[0].id;
            }
          }

          if (!assignedUser) {
            console.log('[META WEBHOOK] No connected agent found for this number');
            continue;
          }

          const bookingUrl = `${process.env.FRONTEND_URL || 'https://getagentflow.co'}/pages/book.html?agent=${assignedUserId}`;

          // ---- CHECK IF ALREADY A LEAD ----
          let existingLead = null;
          let existingLeadId = null;

          if (supabase) {
            const cleanPhone = fromPhone.replace(/\D/g, '').slice(-9);
            const { data } = await supabase.from('leads')
              .select('*')
              .eq('user_id', assignedUserId)
              .ilike('phone', `%${cleanPhone}%`)
              .limit(1)
              .catch(() => ({ data: [] }));

            if (data?.length) {
              existingLeadId = data[0].id;
              existingLead = data[0];
            }
          }

          // ---- EXISTING LEAD: update last message ----
          if (existingLead) {
            console.log(`[META WEBHOOK] Known lead ${fromPhone} — updating`);
            await updateLead(existingLeadId, {
              last_whatsapp: messageText,
              last_contact: new Date().toISOString(),
              status: 'replied'
            });

            // Stop follow-up sequence if buyer replied
            if (supabase) {
              await supabase.from('leads')
                .update({ followup_stopped: true, followup_stage: -1 })
                .eq('id', existingLeadId)
                .catch(() => {});
            }
            continue;
          }

          // ---- NEW LEAD: create + AI reply ----

          // Extract property info from message (from Bayut/PF pre-filled text)
          let propertyInfo = null;
          const propertyMatch = messageText.match(/interested in (.+?)(?:\s+listed|\s+on|\s+for|$)/i);
          if (propertyMatch) propertyInfo = propertyMatch[1];

          // Create lead
          const leadId = uuidv4();
          await createLead(leadId, {
            userId: assignedUserId,
            user_id: assignedUserId,
            name: buyerName,
            email: '',
            phone: fromPhone,
            source: 'whatsapp',
            status: 'new',
            notes: `WhatsApp enquiry: "${messageText.substring(0, 300)}"`,
            property_interest: propertyInfo || '',
            followup_stage: 0,
            followup_stopped: false,
            last_whatsapp: messageText,
            last_contact: new Date().toISOString(),
            created_at: new Date().toISOString()
          });

          console.log(`[META WEBHOOK] ✅ New lead: ${buyerName} (${fromPhone}) → agent ${assignedUser.name}`);

          // Generate AI reply
          const aiReply = await generateAIReply(
            assignedUser.name,
            assignedUser.agency,
            messageText,
            propertyInfo
          );

          // Send AI reply from agent's number
          if (assignedUser.meta_phone_number_id && assignedUser.meta_access_token) {
            await sendMetaWhatsApp(
              assignedUser.meta_phone_number_id,
              assignedUser.meta_access_token,
              fromPhone,
              aiReply
            ).catch(err => console.error('[META] AI reply send failed:', err.message));
          }

          // Notify agent by email
          if (assignedUser.email) {
            sendEmail({
              to: assignedUser.email,
              subject: `📱 New WhatsApp Lead — ${buyerName}`,
              html: `
<div style="font-family:Arial,sans-serif;max-width:600px;padding:32px;background:#080c14;color:#e8eaf0;">
  <h2 style="color:#c9a84c;">New WhatsApp Lead! 📱</h2>
  <p style="color:#8892a4;">Someone messaged you on WhatsApp and has been added to your leads automatically.</p>
  <div style="background:#0d1420;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin:20px 0;">
    <p><strong>Name:</strong> ${buyerName}</p>
    <p><strong>WhatsApp:</strong> ${fromPhone}</p>
    ${propertyInfo ? `<p><strong>Interested in:</strong> ${propertyInfo}</p>` : ''}
    <p style="margin-top:12px;"><strong>Message:</strong></p>
    <p style="color:#8892a4;font-style:italic;">"${messageText.substring(0, 300)}"</p>
  </div>
  <div style="background:#0d2010;border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:16px;margin:16px 0;">
    <p style="color:#22c55e;font-weight:700;">✅ AI replied instantly from your WhatsApp number</p>
    <p style="color:#8892a4;font-size:0.85rem;margin-top:8px;">AI Message sent: "${aiReply.substring(0, 150)}..."</p>
  </div>
  <a href="${process.env.FRONTEND_URL || 'https://getagentflow.co'}/pages/dashboard.html"
     style="background:#c9a84c;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px;">
    View in Dashboard →
  </a>
</div>`
            }).catch(err => console.error('[META] Agent email notify failed:', err.message));
          }

          // Notify agent on WhatsApp (on their personal number if different)
          const agentPersonalNumber = assignedUser.whatsapp_number;
          if (agentPersonalNumber && agentPersonalNumber !== fromPhone && assignedUser.meta_phone_number_id) {
            sendMetaWhatsApp(
              assignedUser.meta_phone_number_id,
              assignedUser.meta_access_token,
              agentPersonalNumber,
              `🔥 New WhatsApp lead!\n\nName: ${buyerName}\nPhone: ${fromPhone}${propertyInfo ? `\nProperty: ${propertyInfo}` : ''}\n\n✅ AI replied automatically.\n\nView in dashboard: ${process.env.FRONTEND_URL}/pages/dashboard.html`
            ).catch(() => {});
          }

          // Schedule follow-up sequence (Day 1, 3, 7)
          scheduleFollowUps(leadId, assignedUserId, fromPhone, buyerName, assignedUser, bookingUrl);
        }
      }
    }
  } catch (err) {
    console.error('[META WEBHOOK] Handler error:', err.message, err.stack);
  }
});

// ============================================
// FOLLOW-UP SEQUENCE SCHEDULER
// Day 1, Day 3, Day 7 — stops if buyer replies
// ============================================
function scheduleFollowUps(leadId, agentId, buyerPhone, buyerName, agent, bookingUrl) {
  const followups = [
    {
      delay: 24 * 60 * 60 * 1000, // Day 1
      day: 1,
      message: `Hi ${buyerName}! 👋 Just following up on your property enquiry. Have you had a chance to think about it? I have some great options that might interest you.\n\n— ${agent.name}`
    },
    {
      delay: 3 * 24 * 60 * 60 * 1000, // Day 3
      day: 3,
      message: `Hi ${buyerName}! Properties in this area are moving fast. 🏠 Would you like to schedule a quick viewing call to see what's available? Book here: ${bookingUrl}\n\n— ${agent.name}`
    },
    {
      delay: 7 * 24 * 60 * 60 * 1000, // Day 7
      day: 7,
      message: `Hi ${buyerName}, last message from me! 😊 If you're still looking for a property, I'm here to help. Just reply anytime and I'll pick up right where we left off.\n\n— ${agent.name}`
    }
  ];

  for (const followup of followups) {
    setTimeout(async () => {
      try {
        // Check if lead still needs follow-up
        if (!supabase) return;
        const { data } = await supabase.from('leads')
          .select('followup_stopped, status')
          .eq('id', leadId)
          .single()
          .catch(() => ({ data: null }));

        if (!data || data.followup_stopped || data.status === 'replied') {
          console.log(`[FOLLOWUP] Day ${followup.day} skipped — lead replied or stopped`);
          return;
        }

        // Get fresh agent credentials
        const freshAgent = await getUserById(agentId);
        if (!freshAgent?.meta_connected || !freshAgent?.meta_phone_number_id) return;

        await sendMetaWhatsApp(
          freshAgent.meta_phone_number_id,
          freshAgent.meta_access_token,
          buyerPhone,
          followup.message
        );

        // Update follow-up stage
        await supabase.from('leads')
          .update({ followup_stage: followup.day })
          .eq('id', leadId)
          .catch(() => {});

        console.log(`[FOLLOWUP] Day ${followup.day} sent to ${buyerPhone}`);
      } catch (err) {
        console.error(`[FOLLOWUP] Day ${followup.day} failed:`, err.message);
      }
    }, followup.delay);
  }
}

// ============================================
// GET /api/whatsapp/status — Legacy check
// ============================================
router.get('/status', (req, res) => {
  res.json({
    configured: !!(process.env.META_APP_ID),
    provider: 'Meta WhatsApp Business API',
    webhook_url: `${process.env.FRONTEND_URL || 'https://getagentflow.co'}/api/whatsapp/webhook`
  });
});

module.exports = router;