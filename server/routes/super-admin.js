const express  = require('express');
const router   = express.Router();
const Groq     = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('../services/supabase');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jwlepxmclbkrmfzrumch.supabase.co';
const THUMB_BUCKET = 'challenge-thumbnails';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}

function generateId(grade, title) {
  const gradeNum = grade.replace(/\D/g, '');
  return `custom_g${gradeNum}_${slugify(title)}_${Date.now().toString(36)}`;
}

// ── GET /super-admin/challenges ───────────────────────────────────────
router.get('/challenges', async (req, res) => {
  try {
    const { grade, curriculum, subject } = req.query;
    let query = supabase.from('challenges').select('*').order('grade').order('type');
    if (grade)      query = query.eq('grade', grade);
    if (curriculum) query = query.eq('curriculum', curriculum);
    if (subject)    query = query.eq('subject', subject);
    const { data, error } = await query;
    if (error) throw error;

    // Map snake_case DB columns → camelCase for frontend
    const challenges = (data || []).map(c => ({
      id: c.id,
      title: c.title,
      description: c.description,
      grade: c.grade,
      curriculum: c.curriculum,
      subject: c.subject,
      topic: c.topic,
      difficulty: c.difficulty,
      xpReward: c.xp_reward,
      questionCount: c.question_count,
      timeLimitMinutes: c.time_limit_minutes,
      type: c.type,
      category: c.category,
      thumbnailUrl: c.thumbnail_url || null,
    }));
    res.json(challenges);
  } catch (e) {
    console.error('[super-admin/challenges GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /super-admin/challenges/:id/questions ─────────────────────────
router.get('/challenges/:id/questions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('challenge_questions')
      .select('*')
      .eq('challenge_id', req.params.id)
      .order('sort_order');
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error('[super-admin/questions GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /super-admin/challenges/generate ────────────────────────────
router.post('/challenges/generate', async (req, res) => {
  const { grade, subject, topic, difficulty, questionCount = 10, curriculum = 'IB PYP' } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  const difficultyGuide = difficulty === 'Hard'
    ? 'Olympiad-style: elegant, multi-step reasoning, non-obvious answers, tests deep conceptual understanding. Questions should require 2-3 logical steps to solve. Distractors should be common mistakes students make.'
    : difficulty === 'Easy'
    ? 'Straightforward single-step recall or basic application. Clear and unambiguous.'
    : 'Moderate two-step reasoning and application. Plausible distractors based on common errors.';

  const prompt = `You are an expert question setter creating a challenge quiz for ${grade} students. Create ${questionCount} MCQs on "${topic}" (${subject}, difficulty: ${difficulty}).
Note: questions should be curriculum-neutral — no references to specific curricula like IB, NCERT, CBSE in the question text. Focus purely on the concept.

${difficultyGuide}

For EACH question, provide:
- "question": the question text
- "answer": the CORRECT ANSWER VALUE (e.g. "3/8", "75", "False") — do NOT include A/B/C/D labels
- "wrong1", "wrong2", "wrong3": three plausible WRONG ANSWER VALUES based on common student mistakes — no labels
- "explanation": 1 concise sentence explaining WHY the answer is correct

Return ONLY this JSON:
{
  "suggestedTitle": "catchy 3-5 word title",
  "suggestedDescription": "one sentence describing the challenge",
  "questions": [
    {
      "question": "...",
      "answer": "correct answer value here",
      "wrong1": "common mistake 1",
      "wrong2": "common mistake 2",
      "wrong3": "common mistake 3",
      "explanation": "..."
    }
  ]
}

${difficulty === 'Hard' ? 'Questions must be olympiad-style: multi-step, elegant, non-obvious. Avoid trivial word problems.' : ''}
All answers and wrong options must be clearly distinct from each other.`;

  try {
    const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a curriculum question setter. You MUST respond with valid JSON only. Never use "options" or "correct" fields. Always use exactly these fields per question: "question", "answer", "wrong1", "wrong2", "wrong3", "explanation". No other fields allowed.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });
    const text = completion.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(text);
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      return res.status(500).json({ error: 'AI returned invalid format' });
    }

    const labels = ['A', 'B', 'C', 'D'];
    parsed.questions = parsed.questions.map(q => {
      let correctValue, wrongValues;

      if (q.answer) {
        // Preferred format: answer + wrong1/wrong2/wrong3
        correctValue = String(q.answer);
        wrongValues = [q.wrong1, q.wrong2, q.wrong3].filter(Boolean).map(String);
        // Pad if AI gave fewer wrongs
        while (wrongValues.length < 3) wrongValues.push(`Option ${wrongValues.length + 2}`);
      } else if (Array.isArray(q.options) && q.options.length === 4) {
        // Fallback: AI used options/correct format
        const strip = (s) => String(s).replace(/^[A-D]\.\s*/i, '').trim();
        const strippedOptions = q.options.map(strip);
        // Try to find which option the explanation mentions (most reliable signal)
        let bestIdx = Math.max(0, Math.min(3, Number(q.correct) || 0));
        if (q.explanation) {
          for (let i = 0; i < strippedOptions.length; i++) {
            // Check if explanation contains this option value
            if (q.explanation.includes(strippedOptions[i])) {
              bestIdx = i;
              break;
            }
          }
        }
        correctValue = strippedOptions[bestIdx];
        wrongValues = strippedOptions.filter((_, i) => i !== bestIdx);
      } else {
        return null; // skip malformed
      }

      // Shuffle correct + 3 wrongs, assign A/B/C/D server-side
      const pool = [correctValue, ...wrongValues];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const correct = pool.indexOf(correctValue);
      const options = pool.map((val, i) => `${labels[i]}. ${val}`);
      return { question: q.question, options, correct, explanation: q.explanation };
    }).filter(Boolean);

    res.json(parsed);
  } catch (e) {
    console.error('[super-admin/generate]', e.message);
    res.status(500).json({ error: e.message || 'AI generation failed' });
  }
});

// ── POST /super-admin/challenges ─────────────────────────────────────
router.post('/challenges', async (req, res) => {
  const { questions, ...challengeData } = req.body;
  if (!challengeData.title || !questions?.length) {
    return res.status(400).json({ error: 'title and questions are required' });
  }

  const id = generateId(challengeData.grade || 'Grade4', challengeData.title);

  try {
    // Insert challenge
    const { error: cErr } = await supabase.from('challenges').insert({
      id,
      title: challengeData.title,
      description: challengeData.description || '',
      grade: challengeData.grade || 'Grade 4',
      curriculum: challengeData.curriculum || 'IB PYP',
      subject: challengeData.subject || 'Mixed',
      topic: challengeData.topic || '',
      difficulty: challengeData.difficulty || 'Medium',
      xp_reward: challengeData.xpReward || 500,
      question_count: questions.length,
      time_limit_minutes: challengeData.timeLimitMinutes || 20,
      type: challengeData.type || 'school_challenge',
      category: challengeData.category || 'School Challenge',
      thumbnail_url: challengeData.thumbnailUrl || null,
      is_published: true,
    });
    if (cErr) throw cErr;

    // Insert questions
    const qRows = questions.map((q, i) => ({
      challenge_id: id,
      question: q.question,
      options: q.options ?? null,
      correct: q.correct ?? null,
      explanation: q.explanation || '',
      sort_order: i,
      question_type: q.questionType || q.question_type || 'mcq',
      accept_answers: q.acceptAnswers || q.accept_answers || null,
    }));
    const { error: qErr } = await supabase.from('challenge_questions').insert(qRows);
    if (qErr) throw qErr;

    res.json({ success: true, id, challenge: { id, ...challengeData, questionCount: questions.length } });
  } catch (e) {
    console.error('[super-admin/challenges POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /super-admin/challenges/:id ──────────────────────────────────
router.put('/challenges/:id', async (req, res) => {
  const { id } = req.params;
  const { questions, ...challengeData } = req.body;

  try {
    const update = {};
    if (challengeData.title)            update.title = challengeData.title;
    if (challengeData.description)      update.description = challengeData.description;
    if (challengeData.grade)            update.grade = challengeData.grade;
    if (challengeData.curriculum)       update.curriculum = challengeData.curriculum;
    if (challengeData.subject)          update.subject = challengeData.subject;
    if (challengeData.topic)            update.topic = challengeData.topic;
    if (challengeData.difficulty)       update.difficulty = challengeData.difficulty;
    if (challengeData.xpReward != null) update.xp_reward = challengeData.xpReward;
    if (challengeData.timeLimitMinutes) update.time_limit_minutes = challengeData.timeLimitMinutes;
    if (challengeData.type)             update.type = challengeData.type;
    if (challengeData.category)         update.category = challengeData.category;
    if (challengeData.thumbnailUrl !== undefined) update.thumbnail_url = challengeData.thumbnailUrl;
    if (questions?.length)              update.question_count = questions.length;
    update.updated_at = new Date().toISOString();

    const { error: cErr } = await supabase.from('challenges').update(update).eq('id', id);
    if (cErr) throw cErr;

    // Replace questions if provided
    if (questions && questions.length > 0) {
      await supabase.from('challenge_questions').delete().eq('challenge_id', id);
      const qRows = questions.map((q, i) => ({
        challenge_id: id,
        question: q.question,
        options: q.options ?? null,
        correct: q.correct ?? null,
        explanation: q.explanation || '',
        sort_order: i,
        question_type: q.questionType || q.question_type || 'mcq',
        accept_answers: q.acceptAnswers || q.accept_answers || null,
      }));
      const { error: qErr } = await supabase.from('challenge_questions').insert(qRows);
      if (qErr) throw qErr;
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[super-admin/challenges PUT]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /super-admin/challenges/:id ───────────────────────────────
router.delete('/challenges/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Questions auto-deleted via CASCADE
    const { error } = await supabase.from('challenges').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error('[super-admin/challenges DELETE]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /super-admin/challenges/:id/thumbnail ───────────────────────
// Accepts JSON { dataUrl: "data:image/png;base64,..." } → uploads to Supabase Storage
router.post('/challenges/:id/thumbnail', async (req, res) => {
  const { id } = req.params;
  const { dataUrl } = req.body;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'dataUrl is required' });
  }
  try {
    const commaIdx = dataUrl.indexOf(',');
    const header = dataUrl.substring(0, commaIdx); // e.g. "data:image/png;base64"
    const b64 = dataUrl.substring(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+)/);
    if (!mimeMatch) return res.status(400).json({ error: 'Invalid dataUrl format' });
    const mimeType = mimeMatch[1]; // e.g. "image/png"
    const extRaw = mimeType.split('/')[1];
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
    const buffer = Buffer.from(b64, 'base64');
    const filename = `${id}.${ext}`;

    // Upload to Supabase Storage
    const { error: upErr } = await supabase.storage
      .from(THUMB_BUCKET)
      .upload(filename, buffer, { contentType: mimeType, upsert: true });
    if (upErr) throw upErr;

    // Get public URL
    const { data: urlData } = supabase.storage.from(THUMB_BUCKET).getPublicUrl(filename);
    const url = urlData.publicUrl;

    await supabase.from('challenges').update({ thumbnail_url: url }).eq('id', id);
    res.json({ success: true, thumbnailUrl: url });
  } catch (e) {
    console.error('[thumb upload]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
