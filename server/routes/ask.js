const express = require('express');
const router = express.Router();
const { generateAnswer, generateAnswerStream } = require('../services/llm');
const { retrieveCurriculumContext } = require('../services/rag');
const { retrieveWebContext } = require('../services/webSearch');
const { logEvent } = require('../services/analytics');
const { normalizeCurriculum } = require('../utils/curriculum');
const supabase = require('../services/supabase');

// ── Free-tier daily message limit ──────────────────────────────────
const FREE_DAILY_LIMIT = 10;

async function getIsPro(email) {
  if (!email) return false;
  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', email.toLowerCase().trim())
      .maybeSingle();
    return data?.data?.isPro === true;
  } catch { return false; }
}

async function getDailyUsage(email) {
  if (!email) return { count: 0 };
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = email.toLowerCase().trim();
  try {
    const { data } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', key)
      .maybeSingle();
    const usage = data?.data?.aiUsage || {};
    if (usage.date === today) return { count: usage.count || 0 };
    return { count: 0 }; // new day, reset
  } catch { return { count: 0 }; }
}

async function incrementDailyUsage(email) {
  if (!email) return;
  const today = new Date().toISOString().slice(0, 10);
  const key = email.toLowerCase().trim();
  try {
    const { data: existing } = await supabase
      .from('user_preferences')
      .select('data')
      .eq('user_email', key)
      .maybeSingle();
    const currentData = existing?.data || {};
    const usage = currentData.aiUsage || {};
    const newCount = (usage.date === today) ? (usage.count || 0) + 1 : 1;
    await supabase.from('user_preferences').upsert({
      user_email: key,
      data: { ...currentData, aiUsage: { date: today, count: newCount } },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_email' });
  } catch (err) { console.error('[incrementDailyUsage]', err?.message); }
}

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

    // ── Free-tier usage gate ────────────────────────────────────────
    const emailLc = (userEmail || '').toLowerCase().trim();
    const isPro = await getIsPro(emailLc);
    if (!isPro && emailLc) {
      const { count } = await getDailyUsage(emailLc);
      if (count >= FREE_DAILY_LIMIT) {
        return res.status(429).json({
          error: `You've used all ${FREE_DAILY_LIMIT} free messages for today. Upgrade to Pro for unlimited AI Coach access.`,
          limitReached: true,
          dailyLimit: FREE_DAILY_LIMIT,
          used: count,
        });
      }
    }

    let context = '';
    let sources = [];
    let images = [];
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
      images = rag.images || [];
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

    // Track usage for free-tier limit
    if (!isPro && emailLc) incrementDailyUsage(emailLc).catch(() => {});

    res.json({ answer, sources, images });
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

// POST /ask/teacher — Teacher AI assistant, no student guardrails, uses real class data
// Supports: text questions, image attachments (base64), PDF text extraction (text + scanned)
router.post('/teacher', async (req, res) => {
  try {
    const { question, classSummary = '', teacherEmail = '', imageBase64, imageType, pdfText, pdfBase64, pdfName } = req.body;
    if (!question?.trim() && !imageBase64 && !pdfText && !pdfBase64) return res.status(400).json({ error: 'question or attachment required' });

    // Server-side PDF text extraction for scanned/image PDFs
    let resolvedPdfText = pdfText || '';
    if (pdfBase64 && !resolvedPdfText) {
      try {
        const pdfParse = require('pdf-parse');
        const buffer = Buffer.from(pdfBase64, 'base64');
        const data = await pdfParse(buffer);
        resolvedPdfText = data.text?.trim() || '';
        if (!resolvedPdfText) {
          resolvedPdfText = `[This PDF (${pdfName || 'uploaded'}) appears to be a scanned/image-based document with no extractable text. Please upload the individual pages as images for analysis.]`;
        }
      } catch (pdfErr) {
        resolvedPdfText = `[PDF parse error: ${pdfErr.message}. Try uploading pages as images instead.]`;
      }
    }

    const Groq = require('groq-sdk');
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const systemPrompt = `You are an expert AI teaching assistant helping a professional school teacher.
You have full access to the teacher's class data below.
Be direct, specific, and professional. No child-friendly guardrails.
Use student names in your responses. Give data-driven, actionable insights.
Format responses with clear bullet points and headers where appropriate.
If asked about weak topics, analyse actual completed topic counts.
If asked about struggling students, use the NEEDS ATTENTION flag and low progress %.
If given an image of an assignment or worksheet, analyse it, grade it if possible, identify mistakes, and give teacher feedback.
If given PDF text (assignment/worksheet), extract questions, grade answers, and provide per-student feedback.
Never hallucinate — only use data provided.

CLASS DATA:
${classSummary || 'No class data provided.'}`;

    let answer;

    // Image attachment — use Groq vision model
    if (imageBase64) {
      const userContent = [
        {
          type: 'image_url',
          image_url: { url: `data:${imageType || 'image/jpeg'};base64,${imageBase64}` },
        },
        {
          type: 'text',
          text: question || 'Analyse this assignment/document. Grade it, identify mistakes, and provide teacher feedback.',
        },
      ];
      const completion = await client.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });
      answer = completion.choices?.[0]?.message?.content || 'Could not analyse image.';

    } else {
      // Text question (possibly with PDF text appended)
      const userContent = resolvedPdfText
        ? `${question || 'Analyse this document:'}\n\n[PDF CONTENT]:\n${resolvedPdfText.slice(0, 6000)}`
        : question;

      const completion = await client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.4,
        max_tokens: 800,
      });
      answer = completion.choices?.[0]?.message?.content || 'Unable to generate response.';
    }

    res.json({ answer });
  } catch (err) {
    console.error('Teacher AI error:', err.message);
    res.status(500).json({ error: 'AI error: ' + err.message });
  }
});

// POST /ask/parent — Parent AI assistant
// Warm, jargon-free, focused on single child. No teacher-level data access.
router.post('/parent', async (req, res) => {
  try {
    const { question, childSummary = '', childName = '', parentEmail = '' } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: 'question is required' });

    const Groq = require('groq-sdk');
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const systemPrompt = `You are a warm, supportive AI assistant helping a parent understand and support their child's learning journey on the Aivorah platform.

Your role:
- Explain their child's progress in simple, jargon-free language
- Suggest specific, practical activities they can do at home (5–10 minutes max)
- Help them understand what topics their child is working on
- Decode report data into plain English
- Help draft messages to the teacher if asked
- Be encouraging and non-judgmental — never make the parent feel bad
- Keep answers short, warm, and actionable

Rules:
- Only talk about the child whose data is provided
- Never make up data — only use what's in CHILD DATA below
- If data is missing, say so kindly and suggest what to look for
- No technical jargon — speak like a friendly school counsellor

CHILD DATA:
${childSummary || 'No child data available yet.'}`;

    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0.5,
      max_tokens: 600,
    });

    const answer = completion.choices?.[0]?.message?.content || 'Unable to generate response.';
    res.json({ answer });
  } catch (err) {
    console.error('Parent AI error:', err.message);
    res.status(500).json({ error: 'AI error: ' + err.message });
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

  // ── Free-tier usage gate (stream) ─────────────────────────────
  const streamEmailLc = (userEmail || '').toLowerCase().trim();
  const streamIsPro = await getIsPro(streamEmailLc);
  if (!streamIsPro && streamEmailLc) {
    const { count } = await getDailyUsage(streamEmailLc);
    if (count >= FREE_DAILY_LIMIT) {
      return res.status(429).json({
        error: `You've used all ${FREE_DAILY_LIMIT} free messages for today. Upgrade to Pro for unlimited AI Coach access.`,
        limitReached: true,
        dailyLimit: FREE_DAILY_LIMIT,
        used: count,
      });
    }
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
    let images = [];
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
      images = rag.images || [];
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

    // Send sources + images first
    res.write(`data: ${JSON.stringify({ type: 'sources', sources, images })}\n\n`);

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

    // Track usage for free-tier limit
    if (!streamIsPro && streamEmailLc) incrementDailyUsage(streamEmailLc).catch(() => {});

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

// GET /ask/usage?email=...
// Returns daily usage stats for the AI Coach (used by frontend to show remaining messages)
router.get('/usage', async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });

    const isPro = await getIsPro(email);
    if (isPro) return res.json({ isPro: true, unlimited: true, dailyLimit: null, used: 0, remaining: null });

    const { count } = await getDailyUsage(email);
    res.json({
      isPro: false,
      unlimited: false,
      dailyLimit: FREE_DAILY_LIMIT,
      used: count,
      remaining: Math.max(0, FREE_DAILY_LIMIT - count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
