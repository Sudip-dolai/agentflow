// ============================================
// AGENTFLOW — Database (Supabase)
// Data persists across server restarts
// ============================================

const { createClient } = require('@supabase/supabase-js');

// ---- SUPABASE CLIENT ----
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  console.log('[DB] Supabase connected ✓');
} else {
  console.log('[DB] No Supabase keys — using in-memory store');
}

// ---- IN-MEMORY FALLBACK (dev mode / no Supabase) ----
const _users    = new Map();
const _leads    = new Map();
const _listings = new Map();
const _bookings = new Map();

// ---- DEFAULT SEQUENCE ----
const defaultSequence = [
  { day: 0, subject: "Thanks for your enquiry — I'll be in touch shortly", delay_hours: 0 },
  { day: 1, subject: "I found properties that match what you're looking for", delay_hours: 24 },
  { day: 3, subject: 'Ready to schedule a viewing? Pick a time that works for you', delay_hours: 72 },
  { day: 7, subject: "Still looking? Let me know how I can help", delay_hours: 168 }
];

// ============================================
// USER OPERATIONS
// ============================================

async function createUser(id, userData) {
  if (supabase) {
    const { error } = await supabase.from('users').insert({ id, ...userData });
    if (error) throw new Error(error.message);
  }
  _users.set(id, userData);
}

async function updateUser(id, updates) {
  if (supabase) {
    const { error } = await supabase.from('users').update(updates).eq('id', id);
    if (error) console.error('[DB] updateUser error:', error.message);
  }
  const existing = _users.get(id) || {};
  _users.set(id, { ...existing, ...updates });
}

async function getUserByEmail(email) {
  if (supabase) {
    const { data, error } = await supabase
      .from('users').select('*').eq('email', email.toLowerCase()).single();
    if (error || !data) return null;
    _users.set(data.id, data); // cache in memory
    return { id: data.id, ...data };
  }
  for (const [id, user] of _users) {
    if (user.email === email.toLowerCase()) return { id, ...user };
  }
  return null;
}

async function getUserById(id) {
  // Check memory cache first
  if (_users.has(id)) return { id, ..._users.get(id) };

  if (supabase) {
    const { data, error } = await supabase
      .from('users').select('*').eq('id', id).single();
    if (error || !data) return null;
    _users.set(data.id, data); // cache
    return { id: data.id, ...data };
  }
  return null;
}

// ============================================
// LEAD OPERATIONS
// ============================================

async function createLead(id, leadData) {
  if (supabase) {
    const { error } = await supabase.from('leads').insert({
      id,
      user_id: leadData.userId,
      name: leadData.name,
      email: leadData.email || '',
      phone: leadData.phone || '',
      source: leadData.source || 'manual',
      status: leadData.status || 'new',
      notes: leadData.notes || '',
      followup_stage: leadData.followup_stage || 0,
      created_at: leadData.created_at
    });
    if (error) console.error('[DB] createLead error:', error.message);
  }
  _leads.set(id, leadData);
}

async function getLeadById(id) {
  if (supabase) {
    const { data } = await supabase.from('leads').select('*').eq('id', id).single().catch(() => ({ data: null }));
    if (data) { _leads.set(data.id, { ...data, userId: data.user_id }); return { ...data, userId: data.user_id }; }
  }
  return _leads.get(id) || null;
}

async function getLeadsByUser(userId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('leads').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (!error && data) {
      data.forEach(l => _leads.set(l.id, { ...l, userId: l.user_id }));
      return data.map(l => ({ id: l.id, ...l, userId: l.user_id }));
    }
  }
  const result = [];
  for (const [id, lead] of _leads) {
    if (lead.userId === userId) result.push({ id, ...lead });
  }
  return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function updateLead(id, updates) {
  if (supabase) {
    const { error } = await supabase.from('leads').update(updates).eq('id', id);
    if (error) console.error('[DB] updateLead error:', error.message);
  }
  const existing = _leads.get(id) || {};
  _leads.set(id, { ...existing, ...updates });
}

async function deleteLead(id) {
  if (supabase) {
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) console.error('[DB] deleteLead error:', error.message);
  }
  _leads.delete(id);
}

// ============================================
// LISTING OPERATIONS
// ============================================

async function createListing(id, listingData) {
  if (supabase) {
    const { error } = await supabase.from('listings').insert({
      id,
      user_id: listingData.userId,
      portal: listingData.portal,
      market: listingData.market,
      property_type: listingData.property_type,
      location: listingData.location,
      beds: listingData.beds,
      baths: listingData.baths,
      size: listingData.size,
      price: listingData.price,
      features: listingData.features,
      content_en: listingData.content_en,
      content_ar: listingData.content_ar,
      created_at: listingData.created_at
    });
    if (error) console.error('[DB] createListing error:', error.message);
  }
  _listings.set(id, listingData);
}

async function getListingById(id) {
  if (supabase) {
    const { data } = await supabase.from('listings').select('*').eq('id', id).single().catch(() => ({ data: null }));
    if (data) { _listings.set(data.id, { ...data, userId: data.user_id }); return { ...data, userId: data.user_id }; }
  }
  return _listings.get(id) || null;
}

async function deleteListing(id) {
  if (supabase) {
    const { error } = await supabase.from('listings').delete().eq('id', id);
    if (error) console.error('[DB] deleteListing error:', error.message);
  }
  _listings.delete(id);
}

async function getListingsByUser(userId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('listings').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
    if (!error && data) {
      data.forEach(l => _listings.set(l.id, { ...l, userId: l.user_id }));
      return data.map(l => ({ id: l.id, ...l, userId: l.user_id }));
    }
  }
  const result = [];
  for (const [id, listing] of _listings) {
    if (listing.userId === userId) result.push({ id, ...listing });
  }
  return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ============================================
// BOOKING OPERATIONS
// ============================================

async function createBooking(id, bookingData) {
  if (supabase) {
    const { error } = await supabase.from('bookings').insert({
      id,
      user_id: bookingData.userId,
      client_name: bookingData.client_name,
      client_email: bookingData.client_email || '',
      client_phone: bookingData.client_phone || '',
      property: bookingData.property || '',
      message: bookingData.message || '',
      date: bookingData.date,
      time: bookingData.time,
      date_time: bookingData.date_time,
      status: bookingData.status || 'confirmed',
      google_event_id: bookingData.google_event_id || null,
      created_at: bookingData.created_at
    });
    if (error) console.error('[DB] createBooking error:', error.message);
  }
  _bookings.set(id, bookingData);
}

async function getBookingById(id) {
  if (supabase) {
    const { data } = await supabase.from('bookings').select('*').eq('id', id).single().catch(() => ({ data: null }));
    if (data) { _bookings.set(data.id, { ...data, userId: data.user_id }); return { ...data, userId: data.user_id }; }
  }
  return _bookings.get(id) || null;
}

async function getBookingsByUser(userId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('bookings').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (!error && data) {
      data.forEach(b => _bookings.set(b.id, { ...b, userId: b.user_id }));
      return data.map(b => ({ id: b.id, ...b, userId: b.user_id }));
    }
  }
  const result = [];
  for (const [id, booking] of _bookings) {
    if (booking.userId === userId) result.push({ id, ...booking });
  }
  return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function updateBooking(id, updates) {
  if (supabase) {
    const { error } = await supabase.from('bookings').update(updates).eq('id', id);
    if (error) console.error('[DB] updateBooking error:', error.message);
  }
  const existing = _bookings.get(id) || {};
  _bookings.set(id, { ...existing, ...updates });
}

// ============================================
// COMPATIBILITY LAYER
// Some routes use maps directly — keep working
// ============================================
const users    = _users;
const leads    = _leads;
const listings = _listings;
const bookings = _bookings;
const availability = new Map();
const sequences = new Map();

module.exports = {
  // Async functions (preferred)
  createUser, updateUser, getUserByEmail, getUserById,
  createLead, getLeadById, getLeadsByUser, updateLead, deleteLead,
  createListing, getListingById, deleteListing, getListingsByUser,
  createBooking, getBookingById, getBookingsByUser, updateBooking,
  // Expose supabase client for direct queries in routes/cron
  supabase,

  // Maps (compatibility — still work for routes using them directly)
  users, leads, listings, bookings, availability, sequences,
  defaultSequence,

  // Sync helpers (used by middleware/auth — keep sync for speed)
  getUserByEmailSync: (email) => {
    for (const [id, user] of _users) {
      if (user.email === email.toLowerCase()) return { id, ...user };
    }
    return null;
  },

  supabase
};

// ============================================
// SUPABASE SCHEMA — Run this in SQL Editor
// supabase.com → your project → SQL Editor
// ============================================
/*
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
*/
