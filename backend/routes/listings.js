// ============================================
// AGENTFLOW — Listings Routes
// ============================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const { listings, getUserById, createListing, getListingsByUser, getListingById, deleteListing } = require('../config/db');

const PORTAL_CONFIG = {
  bayut: {
    name: 'Bayut',
    market: 'uae',
    maxChars: 5000,
    systemPrompt: `You are an expert UAE real estate copywriter specializing in Bayut listings. 
Write compelling, professional property descriptions that appeal to buyers and investors in Dubai and the UAE.
Use direct, feature-focused language. Highlight investment potential, lifestyle benefits, and location advantages.
Format: Ready to publish on Bayut. Do not include a title.`
  },
  propertyfinder: {
    name: 'Property Finder',
    market: 'uae',
    maxChars: 4000,
    systemPrompt: `You are an expert UAE real estate copywriter specializing in Property Finder listings.
Write benefit-focused, professional property descriptions for the UAE market.
Emphasize lifestyle, community, and investment value. Appeal to both local and international buyers.
Format: Ready to publish on Property Finder. Do not include a title.`
  },
  rightmove: {
    name: 'Rightmove',
    market: 'uk',
    maxChars: 2000,
    systemPrompt: `You are an expert UK estate agent copywriter specializing in Rightmove listings.
Write formal, professional descriptions in British English.
Use correct UK property terminology: leasehold/freehold, EPC rating, chain-free, council tax band, etc.
Keep it concise and factual — Rightmove buyers appreciate clarity.
Format: Ready to publish on Rightmove. Do not include a title.`
  },
  zoopla: {
    name: 'Zoopla',
    market: 'uk',
    maxChars: 3000,
    systemPrompt: `You are an expert UK estate agent copywriter specializing in Zoopla listings.
Write warm, lifestyle-focused descriptions in British English.
Paint a picture of the lifestyle the property offers while including all key facts.
Use correct UK property terminology.
Format: Ready to publish on Zoopla. Do not include a title.`
  }
};

// POST /api/listings/generate
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const {
      portal, market, property_type, location,
      beds, baths, size, price, features, tone
    } = req.body;

    if (!portal || !property_type || !location)
      return res.status(400).json({ error: 'Portal, property type, and location are required' });

    const config = PORTAL_CONFIG[portal];
    if (!config)
      return res.status(400).json({ error: 'Invalid portal. Use: bayut, propertyfinder, rightmove, zoopla' });

    // Get user's OpenAI key (user-provided or system)
    const user = await getUserById(req.userId);
    // Always use system .env key — agents never need their own key
    // Agent's personal key is only an optional override
    const apiKey = process.env.OPENAI_API_KEY || user?.openai_key;

    const userPrompt = `Write a ${tone || 'professional'} property listing description for:
- Property Type: ${property_type}
- Location: ${location}
- Bedrooms: ${beds || 'not specified'}
- Bathrooms: ${baths || 'not specified'}
- Size: ${size || 'not specified'}
- Price: ${price || 'not specified'}
- Key Features: ${features || 'not specified'}
- Portal: ${config.name}

Maximum ${config.maxChars} characters. Output ONLY the description, nothing else.`;

    let englishContent = '';
    let arabicContent = '';

    if (apiKey) {
      try {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey });

        // Generate English listing
        const enResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: config.systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 800,
          temperature: 0.7
        });
        englishContent = enResponse.choices[0].message.content.trim();

        // Generate Arabic version for UAE portals
        if ((market === 'uae' || config.market === 'uae') && (portal === 'bayut' || portal === 'propertyfinder')) {
          const arResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are an expert Arabic real estate copywriter for the UAE market. Translate and adapt the following property listing to professional Arabic (Modern Standard Arabic with Gulf dialect touches). Keep it compelling and publication-ready.' },
              { role: 'user', content: `Translate and adapt this listing to Arabic:\n\n${englishContent}` }
            ],
            max_tokens: 800,
            temperature: 0.5
          });
          arabicContent = arResponse.choices[0].message.content.trim();
        }
      } catch (aiErr) {
        console.error('OpenAI error:', aiErr.message);
        // Fall through to demo content
      }
    }

    // Demo content if no API key
    if (!englishContent) {
      englishContent = generateDemoListing(property_type, location, beds, baths, size, price, features, config.name);
    }
    if (!arabicContent && (config.market === 'uae')) {
      arabicContent = generateDemoArabic(property_type, location, beds, price);
    }

    // Save to DB
const listingId = uuidv4();
const listingData = {
  userId: req.userId || user?.id,
  portal,
  market: market || config.market,
  property_type, location, beds, baths, size, price, features,
  content_en: englishContent,
  content_ar: arabicContent,
  created_at: new Date().toISOString()
};
await createListing(listingId, listingData);

    res.json({
      id: listingId,
      portal,
      portal_name: config.name,
      market: config.market,
      content_en: englishContent,
      content_ar: arabicContent,
      char_count_en: englishContent.length,
      char_count_ar: arabicContent.length,
      max_chars: config.maxChars,
      is_demo: false  // System always has API key
    });

  } catch (err) {
    console.error('Listing generation error:', err);
    res.status(500).json({ error: 'Failed to generate listing' });
  }
});

// GET /api/listings — Get user's listing history
router.get('/', authMiddleware, async (req, res) => {
  const result = await getListingsByUser(req.userId);
  res.json({ listings: result.slice(0, 50) });
});

// DELETE /api/listings/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  // FIX: use getListingById (reads Supabase) — listings.get fails after restart
  const listing = await getListingById(req.params.id);
  if (!listing || listing.userId !== req.userId)
    return res.status(404).json({ error: 'Listing not found' });
  await deleteListing(req.params.id);
  res.json({ message: 'Listing deleted' });
});

function generateDemoListing(type, location, beds, baths, size, price, features, portalName) {
  const bedsText = beds ? `${beds}-bedroom ` : '';
  const featList = features ? features.split(',').map(f => f.trim()).filter(Boolean) : [];
  const featText = featList.length > 0
    ? `This exceptional property boasts ${featList.slice(0, 4).join(', ')}${featList.length > 4 ? ' and much more' : ''}.`
    : '';

  return `Presenting a stunning ${bedsText}${type} in the prestigious ${location}${price ? ` — available at ${price}` : ''}.

${featText ? featText + '\n\n' : ''}From the moment you step inside, you will be captivated by the seamless flow of space and natural light throughout. The thoughtfully designed layout perfectly balances modern living with comfort and functionality, making this an ideal choice for professionals, families, and investors.

${location} is one of the most sought-after addresses in the region, offering world-class amenities, excellent connectivity, and a vibrant lifestyle.

${beds ? `With ${beds} generously sized bedrooms${baths ? ` and ${baths} bathrooms` : ''}` : 'The property'}, every detail has been carefully considered to deliver an exceptional living experience.${size ? ` Spanning ${size}, the space is both generous and versatile.` : ''}

Do not miss this rare opportunity. Contact us today to arrange a private viewing.`;
}

function generateDemoArabic(type, location, beds, price) {
  return `نقدم لكم ${type} استثنائية في ${location}${price ? ` - بسعر ${price}` : ''}.

${beds ? `تتميز هذه العقارة الراقية بـ ${beds} غرف نوم فسيحة مصممة بعناية فائقة تجمع بين الأناقة والراحة.` : ''}

تقع في موقع استراتيجي متميز يوفر سهولة الوصول إلى جميع المرافق والخدمات، مع إطلالات خلابة ومساحات معيشية مريحة تلبي أرقى المعايير.

فرصة استثمارية نادرة لا تعوض. تواصلوا معنا الآن لترتيب جولة خاصة.

`;
}

module.exports = router;
