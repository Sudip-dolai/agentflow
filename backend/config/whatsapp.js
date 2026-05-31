// ============================================
// AGENTFLOW — WhatsApp Config (Twilio)
// ============================================
// Get keys from: https://console.twilio.com
// Free sandbox for testing — no approval needed
// Production requires Meta Business verification

function getClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  try {
    return require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch (e) {
    console.log('[WHATSAPP] Twilio not installed. Run: npm install twilio');
    return null;
  }
}

async function sendWhatsApp(to, message) {
  const client = getClient();
  if (!client) {
    console.log(`[WHATSAPP] Skipped (not configured): ${to}`);
    return { skipped: true };
  }

  // Clean phone number — ensure it has country code
  const cleanPhone = to.replace(/\s+/g, '').replace(/[^+\d]/g, '');
  const toNumber = cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`;

  try {
    const result = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
      to: `whatsapp:${toNumber}`,
      body: message
    });
    console.log(`[WHATSAPP] Sent to ${toNumber} — SID: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error(`[WHATSAPP] Failed to send to ${toNumber}:`, err.message);
    return { error: err.message };
  }
}

// ---- MESSAGE TEMPLATES ----
const templates = {
  // Day 0 — Instant reply when lead comes in
  welcome: (agentName, agencyName, bookingUrl) =>
    `Hi! 👋 Thanks for your enquiry.\n\nI'm ${agentName}${agencyName ? ` from ${agencyName}` : ''}, your property specialist. I'll be in touch shortly with properties matching your requirements.\n\n📅 Want to book a viewing now? Pick a time here:\n${bookingUrl}\n\nLooking forward to helping you find the perfect property!`,

  // Day 1 — Property match follow-up
  day1: (agentName) =>
    `Hi! It's ${agentName} following up on your property enquiry 🏡\n\nI've found some great options that match what you're looking for.\n\nCan I send them over? Just reply *YES* and I'll share them with you now.`,

  // Day 3 — Viewing invite
  day3: (agentName, bookingUrl) =>
    `Hi! ${agentName} here again 👋\n\nWould you like to arrange a viewing this week? It only takes 2 minutes to pick a time:\n\n📅 ${bookingUrl}\n\nLooking forward to showing you some great properties!`,

  // Day 7 — Final check-in
  day7: (agentName) =>
    `Hi! Just a quick check-in — are you still looking for a property? 🏠\n\nI'm here to help whenever you're ready. Just reply to this message and we can pick up where we left off.\n\n— ${agentName}`,

  // Trial ending warning to agent
  trialEnding: (agentName) =>
    `Hi ${agentName}! ⚡ Your AgentFlow free trial ends tomorrow.\n\nDon't lose access to your listing generator, lead follow-ups, and weekly reports.\n\nUpgrade now: https://theagentflow.co/pages/dashboard.html`
};

module.exports = { sendWhatsApp, templates };
