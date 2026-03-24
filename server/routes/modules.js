/**
 * routes/modules.js
 * Content micro-tools: Math Helper, AI Storyteller, Word Wizard
 * All powered by Groq + NCERT chapter content from Qdrant
 */
const express = require('express');
const router  = express.Router();
const Groq    = require('groq-sdk');
const { client, COLLECTION } = require('../services/qdrant');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Helper: fetch chapter text content from Qdrant ─────────────────────────
async function getChapterContext(topic, maxChars = 2500) {
  const chunks = [];
  let offset = null;
  do {
    const result = await client.scroll(COLLECTION, {
      filter: {
        must: [
          { key: 'curriculum',   match: { value: 'NCERT' } },
          { key: 'topic',        match: { value: topic   } },
          { key: 'content_type', match: { value: 'text'  } },
        ],
      },
      limit: 20,
      offset: offset ?? undefined,
      with_payload: true,
      with_vector: false,
    });
    for (const pt of result.points) {
      if (pt.payload?.content) chunks.push(pt.payload.content);
    }
    offset = result.next_page_offset ?? null;
  } while (offset !== null && chunks.join(' ').length < maxChars);

  return chunks.join('\n\n').slice(0, maxChars);
}

// ── POST /modules/math-helper ──────────────────────────────────────────────
// Generates or solves a math problem from the chapter step-by-step
router.post('/math-helper', async (req, res) => {
  try {
    const { topic, problem } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const context = await getChapterContext(topic);

    const prompt = `You are Ms. Zara, a patient and encouraging Grade 3 Maths teacher.

Chapter: "${topic}"
Chapter content:
${context}

${problem
  ? `The student wants help with: "${problem}"\nSolve this step by step for an 8-year-old.`
  : `Create ONE fun, simple math problem from this chapter for a Grade 3 student. Then solve it step by step.`
}

Rules:
- Simple words only, max 10 words per sentence
- Use a real-life context (Meera, Ravi, market, school, etc.)
- Show each step clearly and simply
- End with warm encouragement

Return ONLY valid JSON, no markdown:
{
  "problem": "...",
  "steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
  "answer": "The answer is ...",
  "encouragement": "...",
  "tryThis": "A similar problem for the student to try on their own..."
}`;

    const resp = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens:  700,
    });

    const raw   = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    res.json({ topic, ...JSON.parse(match[0]) });
  } catch (err) {
    console.error('math-helper error:', err.message);
    res.status(500).json({ error: 'Failed to generate math help' });
  }
});

// ── POST /modules/storyteller ──────────────────────────────────────────────
// Interactive branching story — each call returns a story segment + 3 choices
router.post('/storyteller', async (req, res) => {
  try {
    const { topic, choice, storyHistory = [] } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const context      = await getChapterContext(topic, 1500);
    const isStart      = storyHistory.length === 0;
    const isLastChoice = storyHistory.length >= 3;

    const historyText = storyHistory.length > 0
      ? `\nStory so far:\n${storyHistory.map((h, i) => `Part ${i + 1}: ${h}`).join('\n')}\n`
      : '';
    const choiceText = choice ? `\nStudent chose: "${choice}"\n` : '';

    const prompt = `You are a fun storyteller for 8-year-old kids in India.

The story must teach the maths concept: "${topic}" naturally through the plot.

Chapter content for reference:
${context}
${historyText}${choiceText}

${isStart
  ? `Write the OPENING of an exciting story (3-4 short sentences). Introduce a child character (Indian name). Make the maths concept "${topic}" central to the problem they face. End at an exciting decision moment.`
  : isLastChoice
  ? `Write the FINAL ENDING of the story (4-5 short sentences). The character uses "${topic}" to solve the problem heroically. Happy, satisfying ending. No more choices.`
  : `Continue the story (3-4 short sentences) based on the choice made. Keep "${topic}" central. End at another exciting decision moment.`
}

Rules:
- Simple words, short sentences (max 10 words each)
- Fun, exciting, kid-friendly
- Indian context (school, market, village, festival)
- The maths concept must appear naturally in the story

Return ONLY valid JSON, no markdown:
{
  "segment": "...",
  "choices": ["...", "...", "..."],
  "isEnd": false
}

${isLastChoice ? 'Set "isEnd": true and "choices": [] for the final ending.' : ''}`;

    const resp = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.78,
      max_tokens:  500,
    });

    const raw   = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    res.json({ topic, ...JSON.parse(match[0]) });
  } catch (err) {
    console.error('storyteller error:', err.message);
    res.status(500).json({ error: 'Failed to generate story' });
  }
});

// ── POST /modules/word-wizard ──────────────────────────────────────────────
// Picks key maths vocabulary from the chapter and explains each simply
router.post('/word-wizard', async (req, res) => {
  try {
    const { topic, word } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const context = await getChapterContext(topic);

    const prompt = `You are Ms. Zara, a friendly Grade 3 Maths teacher.

Chapter: "${topic}"
Chapter content:
${context}

${word
  ? `Explain the maths word or concept: "${word}" from this chapter.`
  : `Pick exactly 4 of the MOST IMPORTANT maths words or concepts from this chapter that every Grade 3 student must know.`
}

For ${word ? 'this word' : 'each of the 4 words'}:
- Simple meaning in 1 sentence (max 10 words, language for an 8-year-old)
- One fun real-life example from daily life in India
- How it connects to the chapter "${topic}"

Return ONLY valid JSON, no markdown:
{
  "words": [
    {
      "word": "...",
      "meaning": "...",
      "example": "...",
      "connection": "..."
    }
  ]
}`;

    const resp = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.35,
      max_tokens:  700,
    });

    const raw   = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed = JSON.parse(match[0]);
    res.json({ topic, words: parsed.words ?? [] });
  } catch (err) {
    console.error('word-wizard error:', err.message);
    res.status(500).json({ error: 'Failed to generate word wizard' });
  }
});

module.exports = router;
