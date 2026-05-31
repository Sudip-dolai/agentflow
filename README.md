# AgentFlow v2.0 — Full Stack SaaS
AI automation platform for UAE & UK real estate agents.

> **v2.0:** Dodo Payments ($49/mo). 14-day free trial. 30-day active plan cycle. WhatsApp incoming webhook — auto-creates leads. Gmail API auto-parsing — Rightmove/Zoopla emails auto-create leads.

## Project Structure
```
agentflow/
├── frontend/          ← HTML/CSS/JS (served by Express)
│   ├── index.html     ← Landing page
│   ├── css/style.css  ← All styles
│   ├── js/
│   │   ├── api.js     ← Frontend API client
│   │   └── main.js    ← UI utilities
│   └── pages/
│       ├── login.html
│       ├── signup.html
│       └── dashboard.html
└── backend/           ← Node.js + Express API
    ├── server.js      ← Main entry point
    ├── .env.example   ← Copy to .env and fill in keys
    ├── config/
    │   ├── db.js      ← Supabase + in-memory fallback
    │   ├── email.js   ← Nodemailer email config
    │   ├── google.js  ← Google Calendar + Gmail OAuth
    │   ├── whatsapp.js← Twilio WhatsApp
    │   └── cron.js    ← Scheduled jobs
    ├── middleware/
    │   └── auth.js    ← JWT auth + plan gate
    └── routes/
        ├── auth.js      ← POST /signup, /login, GET /me
        ├── listings.js  ← POST /generate, GET /
        ├── leads.js     ← CRUD leads + auto follow-up
        ├── chatbot.js   ← Chatbot config + embed
        ├── bookings.js  ← Booking management
        ├── calendar.js  ← Google Calendar OAuth + slots
        ├── gmail.js     ← Gmail auto-parse leads
        ├── reports.js   ← Weekly stats + email report
        ├── payments.js  ← Dodo Payments checkout + webhook
        ├── profile.js   ← Public agent profile
        └── user.js      ← Profile + settings + stats
```

## Quick Start (5 minutes)

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env and add your keys
```

### 3. Start the server
```bash
npm run dev    # development (with auto-reload)
npm start      # production
```

### 4. Open in browser
```
http://localhost:5000
```

---

## API Keys You Need

### Required to go live:
| Key | Where to get | Cost |
|-----|-------------|------|
| `OPENAI_API_KEY` | platform.openai.com/api-keys | ~$0.01/listing |
| `DODO_API_KEY` | dodopayments.com | Free to set up |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | supabase.com | Free tier |

### Optional but recommended:
| Key | Where to get | Cost |
|-----|-------------|------|
| `EMAIL_USER` + `EMAIL_PASS` | Gmail App Password | Free |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | console.twilio.com | Pay per message |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | console.cloud.google.com | Free |

---

## Adding Keys (Step by Step)

### OpenAI (AI Listing Generator)
1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy the key (starts with `sk-`)
4. Add to `.env`: `OPENAI_API_KEY=sk-proj-...`

### Dodo Payments
1. Go to https://dodopayments.com
2. Sign up and get your API Key from the dashboard
3. Add to `.env`: `DODO_API_KEY=your_key`
4. In Dodo dashboard → Webhooks → Add endpoint:
   `https://yourdomain.com/api/payments/webhook`
5. Events to subscribe: `payment.succeeded`, `subscription.activated`, `subscription.created`, `subscription.cancelled`, `payment.failed`

### Gmail Email (for sending follow-ups)
1. Go to Google Account → Security → 2-Step Verification → App Passwords
2. Create app password for "Mail"
3. Use that 16-char password in `.env`

### Supabase (Production Database)
1. Go to https://supabase.com → New project
2. Go to Settings → API
3. Copy Project URL and service_role key
4. Go to SQL Editor and run the schema from `backend/config/db.js` (at bottom of file in comments)

---

## Deploying to Production

### Railway (Recommended — easiest for Node.js)
1. Go to railway.app
2. New Project → Deploy from GitHub
3. Set root directory to `backend`
4. Add all environment variables from `.env` in Railway Settings
5. Railway gives you a free domain, or add your own

### VPS (DigitalOcean / Hetzner / any Linux server)
```bash
# On your server:
git clone your-repo
cd agentflow/backend
npm install
cp .env.example .env
nano .env  # add your keys

# Run with PM2 (keeps it alive after logout)
npm install -g pm2
pm2 start server.js --name agentflow
pm2 startup
pm2 save
```

### Vercel (Not recommended — Vercel is for serverless, cron jobs won't work)

---

## API Endpoints Reference

### Auth
- `POST /api/auth/signup` — Create account
- `POST /api/auth/login` — Login
- `GET /api/auth/me` — Get current user (requires token)

### Listings
- `POST /api/listings/generate` — Generate AI listing
- `GET /api/listings` — Get listing history

### Leads
- `POST /api/leads` — Add lead (triggers follow-up)
- `GET /api/leads` — Get all leads
- `POST /api/leads/capture` — Public: chatbot lead capture

### Reports
- `GET /api/reports/weekly` — Weekly stats
- `POST /api/reports/send` — Send report to email

### Payments (Dodo Payments)
- `POST /api/payments/create-checkout` — Create Dodo checkout session
- `POST /api/payments/webhook` — Dodo webhook (public — Dodo calls this)
- `GET /api/payments/status` — Subscription status

### User
- `PUT /api/user/profile` — Update profile
- `PUT /api/user/apikey` — Save OpenAI key
- `GET /api/user/stats` — Dashboard stats

### Calendar
- `GET /api/calendar/connect` — Start Google Calendar OAuth
- `GET /api/calendar/slots/:userId` — Public: available slots

### WhatsApp
- `POST /api/whatsapp/webhook` — Twilio inbound webhook

---

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (no framework needed)
- **Backend:** Node.js + Express
- **Database:** Supabase PostgreSQL (in-memory fallback for dev)
- **AI:** OpenAI GPT-4o-mini
- **Payments:** Dodo Payments ($49/month)
- **Email:** Nodemailer + Gmail SMTP
- **WhatsApp:** Twilio
- **Calendar:** Google Calendar API
- **Hosting:** Railway / Any Node.js host

---

## WhatsApp Setup (Twilio)

### Step 1 — Sign up for Twilio
1. Go to https://console.twilio.com
2. Sign up free
3. Go to **Messaging → Try it out → Send a WhatsApp message**
4. Follow the sandbox setup — scan QR code with your phone

### Step 2 — Get your keys
1. From Twilio Console dashboard copy:
   - **Account SID** → `TWILIO_ACCOUNT_SID`
   - **Auth Token** → `TWILIO_AUTH_TOKEN`
2. Sandbox number: `+14155238886` → `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`

### Step 3 — Set webhook URL in Twilio
Go to Twilio Console → Messaging → Settings → WhatsApp Sandbox Settings
Set **"When a message comes in"** to: `https://yourdomain.com/api/whatsapp/webhook`

---

## Google Calendar + Gmail Setup

### Step 1 — Google Cloud Console
1. Go to https://console.cloud.google.com
2. New Project → name it `AgentFlow`
3. APIs & Services → Library → Enable **Google Calendar API** and **Gmail API**
4. APIs & Services → Credentials → Create OAuth 2.0 Client ID
   - Type: Web Application
   - Authorized redirect URIs — add all of these:
     - `http://localhost:5000/api/calendar/callback`
     - `http://localhost:5000/api/gmail/callback`
     - `https://yourdomain.com/api/calendar/callback`
     - `https://yourdomain.com/api/gmail/callback`
5. Copy Client ID and Client Secret

### Step 2 — Add to .env
```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/calendar/callback
GOOGLE_REDIRECT_URI_GMAIL=https://yourdomain.com/api/gmail/callback
```

---

## Trial & Subscription Flow

- New agents get **14 days free trial**
- After trial expires → all features locked, upgrade prompt shown
- Agent clicks Upgrade → redirected to Dodo checkout ($49/month)
- After payment → Dodo fires webhook → plan set to `active` (30-day period)
- After 30 days → features locked again, renewal prompt shown
- Dodo handles recurring billing automatically

---

## Supabase Schema

Run this SQL in your Supabase project → SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  agency TEXT DEFAULT '',
  market TEXT DEFAULT 'uae',
  plan TEXT DEFAULT 'trial',
  trial_start TIMESTAMPTZ DEFAULT NOW(),
  follow_up_channel TEXT DEFAULT 'email',
  whatsapp_number TEXT DEFAULT '',
  username TEXT UNIQUE,
  tagline TEXT DEFAULT '',
  photo_url TEXT DEFAULT '',
  openai_key TEXT DEFAULT '',
  dodo_subscription_id TEXT DEFAULT '',
  gmail_connected BOOLEAN DEFAULT FALSE,
  gmail_tokens JSONB,
  calendar_connected BOOLEAN DEFAULT FALSE,
  google_tokens JSONB,
  plan_start TIMESTAMPTZ,
  plan_period_end TIMESTAMPTZ,
  calendar_timezone TEXT DEFAULT 'Asia/Dubai',
  availability JSONB,
  chatbot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'new',
  notes TEXT DEFAULT '',
  followup_stage INTEGER DEFAULT 0,
  gmail_message_id TEXT DEFAULT '',
  property TEXT DEFAULT '',
  last_whatsapp TEXT DEFAULT '',
  last_contact TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  portal TEXT NOT NULL,
  market TEXT NOT NULL,
  property_type TEXT,
  location TEXT,
  beds INTEGER,
  baths INTEGER,
  size TEXT,
  price TEXT,
  features TEXT,
  content_en TEXT,
  content_ar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  client_email TEXT DEFAULT '',
  client_phone TEXT DEFAULT '',
  property TEXT DEFAULT '',
  message TEXT DEFAULT '',
  date TEXT,
  time TEXT,
  date_time TIMESTAMPTZ,
  status TEXT DEFAULT 'confirmed',
  google_event_id TEXT,
  reminder_24_sent BOOLEAN DEFAULT FALSE,
  reminder_1h_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Built for UAE (Bayut, Property Finder) and UK (Rightmove, Zoopla) real estate agents.
