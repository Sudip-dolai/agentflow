// ============================================
// AGENTFLOW — Auth Middleware
// ============================================

const jwt = require('jsonwebtoken');
const { getUserById, updateUser } = require('../config/db');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'agentflow_dev_secret');
    const user = await getUserById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---- PLAN GATE MIDDLEWARE ----
// Blocks access if trial expired or plan expired/cancelled
// Exempt routes: /api/payments/*, /api/auth/*
async function planGate(req, res, next) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const plan = user.plan || 'trial';

    // Already hard-expired
    if (plan === 'expired' || plan === 'cancelled') {
      return res.status(402).json({
        error: 'subscription_required',
        message: 'Your plan has expired. Please upgrade to continue.',
        upgrade_url: '/pages/dashboard.html#upgrade'
      });
    }

    // Active plan — check 30-day period
    if (plan === 'active') {
      const periodEnd = user.plan_period_end ? new Date(user.plan_period_end) : null;
      if (periodEnd && new Date() > periodEnd) {
        await updateUser(req.userId, { plan: 'expired' });
        return res.status(402).json({
          error: 'subscription_required',
          message: 'Your 30-day subscription period has ended. Please renew to continue.',
          upgrade_url: '/pages/dashboard.html#upgrade'
        });
      }
      return next();
    }

    // Trial — check 14-day window
    if (plan === 'trial') {
      const trialStart = new Date(user.trial_start || Date.now());
      const trialEnd = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);
      if (new Date() > trialEnd) {
        await updateUser(req.userId, { plan: 'expired' });
        return res.status(402).json({
          error: 'subscription_required',
          message: 'Your 14-day free trial has ended. Upgrade for $49/month to continue.',
          upgrade_url: '/pages/dashboard.html#upgrade'
        });
      }
      return next();
    }

    next();
  } catch (err) {
    console.error('[PLAN GATE] Error:', err.message);
    next(); // fail open so auth errors don't block everything
  }
}

function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'agentflow_dev_secret');
      req.userId = decoded.userId;
    }
  } catch (err) { /* ignore */ }
  next();
}

module.exports = { authMiddleware, planGate, optionalAuth };
