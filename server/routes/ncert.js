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
  { id: 2, file: 'cemm105', topic: 'Shapes and Designs',         unit: 'Geometry',                 emoji: '🔷' },
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

// ── Science chapter metadata ──────────────────────────────────────────────
const SCIENCE_CHAPTERS = [
  { id: 1,  file: 'ceev101', topic: 'Our Families and Communities',     unit: 'Unit 1 - Our Families and Communities', icon: 'users' },
  { id: 2,  file: 'ceev102', topic: 'Going to the Mela',                 unit: 'Unit 1 - Our Families and Communities', icon: 'map-pin' },
  { id: 3,  file: 'ceev103', topic: 'Celebrating Festivals',             unit: 'Unit 1 - Our Families and Communities', icon: 'star' },
  { id: 4,  file: 'ceev104', topic: 'Life Around Us',                    unit: 'Unit 2 - Living Together',              icon: 'feather' },
  { id: 5,  file: 'ceev105', topic: 'Plants and Animals Live Together',  unit: 'Unit 2 - Living Together',              icon: 'sun' },
  { id: 6,  file: 'ceev106', topic: 'Living in Harmony',                 unit: 'Unit 2 - Living Together',              icon: 'heart' },
  { id: 7,  file: 'ceev107', topic: 'Gifts of Nature',                   unit: 'Unit 3 - Gifts of Nature',              icon: 'droplet' },
  { id: 8,  file: 'ceev108', topic: 'Food We Eat',                       unit: 'Unit 3 - Gifts of Nature',              icon: 'coffee' },
  { id: 9,  file: 'ceev109', topic: 'Staying Healthy and Happy',         unit: 'Unit 3 - Gifts of Nature',              icon: 'activity' },
  { id: 10, file: 'ceev110', topic: 'Things Around Us',                  unit: 'Unit 4 - Things Around Us',             icon: 'box' },
  { id: 11, file: 'ceev111', topic: 'Making Things',                     unit: 'Unit 4 - Things Around Us',             icon: 'tool' },
  { id: 12, file: 'ceev112', topic: 'Taking Charge of Waste',            unit: 'Unit 4 - Things Around Us',             icon: 'trash-2' },
  { id: 13, file: 'ceev113', topic: 'Living and Non-Living Things',      unit: 'Unit 2 - Living Together',              icon: 'zap' },
];

const SCIENCE_HOOKS = {
  'Our Families and Communities':     'How does your family help you every day?',
  'Going to the Mela':                'Have you ever been to a fair or mela? What did you see?',
  'Celebrating Festivals':            'What is your favourite festival and why?',
  'Life Around Us':                   'What plants and animals do you see near your home?',
  'Plants and Animals Live Together': 'Can you find an animal hiding in a plant right now?',
  'Living in Harmony':                'Do any animals live inside your house?',
  'Gifts of Nature':                  'Name 3 things nature gives us for free.',
  'Food We Eat':                      'What did you eat for breakfast today?',
  'Staying Healthy and Happy':        'What do you do every morning to stay healthy?',
  'Living and Non-Living Things':     'Can you name one living and one non-living thing near you?',
  'Things Around Us':                 'Name 5 things you can see right now.',
  'Making Things':                    'Have you ever made something with your hands?',
  'Taking Charge of Waste':           'Where does your garbage go after it leaves your home?',
};

const SCIENCE_READY_TOPICS = new Set([
  'Living and Non-Living Things',
]);

router.get('/science-chapters', async (req, res) => {
  try {
    const counts = {};
    let offset = null;
    do {
      const result = await client.scroll(COLLECTION, {
        filter: { must: [
          { key: 'curriculum', match: { value: 'NCERT' } },
          { key: 'subject',    match: { value: 'Science' } },
        ]},
        limit: 250,
        offset: offset ?? undefined,
        with_payload: true,
        with_vector: false,
      });
      for (const pt of result.points) {
        const topic = pt.payload?.topic;
        if (!topic) continue;
        counts[topic] = (counts[topic] ?? 0) + 1;
      }
      offset = result.next_page_offset ?? null;
    } while (offset !== null);

    const chapters = SCIENCE_CHAPTERS.map(ch => ({
      ...ch,
      hookQuestion: SCIENCE_HOOKS[ch.topic] || '',
      chunkCount:   counts[ch.topic] ?? 0,
      hasContent:   (counts[ch.topic] ?? 0) > 0 || SCIENCE_READY_TOPICS.has(ch.topic),
    }));

    res.json({ curriculum: 'NCERT', grade: 'Grade 3', book: 'Our Wondrous World', chapters });
  } catch (err) {
    console.error('Error in GET /ncert/science-chapters:', err.message);
    res.status(500).json({ error: 'Failed to fetch science chapters' });
  }
});

// ── GET /ncert/science-chapter-content?topic=... ──────────────────────────
router.get('/science-chapter-content', async (req, res) => {
  try {
    const { topic } = req.query;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const chunks = [];
    let offset = null;
    do {
      const result = await client.scroll(COLLECTION, {
        filter: { must: [
          { key: 'curriculum', match: { value: 'NCERT' } },
          { key: 'subject',    match: { value: 'Science' } },
          { key: 'topic',      match: { value: topic } },
        ]},
        limit: 100,
        offset: offset ?? undefined,
        with_payload: true,
        with_vector: false,
      });
      for (const pt of result.points) {
        chunks.push({ id: pt.id, content: pt.payload.content });
      }
      offset = result.next_page_offset ?? null;
    } while (offset !== null);

    const ch = SCIENCE_CHAPTERS.find(c => c.topic === topic);
    res.json({
      topic,
      unit:         ch?.unit || '',
      icon:         ch?.icon || 'zap',
      hookQuestion: SCIENCE_HOOKS[topic] || '',
      textChunks:   chunks,
    });
  } catch (err) {
    console.error('Error in GET /ncert/science-chapter-content:', err.message);
    res.status(500).json({ error: 'Failed to fetch science chapter content' });
  }
});

// ── POST /ncert/science-quiz ────────────────────────────────────────────────
router.post('/science-quiz', async (req, res) => {
  try {
    const { topic, context = '' } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const prompt = `You are a Grade 3 SCIENCE teacher (NCERT "Our Wondrous World") creating a quiz about: "${topic}".

STRICT RULES:
- Exactly 5 multiple-choice questions
- Each question has exactly 4 options (A, B, C, D)
- Questions must be age-appropriate for 8-9 year olds
- Use simple, clear language
- Base questions on this context: ${context.slice(0, 800)}

Return ONLY valid JSON in this exact format:
{
  "questions": [
    {
      "question": "...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correct": "A",
      "explanation": "Simple explanation for a Grade 3 student"
    }
  ]
}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 1500,
    });

    const raw  = completion.choices[0]?.message?.content || '';
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return res.status(500).json({ error: 'Failed to parse quiz' });
    const parsed = JSON.parse(json);

    // Normalize: convert correct from letter ("A","B","C","D") to 0-based index if needed
    // The frontend PracticePhase expects correct as a number (0-3)
    const LETTER_MAP = { A: 0, B: 1, C: 2, D: 3 };
    const questions = (parsed.questions || []).map(q => ({
      ...q,
      correct: typeof q.correct === 'string'
        ? (LETTER_MAP[q.correct.toUpperCase()] ?? 0)
        : q.correct,
      // Strip "A. ", "B. " prefixes from options if present
      options: (q.options || []).map(opt => opt.replace(/^[A-D]\.\s*/i, '')),
    }));

    res.json({ questions });
  } catch (err) {
    console.error('Error in POST /ncert/science-quiz:', err.message);
    res.status(500).json({ error: 'Quiz generation failed' });
  }
});

// ── POST /ncert/science-explain ─────────────────────────────────────────────
router.post('/science-explain', async (req, res) => {
  try {
    const { topic, question, wrongAnswer, correctAnswer } = req.body;

    const prompt = `You are a patient, encouraging Grade 3 Science teacher. A student answered a question wrong.

Topic: "${topic}"
Question: "${question}"
Student answered: "${wrongAnswer}"
Correct answer: "${correctAnswer}"

Give a very simple, friendly explanation (2-3 sentences max) in plain language a 8-year-old understands. Use a real-world example they can relate to. End with encouragement.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 200,
    });

    res.json({ explanation: completion.choices[0]?.message?.content || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const { topic, question, wrongAnswer, correctAnswer, subject = 'Mathematics' } = req.body;
    if (!topic || !question) return res.status(400).json({ error: 'topic and question are required' });

    const isScience = subject === 'Science';
    const teacherDesc = isScience
      ? 'Grade 3 Science teacher (NCERT Our Wondrous World)'
      : 'Grade 3 Maths teacher';

    const prompt = `You are Ms. Zara, a warm and encouraging ${teacherDesc}.

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

