// ============================================
// AGENTFLOW — Email Config (Nodemailer)
// ============================================

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.resend.com',
  port: parseInt(process.env.EMAIL_PORT) || 465,
  secure: true,  // ← change this
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});
async function sendEmail({ to, subject, html, text }) {
  // Skip if email not configured
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[EMAIL] Skipped (not configured): ${subject} → ${to}`);
    return { skipped: true };
  }
  try {
    const result = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'AgentFlow <noreply@theagentflow.co>',
      to, subject, html, text
    });
    console.log(`[EMAIL] Sent: ${subject} → ${to}`);
    return result;
  } catch (err) {
    console.error(`[EMAIL] Failed: ${err.message}`);
    throw err;
  }
}

// Welcome email template
function welcomeEmail(name) {
  return `
  <!DOCTYPE html>
  <html>
  <body style="font-family:Arial,sans-serif;background:#080c14;color:#e8eaf0;margin:0;padding:40px 20px;">
    <div style="max-width:600px;margin:0 auto;">
      <h1 style="color:#fff;">Welcome to Agent<span style="color:#c9a84c;">Flow</span> 🎉</h1>
      <p>Hi ${name},</p>
      <p>Your 14-day free trial has started. Here's what you can do right now:</p>
      <ul style="color:#8892a4;line-height:2;">
        <li>✍️ Generate Bayut & Rightmove listings in 10 seconds</li>
        <li>⚡ Set up your lead follow-up sequence</li>
        <li>🤖 Deploy your AI chatbot</li>
        <li>📅 Set up auto appointment booking</li>
        <li>📊 Get your weekly performance report every Monday</li>
      </ul>
      <a href="${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html" 
         style="background:#c9a84c;color:#000;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px;">
        Open Your Dashboard →
      </a>
      <p style="color:#8892a4;font-size:0.85rem;margin-top:32px;">Questions? Just reply to this email.</p>
    </div>
  </body>
  </html>`;
}

// Lead follow-up email template
function leadFollowupEmail(agentName, agencyName, bookingUrl) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;background:#fff;color:#333;">
    <p>Hi,</p>
    <p>Thank you for your enquiry. I'm ${agentName}${agencyName ? ` from ${agencyName}` : ''} and I'd love to help you find the perfect property.</p>
    <p>I'll be in touch shortly with some options that match your requirements. In the meantime, feel free to book a convenient time to chat:</p>
    ${bookingUrl ? `<a href="${bookingUrl}" style="background:#c9a84c;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin:16px 0;">Book a Call →</a>` : ''}
    <p style="color:#666;font-size:0.85rem;">Best regards,<br>${agentName}</p>
  </div>`;
}

// Send email via agent's connected Gmail OAuth tokens
async function sendEmailViaGmail(gmailTokens, { to, subject, html }) {
  const { google } = require('googleapis');
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI_GMAIL
  );
  
  oauth2Client.setCredentials(gmailTokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html
  ];
  
  const raw = Buffer.from(emailLines.join('\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });

  console.log(`[GMAIL] Sent via agent Gmail: ${subject} → ${to}`);
}
module.exports = { sendEmail, sendEmailViaGmail, welcomeEmail, leadFollowupEmail };

