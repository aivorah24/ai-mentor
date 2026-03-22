const express = require('express');
const router = express.Router();
const { embed } = require('../services/embeddings');
const { searchContent } = require('../services/qdrant');
const { generateAnswer } = require('../services/llm');

// POST /ask
// Body: { question, curriculum?, grade?, subject? }
router.post('/', async (req, res) => {
  try {
    const { question, curriculum = 'IB_PYP', grade, subject } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'question is required' });
    }

    // 1. Embed the student's question
    const vector = await embed(question);

    // 2. Search Qdrant — filtered by curriculum + grade + subject
    const results = await searchContent({ vector, curriculum, grade, subject, limit: 5 });

    if (results.length === 0) {
      return res.json({
        answer: "I don't have information on that topic yet. Your teacher can upload more content to help me answer this!",
        sources: [],
      });
    }

    // 3. Build context from top results
    const context = results
      .map(r => {
        const p = r.payload;
        return `[${p.subject || ''} › ${p.unit || ''} › ${p.topic || ''}]\n${p.content}`;
      })
      .join('\n\n---\n\n');

    const sources = results.map(r => ({
      subject: r.payload.subject,
      unit: r.payload.unit,
      topic: r.payload.topic,
      score: Math.round(r.score * 100) / 100,
    }));

    // 4. Generate answer via Groq LLaMA
    const answer = await generateAnswer({ question, context, grade, subject });

    res.json({ answer, sources });
  } catch (err) {
    console.error('Error in /ask:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
