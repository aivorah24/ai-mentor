/**
 * routes/modules.js
 * Content micro-tools: Math Helper, AI Storyteller, Word Wizard
 * All chapter-type aware — content adapts to what the chapter actually teaches
 */
const express = require('express');
const router  = express.Router();
const Groq    = require('groq-sdk');
const { client, COLLECTION } = require('../services/qdrant');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Chapter type map — what skill does each unit develop? ──────────────────
const UNIT_SKILL = {
  'Numbers':                   'recognizing and reading numbers in real-life situations (clocks, bus numbers, door numbers, prices, calendars, page numbers)',
  'Addition & Subtraction':    'adding and subtracting using real objects (apples, coins, students in class)',
  'Measurement':               'measuring and comparing lengths and heights using hand spans, feet, rulers',
  'Geometry':                  'identifying, naming, and drawing 3D shapes — cube, cuboid, cylinder, cone, sphere — and finding them in everyday objects like boxes, cans, balls, ice cream cones',
  'Weight & Mass':             'comparing weights — heavier, lighter, same — using a balance scale',
  'Time':                      'reading time on a clock and understanding calendars, days, months',
  'Multiplication & Division': 'repeated addition and equal groups (how many times, sharing equally)',
  'Patterns':                  'identifying and continuing repeating patterns (colours, shapes, numbers)',
  'Capacity':                  'comparing how much containers hold — more, less, full, empty',
  'Division & Fractions':      'sharing equally and understanding halves and quarters',
  'Data Handling':             'reading and making tally marks and picture charts',
  'Money':                     'recognizing rupees and paise, adding prices, giving change',
};

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
// Generates a chapter-appropriate activity/problem — NOT generic arithmetic
router.post('/math-helper', async (req, res) => {
  try {
    const { topic, unit, problem, previousProblems = [] } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const context  = await getChapterContext(topic);
    const skill    = UNIT_SKILL[unit] || `understanding ${topic}`;

    const prompt = `You are Ms. Zara, a warm Grade 3 Maths teacher who ALWAYS shows step-by-step working.

Chapter: "${topic}"
This chapter is about: ${skill}

Chapter content from textbook:
${context}

${problem
  ? `The student asks: "${problem}". Solve it step by step — show every single step clearly.`
  : `Create ONE word problem that directly practices: ${skill}

     Use real Indian daily-life context. Examples by chapter type:
     - Addition/Subtraction: "Priya has 8 mangoes. She buys 5 more. How many total?"
     - Money: "A pen costs ₹6. Arjun buys 3 pens. How much does he pay?"
     - Time: "School starts at 8 o'clock. It ends 5 hours later. What time does school end?"
     - Multiplication: "There are 4 rows of chairs. Each row has 6 chairs. How many chairs total?"
     - Numbers: "The bus number is 247. What digit is in the tens place?"
     - Measurement: "Priya's ribbon is 15 cm. She cuts off 6 cm. How long is it now?"
     Match the problem TYPE exactly to the chapter skill — never generic.
     ${previousProblems.length > 0 ? `\nIMPORTANT: Do NOT repeat any of these problems already shown:\n${previousProblems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\nCreate a FRESH problem with different numbers and a different situation.` : ''}`
}

STEP-BY-STEP RULES (very important):
- ALWAYS show 3 to 4 clear steps — no skipping
- Each step must show ONE small action: what you know, what you do, what you get
- Step 1: Write what you know (the given information)
- Step 2: Decide what operation to use and why
- Step 3: Do the calculation slowly (e.g. "8 + 5 = 13")
- Step 4: Write the final answer as a complete sentence
- VERIFY your answer is mathematically correct before writing it
- Simple words, max 10 words per sentence, age 8 level

Return ONLY valid JSON, no markdown:
{
  "problem": "Full problem sentence with all numbers clearly stated",
  "hint": "Think about it like this — one short clue",
  "steps": [
    "Step 1: We know that... [given info]",
    "Step 2: We need to... [operation and why]",
    "Step 3: So we calculate... [show the actual sum/calculation]",
    "Step 4: The answer is... [complete sentence answer]"
  ],
  "answer": "The answer is [number] [unit] — written as a full sentence",
  "encouragement": "Short warm praise for trying",
  "tryThis": "Now try: [a similar but slightly different problem]"
}`;

    const resp = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens:  900,
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

// ── POST /modules/math-helper/check ────────────────────────────────────────
// Checks student's answer — returns correct/incorrect + encouragement
router.post('/math-helper/check', async (req, res) => {
  try {
    const { problem, correctAnswer, studentAnswer, topic, unit } = req.body;
    if (!problem || !correctAnswer || studentAnswer === undefined) {
      return res.status(400).json({ error: 'problem, correctAnswer and studentAnswer are required' });
    }

    // Normalise both answers for comparison (strip spaces, lowercase, remove units)
    const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]/g, '').trim();
    const correct = normalise(correctAnswer);
    const student = normalise(studentAnswer);

    // Simple match first — if it contains the core number/word it's correct
    const isCorrect = correct.includes(student) || student.includes(correct) || correct === student;

    if (isCorrect) {
      return res.json({
        isCorrect: true,
        message: 'Correct! Well done!',
        praise: [
          'Fantastic! You got it right!',
          'Amazing work — you are a maths star!',
          'Yes! That is exactly right — brilliant!',
          'Superstar! You solved it perfectly!',
          'Woohoo! Correct answer — you rock!',
        ][Math.floor(Math.random() * 5)],
      });
    }

    // Wrong answer — generate a gentle nudge without giving away the answer
    const skill = UNIT_SKILL[unit] || topic;
    const resp = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: `You are Ms. Zara, a kind Grade 3 Maths teacher.

Problem: "${problem}"
Correct answer: "${correctAnswer}"
Student answered: "${studentAnswer}"

The student is wrong. Give ONE gentle nudge (not the answer) to help them try again.
- Point out what they may have misunderstood
- Keep it very simple (age 8)
- Max 2 short sentences
- End with "Try again — you can do it!"

Return ONLY valid JSON: { "nudge": "..." }` }],
      temperature: 0.4,
      max_tokens: 150,
    });

    const raw = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const nudge = match ? JSON.parse(match[0]).nudge : 'Check your calculation again. Try again — you can do it!';

    res.json({ isCorrect: false, nudge });
  } catch (err) {
    console.error('math-check error:', err.message);
    res.status(500).json({ error: 'Failed to check answer' });
  }
});

// ── POST /modules/storyteller ──────────────────────────────────────────────
// Interactive narrative story — each choice drives the plot naturally
router.post('/storyteller', async (req, res) => {
  try {
    const { topic, unit, choice, storyHistory = [] } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const context      = await getChapterContext(topic, 1500);
    const skill        = UNIT_SKILL[unit] || topic;
    const isStart      = storyHistory.length === 0;
    const isLastChoice = storyHistory.length >= 3;

    const historyText = storyHistory.length > 0
      ? `\nStory so far:\n${storyHistory.map((h, i) => `Part ${i + 1}: ${h}`).join('\n')}\n`
      : '';
    const choiceText = choice ? `\nThe student chose: "${choice}"\n` : '';

    const prompt = `You are a master storyteller writing for 8-year-old kids in India.

The story is set in India and naturally teaches: ${skill}
Based on chapter: "${topic}"

Reference content:
${context}
${historyText}${choiceText}

${isStart
  ? `Write Part 1 of an exciting story (4-5 short sentences).
     - Start with a child character (Indian name, age 8-9) facing a real-life problem that needs ${skill} to solve
     - Make the setting vivid: a market, school, village fair, festival, railway station
     - The maths concept must appear naturally as part of the problem — NOT as a quiz question
     - End at a moment of decision: the character must choose what to do next

     The 3 choices must be ACTIONS the character can take (not maths answers):
     Example: "She runs to the bus" / "She asks the shopkeeper" / "She checks the board again"
     NOT: "The answer is 5" / "Option A" / "42"`
  : isLastChoice
  ? `Write the FINAL PART of the story (5-6 sentences).
     - The character uses ${skill} to solve their problem heroically
     - Show HOW the maths helped them in the story
     - Happy, satisfying ending
     - No more choices needed`
  : `Continue the story (4-5 sentences) based on the choice: "${choice}"
     - The story should naturally progress
     - The maths concept "${topic}" must stay central
     - End at another decision moment with action-based choices`
}

Return ONLY valid JSON, no markdown:
{
  "segment": "...",
  "choices": ["[action choice A]", "[action choice B]", "[action choice C]"],
  "isEnd": false
}
${isLastChoice ? 'Set isEnd: true and choices: []' : ''}

IMPORTANT: Choices must be ACTIONS (what the character does), never maths answers.`;

    const resp = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.78,
      max_tokens:  600,
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
// Key vocabulary from the chapter + an interactive mini-challenge per word
router.post('/word-wizard', async (req, res) => {
  try {
    const { topic, unit, word } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const context = await getChapterContext(topic);
    const skill   = UNIT_SKILL[unit] || topic;

    const prompt = `You are Ms. Zara, a friendly Grade 3 teacher.

Chapter: "${topic}"
This chapter teaches: ${skill}

Textbook content:
${context}

${word
  ? `Explain the word: "${word}" from this chapter.`
  : `Pick exactly 4 key words from this chapter that an 8-year-old MUST understand to master "${topic}".`
}

For each word provide:
1. Simple meaning (1 sentence, max 10 words, age 8 language)
2. A fun real-life Indian example (market, home, school, festival, nature, family)
3. How it connects to "${topic}" specifically (1 sentence)
4. A scenario-based quiz question that tests UNDERSTANDING — NOT a definition question:
   IMPORTANT RULES for the question:
   - NEVER ask "What is [word]?" or "What does [word] mean?" — the meaning is already shown above
   - NEVER put the definition text as an option — the student already read it
   - ASK about a real-life situation: "Which of these shows [word]?" or "Ravi does X. What is this an example of?" or "Which of these does NOT show [word]?"
   - The question should require the student to think and apply the concept
   - Exactly 4 options: first option is the CORRECT answer, rest are plausible wrong answers
   - Wrong options should be from different real-life situations, NOT variations of the definition
   - A short encouraging explanation (max 20 words) that says WHY the correct situation matches the word

GOOD example for word "culture":
  prompt: "Which of these shows a group's culture?"
  options: ["Celebrating Diwali with family every year", "Buying a new phone", "Going to the doctor", "Taking a school exam"]
  correct: 0
  explanation: "Yes! Festivals like Diwali that a community celebrates together show their culture and way of life!"

BAD example (DO NOT do this):
  prompt: "What is culture?"
  options: ["The way of life of a group of people", "The way of life of one person", ...]  ← WRONG, this is just the definition

Return ONLY valid JSON, no markdown:
{
  "words": [
    {
      "word": "...",
      "meaning": "...",
      "example": "...",
      "connection": "...",
      "challenge": {
        "prompt": "Scenario-based question? (max 12 words)",
        "options": ["Correct real-life example", "Wrong situation B", "Wrong situation C", "Wrong situation D"],
        "correct": 0,
        "explanation": "Yes! [why this situation shows the word]"
      }
    }
  ]
}`;

    const resp = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.35,
      max_tokens:  900,
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

// ── POST /modules/word-explain ─────────────────────────────────────────────
// Groq explains why a word quiz answer was wrong — used when student taps wrong option
router.post('/word-explain', async (req, res) => {
  try {
    const { word, meaning, wrongAnswer, correctAnswer, topic } = req.body;
    if (!word || !correctAnswer) return res.status(400).json({ error: 'word and correctAnswer are required' });

    const prompt = `You are Ms. Zara, a kind Grade 3 teacher.

The student was asked about the word "${word}" (which means: ${meaning}).
Correct answer: "${correctAnswer}"
Student chose:  "${wrongAnswer}"

Explain gently why "${correctAnswer}" is right and "${wrongAnswer}" is not.
Rules:
- Age 8 language. Max 3 very short sentences.
- Start with "That is okay!" or "Good try!"
- Explain the correct answer simply using a real-life example
- End with "You are doing great!"

Return ONLY valid JSON: { "explanation": "..." }`;

    const resp = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens:  150,
    });

    const raw   = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const explanation = match ? JSON.parse(match[0]).explanation : `Good try! "${correctAnswer}" is correct because it best describes "${word}". You are doing great!`;
    res.json({ explanation });
  } catch (err) {
    console.error('word-explain error:', err.message);
    res.status(500).json({ error: 'Failed to generate explanation' });
  }
});

// ── POST /modules/word-performance ─────────────────────────────────────────
// Groq analyses student's Word Wizard session and gives a personalized summary
router.post('/word-performance', async (req, res) => {
  try {
    const { topic, results } = req.body;
    // results: [{ word, stars, correct }]  — stars: 2=first try, 1=after hint, 0=wrong
    if (!results?.length) return res.status(400).json({ error: 'results required' });

    const strong  = results.filter(r => r.stars === 2).map(r => r.word);
    const partial = results.filter(r => r.stars === 1).map(r => r.word);
    const weak    = results.filter(r => r.stars === 0).map(r => r.word);

    const prompt = `You are Ms. Zara, a warm Grade 3 teacher giving a student their Word Wizard report.

Chapter: "${topic}"
Student results:
- Got immediately correct (2 stars): ${strong.length ? strong.join(', ') : 'none'}
- Got correct after hint (1 star):   ${partial.length ? partial.join(', ') : 'none'}
- Got wrong:                         ${weak.length ? weak.join(', ') : 'none'}

Write a short, personal, encouraging summary for this student (age 8).
Rules:
- Max 3 short sentences
- Celebrate what they did well first
- Gently name 1 word to practise more (if any weak ones)
- End with a warm motivating line
- Simple age-8 language

Return ONLY valid JSON: { "summary": "...", "stars": ${results.reduce((a, r) => a + r.stars, 0)}, "maxStars": ${results.length * 2} }`;

    const resp = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 200,
    });
    const raw   = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    res.json({
      summary:  parsed.summary || 'Great work today! You are learning so many new words!',
      stars:    results.reduce((a, r) => a + r.stars, 0),
      maxStars: results.length * 2,
    });
  } catch (err) {
    console.error('word-performance error:', err.message);
    res.status(500).json({ error: 'Failed to generate performance summary' });
  }
});

// ── POST /modules/word-sentence ─────────────────────────────────────────────
// Groq checks if student's sentence uses the word correctly
router.post('/word-sentence', async (req, res) => {
  try {
    const { word, sentence, meaning } = req.body;
    if (!word || !sentence) return res.status(400).json({ error: 'word and sentence required' });

    const prompt = `You are Ms. Zara, a kind Grade 3 teacher.

Word: "${word}" (meaning: ${meaning})
Student's sentence: "${sentence}"

Does the student use "${word}" correctly in context? Be generous — if the usage makes sense, accept it.

Return ONLY valid JSON:
{
  "correct": true/false,
  "feedback": "One short encouraging sentence (age 8, max 12 words)"
}`;

    const resp = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });
    const raw   = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { correct: true, feedback: 'Great sentence!' };
    res.json(parsed);
  } catch (err) {
    console.error('word-sentence error:', err.message);
    res.json({ correct: true, feedback: 'Great effort using that word!' });
  }
});

// ── POST /modules/drawing-buddy ────────────────────────────────────────────
// Generates a drawing activity prompt for visual math or science concepts
router.post('/drawing-buddy', async (req, res) => {
  try {
    const { topic, unit, subject, improveNote, usedTargets = [] } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const context    = await getChapterContext(topic);
    const isScience  = subject === 'Science';
    const skill      = UNIT_SKILL[unit] || topic;
    const subjectCtx = isScience
      ? `Grade 3 Science (NCERT Our Wondrous World) chapter: "${topic}"`
      : `Grade 3 Maths (NCERT Maths Mela) chapter: "${topic}", which teaches: ${skill}`;

    const improveLine = improveNote
      ? `\nIMPROVEMENT FOCUS: Student got feedback: "${improveNote}". Design this task to address that.`
      : '';

    const avoidLine = usedTargets.length > 0
      ? `\nALREADY USED — pick something DIFFERENT from these: ${usedTargets.join(', ')}`
      : '';

    // Guide type mapping — tells frontend which dotted template to draw
    const GUIDE_TYPES = ['oval','rectangle','circle','house','tree','bus','bee','fish','butterfly','flower','cube','person','bird','leaf','star'];

    const prompt = `You are Ms. Zara, a fun Grade 3 teacher creating a drawing task for an 8-year-old.

${subjectCtx}

Chapter content:
${context}

Create ONE very simple drawing task from this chapter.${improveLine}${avoidLine}

RULES:
- Pick ONE specific object actually mentioned in the chapter content — vary your choice each time
- ONE object only, drawable with circles/ovals/rectangles/lines
- GOOD: "Draw a mango" / "Draw a honeybee" / "Draw a bus" / "Draw a leaf"
- BAD: complex scenes with multiple objects
- 4 steps max, each step adds ONE simple shape
- guideType must be ONE word from this list: ${GUIDE_TYPES.join(', ')}
  Pick whichever best matches the shape of what you're asking to draw

Return ONLY valid JSON, no markdown:
{
  "title": "Draw a [object]",
  "instruction": "One sentence why this object is from the chapter",
  "targetShape": "exact object name",
  "guideType": "oval",
  "steps": ["Step 1: ...", "Step 2: ...", "Step 3: ...", "Step 4: ..."],
  "encouragement": "Short warm message",
  "tryThis": "One tiny extra detail"
}`;

    const resp = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.85,
      max_tokens:  600,
    });

    const raw   = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const parsed = JSON.parse(match[0]);
    // Ensure targetShape always exists (fallback for old model responses)
    if (!parsed.targetShape) parsed.targetShape = parsed.title?.replace(/^Draw\s+/i, '') || topic;
    res.json({ topic, ...parsed });
  } catch (err) {
    console.error('drawing-buddy error:', err.message);
    res.status(500).json({ error: 'Failed to generate drawing activity' });
  }
});

// ── POST /modules/drawing-feedback ─────────────────────────────────────────
// Groq Vision analyses student's canvas drawing and gives warm feedback
router.post('/drawing-feedback', async (req, res) => {
  try {
    const { imageBase64, topic, unit, task, targetShape, improveFocus } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });

    const skill = UNIT_SKILL[unit] || topic;
    const target = targetShape || task || topic;
    const focusLine = improveFocus
      ? `\nIMPROVEMENT FOCUS this round: "${improveFocus}" — specifically check if the student addressed this.`
      : '';

    const resp = await groq.chat.completions.create({
      model:      'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${imageBase64}` },
          },
          {
            type: 'text',
            text: `You are Ms. Zara, a warm and encouraging Grade 3 teacher.

The student was asked to draw: "${target}"
Chapter: "${topic}"${skill !== topic ? ` — which teaches: ${skill}` : ''}${focusLine}

Look carefully at this drawing. Give specific, honest, kind feedback to an 8-year-old.

What to check:
- Did the student attempt to draw "${target}"? (even a rough attempt counts)
- For 3D shapes: can you see the basic shape? Are faces/edges roughly shown?
- For science drawings (animals, plants, scenes): are key features visible?
- For number drawings (clock, price tag): are numbers visible?
- What specific details did they include?

Feedback rules:
- Start with something SPECIFIC you can see (not "Great drawing!" — be concrete)
- Give 1 concrete tip to improve the drawing
- End with enthusiastic encouragement — mention what they drew
- Language: very simple, age 8, warm and excited
- If the canvas looks mostly empty: say "I see a blank page — pick up your pencil and try drawing a ${target}! You can do it!"

Return ONLY valid JSON, no markdown:
{
  "praise": "Specific thing you can see in the drawing (1-2 sentences)",
  "suggestion": "One concrete tip to make the drawing better",
  "encouragement": "Short enthusiastic final line",
  "score": 85
}

Score guide: empty canvas = 70, some attempt = 75-80, recognisable drawing = 82-90, detailed + concept shown = 91-100.`,
          },
        ],
      }],
    });

    const raw   = resp.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const parsed = JSON.parse(match[0]);

    // Build spoken feedback text
    const spokenText = `${parsed.praise} ${parsed.suggestion} ${parsed.encouragement}`;
    res.json({ ...parsed, spokenText });
  } catch (err) {
    console.error('drawing-feedback error:', err.message);
    res.status(500).json({ error: 'Failed to analyse drawing' });
  }
});

module.exports = router;
