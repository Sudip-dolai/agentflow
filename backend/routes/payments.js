// ============================================
// AGENTFLOW — Payments Routes (Dodo Payments)
// ============================================

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { updateUser, getUserById } = require('../config/db');

// ---- DODO SDK CLIENT ----
function getDodoClient() {
  const DodoPayments = require('dodopayments');
  return new DodoPayments({
    bearerToken: process.env.DODO_API_KEY,
    environment: 'live_mode'
  });
}

// POST /api/payments/create-checkout — Create Dodo checkout session
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    if (!process.env.DODO_API_KEY) {
      return res.status(503).json({
        error: 'Dodo Payments not configured',
        message: 'Add DODO_API_KEY to your .env file to enable payments'
      });
    }

    if (!process.env.DODO_PRODUCT_ID) {
      return res.status(503).json({
        error: 'Dodo Product not configured',
        message: 'Add DODO_PRODUCT_ID to your .env file'
      });
    }

    const user = req.user;
    const client = getDodoClient();

    const session = await client.checkoutSessions.create({
      product_cart: [
        { product_id: process.env.DODO_PRODUCT_ID, quantity: 1 }
      ],
      subscription_data: { trial_period_days: 14 },
      customer: {
        email: user.email,
        name:  user.name || user.full_name || user.email
      },
      metadata: {
        agentflow_user_id: req.userId
      },
      return_url: `${process.env.FRONTEND_URL || 'https://getagentflow.co'}/pages/dashboard.html?upgraded=true`
    });

    console.log('[DODO] Checkout session created:', session.checkout_url);
    res.json({ url: session.checkout_url, session_id: session.id });

  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/payments/webhook — Dodo webhook (PUBLIC — no auth)
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
    const userId = data?.metadata?.agentflow_user_id
                || data?.customer?.metadata?.agentflow_user_id;

    if (!userId) {
      console.log('[DODO] No userId in webhook metadata');
      return res.status(200).json({ received: true });
    }

    if (
      eventType.includes('payment.succeeded') ||
      eventType.includes('subscription.activated') ||
      eventType.includes('subscription.created')
    ) {
      const u = await getUserById(userId);
      if (u) {
        const now       = new Date().toISOString();
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
       await updateUser(userId, {
  plan: 'active',
  plan_start: now,
  plan_period_end: periodEnd,
  dodo_subscription_id: data.id || data.subscription_id || '',
  dodo_customer_id: data.customer_id || data.customer?.id || ''
});
        console.log(`[DODO] Plan activated for user ${userId}`);
      } else {
        console.error(`[DODO] User ${userId} not found — cannot activate plan`);
      }
    }

    if (
      eventType.includes('subscription.cancelled') ||
      eventType.includes('subscription.deleted') ||
      eventType.includes('payment.failed')
    ) {
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
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const plan = user.plan || 'trial';

    if (plan === 'active') {
      const periodEnd = user.plan_period_end ? new Date(user.plan_period_end) : null;
      const now = new Date();

      if (periodEnd && now > periodEnd) {
        await updateUser(req.userId, { plan: 'expired' });
        return res.json({
          plan: 'expired',
          expired: true,
          message: 'Your subscription period has ended. Please renew to continue.'
        });
      }

      const daysLeft = periodEnd
        ? Math.max(0, Math.ceil((periodEnd - now) / (1000 * 60 * 60 * 24)))
        : 30;

      return res.json({
        plan: 'active',
        days_left: daysLeft,
        period_end: periodEnd ? periodEnd.toISOString() : null,
        dodo_configured: !!process.env.DODO_API_KEY
      });
    }

    if (plan === 'trial') {
      const trialStart = new Date(user.trial_start || Date.now());
      const trialEnd   = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);
      const now        = new Date();

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

// POST /api/payments/portal — Dodo billing portal
router.post('/portal', authMiddleware, async (req, res) => {
  try {
    if (!process.env.DODO_API_KEY) {
      return res.status(503).json({ error: 'Dodo Payments not configured' });
    }

    const user = req.user;
    if (!user.dodo_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const client = getDodoClient();
    const portal = await client.subscriptions.createPortalSession(
      user.dodo_subscription_id,
      {
        return_url: `${process.env.FRONTEND_URL || 'https://getagentflow.co'}/pages/dashboard.html`
      }
    );

    res.json({ url: portal.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

module.exports = router;