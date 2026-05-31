const express = require('express');
const router = express.Router();
const { logEvent, readEvents, summarizeEvents } = require('../services/analytics');

function getAllowedAdminEmails() {
  const list = [
    'kannansaimohan2003@gmail.com',
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

// GET /analytics/child-report?childEmail=
// Returns per-topic analytics for a child — used by parent dashboard
router.get('/child-report', async (req, res) => {
  try {
    const childEmail = String(req.query.childEmail || '').toLowerCase().trim();
    if (!childEmail) return res.status(400).json({ error: 'childEmail required' });

    const events = await readEvents();
    const childEvents = events.filter(e =>
      String(e.userEmail || '').toLowerCase() === childEmail
    );

    // Per-topic aggregation
    const topicMap = {};
    const scores = [];

    for (const e of childEvents) {
      const topic = e.topic || '';
      if (!topic) continue;

      if (!topicMap[topic]) {
        topicMap[topic] = {
          subject:      e.subject || '',
          grade:        e.grade   || '',
          aiChats:      0,
          quizScores:   [],
          minutesSpent: 0,
          lastActivity: '',
          sessionCount: 0,
        };
      }

      const t = topicMap[topic];

      // Count AI interactions (ask + lesson)
      if (e.eventType === 'ai_ask' || e.eventType === 'ai_lesson_script' || e.eventType === 'ai_lesson_hook') {
        t.aiChats++;
      }

      // Session time estimate: each lesson script ≈ 15 min
      if (e.eventType === 'ai_lesson_script') {
        t.minutesSpent += 15;
        t.sessionCount++;
      }

      // Quiz scores
      if ((e.eventType === 'ibpyp_quiz_result' || e.eventType === 'ncert_quiz_result') && typeof e.score === 'number') {
        t.quizScores.push(e.score);
        scores.push(e.score);
      }

      // Track last activity
      if (e.timestamp && e.timestamp > t.lastActivity) {
        t.lastActivity = e.timestamp;
      }
    }

    // Build final topics map
    const topics = {};
    for (const [topic, t] of Object.entries(topicMap)) {
      const avgScore = t.quizScores.length > 0
        ? Math.round(t.quizScores.reduce((a, b) => a + b, 0) / t.quizScores.length)
        : null;
      topics[topic] = {
        subject:      t.subject,
        grade:        t.grade,
        aiChats:      t.aiChats,
        avgScore,
        quizCount:    t.quizScores.length,
        minutesSpent: t.minutesSpent,
        lastActivity: t.lastActivity,
        hasActivity:  t.aiChats > 0 || t.quizScores.length > 0,
      };
    }

    // Global stats
    let totalMinutes = Object.values(topicMap).reduce((s, t) => s + t.minutesSpent, 0);
    const totalAIChats = Object.values(topicMap).reduce((s, t) => s + t.aiChats, 0);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;

    // Enrich with real study_time_minutes from student_stats
    try {
      const supabase = require('../services/supabase');
      const { data: userRow } = await supabase.from('users').select('id').eq('email', childEmail).maybeSingle();
      if (userRow?.id) {
        const { data: statsRow } = await supabase.from('student_stats').select('study_time_minutes').eq('student_id', userRow.id).maybeSingle();
        if (statsRow?.study_time_minutes > 0) totalMinutes = statsRow.study_time_minutes;
      }
    } catch {}

    res.json({
      childEmail,
      totalMinutes,
      totalAIChats,
      avgScore,
      topicCount: Object.keys(topics).length,
      topics,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/practice-trends?studentEmail=
// Returns per-topic mistake trends for learning path practice tests — used by teacher dashboard
router.get('/practice-trends', async (req, res) => {
  try {
    const studentEmail = String(req.query.studentEmail || '').toLowerCase().trim();
    if (!studentEmail) return res.status(400).json({ error: 'studentEmail required' });

    const events = await readEvents();
    const quizEvents = events.filter(e =>
      String(e.userEmail || '').toLowerCase() === studentEmail &&
      (e.eventType === 'ibpyp_quiz_result' || e.eventType === 'ncert_quiz_result') &&
      typeof e.score === 'number'
    ).sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

    // Group by topic — keep chronological order of attempts
    const topicMap = {};
    for (const e of quizEvents) {
      const topic = e.topic || 'Unknown';
      if (!topicMap[topic]) {
        topicMap[topic] = { subject: e.subject || '', grade: e.grade || '', attempts: [] };
      }
      topicMap[topic].attempts.push({
        score:               e.score,
        firstAttemptCorrect: e.meta?.firstAttemptCorrect ?? null,
        totalQuestions:      e.meta?.totalQuestions ?? null,
        timestamp:           e.timestamp || '',
      });
    }

    // Compute trend per topic
    const topics = {};
    for (const [topic, t] of Object.entries(topicMap)) {
      const attempts = t.attempts;
      const firstScore  = attempts[0]?.score ?? null;
      const latestScore = attempts[attempts.length - 1]?.score ?? null;
      const attemptCount = attempts.length;

      // Trend: compare last 2 attempts
      let trend = 'stable';
      if (attempts.length >= 2) {
        const diff = attempts[attempts.length - 1].score - attempts[attempts.length - 2].score;
        if (diff >= 10)       trend = 'improving';
        else if (diff <= -10) trend = 'declining';
      }

      // First attempt mistakes = questions wrong on first try
      const firstAttemptData = attempts[0];
      const firstAttemptMistakes = (firstAttemptData?.totalQuestions != null && firstAttemptData?.firstAttemptCorrect != null)
        ? firstAttemptData.totalQuestions - firstAttemptData.firstAttemptCorrect
        : null;

      topics[topic] = {
        subject:              t.subject,
        grade:                t.grade,
        attemptCount,
        firstScore,
        latestScore,
        trend,                // 'improving' | 'declining' | 'stable'
        firstAttemptMistakes, // how many wrong on very first try
        scores:               attempts.map(a => a.score),
      };
    }

    res.json({ studentEmail, topics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
