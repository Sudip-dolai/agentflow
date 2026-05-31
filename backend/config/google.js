// ============================================
// AGENTFLOW — Google Calendar Integration
// ============================================
// Setup: console.cloud.google.com
// Enable: Google Calendar API
// Create: OAuth 2.0 Client ID (Web Application)
// Redirect URI: http://localhost:5000/api/calendar/callback

const { google } = require('googleapis');

// ---- OAUTH CLIENT ----
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/calendar/callback'
  );
}

// ---- GENERATE AUTH URL ----
// Redirects agent to Google's consent page
function getAuthUrl(userId) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',       // gets refresh_token so we don't need to re-auth
    prompt: 'consent',            // forces refresh token every time
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',  // read existing events
      'https://www.googleapis.com/auth/calendar.events'     // create new events
    ],
    state: userId                 // pass userId through OAuth flow
  });
}

// ---- EXCHANGE CODE FOR TOKENS ----
async function exchangeCodeForTokens(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// ---- GET AUTHENTICATED CLIENT FOR A USER ----
function getAuthenticatedClient(tokens) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials(tokens);

  // Auto-refresh token when expired
  oauth2Client.on('tokens', (newTokens) => {
    if (newTokens.refresh_token) {
      tokens.refresh_token = newTokens.refresh_token;
    }
    tokens.access_token = newTokens.access_token;
    tokens.expiry_date = newTokens.expiry_date;
  });

  return oauth2Client;
}

// ---- GET BUSY SLOTS FROM GOOGLE CALENDAR ----
// Returns array of busy time ranges for a given date
async function getBusySlots(tokens, date, timezone) {
  if (!tokens || !tokens.access_token) return [];

  try {
    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    // Query from start to end of the requested date
    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59`);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        timeZone: timezone || 'UTC',
        items: [{ id: 'primary' }]
      }
    });

    const busy = response.data.calendars?.primary?.busy || [];
    return busy.map(slot => ({
      start: new Date(slot.start),
      end: new Date(slot.end)
    }));
  } catch (err) {
    console.error('[GOOGLE CALENDAR] getBusySlots error:', err.message);
    return []; // fail gracefully — return empty so slots still show
  }
}

// ---- CREATE CALENDAR EVENT ON BOOKING ----
async function createCalendarEvent(tokens, booking, agentTimezone) {
  if (!tokens || !tokens.access_token) return null;

  try {
    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const startDateTime = new Date(`${booking.date}T${booking.time}:00`);
    const endDateTime = new Date(startDateTime.getTime() + (booking.duration || 60) * 60 * 1000);

    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: `🏠 Property Viewing — ${booking.client_name}`,
        description: [
          `Client: ${booking.client_name}`,
          booking.client_email ? `Email: ${booking.client_email}` : '',
          booking.client_phone ? `Phone/WhatsApp: ${booking.client_phone}` : '',
          `Property: ${booking.property}`,
          booking.message ? `Notes: ${booking.message}` : '',
          '',
          'Booked via AgentFlow'
        ].filter(Boolean).join('\n'),
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: agentTimezone || 'UTC'
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: agentTimezone || 'UTC'
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'email', minutes: 1440 } // 24 hours
          ]
        },
        colorId: '5' // Yellow — stands out in calendar
      }
    });

    console.log(`[GOOGLE CALENDAR] Event created: ${event.data.id}`);
    return event.data;
  } catch (err) {
    console.error('[GOOGLE CALENDAR] createCalendarEvent error:', err.message);
    return null; // fail gracefully — booking still saves
  }
}

// ---- DELETE CALENDAR EVENT ON CANCELLATION ----
async function deleteCalendarEvent(tokens, eventId) {
  if (!tokens || !eventId) return;
  try {
    const auth = getAuthenticatedClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId });
    console.log(`[GOOGLE CALENDAR] Event deleted: ${eventId}`);
  } catch (err) {
    console.error('[GOOGLE CALENDAR] deleteCalendarEvent error:', err.message);
  }
}

// ---- CHECK IF SLOT CONFLICTS WITH GOOGLE CALENDAR ----
function slotConflictsWithBusy(slotTime, slotDate, slotDurationMinutes, busySlots) {
  const slotStart = new Date(`${slotDate}T${slotTime}:00`);
  const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60 * 1000);

  return busySlots.some(busy => {
    // Conflict if slot overlaps with any busy period
    return slotStart < busy.end && slotEnd > busy.start;
  });
}

// ---- CHECK IF GOOGLE CALENDAR IS CONFIGURED ----
function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getAuthenticatedClient,
  getBusySlots,
  createCalendarEvent,
  deleteCalendarEvent,
  slotConflictsWithBusy,
  isConfigured
};
