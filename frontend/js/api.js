// ============================================
// AGENTFLOW — Frontend API Client v3
// ============================================

const API_BASE = window.location.origin + '/api';

// ---- TOKEN MANAGEMENT ----
function getToken()    { return localStorage.getItem('af_token'); }
function setToken(t)   { localStorage.setItem('af_token', t); }
function clearToken()  { localStorage.removeItem('af_token'); localStorage.removeItem('af_user'); localStorage.removeItem('af_plan'); }

// ---- BASE FETCH ----
async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res  = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---- AUTH ----
const Auth = {
  async signup(name, email, password, agency, market) {
    const data = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, agency, market })
    });
    setToken(data.token);
    localStorage.setItem('af_user', JSON.stringify(data.user));
    return data;
  },
  async login(email, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setToken(data.token);
    localStorage.setItem('af_user', JSON.stringify(data.user));
    return data;
  },
  async me() { return await apiFetch('/auth/me'); },
  logout() { clearToken(); window.location.href = '/pages/login.html'; },
  isLoggedIn() { return !!getToken(); },
  getUser() {
    const raw = localStorage.getItem('af_user');
    return raw ? JSON.parse(raw) : null;
  }
};

// ---- PLAN / TRIAL GATE ----
const Plan = {
  TRIAL_DAYS: 14,

  // Get real-time plan status from server + cache it
  async refresh() {
    try {
      const data = await apiFetch('/payments/status');
      localStorage.setItem('af_plan', JSON.stringify({ ...data, _fetched: Date.now() }));
      // Keep af_user plan in sync
      const u = Auth.getUser();
      if (u) { u.plan = data.plan; localStorage.setItem('af_user', JSON.stringify(u)); }
      return data;
    } catch(e) { return null; }
  },

  getCached() {
    const raw = localStorage.getItem('af_plan');
    if (!raw) return null;
    const p = JSON.parse(raw);
    // Re-use cache for up to 60 seconds
    if (Date.now() - (p._fetched || 0) < 60000) return p;
    return null;
  },

  async get() {
    return this.getCached() || await this.refresh();
  },

  isActive(plan) { return plan && plan.plan === 'active'; },
  isExpired(plan) { return plan && (plan.plan === 'expired' || plan.plan === 'cancelled' || plan.trial_expired); },
  isTrialActive(plan) { return plan && plan.plan === 'trial' && !plan.trial_expired; },

  daysLeft(plan) {
    if (!plan) return 0;
    if (plan.plan === 'active')  return plan.days_left || 30;
    if (plan.plan === 'trial')   return plan.trial_days_left || 0;
    return 0;
  }
};

// ---- LISTINGS ----
const Listings = {
  async generate(data) {
    return await apiFetch('/listings/generate', { method: 'POST', body: JSON.stringify(data) });
  },
  async getAll()     { return await apiFetch('/listings'); },
  async delete(id)   { return await apiFetch(`/listings/${id}`, { method: 'DELETE' }); }
};

// ---- LEADS ----
const Leads = {
  async add(data)         { return await apiFetch('/leads', { method: 'POST', body: JSON.stringify(data) }); },
  async getAll()          { return await apiFetch('/leads'); },
  async update(id, data)  { return await apiFetch(`/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  async delete(id)        { return await apiFetch(`/leads/${id}`, { method: 'DELETE' }); }
};

// ---- BOOKINGS ----
const Bookings = {
  async create(data) { return await apiFetch('/bookings', { method: 'POST', body: JSON.stringify(data) }); },
  async getAll()     { return await apiFetch('/bookings'); }
};

// ---- REPORTS ----
const Reports = {
  async getWeekly()  { return await apiFetch('/reports/weekly'); },
  async getAllTime()  { return await apiFetch('/reports/all-time'); },
  async sendNow()    { return await apiFetch('/reports/send', { method: 'POST' }); }
};

// ---- PAYMENTS ----
const Payments = {
  async createCheckout() {
    const data = await apiFetch('/payments/create-checkout', { method: 'POST' });
    if (data.url) window.location.href = data.url;
    return data;
  },
  async getStatus()  { return await apiFetch('/payments/status'); },
  async openPortal() {
    const data = await apiFetch('/payments/portal', { method: 'POST' });
    if (data.url) window.location.href = data.url;
    return data;
  }
};

// ---- USER ----
const User = {
  async updateProfile(data)     { return await apiFetch('/user/profile',      { method: 'PUT', body: JSON.stringify(data) }); },
  async saveApiKey(openai_key)  { return await apiFetch('/user/apikey',       { method: 'PUT', body: JSON.stringify({ openai_key }) }); },
  async updateIntegrations(d)   { return await apiFetch('/user/integrations',  { method: 'PUT', body: JSON.stringify(d) }); },
  async getStats()              { return await apiFetch('/user/stats'); }
};

// ---- PROFILE ----
const Profile = {
  async get()        { return await apiFetch('/profile'); },
  async update(data) { return await apiFetch('/profile', { method: 'PUT', body: JSON.stringify(data) }); }
};

// ---- CALENDAR ----
const Calendar = {
  async status()             { return await apiFetch('/calendar/status'); },
  async connect()            { return await apiFetch('/calendar/connect'); },
  async disconnect()         { return await apiFetch('/calendar/disconnect', { method: 'DELETE' }); },
  async slots(agentId, date) { return await apiFetch(`/calendar/slots/${agentId}?date=${date}`); },
  async updateTimezone(tz)   { return await apiFetch('/calendar/timezone',  { method: 'PUT', body: JSON.stringify({ timezone: tz }) }); }
};

// ---- CHANNEL ----
const Channel = {
  async set(channel) { return await apiFetch('/user/channel', { method: 'PUT', body: JSON.stringify({ channel }) }); }
};

// ---- ROUTE GUARD ----
function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = '/pages/login.html';
    return false;
  }
  return true;
}

// ---- TOAST ----
function showToast(message, type = 'success') {
  const existing = document.getElementById('af-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'af-toast';
  const bg = type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#c9a84c';
  const color = type === 'gold' ? '#000' : '#fff';
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;background:${bg};color:${color};padding:14px 24px;border-radius:10px;font-size:0.9rem;font-weight:600;font-family:'DM Sans',sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.4);animation:slideIn 0.3s ease;max-width:360px;line-height:1.4;`;
  toast.textContent = message;
  const style = document.createElement('style');
  style.textContent = '@keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
  document.head.appendChild(style);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
