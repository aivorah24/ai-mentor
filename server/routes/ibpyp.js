/**
 * routes/ibpyp.js
 * IB PYP Quiz & Adaptive Practice — Grades 3, 4, 5
 * Mirrors the NCERT quiz pattern but works for any subject + grade
 */
const express = require('express');
const router  = express.Router();
const Groq    = require('groq-sdk');
const { logEvent } = require('../services/analytics');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Subject-specific instructions for better quiz quality
const SUBJECT_CONTEXT = {
  Mathematics: {
    focus: 'numbers, arithmetic, geometry, measurement, patterns, and data handling',
    rule: 'Every question should test a mathematical concept. Prefer questions with a number as the answer.',
  },
  Science: {
    focus: 'living things, plants, animals, earth & space, weather, matter, forces, and environment',
    rule: 'Base questions on observable science concepts. Use real-world examples kids can relate to.',
  },
  'Social Studies': {
    focus: 'community, culture, geography, history, maps, countries, and global connections',
    rule: 'Focus on understanding concepts, not memorising facts. Use scenarios kids encounter.',
  },
  English: {
    focus: 'reading comprehension, grammar, vocabulary, story elements, and writing skills',
    rule: 'Test language understanding, not obscure vocabulary. Use age-appropriate passages if needed.',
  },
  Arts: {
    focus: 'art elements (colour, line, shape, texture), music concepts (rhythm, beat), and creative expression',
    rule: 'Keep questions visual and practical. Ask about what students create or observe.',
  },
  'Physical Education': {
    focus: 'sports rules, health, body systems, movement skills, and team play',
    rule: 'Focus on health literacy and sport concepts. Keep it practical and fun.',
  },
  ICT: {
    focus: 'computer basics, internet safety, digital tools, coding concepts, and online communication',
    rule: 'Focus on digital literacy. Use scenarios about using devices safely and responsibly.',
  },
};

// Grade → student age range
const GRADE_AGE = { 'Grade 3': '8-9', 'Grade 4': '9-10', 'Grade 5': '10-11' };

// ── POST /ibpyp/quiz ──────────────────────────────────────────────────────────
// Generate 5 MCQ practice questions for any IB PYP topic
router.post('/quiz', async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      topic,
      grade   = 'Grade 3',
      subject = 'Mathematics',
      userEmail,
      role,
    } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const ctx      = SUBJECT_CONTEXT[subject] || { focus: `key concepts in ${subject}`, rule: 'Test conceptual understanding.' };
    const ageRange = GRADE_AGE[grade] || '8-11';

    const prompt = `You are an expert IB PYP ${grade} ${subject} teacher. Create a practice quiz for the topic: "${topic}".

Student profile: IB PYP ${grade}, ages ${ageRange}
Subject focus: ${ctx.focus}
Teaching rule: ${ctx.rule}

Generate EXACTLY 5 multiple-choice questions. Requirements:
1. Simple, clear language appropriate for ages ${ageRange}
2. One clearly correct answer per question
3. Three plausible wrong answers (not obviously silly)
4. Questions increase slightly in difficulty from Q1 to Q5
5. Each explanation must be encouraging and use a real-world example
6. Questions must directly test the topic "${topic}" — IB PYP style (concept-based, inquiry-driven)

Return ONLY valid JSON — no markdown, no extra text:
{
  "questions": [
    {
      "question": "...",
      "options": ["option 1", "option 2", "option 3", "option 4"],
      "correct": 0,
      "explanation": "Short encouraging explanation for ${grade} students (2 sentences max)"
    }
  ]
}

"correct" is the 0-based index of the correct option in the options array.`;

    const completion = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens:  1800,
    });

    const raw  = completion.choices[0]?.message?.content || '';
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return res.status(500).json({ error: 'Failed to parse quiz response' });

    const parsed = JSON.parse(json);

    // Normalise: handle both letter ("A") and 0-based index correct answers
    const LETTER_MAP = { A: 0, B: 1, C: 2, D: 3 };
    const questions = (parsed.questions || []).map(q => ({
      question:    q.question,
      options:     (q.options || []).map(opt => String(opt).replace(/^[A-D]\.\s*/i, '').trim()),
      correct:     typeof q.correct === 'string'
        ? (LETTER_MAP[String(q.correct).toUpperCase()] ?? 0)
        : (typeof q.correct === 'number' ? q.correct : 0),
      explanation: q.explanation || '',
    }));

    logEvent('ibpyp_quiz_generated', {
      userEmail, role,
      source: 'ibpyp_quiz',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      topic, subject, grade,
    }).catch(() => {});

    res.json({ questions, topic, grade, subject });
  } catch (err) {
    console.error('POST /ibpyp/quiz error:', err.message);
    logEvent('ibpyp_quiz_generated', {
      userEmail: req.body?.userEmail,
      source: 'ibpyp_quiz',
      status: 'error',
      latencyMs: Date.now() - startedAt,
      topic: req.body?.topic,
      subject: req.body?.subject,
      grade: req.body?.grade,
      meta: { error: err.message },
    }).catch(() => {});
    res.status(500).json({ error: 'Quiz generation failed' });
  }
});

// ── POST /ibpyp/explain-wrong ─────────────────────────────────────────────────
// Adaptive explanation when a student answers incorrectly
router.post('/explain-wrong', async (req, res) => {
  try {
    const {
      topic,
      subject     = 'Mathematics',
      grade       = 'Grade 3',
      question,
      wrongAnswer,
      correctAnswer,
    } = req.body;

    if (!question || !wrongAnswer || !correctAnswer) {
      return res.status(400).json({ error: 'question, wrongAnswer, correctAnswer are required' });
    }

    const ageRange = GRADE_AGE[grade] || '8-11';

    const prompt = `You are a warm, patient IB PYP ${grade} ${subject} teacher helping a student who got a question wrong.

Topic: "${topic}"
Question: "${question}"
Student's answer: "${wrongAnswer}"
Correct answer: "${correctAnswer}"

Write a short, kind explanation (2-3 sentences) that:
1. Starts with something encouraging (NOT "That's wrong" — say something like "Almost!" or "Good try!")
2. Explains simply WHY the correct answer is right
3. Uses a real-world example or analogy a ${ageRange}-year-old can picture
4. Ends with motivation ("You've got this!", "Try again — you're so close!", "I believe in you!")

Keep it warm, simple, and age-appropriate for ${grade} (ages ${ageRange}).`;

    const completion = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens:  220,
    });

    res.json({ explanation: completion.choices[0]?.message?.content?.trim() || '' });
  } catch (err) {
    console.error('POST /ibpyp/explain-wrong error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /ibpyp/track-result ──────────────────────────────────────────────────
// Called after a student completes a practice quiz — logs score to analytics
router.post('/track-result', async (req, res) => {
  try {
    const {
      userEmail,
      topic,
      subject,
      grade,
      score,           // 0-100
      totalQuestions,
      correctAnswers,
      role = 'student',
    } = req.body;

    await logEvent('ibpyp_quiz_result', {
      userEmail, role,
      source: 'ibpyp_quiz',
      status: 'success',
      topic, subject, grade,
      score,
      meta: { totalQuestions, correctAnswers },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /ibpyp/lesson-content — serve pre-written lesson JSON ─────────────────
router.get('/lesson-content', (req, res) => {
  const { topic, grade, subject } = req.query;
  if (!topic || !grade) return res.status(400).json({ error: 'topic and grade required' });

  const fs   = require('fs');
  const path = require('path');

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // Grade: "Grade 4" → try both "grade_4" and "g4"
  const gradeNum    = (grade.match(/\d+/) || [''])[0];               // "4"
  const gradeSlugA  = slug(grade);                                   // "grade_4"
  const gradeSlugB  = gradeNum ? `g${gradeNum}` : gradeSlugA;        // "g4"

  const subjectSlug = slug(subject || '');
  const topicSlug   = slug(topic);

  const dir = path.join(__dirname, '../data/lessons/pyp');

  // 1. Exact filename match
  for (const gs of [gradeSlugA, gradeSlugB]) {
    const name = `pyp_${gs}_${subjectSlug}_${topicSlug}.json`;
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  // 2. Fuzzy: file must contain grade identifier AND highest-scoring word overlap with topic
  const all = fs.readdirSync(dir);
  const gradeFiles = all.filter(f => f.includes(gradeSlugB) || f.includes(gradeSlugA));

  // Score: count how many significant words from topic appear in filename
  const stopwords = new Set(['and', 'the', 'of', 'in', 'to', 'a', 'an', 'for', 'with', 'problems', 'introduction']);
  const topicWords = topicSlug.split('_').filter(w => w.length > 2 && !stopwords.has(w));

  let bestFile = null, bestScore = 0;
  for (const f of gradeFiles) {
    const score = topicWords.filter(w => f.includes(w)).length;
    if (score > bestScore) { bestScore = score; bestFile = f; }
  }

  if (bestFile && bestScore > 0) {
    return res.json(JSON.parse(fs.readFileSync(path.join(dir, bestFile), 'utf8')));
  }

  res.status(404).json({ error: `No lesson found for "${topic}" / ${grade}`, topicSlug, gradeSlugB });
});

module.exports = router;
