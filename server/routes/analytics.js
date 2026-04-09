const express = require('express');
const router = express.Router();
const { logEvent, readEvents, summarizeEvents } = require('../services/analytics');

function getAllowedAdminEmails() {
  const list = [
    'admin@aivorah.ai',
    'preddy6678@gmail.com',
    process.env.ADMIN_EMAIL || '',
    ...(process.env.ADMIN_EMAILS || '').split(','),
  ];
  return new Set(
    list
      .map((email) => String(email).toLowerCase().trim())
      .filter(Boolean),
  );
}

function requireAdminAccess(req, res, next) {
  const requiredKey = process.env.ADMIN_PANEL_KEY;
  const providedKey = req.query.key || req.headers['x-admin-key'];
  if (requiredKey && providedKey !== requiredKey) {
    return res.status(401).json({ error: 'Unauthorized admin key' });
  }

  const providedEmail = String(req.query.email || req.headers['x-admin-email'] || '').toLowerCase().trim();
  const allowed = getAllowedAdminEmails();
  if (!providedEmail || !allowed.has(providedEmail)) {
    return res.status(403).json({ error: 'Unauthorized admin email' });
  }

  next();
}

// POST /analytics/track
router.post('/track', async (req, res) => {
  const {
    eventType = 'event',
    userEmail = '',
    role = '',
    source = '',
    page = '',
    path = '',
    status = '',
    latencyMs,
    model = '',
    topic = '',
    subject = '',
    grade = '',
    score,
    comment = '',
    meta = {},
  } = req.body ?? {};

  await logEvent(String(eventType), {
    userEmail,
    role,
    source,
    page,
    path,
    status,
    latencyMs: typeof latencyMs === 'number' ? latencyMs : undefined,
    model,
    topic,
    subject,
    grade,
    score: typeof score === 'number' ? score : undefined,
    comment,
    meta,
  });

  res.json({ ok: true });
});

// POST /analytics/feedback
router.post('/feedback', async (req, res) => {
  const {
    userEmail = '',
    role = '',
    source = 'ai',
    topic = '',
    subject = '',
    grade = '',
    score,
    comment = '',
    meta = {},
  } = req.body ?? {};

  await logEvent('ai_feedback', {
    userEmail,
    role,
    source,
    topic,
    subject,
    grade,
    score: typeof score === 'number' ? score : undefined,
    comment,
    meta,
  });

  res.json({ ok: true });
});

// GET /analytics/summary (admin)
router.get('/summary', requireAdminAccess, async (_req, res) => {
  try {
    const events = await readEvents();
    res.json(summarizeEvents(events));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
