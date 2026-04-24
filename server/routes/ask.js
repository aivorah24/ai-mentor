const express = require('express');
const router = express.Router();
const { generateAnswer, generateAnswerStream } = require('../services/llm');
const { retrieveCurriculumContext } = require('../services/rag');
const { retrieveWebContext } = require('../services/webSearch');
const { logEvent } = require('../services/analytics');
const { normalizeCurriculum } = require('../utils/curriculum');

// POST /ask
// Body: { question, curriculum?, grade?, subject?, topic? }
router.post('/', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { question, curriculum = 'IB_PYP', grade, subject, topic, history = [], userEmail, role } = req.body;
    const normalizedCurriculum = normalizeCurriculum(curriculum);

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'question is required' });
    }

    let context = '';
    let sources = [];
    let ragMeta = { strategy: 'none', strictCandidates: 0, broadCandidates: 0, selected: 0 };
    let webMeta = { enabled: false, query: '', count: 0 };

    // 1. Retrieve RAG context from Qdrant
    try {
      const rag = await retrieveCurriculumContext({
        question,
        curriculum: normalizedCurriculum,
        grade: grade || undefined,
        subject: subject || undefined,
        topic: topic || undefined,
        history,
        maxSources: 5,
      });
      context = rag.context;
      sources = rag.sources;
      ragMeta = rag.meta;
    } catch (qdrantErr) {
      // Continue with no context if retrieval is unavailable
      console.warn('Qdrant unavailable, using no-context mode:', qdrantErr.message);
    }

    // 1b. Curriculum-aware web search fallback when RAG has no context
    if (!context) {
      try {
        const web = await retrieveWebContext({
          question,
          curriculum: normalizedCurriculum,
          grade: grade || undefined,
          subject: subject || undefined,
          topic: topic || undefined,
        });
        if (web.context) {
          context = web.context;
          sources = web.sources;
        }
        webMeta = web.meta;
      } catch (webErr) {
        console.warn('Web search fallback unavailable:', webErr.message);
      }
    }

    // 2. Generate grounded answer
    const answer = await generateAnswer({ question, context, grade, subject, topic, history });

    logEvent('ai_ask', {
      userEmail,
      role,
      source: 'topic_ai_coach',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      topic,
      subject,
      grade,
      meta: {
        hasRagContext: Boolean(context),
        sourceCount: sources.length,
        ragStrategy: ragMeta.strategy,
        strictCandidates: ragMeta.strictCandidates,
        broadCandidates: ragMeta.broadCandidates,
        usedFollowUpExpansion: Boolean(ragMeta.usedFollowUpExpansion),
        subjectUsed: ragMeta.subjectUsed || '',
        subjectInferred: Boolean(ragMeta.subjectInferred),
        hasWebContext: Boolean(webMeta.count),
        webSourceCount: webMeta.count || 0,
        webQuery: webMeta.query || '',
      },
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

// POST /ask/stream - SSE streaming version
router.post('/stream', async (req, res) => {
  const startedAt = Date.now();
  const { question, curriculum = 'IB_PYP', grade, subject, topic, history = [], userEmail, role } = req.body;
  const normalizedCurriculum = normalizeCurriculum(curriculum);

  if (!question || question.trim().length === 0) {
    return res.status(400).json({ error: 'question is required' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    let context = '';
    let sources = [];
    let ragMeta = { strategy: 'none', strictCandidates: 0, broadCandidates: 0, selected: 0 };
    let webMeta = { enabled: false, query: '', count: 0 };

    // 1. Retrieve RAG context
    try {
      const rag = await retrieveCurriculumContext({
        question,
        curriculum: normalizedCurriculum,
        grade: grade || undefined,
        subject: subject || undefined,
        topic: topic || undefined,
        history,
        maxSources: 5,
      });
      context = rag.context;
      sources = rag.sources;
      ragMeta = rag.meta;
    } catch (qdrantErr) {
      console.warn('Qdrant unavailable, using no-context mode:', qdrantErr.message);
    }

    // 1b. Curriculum-aware web search fallback when RAG has no context
    if (!context) {
      try {
        const web = await retrieveWebContext({
          question,
          curriculum: normalizedCurriculum,
          grade: grade || undefined,
          subject: subject || undefined,
          topic: topic || undefined,
        });
        if (web.context) {
          context = web.context;
          sources = web.sources;
        }
        webMeta = web.meta;
      } catch (webErr) {
        console.warn('Web search fallback unavailable:', webErr.message);
      }
    }

    // Send sources first
    res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);

    // 2. Stream answer tokens
    await generateAnswerStream({
      question,
      context,
      grade,
      subject,
      topic,
      history,
      onToken: (token) => {
        res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
      },
    });

    // 3. Done signal
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

    logEvent('ai_ask', {
      userEmail,
      role,
      source: 'topic_ai_coach',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      topic,
      subject,
      grade,
      meta: {
        hasRagContext: Boolean(context),
        sourceCount: sources.length,
        streamed: true,
        ragStrategy: ragMeta.strategy,
        strictCandidates: ragMeta.strictCandidates,
        broadCandidates: ragMeta.broadCandidates,
        usedFollowUpExpansion: Boolean(ragMeta.usedFollowUpExpansion),
        subjectUsed: ragMeta.subjectUsed || '',
        subjectInferred: Boolean(ragMeta.subjectInferred),
        hasWebContext: Boolean(webMeta.count),
        webSourceCount: webMeta.count || 0,
        webQuery: webMeta.query || '',
      },
    }).catch(() => {});
  } catch (err) {
    console.error('Error in /ask/stream:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Something went wrong. Please try again.' })}\n\n`);
    res.end();
  }
});

module.exports = router;
