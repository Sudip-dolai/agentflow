async function sendMetaWhatsApp(agent, to, message) {
  if (!agent?.meta_connected || !agent?.meta_phone_number_id || !agent?.meta_access_token) {
    console.log(`[WHATSAPP] Skipped — agent ${agent?.id} has no WhatsApp connected`);
    return { skipped: true };
  }
  const cleanTo = to.replace(/\D/g, '');
  const res = await fetch(`https://graph.facebook.com/v18.0/${agent.meta_phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agent.meta_access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: cleanTo, type: 'text', text: { body: message } })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Meta API error');
  return { success: true, id: data.messages?.[0]?.id };
}

// ---- MESSAGE TEMPLATES ----
const templates = {
  welcome: (agentName, agencyName, bookingUrl) =>
    `Hi! 👋 Thanks for your enquiry.\n\nI'm ${agentName}${agencyName ? ` from ${agencyName}` : ''}, your property specialist. I'll be in touch shortly with properties matching your requirements.\n\n📅 Want to book a viewing now? Pick a time here:\n${bookingUrl}\n\nLooking forward to helping you find the perfect property!`,

  day1: (agentName) =>
    `Hi! It's ${agentName} following up on your property enquiry 🏡\n\nI've found some great options that match what you're looking for.\n\nCan I send them over? Just reply *YES* and I'll share them with you now.`,

  day3: (agentName, bookingUrl) =>
    `Hi! ${agentName} here again 👋\n\nWould you like to arrange a viewing this week? It only takes 2 minutes to pick a time:\n\n📅 ${bookingUrl}\n\nLooking forward to showing you some great properties!`,

  day7: (agentName) =>
    `Hi! Just a quick check-in — are you still looking for a property? 🏠\n\nI'm here to help whenever you're ready. Just reply to this message and we can pick up where we left off.\n\n— ${agentName}`,

  trialEnding: (agentName) =>
    `Hi ${agentName}! ⚡ Your AgentFlow free trial ends tomorrow.\n\nDon't lose access to your listing generator, lead follow-ups, and weekly reports.\n\nUpgrade now: https://getagentflow.co/pages/dashboard.html`
};

module.exports = { sendMetaWhatsApp, templates };
