const express = require('express');
const router = express.Router();
const { embed } = require('../services/embeddings');
const { searchContent } = require('../services/qdrant');
const { generateAnswer } = require('../services/llm');
const { logEvent } = require('../services/analytics');

// POST /ask
// Body: { question, curriculum?, grade?, subject?, topic? }
router.post('/', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { question, curriculum = 'IB_PYP', grade, subject, topic, userEmail, role } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'question is required' });
    }

    let context = '';
    let sources = [];

    // 1. Try Qdrant RAG — fall back gracefully if unreachable
    try {
      const vector = await embed(question);
      const results = await searchContent({ vector, curriculum, grade, subject, limit: 5 });

      if (results.length > 0) {
        context = results
          .map(r => {
            const p = r.payload;
            return `[${p.subject || ''} › ${p.unit || ''} › ${p.topic || ''}]\n${p.content}`;
          })
          .join('\n\n---\n\n');

        sources = results.map(r => ({
          subject: r.payload.subject,
          unit: r.payload.unit,
          topic: r.payload.topic,
          score: Math.round(r.score * 100) / 100,
        }));
      }
    } catch (qdrantErr) {
      // Qdrant unreachable — continue with Groq-only (no RAG context)
      console.warn('Qdrant unavailable, using Groq-only mode:', qdrantErr.message);
    }

    // 2. Generate answer via Groq — works with or without Qdrant context
    const answer = await generateAnswer({ question, context, grade, subject, topic });

    logEvent('ai_ask', {
      userEmail,
      role,
      source: 'topic_ai_coach',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      topic,
      subject,
      grade,
      meta: { hasRagContext: Boolean(context), sourceCount: sources.length },
    }).catch(() => {});

    res.json({ answer, sources });
  } catch (err) {
    console.error('Error in /ask:', err.message);
    logEvent('ai_ask', {
      userEmail: req.body?.userEmail,
      role: req.body?.role,
      source: 'topic_ai_coach',
      status: 'error',
      latencyMs: Date.now() - startedAt,
      topic: req.body?.topic,
      subject: req.body?.subject,
      grade: req.body?.grade,
      meta: { error: err.message },
    }).catch(() => {});
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
