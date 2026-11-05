# AgentFlow — Full Stack SaaS

AI automation platform for UAE & UK real estate agents: generate portal-ready listings, capture leads, follow up automatically on email and WhatsApp, take viewing bookings, and track performance.

**Live:** https://getagentflow.co

## Features
- **AI listing generator** — Bayut, Property Finder (English + Arabic), Rightmove, Zoopla (British English). OpenAI `gpt-4o-mini`, with a portal-specific prompt and character limit.
- **Lead capture** — manual entry, website chatbot widget, WhatsApp incoming messages, and Gmail auto-parsing of Rightmove/Zoopla enquiry emails.
- **Automated follow-ups** — instant message on a new lead, then hourly cron stages at 24h, 72h and 7 days over email, WhatsApp or both.
- **Booking page** — public page with slots built from your availability and Google Calendar.
- **Reports** — weekly stats and emailed report.
- **Subscriptions** — 14-day free trial, then $49/month through Dodo Payments.

## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (served by Express) |
| Backend | Node.js (>= 22) + Express |
| Database | Supabase PostgreSQL (in-memory fallback for local development only) |
| AI | OpenAI GPT-4o-mini |
| Payments | Dodo Payments |
| Email | Resend (or Nodemailer SMTP), agent's Gmail via OAuth |
| WhatsApp | Meta WhatsApp Cloud API (embedded signup + webhook) |
| Calendar / Gmail | Google Calendar API, Gmail API (OAuth 2.0) |
| Auth & security | JWT + bcryptjs, helmet, CORS, express-rate-limit (100 requests / 15 min) |
| Scheduling | node-cron |

## Project Structure
```
agentflow/
├── frontend/              ← HTML/CSS/JS
│   ├── index.html         ← Landing page
│   ├── css/style.css
│   ├── js/                ← api.js (API client), main.js (UI utilities)
│   └── pages/             ← login, signup, dashboard, book ...
└── backend/               ← Node.js + Express API
    ├── server.js          ← Entry point
    ├── .env.example       ← Copy to .env
    ├── config/
    │   ├── db.js          ← Supabase + in-memory fallback
    │   ├── email.js       ← Email sending
    │   ├── google.js      ← Google Calendar + Gmail OAuth
    │   ├── whatsapp.js    ← Meta WhatsApp Cloud API sender + templates
    │   └── cron.js        ← Hourly follow-up jobs
    ├── middleware/
    │   └── auth.js        ← JWT auth + plan gate (HTTP 402 when expired)
    └── routes/
        ├── auth.js  listings.js  leads.js  chatbot.js  bookings.js
        ├── calendar.js  gmail.js  whatsapp.js  reports.js
        └── payments.js  profile.js  user.js
```

## Quick Start
```bash
cd backend
npm install
cp .env.example .env     # then fill in your keys
npm run dev              # development (auto-reload)
npm start                # production
```
Open http://localhost:5000

## Environment Variables
Never commit `.env`. Only `.env.example` (with empty values) belongs in Git.

**Required**
| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Long random string (32+ chars). **Required in production.** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Database (without them the app uses an in-memory store and loses data on restart) |
| `OPENAI_API_KEY` | Listing generation (without it, demo text is returned) |
| `DODO_API_KEY`, `DODO_PRODUCT_ID` | Subscription checkout |
| `FRONTEND_URL` | Public base URL (used in links and redirects) |

**Optional**
| Variable | Purpose |
|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS` | SMTP alternative (Gmail App Password) |
| `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | WhatsApp Cloud API |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REDIRECT_URI_GMAIL` | Calendar + Gmail OAuth |
| `PORT`, `NODE_ENV` | Server settings |

## Setup Guides

### Dodo Payments
1. Create an account at https://dodopayments.com and a monthly product; copy its ID to `DODO_PRODUCT_ID`.
2. Put your API key in `DODO_API_KEY`.
3. Dashboard → Webhooks → add `https://yourdomain.com/api/payments/webhook`.
4. Subscribe to: `payment.succeeded`, `subscription.activated`, `subscription.created`, `subscription.cancelled`, `payment.failed`.

### WhatsApp (Meta Cloud API)
1. Create an app at https://developers.facebook.com and add the WhatsApp product.
2. Put `META_APP_ID`, `META_APP_SECRET` and a self-chosen `META_WEBHOOK_VERIFY_TOKEN` in `.env`.
3. In the Meta app, set the webhook callback URL to `https://yourdomain.com/api/whatsapp/webhook` and the same verify token; subscribe to the `messages` field.
4. Each agent connects their own WhatsApp Business number from the dashboard (embedded signup). Incoming messages create leads automatically.

### Google Calendar + Gmail
1. https://console.cloud.google.com → new project → enable **Google Calendar API** and **Gmail API**.
2. Credentials → OAuth 2.0 Client ID (Web application). Authorized redirect URIs:
   - `http://localhost:5000/api/calendar/callback`
   - `http://localhost:5000/api/gmail/callback`
   - `https://yourdomain.com/api/calendar/callback`
   - `https://yourdomain.com/api/gmail/callback`
3. Add to `.env`:
```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/calendar/callback
GOOGLE_REDIRECT_URI_GMAIL=https://yourdomain.com/api/gmail/callback
```

### Supabase
Create a project → Settings → API → copy the Project URL and `service_role` key → SQL Editor → run the schema below.

## Deployment
The server must run continuously because follow-ups use node-cron, so serverless hosts such as Vercel are not suitable.

**Any Node.js host (Railway, Google Cloud, etc.)**
1. Connect the GitHub repo and set the root directory to `backend`.
2. Add every variable from `.env` in the host's environment settings.
3. Start command: `npm start`.

**VPS with PM2**
```bash
git clone <your-repo> && cd agentflow/backend
npm install
cp .env.example .env && nano .env
npm install -g pm2
pm2 start server.js --name agentflow
pm2 startup && pm2 save
```

## Trial & Subscription Flow
- New agents get a 14-day free trial.
- After the trial, gated features return HTTP 402 and the dashboard shows an upgrade prompt.
- Upgrade opens a Dodo checkout ($49/month). After payment, Dodo calls the webhook and the plan becomes `active` for a 30-day period.
- When the period ends without renewal, the plan becomes `expired` and features lock again.
- Cancelled or failed payments set the plan to `cancelled`.

## API Reference
**Auth** — `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`
**Listings** — `POST /api/listings/generate`, `GET /api/listings`
**Leads** — `POST /api/leads`, `GET /api/leads`, `POST /api/leads/capture` (public, chatbot)
**Chatbot** — `POST|GET /api/chatbot/config`, `GET /api/chatbot/widget/:agentId` (public)
**Bookings** — `GET /api/bookings/slots/:userId?date=YYYY-MM-DD` (public), `POST /api/bookings/book` (public), `GET|PUT /api/bookings/availability`
**Calendar** — `GET /api/calendar/connect`, `GET /api/calendar/slots/:userId`
**Gmail** — `GET /api/gmail/connect`, `POST /api/gmail/sync`
**WhatsApp** — `GET|POST /api/whatsapp/webhook` (Meta), `GET /api/whatsapp/meta/status`
**Reports** — `GET /api/reports/weekly`, `POST /api/reports/send`
**Payments** — `POST /api/payments/create-checkout`, `POST /api/payments/webhook` (public), `GET /api/payments/status`
**User** — `PUT /api/user/profile`, `GET /api/user/stats`

## Supabase Schema
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
  dodo_customer_id TEXT DEFAULT '',
  meta_connected BOOLEAN DEFAULT FALSE,
  meta_phone_number_id TEXT,
  meta_waba_id TEXT,
  meta_access_token TEXT,
  meta_connected_at TIMESTAMPTZ,
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
