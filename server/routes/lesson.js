const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Fixed lesson scripts per chapter — used instead of Groq when available
// Key = topic string (must match exactly)
const FIXED_SCRIPTS = {};
const LESSONS_DIR = path.join(__dirname, '../data/lessons');
if (fs.existsSync(LESSONS_DIR)) {
  for (const f of fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const script = JSON.parse(fs.readFileSync(path.join(LESSONS_DIR, f), 'utf8'));
      if (script.topic) FIXED_SCRIPTS[script.topic] = script;
    } catch (_) {}
  }
}

// POST /lesson/script
router.post('/script', async (req, res) => {
  try {
    const {
      topic,
      grade   = 'Grade 3',
      curriculum = 'IB_PYP',
      character  = 'ZARA',
    } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    // Return fixed script if available (pre-authored scenes with Gemini images)
    if (FIXED_SCRIPTS[topic]) {
      const fixed = FIXED_SCRIPTS[topic];
      console.log(`  Using fixed script for: "${topic}" (${fixed.scenes.length} scenes, ${fixed.quiz?.length ?? 0} quiz questions)`);
      return res.json({
        topic, grade, curriculum, character,
        scenes: fixed.scenes,
        quiz:   fixed.quiz ?? [],
      });
    }

    // Accept both 'Grade 3' and 'Class 3' as Grade 3
    const isGrade3   = grade === 'Grade 3' || grade === 'Class 3';
    const sceneCount = isGrade3 ? 14 : 18;

    const { context = '', imageCaptions = [] } = req.body;

    // Build image context block so each scene can reference a real book image
    const imageBlock = imageCaptions.length > 0
      ? `TEXTBOOK IMAGES (each scene should explain what is shown in the image):\n` +
        imageCaptions.map((cap, i) => `Image ${i + 1}: ${cap}`).join('\n') + '\n\n'
      : '';

    const prompt = `You are Ms. Zara — a warm, patient teacher for 8-year-old students.
You are explaining the chapter "${topic}" from NCERT Maths Mela Class 3.

${imageBlock}${context ? `CHAPTER TEXT:\n${context}\n\n` : ''}

YOUR JOB: Look at each textbook image above. For each scene, describe what is shown in the image and explain it simply.
Match your explanation to the image the student is looking at.

LANGUAGE RULES — very important:
- Maximum 8 words per sentence. Short and clear.
- Use only simple everyday words. No big words.
- Speak slowly: use commas and full stops to create natural pauses.
- Speak directly: "Look at this.", "Can you see?", "Yes! Well done!"
- One idea per scene. Do not rush.
- Age 8 language. Like talking to a young child.

GOOD example (correct style):
"Look at this picture. Can you see numbers? Yes! Numbers are all around us."

BAD example (too complex/fast):
"In this chapter we will explore the various ways numbers manifest in our daily environment."

Return ONLY valid JSON, no markdown:
{
  "scenes": [
    { "text": "...", "emotion": "...", "visual": "...", "imageSearch": "2-3 words for photo search" }
  ]
}

imageSearch = 2-3 English keywords for a real-world photo that helps explain this scene.
Example: "clock face numbers", "bus route number", "house door number", "calendar date page"
For greeting/recap/practice scenes where no specific image is needed, set imageSearch to "".

Write exactly ${sceneCount} scenes:

Scene 1:  Greet warmly. "Hello! I am Ms. Zara. Today, we learn about ${topic}!"
  imageSearch: "", emotion: happy, visual: ""

Scene 2:  Introduce the first real-life example. Ask student to look.
  imageSearch: (relevant daily life photo), emotion: happy, visual: (short label, max 20 chars)

Scene 3:  Describe the example. "Can you see...?"
  imageSearch: (same or similar photo), emotion: questioning, visual: (key concept)

Scene 4:  Explain it step by step. Celebrate understanding.
  imageSearch: (related real-world photo), emotion: celebrating, visual: (key word/number)

Scene 5:  Second real-life example. Different from first.
  imageSearch: (different daily life photo), emotion: happy, visual: (label)

Scene 6:  Explore together. Ask the student.
  imageSearch: (same or similar), emotion: excited, visual: (concept)

Scene 7:  Ask a question. Student thinks.
  imageSearch: (relevant photo), emotion: questioning, visual: (question)

Scene 8:  Reveal the answer. Celebrate.
  imageSearch: (relevant photo), emotion: celebrating, visual: (answer)

Scene 9:  Third example. Student's challenge.
  imageSearch: (different photo), emotion: questioning, visual: (challenge)

Scene 10: Reveal and celebrate the answer.
  imageSearch: (relevant photo), emotion: celebrating, visual: (answer)

Scene 11: Common mistake. Show it, then correct it.
  imageSearch: (relevant photo), emotion: thinking, visual: (max 20 chars)

Scene 12: The golden rule to remember.
  imageSearch: (relevant photo), emotion: happy, visual: (rule, max 20 chars)

Scene 13: Quick recap. What did we learn?
  imageSearch: "", emotion: happy, visual: (summary, max 20 chars)

Scene ${sceneCount}: "Amazing! Now let us practice!"
  imageSearch: "", emotion: celebrating, visual: ""

VISUAL FORMAT: Max 20 characters, plain text only, no emojis.
EMOTION OPTIONS: happy, excited, thinking, celebrating, surprised, questioning`;

    const response = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.65,
      max_tokens:  4000,
    });

    const content   = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({
      topic, grade, curriculum, character,
      scenes: parsed.scenes ?? [],
      quiz:   parsed.quiz   ?? [],
    });
  } catch (err) {
    console.error('Error generating lesson script:', err.message);
    res.status(500).json({ error: 'Failed to generate lesson script' });
  }
});

// ElevenLabs — lady voice (Matilda) for all characters
// User confirmed: lady voice is perfect
const ELEVENLABS_VOICE_ID = 'XrExE9yKIg1WjnnlVkGX'; // Matilda — warm, nurturing, clear

router.post('/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });

    const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',  // high-quality, clear, measured pace
        voice_settings: {
          stability:        0.90,   // very high = consistent, slow, clear for age 8
          similarity_boost: 0.85,   // stay close to Matilda voice
          style:            0.05,   // very low = calm, NOT rushed at all
          use_speaker_boost: true,
        },
        speed: 0.85,  // 15% slower than default — clear and unhurried for children
      }),
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      console.error('ElevenLabs error:', errText);
      return res.status(502).json({ error: 'ElevenLabs TTS failed' });
    }

    const buffer = await elRes.arrayBuffer();
    res.json({ audio: Buffer.from(buffer).toString('base64') });
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: 'TTS failed' });
  }
});

// GET /lesson/concept-image?q=clock+face+numbers
// Downloads a concept photo from Unsplash, caches it locally, returns the local path.
// Frontend calls this so images are served from our server (stable, no CORS issues).
const CONCEPT_IMG_DIR = path.join(__dirname, '../data/images/concepts');
fs.mkdirSync(CONCEPT_IMG_DIR, { recursive: true });

// Curated Unsplash direct CDN photo IDs — stable, free, no API key needed
// Each key is a keyword that appears in scene imageSearch values
const CURATED_PHOTOS = {
  'clock':       'photo-1509048191080-d2984bad6ae5',  // wall clock with clear numbers
  'bus':         'photo-1544620347-c4fd4a3d5957',  // city bus with number
  'house':       'photo-1568605114967-8130f3a36994',  // house exterior
  'door':        'photo-1558618666-fcd25c85cd64',  // house door with number
  'calendar':    'photo-1506784365847-bbad939e9335',  // calendar page
  'number':      'photo-1553729459-efe14ef6055d',  // numbers in daily life
  'price':       'photo-1556742049-0cfed4f6a45d',  // shop price tag
  'book':        'photo-1524995997946-a1c2e315a42f',  // open book with pages
  'phone':       'photo-1511707171634-5f897ff02aa9',  // mobile phone
  'shop':        'photo-1534452203293-494d7ddbf7e0',  // shopping
  'count':       'photo-1509228627152-72ae9ae6848d',  // counting objects
  'score':       'photo-1587614382346-4ec70e388b28',  // scoreboard
  'ruler':       'photo-1568667256549-094345857637',  // ruler
  'coin':        'photo-1611974789855-9c2a0a7236a3',  // coins/money
  'rupee':       'photo-1611974789855-9c2a0a7236a3',  // coins/money
  'stamp':       'photo-1586953208448-b95a79798f07',  // postage stamp
  'tally':       'photo-1509228627152-72ae9ae6848d',  // counting marks
  'mark':        'photo-1509228627152-72ae9ae6848d',  // counting
  'cow':         'photo-1546445317-29f4545e9d53',  // cows in field
  'animal':      'photo-1474511320723-9a56873867b5',  // animals
  'default':     'photo-1553729459-efe14ef6055d',  // numbers general
};

function getPhotoId(query) {
  const q = query.toLowerCase();
  for (const [key, id] of Object.entries(CURATED_PHOTOS)) {
    if (q.includes(key)) return id;
  }
  return CURATED_PHOTOS['default'];
}

router.get('/concept-image', async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q) return res.status(400).json({ error: 'q is required' });

    const hash      = crypto.createHash('md5').update(q.toLowerCase().trim()).digest('hex').slice(0, 12);
    const imgFile   = `concept_${hash}.jpg`;
    const imgPath   = path.join(CONCEPT_IMG_DIR, imgFile);
    const servePath = `/data/images/concepts/${imgFile}`;

    // Serve from cache if already downloaded
    if (fs.existsSync(imgPath)) {
      return res.json({ url: servePath, cached: true });
    }

    // Use curated photo ID → direct Unsplash CDN URL (no API key, always works)
    const photoId    = getPhotoId(q);
    const imgUrl     = `https://images.unsplash.com/${photoId}?w=800&q=80&fm=jpg&fit=crop`;
    const imgRes     = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`Download failed: ${imgRes.status}`);

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (buffer.length < 10000) throw new Error('Image too small');

    fs.writeFileSync(imgPath, buffer);
    console.log(`  Cached: "${q}" → ${photoId.slice(0, 20)}… (${(buffer.length/1024).toFixed(0)}KB)`);
    res.json({ url: servePath, cached: false });
  } catch (err) {
    console.error('concept-image error:', err.message);
    res.json({ url: null });
  }
});

// POST /lesson/hook
// Generates a short engaging intro for a chapter — used when no HeyGen video exists
router.post('/hook', async (req, res) => {
  try {
    const { topic, context = '' } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const prompt = `You are Ms. Zara, a warm and enthusiastic Grade 3 Maths teacher.

${context ? `CHAPTER CONTENT:\n${context}\n\n` : ''}

Write a SHORT, engaging spoken introduction for the chapter "${topic}" that:
1. Greets the student warmly
2. Tells them exactly what they will learn today (based on the chapter topic)
3. Gives ONE exciting real-life example of where this topic shows up in their daily life
4. Ends with an enthusiastic "Let's begin!"

Rules:
- Max 4 sentences total
- Simple language for an 8-year-old
- Warm, enthusiastic, encouraging tone
- Do NOT mention addition or subtraction unless the chapter is about that
- Match the intro to the ACTUAL chapter topic

Return ONLY valid JSON, no markdown:
{ "intro": "...", "hook": "...", "visual": "..." }

- intro: the 4-sentence spoken text
- hook: one short curious question to make them think (max 12 words)
- visual: a simple text visual to show on screen (max 30 chars, no emojis)`;

    const response = await groq.chat.completions.create({
      model:       'llama-3.1-8b-instant',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens:  300,
    });

    const content   = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({ topic, intro: parsed.intro ?? '', hook: parsed.hook ?? '', visual: parsed.visual ?? '' });
  } catch (err) {
    console.error('Error generating hook:', err.message);
    res.status(500).json({ error: 'Failed to generate hook' });
  }
});

module.exports = router;
