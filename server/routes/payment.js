const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const Razorpay = require('razorpay');
const supabase = require('../services/supabase');

// ── Razorpay instance (graceful if env vars missing) ────────────
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — payment routes will return 503');
}

// ── Plan config ─────────────────────────────────────────────────
const PLANS = {
  pro: {
    name: 'Aivorah Pro',
    amount: 49900,       // paise (₹499)
    currency: 'INR',
    description: 'Pro Plan — Unlimited AI Coach, All Stories, Challenges',
  },
  pro_annual: {
    name: 'Aivorah Pro (Annual)',
    amount: 499900,      // paise (₹4,999)
    currency: 'INR',
    description: 'Pro Plan Annual — 12 months at ₹499/mo (save ₹1,000)',
  },
  max: {
    name: 'Aivorah Max',
    amount: 99900,       // paise (₹999)
    currency: 'INR',
    description: 'Max Plan — Up to 3 kids, Priority AI, Advanced Dashboard',
  },
};

// ── Helpers ─────────────────────────────────────────────────────
async function getPreferences(email) {
  try {
    const key = email.toLowerCase().trim();
    const { data } = await supabase.from('user_preferences').select('data').eq('user_email', key).maybeSingle();
    return data?.data ?? {};
  } catch { return {}; }
}

async function setPreferences(email, updates) {
  try {
    const key = email.toLowerCase().trim();
    const { data: existing } = await supabase.from('user_preferences').select('data').eq('user_email', key).maybeSingle();
    const merged = { ...(existing?.data ?? {}), ...updates };
    await supabase.from('user_preferences').upsert(
      { user_email: key, data: merged, updated_at: new Date().toISOString() },
      { onConflict: 'user_email' },
    );
  } catch (err) { console.error('[payment setPreferences]', err?.message); }
}

// ── POST /payment/create-order ──────────────────────────────────
// Creates a Razorpay order. Frontend uses the order ID to open checkout.
// Body: { planId: 'pro' | 'pro_annual' | 'max', email, name }
router.post('/create-order', async (req, res) => {
  try {
    if (!razorpay) return res.status(503).json({ error: 'Payment service not configured' });
    const { planId, email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: `Invalid planId: ${planId}. Use: ${Object.keys(PLANS).join(', ')}` });

    const order = await razorpay.orders.create({
      amount:   plan.amount,
      currency: plan.currency,
      receipt:  `aivorah_${planId}_${Date.now()}`,
      notes: {
        email: email.toLowerCase().trim(),
        name:  name || '',
        plan:  planId,
      },
    });

    res.json({
      orderId:     order.id,
      amount:      order.amount,
      currency:    order.currency,
      planName:    plan.name,
      description: plan.description,
      keyId:       process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('[payment/create-order]', err.message);
    res.status(500).json({ error: 'Failed to create order: ' + err.message });
  }
});

// ── POST /payment/verify ────────────────────────────────────────
// Verifies Razorpay payment signature and activates the user's plan.
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, email, planId }
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, email, planId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn('[payment/verify] Signature mismatch for', email);
      return res.status(400).json({ error: 'Payment verification failed — signature mismatch' });
    }

    // Signature valid — activate the plan
    const emailLc = email.toLowerCase().trim();
    const now = new Date().toISOString();
    const plan = PLANS[planId] || PLANS.pro;

    // Calculate expiry based on plan
    const expiryDate = new Date();
    if (planId === 'pro_annual') {
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    } else {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
    }

    await setPreferences(emailLc, {
      isPro: true,
      subscription: {
        planId,
        planName: plan.name,
        activatedAt: now,
        expiresAt: expiryDate.toISOString(),
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        amountPaid: plan.amount / 100, // rupees
      },
    });

    console.log(`[payment] ✅ ${emailLc} activated ${planId} until ${expiryDate.toISOString()}`);

    res.json({
      success: true,
      message: `${plan.name} activated successfully!`,
      isPro: true,
      expiresAt: expiryDate.toISOString(),
    });
  } catch (err) {
    console.error('[payment/verify]', err.message);
    res.status(500).json({ error: 'Verification failed: ' + err.message });
  }
});

// ── GET /payment/status?email=... ───────────────────────────────
// Returns current subscription status for a user
router.get('/status', async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });

    const prefs = await getPreferences(email);
    const sub = prefs.subscription || null;
    const isPro = prefs.isPro === true;

    // Check if subscription has expired
    if (isPro && sub?.expiresAt && new Date(sub.expiresAt) < new Date()) {
      // Expired — deactivate
      await setPreferences(email, { isPro: false });
      return res.json({ isPro: false, expired: true, subscription: sub });
    }

    res.json({ isPro, subscription: sub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
