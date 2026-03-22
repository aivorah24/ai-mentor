/**
 * routes/ncert.js
 * NCERT Maths Mela Class 3 — chapter list + chapter content endpoints
 */
const express = require('express');
const router  = express.Router();
const Groq    = require('groq-sdk');
const { client, COLLECTION } = require('../services/qdrant');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Static chapter metadata ────────────────────────────────────────────────
const CHAPTERS = [
  { id: 1, file: 'cemm101', topic: 'Where to Look for Numbers',  unit: 'Numbers',                  emoji: '🔢' },
  { id: 2, file: 'cemm102', topic: 'Fun with Numbers',           unit: 'Numbers',                  emoji: '🎲' },
  { id: 3, file: 'cemm103', topic: 'Give and Take',              unit: 'Addition & Subtraction',   emoji: '➕' },
  { id: 4, file: 'cemm104', topic: 'Long and Short',             unit: 'Measurement',              emoji: '📏' },
  { id: 5, file: 'cemm105', topic: 'Shapes and Designs',         unit: 'Geometry',                 emoji: '🔷' },
  { id: 6, file: 'cemm106', topic: 'How Much Can You Carry?',    unit: 'Weight & Mass',            emoji: '⚖️' },
  { id: 7, file: 'cemm107', topic: 'Time Goes On',               unit: 'Time',                     emoji: '🕐' },
  { id: 8, file: 'cemm108', topic: 'Who is Heavier?',            unit: 'Weight & Mass',            emoji: '🏋️' },
  { id: 9, file: 'cemm109', topic: 'How Many Times?',            unit: 'Multiplication & Division', emoji: '✖️' },
  { id: 10,file: 'cemm110', topic: 'Play with Patterns',         unit: 'Patterns',                 emoji: '🔵' },
  { id: 11,file: 'cemm111', topic: 'Jugs and Mugs',              unit: 'Capacity',                 emoji: '🪣' },
  { id: 12,file: 'cemm112', topic: 'Can We Share?',              unit: 'Division & Fractions',     emoji: '🍕' },
  { id: 13,file: 'cemm113', topic: 'Smart Charts',               unit: 'Data Handling',            emoji: '📊' },
  { id: 14,file: 'cemm114', topic: 'Rupees and Paise',           unit: 'Money',                    emoji: '💰' },
];

const HOOK_QUESTIONS = {
  'Where to Look for Numbers':  'Look around you right now — how many numbers can you spot?',
  'Fun with Numbers':           'What is the biggest number you can think of?',
  'Give and Take':              'If I give you 5 sweets and take back 2, what is left?',
  'Long and Short':             'Is your pencil longer or shorter than your hand?',
  'Shapes and Designs':         'Can you draw a house using only 3 shapes?',
  'How Much Can You Carry?':    'Can you carry your school bag with just one finger?',
  'Time Goes On':               'How many minutes do you think until your next meal?',
  'Who is Heavier?':            'Which is heavier — your backpack or a water bottle?',
  'How Many Times?':            'If you jump 3 times, 4 times, and 5 times, how many jumps total?',
  'Play with Patterns':         'What comes next: 🔴🔵🔴🔵🔴...?',
  'Jugs and Mugs':              'How many cups of water do you think fill a bottle?',
  'Can We Share?':              'If you have 8 biscuits and 2 friends, how many does each get?',
  'Smart Charts':               "What is your class's favourite fruit? How would you show it?",
  'Rupees and Paise':           'If a pencil costs ₹5, how many can you buy with ₹20?',
};

// ── GET /ncert/chapters ────────────────────────────────────────────────────
// Returns all 14 chapters with metadata + content counts from Qdrant
router.get('/chapters', async (req, res) => {
  try {
    // Count text + image chunks per chapter from Qdrant
    const counts = {};
    let offset = null;
    do {
      const result = await client.scroll(COLLECTION, {
        filter: { must: [{ key: 'curriculum', match: { value: 'NCERT' } }] },
        limit: 250,
        offset: offset ?? undefined,
        with_payload: true,
        with_vector: false,
      });
      for (const pt of result.points) {
        const topic = pt.payload?.topic;
        if (!topic) continue;
        if (!counts[topic]) counts[topic] = { text: 0, image: 0 };
        if (pt.payload.content_type === 'image') counts[topic].image++;
        else counts[topic].text++;
      }
      offset = result.next_page_offset ?? null;
    } while (offset !== null);

    const chapters = CHAPTERS.map(ch => ({
      ...ch,
      hookQuestion: HOOK_QUESTIONS[ch.topic] || '',
      textChunks:   counts[ch.topic]?.text  ?? 0,
      imageChunks:  counts[ch.topic]?.image ?? 0,
      hasContent:   (counts[ch.topic]?.text ?? 0) + (counts[ch.topic]?.image ?? 0) > 0,
    }));

    res.json({ curriculum: 'NCERT', grade: 'Class 3', book: 'Maths Mela', chapters });
  } catch (err) {
    console.error('Error in GET /ncert/chapters:', err.message);
    res.status(500).json({ error: 'Failed to fetch chapters' });
  }
});

// ── GET /ncert/chapter-content?topic=... ──────────────────────────────────
// Returns all text chunks + image chunks for a chapter topic
router.get('/chapter-content', async (req, res) => {
  try {
    const { topic } = req.query;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const textChunks  = [];
    const imageChunks = [];
    let offset = null;

    do {
      const result = await client.scroll(COLLECTION, {
        filter: {
          must: [
            { key: 'curriculum', match: { value: 'NCERT' } },
            { key: 'topic',      match: { value: topic   } },
          ],
        },
        limit: 100,
        offset: offset ?? undefined,
        with_payload: true,
        with_vector: false,
      });

      for (const pt of result.points) {
        const p = pt.payload;
        if (p.content_type === 'image') {
          imageChunks.push({
            id:         pt.id,
            caption:    p.content,
            image_path: p.image_path || null,
            page:       p.page || null,
          });
        } else {
          textChunks.push({
            id:      pt.id,
            content: p.content,
          });
        }
      }

      offset = result.next_page_offset ?? null;
    } while (offset !== null);

    // Sort image chunks by page number
    imageChunks.sort((a, b) => (a.page ?? 99) - (b.page ?? 99));

    const ch = CHAPTERS.find(c => c.topic === topic);
    res.json({
      topic,
      unit:        ch?.unit || '',
      emoji:       ch?.emoji || '📚',
      hookQuestion: HOOK_QUESTIONS[topic] || '',
      textChunks,
      imageChunks,
    });
  } catch (err) {
    console.error('Error in GET /ncert/chapter-content:', err.message);
    res.status(500).json({ error: 'Failed to fetch chapter content' });
  }
});

// ── POST /ncert/quiz ───────────────────────────────────────────────────────
// Generates 5 MCQ questions for a chapter using Groq
router.post('/quiz', async (req, res) => {
  try {
    const { topic, context = '' } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const prompt = `You are a Grade 3 MATHEMATICS teacher creating a quiz about: "${topic}".

STRICT RULES — violations will fail the quiz:
1. NEVER ask about: spelling, letters in a word, alphabets, grammar, colors, animals (unless counting them)
2. EVERY question must have a NUMBER as the answer (e.g., 5, 12, 100)
3. All 4 answer options must be NUMBERS only (e.g., "A. 5", "B. 10", "C. 15", "D. 20")
4. Test the mathematical concept of "${topic}" directly

GOOD question examples for "Where to Look for Numbers":
- "How many days are in a week?" (answer: 7)
- "A clock shows 3 numbers on top half. How many on full clock?" (answer: 12)
- "Bus number is 42. What is the tens digit?" (answer: 4)

BAD question examples (NEVER use — these are banned):
- "How many letters are in the word...?" (BANNED — English)
- "How many letters in 'Seventeen'?" (BANNED — English spelling)
- "How many letters in the name...?" (BANNED — English)
- "What color is...?" (BANNED — not math)
- "Which animal...?" (BANNED — not math)
- NEVER ask about letters, spelling, or words — even if they contain numbers

ONLY ask about REAL-WORLD NUMBER situations:
- Counting objects (apples, coins, students)
- Reading numbers (on clocks, buses, pages, prices)
- Comparing quantities (more, less, bigger, smaller)
- Simple arithmetic with real objects

${context ? `Chapter content for reference:\n${context}\n` : ''}

Create exactly 5 questions. Each answer option must be a NUMBER.

Return ONLY valid JSON:
{
  "questions": [
    {
      "question": "...",
      "options": ["A. 5", "B. 10", "C. 15", "D. 20"],
      "correct": 0,
      "explanation": "..."
    }
  ]
}

correct = index 0-3 of the right answer.`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1500,
    });

    const content   = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ topic, questions: parsed.questions ?? [] });
  } catch (err) {
    console.error('Error in POST /ncert/quiz:', err.message);
    res.status(500).json({ error: 'Failed to generate quiz' });
  }
});

// ── POST /ncert/explain-wrong ──────────────────────────────────────────────
// When student answers a quiz question wrong, AI explains the correct concept
router.post('/explain-wrong', async (req, res) => {
  try {
    const { topic, question, wrongAnswer, correctAnswer } = req.body;
    if (!topic || !question) return res.status(400).json({ error: 'topic and question are required' });

    const prompt = `You are Ms. Zara, a warm and encouraging Grade 3 Maths teacher.

A student answered this question WRONG:
Question: "${question}"
Student answered: "${wrongAnswer}"
Correct answer: "${correctAnswer}"
Topic: "${topic}"

Give a SHORT, clear, encouraging explanation (3-4 sentences max) that:
1. Gently tells them the correct answer
2. Explains WHY it is correct in simple words a 8-year-old understands
3. Gives one easy real-life example
4. Ends with encouragement

Be warm, simple, and supportive. No bullet points. Just natural sentences.`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 200,
    });

    const explanation = response.choices[0].message.content.trim();
    res.json({ explanation });
  } catch (err) {
    console.error('Error in POST /ncert/explain-wrong:', err.message);
    res.status(500).json({ error: 'Failed to generate explanation' });
  }
});

module.exports = router;
