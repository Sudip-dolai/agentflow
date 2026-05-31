// ============================================
// AGENTFLOW — Public Profile Routes
// ============================================

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { users, listings, bookings, getUserById, updateUser, supabase } = require('../config/db');

// GET /api/profile/:username — Public agent profile
router.get('/:username', async (req, res) => {
  const param = req.params.username.toLowerCase().trim();
  let foundUser = null;
  let foundId   = null;

  // 1. Search in-memory map (fast — works in dev)
  for (const [id, user] of users) {
    const slug = (user.username || '').toLowerCase();
    if (slug === param || id === param) {
      foundUser = user; foundId = id; break;
    }
  }

  // 2. Try Supabase directly (works after server restart when memory is empty)
  if (!foundUser && supabase) {
    try {
      const { data } = await supabase
        .from('users')
        .select('*')
        .or(`id.eq.${param},username.eq.${param}`)
        .limit(1);
      if (data && data.length > 0) {
        foundUser = data[0];
        foundId   = data[0].id;
      }
    } catch(e) { /* fail gracefully */ }
  }

  if (!foundUser) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Count listings
  let listingsCount = 0;
  const agentListings = [];
  for (const [, listing] of listings) {
    if (listing.userId === foundId || listing.user_id === foundId) {
      listingsCount++;
      if (agentListings.length < 5) agentListings.push({
        type: listing.property_type, location: listing.location,
        price: listing.price, portal: listing.portal, created_at: listing.created_at
      });
    }
  }

  // Also check Supabase listings
  if (supabase && listingsCount === 0) {
    const { data: dbListings } = await supabase
      .from('listings').select('*').eq('user_id', foundId).limit(5)
      .catch(() => ({ data: [] }));
    if (dbListings?.length) {
      listingsCount = dbListings.length;
      dbListings.forEach(l => agentListings.push({
        type: l.property_type, location: l.location,
        price: l.price, portal: l.portal, created_at: l.created_at
      }));
    }
  }

  // Count bookings this month
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  let viewingsCount = 0;
  for (const [, booking] of bookings) {
    if ((booking.userId === foundId || booking.user_id === foundId) && new Date(booking.created_at) >= monthStart)
      viewingsCount++;
  }
  if (supabase && viewingsCount === 0) {
    const { data: dbBookings } = await supabase
      .from('bookings').select('id').eq('user_id', foundId).gte('created_at', monthStart.toISOString())
      .catch(() => ({ data: [] }));
    viewingsCount = dbBookings?.length || 0;
  }

  // Strip sensitive fields
  const { password_hash, openai_key, gmail_tokens, google_tokens,
          dodo_subscription_id, dodo_customer_id, gmail_connected,
          hubspot_connected, make_connected, ...safeUser } = foundUser;

  res.json({
    ...safeUser,
    id: foundId,
    listings_count: listingsCount,
    viewings_count: viewingsCount,
    listings: agentListings
  });
});

// PUT /api/profile — Agent updates their own profile page settings
router.put('/', authMiddleware, async (req, res) => {
  try {
    const { username, tagline, whatsapp_number, photo_url } = req.body;

    // Use getUserById so it works after server restart (reads Supabase)
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check username not already taken by someone else
    if (username) {
      if (supabase) {
        try {
          const { data: existing } = await supabase
            .from('users')
            .select('id')
            .eq('username', username.toLowerCase())
            .neq('id', req.userId)
            .limit(1);
          if (existing && existing.length > 0) {
            return res.status(409).json({ error: 'Username already taken' });
          }
        } catch(e) { /* ignore — allow save */ }
      } else {
        for (const [id, u] of users) {
          if (id !== req.userId && (u.username || '').toLowerCase() === username.toLowerCase()) {
            return res.status(409).json({ error: 'Username already taken' });
          }
        }
      }
    }

    await updateUser(req.userId, {
      username:        username        ? username.toLowerCase() : (user.username || ''),
      tagline:         tagline         !== undefined ? tagline         : (user.tagline || ''),
      whatsapp_number: whatsapp_number !== undefined ? whatsapp_number : (user.whatsapp_number || ''),
      photo_url:       photo_url       !== undefined ? photo_url       : (user.photo_url || '')
    });

    const profileUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/pages/profile.html?agent=${req.userId}`;
    res.json({ message: 'Profile updated', profile_url: profileUrl });
  } catch (err) {
    console.error('[PROFILE] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/profile — Get own profile settings
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Use getUserById so it reads from Supabase after server restart
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const profileUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/pages/profile.html?agent=${req.userId}`;
    res.json({
      username:        user.username        || '',
      tagline:         user.tagline         || '',
      whatsapp_number: user.whatsapp_number || '',
      photo_url:       user.photo_url       || '',
      profile_url:     profileUrl
    });
  } catch (err) {
    console.error('[PROFILE] GET error:', err.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

module.exports = router;
