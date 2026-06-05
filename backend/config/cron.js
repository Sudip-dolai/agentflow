// ============================================
// AGENTFLOW — Scheduled Jobs (Cron)
// Email + WhatsApp sequences
// ============================================

const cron = require('node-cron');
const { users, leads, bookings, updateUser, updateLead, getUserById } = require('./db');
const { sendEmail } = require('./email');
const { sendWhatsApp, templates } = require('./whatsapp');

// ---- FOLLOW-UP SEQUENCE — Every hour ----
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Checking follow-up sequences...');
  const now = Date.now();

  // Load leads from Supabase if available, fall back to memory
  let allLeads = [];
  const { supabase } = require('./db');
  if (supabase) {
    const { data } = await supabase
      .from('leads')
      .select('*, users!inner(id,name,email,agency,follow_up_channel,whatsapp_number,plan)')
      .in('status', ['new', 'contacted'])
      .lt('followup_stage', 3)
      .catch(() => ({ data: [] }));
    if (data?.length) {
      allLeads = data.map(l => ({
        id: l.id, userId: l.user_id, name: l.name, email: l.email,
        phone: l.phone, source: l.source, followup_stage: l.followup_stage,
        created_at: l.created_at, status: l.status,
        _user: l.users
      }));
    }
  }

  // Also process in-memory leads (dev mode)
  for (const [id, lead] of leads) {
    if (!allLeads.find(l => l.id === id)) {
      allLeads.push({ id, ...lead });
    }
  }

  for (const lead of allLeads) {
    if (lead.status === 'closed' || lead.status === 'converted') continue;

    // FIX: fall back to getUserById (reads Supabase) not users.get() (empty after restart)
    const user = lead._user || await getUserById(lead.userId);
    if (!user) continue;
    if (user.plan !== 'active' && user.plan !== 'trial') continue;

    const hoursOld   = (now - new Date(lead.created_at)) / (1000 * 60 * 60);
    const channel = (user.gmail_connected && user.whatsapp_connected) ? 'both' : user.whatsapp_connected ? 'whatsapp' : 'email';
    const bookingUrl = `${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/book.html?agent=${lead.userId}`;

    try {
      if (hoursOld >= 24 && hoursOld < 25 && lead.followup_stage < 1) {
        await sendFollowup(lead, user, channel, 1, bookingUrl);
        await updateLead(lead.id, { followup_stage: 1 });
        leads.set(lead.id, { ...lead, followup_stage: 1 });
      }
      if (hoursOld >= 72 && hoursOld < 73 && lead.followup_stage < 2) {
        await sendFollowup(lead, user, channel, 2, bookingUrl);
        await updateLead(lead.id, { followup_stage: 2 });
        leads.set(lead.id, { ...lead, followup_stage: 2 });
      }
      if (hoursOld >= 168 && hoursOld < 169 && lead.followup_stage < 3) {
        await sendFollowup(lead, user, channel, 3, bookingUrl);
        await updateLead(lead.id, { followup_stage: 3 });
        leads.set(lead.id, { ...lead, followup_stage: 3 });
      }
    } catch (err) {
      console.error(`[CRON] Follow-up error for lead ${lead.id}:`, err.message);
    }
  }
});

async function sendFollowup(lead, user, channel, stage, bookingUrl) {
  const promises = [];

  if (channel === 'whatsapp' || channel === 'both') {
    if (lead.phone) {
      let msg;
      if (stage === 1) msg = templates.day1(user.name);
      if (stage === 2) msg = templates.day3(user.name, bookingUrl);
      if (stage === 3) msg = templates.day7(user.name);
      promises.push(sendWhatsApp(lead.phone, msg).catch(console.error));
    }
  }

  if (channel === 'email' || channel === 'both' || (!lead.phone)) {
    if (lead.email) {
      const subjects = [
        null,
        `I found properties matching your requirements`,
        `Ready to schedule a viewing?`,
        `Still looking? Let me know how I can help`
      ];
      const bodies = [
        null,
        `<p>Hi ${lead.name},</p><p>I found some great properties that match what you're looking for. Reply to this email and I'll send them over right away.</p><p>Best,<br>${user.name}${user.agency ? `<br>${user.agency}` : ''}</p>`,
        `<p>Hi ${lead.name},</p><p>Would you like to arrange a viewing this week?</p><p><a href="${bookingUrl}" style="background:#c9a84c;color:#000;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Book a Viewing →</a></p><p>Best,<br>${user.name}</p>`,
        `<p>Hi ${lead.name},</p><p>Just checking in — are you still looking for a property? I'm here to help whenever you're ready.</p><p>Best,<br>${user.name}</p>`
      ];
      promises.push(
        sendEmail({ to: lead.email, subject: subjects[stage], html: bodies[stage] })
          .catch(console.error)
      );
    }
  }

  await Promise.allSettled(promises);
  console.log(`[CRON] Stage ${stage} follow-up sent to ${lead.name} via ${channel}`);
}

// ---- WEEKLY REPORT — Every Monday 8AM ----
cron.schedule('0 8 * * 1', async () => {
  console.log('[CRON] Sending weekly reports...');
  // FIX: load all active users from Supabase, not just in-memory map
  const { supabase } = require('./db');
  let activeUsers = [];
  if (supabase) {
    const { data } = await supabase.from('users').select('*').in('plan', ['active','trial']).catch(() => ({ data: [] }));
    if (data?.length) activeUsers = data.map(u => [u.id, u]);
  }
  if (!activeUsers.length) activeUsers = [...users.entries()].filter(([,u]) => u.plan === 'active' || u.plan === 'trial');
  for (const [id, user] of activeUsers) {
    await sendWeeklyReport(id, user).catch(err =>
      console.error(`[CRON] Report failed for ${user.email}:`, err.message)
    );
  }
  console.log('[CRON] Weekly reports done');
}, { timezone: 'UTC' });

// ---- GMAIL AUTO-SCAN — Every 15 minutes ----
cron.schedule('*/15 * * * *', async () => {
  const { scanGmailForLeads } = require('../routes/gmail');
  // FIX: load gmail-connected users from Supabase
  const { supabase } = require('./db');
  let gmailUsers = [];
  if (supabase) {
    const { data } = await supabase.from('users').select('*').eq('gmail_connected', true).in('plan', ['active','trial']).catch(() => ({ data: [] }));
    if (data?.length) gmailUsers = data.map(u => [u.id, u]);
  }
  if (!gmailUsers.length) gmailUsers = [...users.entries()].filter(([,u]) => u.gmail_connected && u.gmail_tokens && (u.plan === 'trial' || u.plan === 'active'));
  for (const [uid, user] of gmailUsers) {
    if (!user.gmail_connected || !user.gmail_tokens) continue;
    if (user.plan !== 'trial' && user.plan !== 'active') continue;
    try {
      const count = await scanGmailForLeads(uid, { ...user, id: uid });
      if (count > 0) console.log(`[CRON] Gmail: ${count} new lead(s) for ${user.name}`);
    } catch (err) {
      console.error(`[CRON] Gmail scan failed for ${user.email}:`, err.message);
    }
  }
});



async function sendWeeklyReport(userId, user) {
  let weekLeads = 0, weekListings = 0, weekBookings = 0;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const [, lead] of leads) {
    if (lead.userId === userId && new Date(lead.created_at) >= weekAgo) weekLeads++;
  }
  const { listings, bookings } = require('./db');
  for (const [, l] of listings) {
    if (l.userId === userId && new Date(l.created_at) >= weekAgo) weekListings++;
  }
  for (const [, b] of bookings) {
    if (b.userId === userId && new Date(b.created_at) >= weekAgo) weekBookings++;
  }

  const hoursSaved = (weekListings * 2) + (weekLeads * 0.5) + (weekBookings * 0.5);

  await sendEmail({
    to: user.email,
    subject: `📊 Your AgentFlow Weekly Report — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`,
    html: weeklyReportHtml(user.name, { leads: weekLeads, listings: weekListings, bookings: weekBookings, hoursSaved: Math.round(hoursSaved) })
  });
}

// ---- TRIAL EXPIRY — Every day 9AM ----
cron.schedule('0 9 * * *', async () => {
  const now = new Date();
  // FIX: load trial users from Supabase
  const { supabase } = require('./db');
  let trialUsers = [];
  if (supabase) {
    const { data } = await supabase.from('users').select('*').eq('plan', 'trial').catch(() => ({ data: [] }));
    if (data?.length) trialUsers = data.map(u => [u.id, u]);
  }
  if (!trialUsers.length) trialUsers = [...users.entries()].filter(([,u]) => u.plan === 'trial');
  for (const [id, user] of trialUsers) {
    if (user.plan !== 'trial') continue;
    const daysPassed = (now - new Date(user.trial_start)) / (1000 * 60 * 60 * 24);

    if (daysPassed >= 13 && daysPassed < 14) {
      await sendEmail({
        to: user.email,
        subject: 'Your AgentFlow 14-day trial ends tomorrow ⚡',
        html: trialEndingHtml(user.name)
      }).catch(console.error);
    }
    if (daysPassed >= 14) {
      // FIX: persist expiry to Supabase, not just in-memory mutation
      await updateUser(id, { plan: 'expired' }).catch(console.error);
      user.plan = 'expired';
      console.log(`[CRON] Trial expired: ${user.email}`);
    }
  }
});

function weeklyReportHtml(name, stats) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#080c14;color:#e8eaf0;margin:0;padding:40px 20px;">
  <div style="max-width:600px;margin:0 auto;">
    <h1 style="color:#fff;margin-bottom:4px;">Agent<span style="color:#c9a84c;">Flow</span></h1>
    <p style="color:#8892a4;margin-top:0;">Weekly Performance Report</p>
    <h2 style="color:#c9a84c;">Hi ${name} 👋</h2>
    <p style="color:#8892a4;">Here's what your automations did this week:</p>
    <div style="display:flex;gap:12px;margin:24px 0;flex-wrap:wrap;">
      <div style="flex:1;min-width:100px;background:#0d1420;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:2rem;color:#c9a84c;font-weight:700;">${stats.leads}</div>
        <div style="color:#8892a4;font-size:0.8rem;margin-top:4px;">Leads</div>
      </div>
      <div style="flex:1;min-width:100px;background:#0d1420;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:2rem;color:#c9a84c;font-weight:700;">${stats.bookings}</div>
        <div style="color:#8892a4;font-size:0.8rem;margin-top:4px;">Viewings</div>
      </div>
      <div style="flex:1;min-width:100px;background:#0d1420;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:2rem;color:#c9a84c;font-weight:700;">${stats.listings}</div>
        <div style="color:#8892a4;font-size:0.8rem;margin-top:4px;">Listings</div>
      </div>
      <div style="flex:1;min-width:100px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:2rem;color:#c9a84c;font-weight:700;">${stats.hoursSaved}h</div>
        <div style="color:#c9a84c;font-size:0.8rem;margin-top:4px;">Saved</div>
      </div>
    </div>
    <a href="${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html" style="background:#c9a84c;color:#000;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">View Dashboard →</a>
    <p style="color:#8892a4;font-size:0.78rem;margin-top:32px;">AgentFlow · theagentflow.co</p>
  </div></body></html>`;
}

function trialEndingHtml(name) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#080c14;color:#e8eaf0;">
    <h2 style="color:#c9a84c;">Hi ${name},</h2>
    <p>Your AgentFlow 14-day free trial ends tomorrow.</p>
    <p>Don't lose access to your listing generator, lead follow-ups, chatbot, and weekly reports.</p>
    <a href="${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html" style="background:#c9a84c;color:#000;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px;">Upgrade Now — $49/mo</a>
  </div>`;
}


// ---- BOOKING REMINDERS — Every hour ----
cron.schedule('30 * * * *', async () => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in1h  = new Date(now.getTime() + 60 * 60 * 1000);
  const { bookings, supabase } = require('./db');
  const { sendEmail } = require('./email');
  const { sendWhatsApp } = require('./whatsapp');

  // FIX: load confirmed bookings from Supabase
  let allBookings = [];
  if (supabase) {
    const { data } = await supabase.from('bookings').select('*').eq('status', 'confirmed').catch(() => ({ data: [] }));
    if (data?.length) allBookings = data.map(b => [b.id, { ...b, userId: b.user_id }]);
  }
  if (!allBookings.length) allBookings = [...bookings.entries()].filter(([,b]) => b.status === 'confirmed');

  for (const [bookingId, booking] of allBookings) {
    if (booking.status !== 'confirmed') continue;
    const bookingTime = new Date(`${booking.date}T${booking.time}:00`);
    const diffHours = (bookingTime - now) / (1000 * 60 * 60);
    const agent = await getUserById(booking.userId);  // FIX: was missing await
    const formattedTime = bookingTime.toLocaleDateString('en-GB', {
      weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'
    });

    // 24 hour reminder
    if (diffHours >= 23.5 && diffHours < 24.5 && !booking.reminder_24_sent) {
      if (booking.client_email) {
        await sendEmail({
          to: booking.client_email,
          subject: `Reminder: Your viewing is tomorrow at ${booking.time}`,
          html: `<div style="font-family:Arial,sans-serif;padding:32px;background:#080c14;color:#e8eaf0;">
            <h2 style="color:#c9a84c;">Viewing Reminder ⏰</h2>
            <p>Hi ${booking.client_name},</p>
            <p>Just a reminder that your property viewing is <strong>tomorrow</strong>:</p>
            <div style="background:#0d1420;border-radius:10px;padding:20px;margin:16px 0;">
              <p>📅 ${formattedTime}</p>
              <p>🏠 ${booking.property}</p>
              <p>👤 ${agent?.name || 'Your Agent'}</p>
            </div>
            <p style="color:#8892a4;">Need to reschedule? Reply to this email.</p>
          </div>`
        }).catch(console.error);
      }
      if (booking.client_phone) {
        await sendWhatsApp(booking.client_phone,
          `⏰ Viewing reminder!

Hi ${booking.client_name}, your property viewing is tomorrow:

📅 ${formattedTime}
🏠 ${booking.property}
👤 ${agent?.name || 'Your Agent'}

See you then! 🏡`
        ).catch(console.error);
      }
      bookings.set(bookingId, { ...booking, reminder_24_sent: true });
      console.log(`[CRON] 24hr reminder sent for booking ${bookingId}`);
    }

    // 1 hour reminder to agent
    if (diffHours >= 0.75 && diffHours < 1.25 && !booking.reminder_1h_sent) {
      if (agent?.email) {
        await sendEmail({
          to: agent.email,
          subject: `Viewing in 1 hour — ${booking.client_name}`,
          html: `<div style="font-family:Arial,sans-serif;padding:32px;background:#080c14;color:#e8eaf0;">
            <h2 style="color:#c9a84c;">Viewing in 1 Hour! ⏰</h2>
            <p>Client: <strong>${booking.client_name}</strong></p>
            <p>Property: ${booking.property}</p>
            <p>Time: ${formattedTime}</p>
            ${booking.client_phone ? `<p>Phone: ${booking.client_phone}</p>` : ''}
          </div>`
        }).catch(console.error);
      }
      if (agent?.whatsapp_number) {
        await sendWhatsApp(agent.whatsapp_number,
          `⏰ Viewing in 1 hour!

Client: ${booking.client_name}
Property: ${booking.property}
Time: ${formattedTime}
${booking.client_phone ? `Phone: ${booking.client_phone}` : ''}`
        ).catch(console.error);
      }
      bookings.set(bookingId, { ...booking, reminder_24_sent: booking.reminder_24_sent, reminder_1h_sent: true });
      console.log(`[CRON] 1hr reminder sent for booking ${bookingId}`);
    }
  }
});


// ---- ACTIVE PLAN EXPIRY — Every day 9AM ----
cron.schedule('0 9 * * *', async () => {
  const now = new Date();
  // FIX: load active plan users from Supabase
  const { supabase } = require('./db');
  let activeUsers = [];
  if (supabase) {
    const { data } = await supabase.from('users').select('*').eq('plan', 'active').catch(() => ({ data: [] }));
    if (data?.length) activeUsers = data.map(u => [u.id, u]);
  }
  if (!activeUsers.length) activeUsers = [...users.entries()].filter(([,u]) => u.plan === 'active');
  for (const [id, user] of activeUsers) {
    if (user.plan !== 'active') continue;
    const periodEnd = user.plan_period_end ? new Date(user.plan_period_end) : null;
    if (periodEnd && now > periodEnd) {
      // FIX: persist expiry to Supabase, not just in-memory
      await updateUser(id, { plan: 'expired' }).catch(console.error);
      user.plan = 'expired';
      users.set(id, user);
      console.log(`[CRON] Active plan expired: ${user.email}`);
      // Notify agent
      await sendEmail({
        to: user.email,
        subject: 'Your AgentFlow subscription has ended',
        html: planExpiredHtml(user.name)
      }).catch(console.error);
    }
  }
});

function planExpiredHtml(name) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#080c14;color:#e8eaf0;">
    <h2 style="color:#c9a84c;">Hi ${name},</h2>
    <p>Your AgentFlow subscription has ended.</p>
    <p>Renew now to restore access to your listing generator, lead follow-ups, chatbot, and weekly reports.</p>
    <a href="${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html#upgrade" style="background:#c9a84c;color:#000;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px;">Renew Now — $49/mo</a>
  </div>`;
}

console.log('[CRON] Scheduled jobs loaded ✓');
