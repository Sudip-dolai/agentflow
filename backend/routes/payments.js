// ============================================
// AGENTFLOW — Payments Routes (Dodo Payments)
// ============================================

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { users, updateUser, getUserById } = require('../config/db');

// ---- DODO PAYMENTS HELPER ----
function getDodoHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.DODO_API_KEY}`
  };
}

const DODO_API = 'https://api.dodopayments.com/v1';
const PLAN_PRICE = 4900; // $49.00 in cents
const PLAN_NAME  = 'AgentFlow Pro — $49/month';

// POST /api/payments/create-checkout — Create Dodo checkout session
// FIX: authMiddleware added so req.user is populated
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    if (!process.env.DODO_API_KEY) {
      return res.status(503).json({
        error: 'Dodo Payments not configured',
        message: 'Add DODO_API_KEY to your .env file to enable payments'
      });
    }

    const user = req.user; // now always defined thanks to authMiddleware

    const payload = {
      amount: PLAN_PRICE,
      currency: 'USD',
      description: PLAN_NAME,
      customer: {
        email: user.email,
        name: user.name
      },
      metadata: {
        agentflow_user_id: req.userId
      },
      success_url: `${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html?upgraded=true`,
      cancel_url:  `${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html`,
      billing_cycle: {
        interval: 'month',
        interval_count: 1
      }
    };

    const response = await fetch(`${DODO_API}/checkout`, {
      method: 'POST',
      headers: getDodoHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[DODO] Checkout error:', data);
      return res.status(500).json({ error: 'Failed to create checkout session' });
    }

    res.json({ url: data.checkout_url || data.url, session_id: data.id });

  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/payments/webhook — Dodo webhook (PUBLIC — no auth, Dodo calls this)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    let event;
    try {
      event = JSON.parse(req.body.toString());
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    console.log('[DODO] Webhook event:', event.type || event.event_type);

    const eventType = event.type || event.event_type || '';
    const data = event.data || event;
    const userId = data?.metadata?.agentflow_user_id || data?.customer?.metadata?.agentflow_user_id;

    if (!userId) {
      console.log('[DODO] No userId in webhook metadata');
      return res.status(200).json({ received: true });
    }

    if (eventType.includes('payment.succeeded') || eventType.includes('subscription.activated') || eventType.includes('subscription.created')) {
      // FIX: use getUserById (reads Supabase) — users.get() fails after server restart
      const u = await getUserById(userId);
      if (u) {
        const now = new Date().toISOString();
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await updateUser(userId, {
          plan: 'active',
          plan_start: now,
          plan_period_end: periodEnd,
          dodo_subscription_id: data.id || data.subscription_id || ''
        });
        console.log(`[DODO] Plan activated for user ${userId}`);
      } else {
        console.error(`[DODO] User ${userId} not found — cannot activate plan`);
      }
    }

    if (eventType.includes('subscription.cancelled') || eventType.includes('subscription.deleted') || eventType.includes('payment.failed')) {
      // FIX: use getUserById (reads Supabase) — users.get() fails after server restart
      const u = await getUserById(userId);
      if (u) {
        await updateUser(userId, { plan: 'cancelled' });
        console.log(`[DODO] Plan cancelled for user ${userId}`);
      } else {
        console.error(`[DODO] User ${userId} not found — cannot cancel plan`);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[DODO] Webhook error:', err);
    res.status(200).json({ received: true });
  }
});

// GET /api/payments/status — Get subscription status
// FIX: authMiddleware added so req.user is populated
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = req.user; // now always defined thanks to authMiddleware
    const plan = user.plan || 'trial';

    if (plan === 'active') {
      const periodEnd = user.plan_period_end ? new Date(user.plan_period_end) : null;
      const now = new Date();

      // Check if 30-day period has expired
      if (periodEnd && now > periodEnd) {
        await updateUser(req.userId, { plan: 'expired' });
        return res.json({
          plan: 'expired',
          expired: true,
          message: 'Your subscription period has ended. Please renew to continue.'
        });
      }

      const daysLeft = periodEnd ? Math.max(0, Math.ceil((periodEnd - now) / (1000 * 60 * 60 * 24))) : 30;
      return res.json({
        plan: 'active',
        days_left: daysLeft,
        period_end: periodEnd ? periodEnd.toISOString() : null,
        dodo_configured: !!process.env.DODO_API_KEY
      });
    }

    if (plan === 'trial') {
      const trialStart = new Date(user.trial_start || Date.now());
      const trialEnd = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);
      const now = new Date();

      if (now > trialEnd) {
        await updateUser(req.userId, { plan: 'expired' });
        return res.json({
          plan: 'expired',
          trial_expired: true,
          message: '14-day free trial has ended. Upgrade to continue.'
        });
      }

      const daysLeft = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
      return res.json({
        plan: 'trial',
        trial_days_left: daysLeft,
        trial_end: trialEnd.toISOString(),
        dodo_configured: !!process.env.DODO_API_KEY
      });
    }

    res.json({
      plan,
      expired: plan === 'expired' || plan === 'cancelled',
      dodo_configured: !!process.env.DODO_API_KEY
    });

  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

// POST /api/payments/portal — Dodo billing portal (manage billing)
// FIX: authMiddleware added so req.user is populated
router.post('/portal', authMiddleware, async (req, res) => {
  try {
    if (!process.env.DODO_API_KEY) {
      return res.status(503).json({ error: 'Dodo Payments not configured' });
    }

    const user = req.user; // now always defined thanks to authMiddleware
    if (!user.dodo_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const response = await fetch(`${DODO_API}/customer-portal`, {
      method: 'POST',
      headers: getDodoHeaders(),
      body: JSON.stringify({
        subscription_id: user.dodo_subscription_id,
        return_url: `${process.env.FRONTEND_URL || 'https://theagentflow.co'}/pages/dashboard.html`
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: 'Failed to open billing portal' });

    res.json({ url: data.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

module.exports = router;
