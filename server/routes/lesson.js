const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { generateSceneImage } = require('../services/gemini');
const { client, COLLECTION } = require('../services/qdrant');
const { resolveImageUrl }    = require('../services/cloudinaryUrls');
const { logEvent }           = require('../services/analytics');
const { getCachedAudio, saveAudio, saveTimings, getLocalPath } = require('../services/audioCache');

// ── Audio cache ─────────────────────────────────────────────────────────────
// Once generated, audio files are saved to disk and served forever (zero quota cost)
const AUDIO_DIR = path.join(__dirname, '../data/audio');
try { fs.mkdirSync(AUDIO_DIR, { recursive: true }); } catch (_) { /* read-only fs on Vercel, skip */ }

// Fixed lesson scripts per chapter — used instead of Groq when available
// Key = topic string (must match exactly)
const FIXED_SCRIPTS = {};
const FIXED_SCRIPTS_NORMALIZED = {};
function normalizeTopicKey(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function registerFixedScriptKey(topicKey, script) {
  const normalized = normalizeTopicKey(topicKey);
  if (!normalized) return;
  FIXED_SCRIPTS_NORMALIZED[normalized] = script;
}
const LESSONS_DIR = path.join(__dirname, '../data/lessons');
if (fs.existsSync(LESSONS_DIR)) {
  for (const f of fs.readdirSync(LESSONS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const script = JSON.parse(fs.readFileSync(path.join(LESSONS_DIR, f), 'utf8'));
      if (script.topic) {
        FIXED_SCRIPTS[script.topic] = script;
        registerFixedScriptKey(script.topic, script);
      }
      if (Array.isArray(script.aliases)) {
        for (const alias of script.aliases) registerFixedScriptKey(alias, script);
      }
    } catch (_) {}
  }
}

// Interactive checkpoints — merged into scenes at serve time
// Separate file so lesson scripts stay clean and checkpoints are maintainable independently
const CHECKPOINTS_FILE = path.join(__dirname, '../data/checkpoints.json');
const CHECKPOINTS = fs.existsSync(CHECKPOINTS_FILE)
  ? JSON.parse(fs.readFileSync(CHECKPOINTS_FILE, 'utf8'))
  : {};

function mergeCheckpoints(scenes, chapterNum) {
  const chapterCheckpoints = CHECKPOINTS[String(chapterNum)] || {};
  return scenes.map(s => {
    const cp = chapterCheckpoints[String(s.scene)];
    return cp ? { ...s, checkpoint: cp } : s;
  });
}

// ── Helper: enrich JSON scenes with image paths from Qdrant ─────────────────
// Falls back to sceneImage already in the JSON if Qdrant has nothing yet.
async function enrichScenesWithQdrantImages(scenes, chapterNum) {
  if (!chapterNum) return scenes;
  try {
    const result = await client.scroll(COLLECTION, {
      filter: {
        must: [
          { key: 'curriculum',   match: { value: 'NCERT' } },
          { key: 'content_type', match: { value: 'scene_image' } },
        ],
      },
      limit: 50,
      with_payload: true,
      with_vector:  false,
    });

    // Build scene → image_path map from Qdrant (filter to this chapter in code)
    const qdrantMap = {};
    for (const pt of result.points) {
      if (pt.payload?.chapter === chapterNum && pt.payload?.scene && pt.payload?.image_path) {
        qdrantMap[pt.payload.scene] = pt.payload.image_path;
      }
    }

    // Merge: Qdrant takes priority, JSON sceneImage is fallback
    // Then resolve to Cloudinary CDN URL if available
    return scenes.map(s => {
      const raw = qdrantMap[s.scene] ?? s.sceneImage ?? null;
      return { ...s, sceneImage: resolveImageUrl(raw) };
    });
  } catch (err) {
    console.error('enrichScenesWithQdrantImages error:', err.message);
    return scenes; // fallback: return as-is
  }
}

// ── Fallback checkpoints for Groq-generated scripts (when Groq doesn't include them) ──
function injectFallbackCheckpoints(scenes) {
  const CHECKPOINT_POSITIONS = [4, 8, 12];
  return scenes.map((s, i) => {
    const sceneNum = i + 1;
    if (!CHECKPOINT_POSITIONS.includes(sceneNum)) return s;
    if (s.checkpoint) return s; // Groq already added one — keep it
    // Generic reflection checkpoint
    return {
      ...s,
      checkpoint: {
        type: 'quick_check',
        prompt: `What is this scene about? Tap the best answer!`,
        options: [
          s.visual && s.visual.length > 3 ? s.visual : 'Key idea',
          'I am not sure',
          'Something else',
          'Ask Ms. Zara',
        ],
        correct: 0,
        explanation: `Great thinking! ${s.visual || 'You are doing really well!'} — keep going!`,
      },
    };
  });
}

// POST /lesson/script
router.post('/script', async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      topic,
      grade      = 'Grade 3',
      curriculum = 'IB_PYP',
      character  = 'ZARA',
      subject    = 'Mathematics',
      userEmail,
      role,
    } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const isScience = subject === 'Science';

    // Return fixed script if available — enrich scenes with Qdrant image paths
    const fixed = FIXED_SCRIPTS[topic] ?? FIXED_SCRIPTS_NORMALIZED[normalizeTopicKey(topic)];
    if (fixed) {
      const fixedTopic = fixed.topic || topic;
      console.log(`  Using fixed script for: "${topic}" -> "${fixedTopic}" (${fixed.scenes.length} scenes, ${fixed.quiz?.length ?? 0} quiz questions)`);

      // Pull scene image paths from Qdrant (stored by ingest-scene-images.js)
      const enrichedScenes = await enrichScenesWithQdrantImages(fixed.scenes, fixed.chapter);

      // Merge interactive checkpoints (scenes 4, 8, 12 get a checkpoint each)
      const scenesWithCheckpoints = mergeCheckpoints(enrichedScenes, fixed.chapter);

      logEvent('ai_lesson_script', {
        userEmail,
        role,
        source: 'lesson_script',
        status: 'success',
        latencyMs: Date.now() - startedAt,
        topic,
        subject,
        grade,
        meta: { mode: 'fixed', sceneCount: scenesWithCheckpoints.length },
      }).catch(() => {});

      return res.json({
        topic, grade, curriculum, character,
        scenes: scenesWithCheckpoints,
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

    const bookName   = isScience ? 'NCERT Our Wondrous World Class 3 (EVS/Science)' : 'NCERT Maths Mela Class 3';
    const subjectCtx = isScience
      ? 'Nature, living things, families, food, health, environment, and our community'
      : 'Numbers, counting, shapes, patterns, and measurements';

    const prompt = `You are Ms. Zara — a warm, patient teacher for 8-year-old students.
You are explaining the chapter "${topic}" from ${bookName}.
Subject area: ${subjectCtx}

${imageBlock}${context ? `CHAPTER TEXT:\n${context}\n\n` : ''}

YOUR JOB: Read the chapter content above. For each scene, explain ONE concept clearly and simply.
${isScience ? 'Connect ideas to nature, family life, food, animals, or community — things the child sees every day.' : 'Connect ideas to numbers, shapes, or patterns the child sees every day.'}

LANGUAGE RULES — very important:
- Maximum 8 words per sentence. Short and clear.
- Use only simple everyday words. No big words.
- Speak slowly: use commas and full stops to create natural pauses.
- Speak directly: "Look at this.", "Can you see?", "Yes! Well done!"
- One idea per scene. Do not rush.
- Age 8 language. Like talking to a young child.

GOOD example (correct style):
"Look at this. Can you see the plants? Yes! Plants need water and sunlight to grow."

BAD example (too complex/fast):
"In this chapter we will explore the various ways nature manifests in our daily environment."

CHECKPOINTS — very important:
Scenes 4, 8, and 12 MUST include a "checkpoint" field. This is an interactive question the student answers before moving on.

Checkpoint format:
{
  "type": "quick_check",
  "prompt": "One clear question about what was just taught (max 12 words)",
  "options": ["Correct answer", "Wrong option B", "Wrong option C", "Wrong option D"],
  "correct": 0,
  "explanation": "Short, encouraging explanation (max 25 words). Always start with a positive word like 'Yes!', 'Great!', 'Excellent!'"
}

Return ONLY valid JSON, no markdown:
{
  "scenes": [
    {
      "text": "...",
      "emotion": "...",
      "visual": "...",
      "imageSearch": "2-3 words for photo search",
      "checkpoint": { ... }
    }
  ]
}

Note: Only scenes 4, 8, and 12 have a checkpoint. All other scenes have NO checkpoint field.

Write exactly ${sceneCount} scenes:

Scene 1:  Greet warmly. "Hello! I am Ms. Zara. Today, we learn about ${topic}!"
  imageSearch: "", emotion: happy, visual: ""

Scene 2:  Introduce the first real-life example from the chapter. Ask student to look.
  imageSearch: (relevant daily life photo), emotion: happy, visual: (short label, max 20 chars)

Scene 3:  Describe the example. "Can you see...?"
  imageSearch: (same or similar photo), emotion: questioning, visual: (key concept)

Scene 4:  Explain it step by step. Celebrate understanding. ADD CHECKPOINT HERE.
  imageSearch: (related real-world photo), emotion: celebrating, visual: (key word)
  checkpoint: { type: "quick_check", ... }

Scene 5:  Second real-life example. Different from first.
  imageSearch: (different daily life photo), emotion: happy, visual: (label)

Scene 6:  Explore together. Ask the student.
  imageSearch: (same or similar), emotion: excited, visual: (concept)

Scene 7:  Ask a question. Student thinks.
  imageSearch: (relevant photo), emotion: questioning, visual: (question)

Scene 8:  Reveal the answer. Celebrate. ADD CHECKPOINT HERE.
  imageSearch: (relevant photo), emotion: celebrating, visual: (answer)
  checkpoint: { type: "quick_check", ... }

Scene 9:  Third example. Student's challenge.
  imageSearch: (different photo), emotion: questioning, visual: (challenge)

Scene 10: Reveal and celebrate the answer.
  imageSearch: (relevant photo), emotion: celebrating, visual: (answer)

Scene 11: Common question or mistake. Show it, then correct it.
  imageSearch: (relevant photo), emotion: thinking, visual: (max 20 chars)

Scene 12: The golden rule to remember. ADD CHECKPOINT HERE.
  imageSearch: (relevant photo), emotion: happy, visual: (rule, max 20 chars)
  checkpoint: { type: "quick_check", ... }

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
    const rawScenes   = parsed.scenes ?? [];
    // Ensure checkpoints exist at positions 4, 8, 12 (Groq may omit them)
    const finalScenes = injectFallbackCheckpoints(rawScenes);
    logEvent('ai_lesson_script', {
      userEmail,
      role,
      source: 'lesson_script',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      topic,
      subject,
      grade,
      model: 'llama-3.3-70b-versatile',
      meta: { mode: 'generated', sceneCount: finalScenes.length },
    }).catch(() => {});
    res.json({
      topic, grade, curriculum, character,
      scenes: finalScenes,
      quiz:   parsed.quiz ?? [],
    });
  } catch (err) {
    console.error('Error generating lesson script:', err.message);
    logEvent('ai_lesson_script', {
      userEmail: req.body?.userEmail,
      role: req.body?.role,
      source: 'lesson_script',
      status: 'error',
      latencyMs: Date.now() - startedAt,
      topic: req.body?.topic,
      subject: req.body?.subject,
      grade: req.body?.grade,
      meta: { error: err.message },
    }).catch(() => {});
    res.status(500).json({ error: 'Failed to generate lesson script' });
  }
});

// ── TTS Voice Config ─────────────────────────────────────────────────────────
// PRIMARY:  TikTok TTS — free, no API key, cartoon energy for kids
// FALLBACK: ElevenLabs — activates automatically when TikTok fails
//
// TikTok voices chosen for Grade 3 kids (age 8-9):
//   main  → en_female_ht_f08_wonderful_world  (warm, enthusiastic, expressive female)
//   comic → en_us_rocket                       (super high energy — perfect for "Wow, try again!")
const TIKTOK_API = 'https://tiktok-tts.weilnet.workers.dev/api/generation';

// Prefer ElevenLabs for stronger modulation. Set USE_ELEVENLABS_PRIMARY=false to switch.
const USE_ELEVENLABS_PRIMARY =
  String(process.env.USE_ELEVENLABS_PRIMARY ?? 'true').toLowerCase() !== 'false';

// TikTok is kept as free fallback when paid TTS is unavailable.
const TIKTOK_VOICE = {
  main: 'en_us_001',
  checkpoint: 'en_us_001',
  comic: 'en_us_rocket',
  celebrate: 'en_us_rocket',
  grandmother: 'en_female_emotional',  // warm female storyteller
  grandfather: 'en_male_narration',    // calm older male narrator
};

// Voice IDs can be replaced without code changes through env vars.
const EL_VOICE = {
  main:        process.env.EL_VOICE_MAIN        || 'cgSgspJ2msm6clMCkdW9', // Matilda
  checkpoint:  process.env.EL_VOICE_CHECKPOINT  || process.env.EL_VOICE_MAIN || 'cgSgspJ2msm6clMCkdW9',
  comic:       process.env.EL_VOICE_COMIC       || 'FGY2WhTYpPnrIDTdsKH5',
  celebrate:   process.env.EL_VOICE_CELEBRATE   || process.env.EL_VOICE_COMIC || 'FGY2WhTYpPnrIDTdsKH5',
  grandmother: process.env.EL_VOICE_GRANDMOTHER || 'wGcFBfKz5yUQqhqr0mVy', // Maria Moody — Grandmotherly Storykeeper (octogenarian narrator)
  grandfather: process.env.EL_VOICE_GRANDFATHER || 'JBFqnCBsd6RMkjVDRZzb', // George — warm older male
};

const EL_SETTINGS_BY_EMOTION = {
  happy: { stability: 0.32, similarity_boost: 0.78, style: 0.72, use_speaker_boost: true },
  excited: { stability: 0.18, similarity_boost: 0.8, style: 0.98, use_speaker_boost: true },
  celebrating: { stability: 0.16, similarity_boost: 0.82, style: 1.0, use_speaker_boost: true },
  questioning: { stability: 0.26, similarity_boost: 0.78, style: 0.84, use_speaker_boost: true },
  thinking: { stability: 0.44, similarity_boost: 0.75, style: 0.58, use_speaker_boost: true },
  surprised: { stability: 0.2, similarity_boost: 0.8, style: 0.95, use_speaker_boost: true },
  neutral: { stability: 0.36, similarity_boost: 0.76, style: 0.66, use_speaker_boost: true },
};

const EL_SETTINGS_BY_ROLE = {
  main:        { stability: 0.3,  similarity_boost: 0.78, style: 0.8,  use_speaker_boost: true },
  checkpoint:  { stability: 0.26, similarity_boost: 0.78, style: 0.86, use_speaker_boost: true },
  comic:       { stability: 0.14, similarity_boost: 0.82, style: 1.0,  use_speaker_boost: true },
  celebrate:   { stability: 0.12, similarity_boost: 0.82, style: 1.0,  use_speaker_boost: true },
  grandmother: { stability: 0.72, similarity_boost: 0.78, style: 0.50, use_speaker_boost: false }, // Maria Moody — slow, warm, grandmotherly
  grandfather: { stability: 0.60, similarity_boost: 0.78, style: 0.55, use_speaker_boost: true }, // calm, authoritative, slow
};

// Split text at sentence boundaries (TikTok limit ~190 chars)
function splitTextForTTS(text, maxLen = 190) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';
  for (const s of sentences) {
    const joined = current ? `${current} ${s}` : s;
    if (joined.length <= maxLen) {
      current = joined;
    } else {
      if (current) chunks.push(current);
      current = s.length > maxLen ? s.slice(0, maxLen) : s;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(c => c.trim().length > 0);
}

function normalizeVoiceRole(voice, emotion) {
  if (voice) return String(voice).toLowerCase();
  const emo = String(emotion || '').toLowerCase();
  if (emo === 'excited' || emo === 'celebrating') return 'celebrate';
  if (emo === 'questioning') return 'checkpoint';
  return 'main';
}

function resolveTikTokVoice(role, emotion) {
  const voiceRole = normalizeVoiceRole(role, emotion);
  return TIKTOK_VOICE[voiceRole] ?? TIKTOK_VOICE.main;
}

function resolveElevenLabsVoiceId(role, emotion) {
  const voiceRole = normalizeVoiceRole(role, emotion);
  return EL_VOICE[voiceRole] ?? EL_VOICE.main;
}

function mergeVoiceSettings(base, override) {
  const merged = { ...base, ...override };
  for (const key of ['stability', 'similarity_boost', 'style']) {
    if (typeof merged[key] === 'number') {
      merged[key] = Math.max(0, Math.min(1, merged[key]));
    }
  }
  return merged;
}

function resolveElevenLabsSettings(role, emotion) {
  const voiceRole = normalizeVoiceRole(role, emotion);
  const emo = String(emotion || '').toLowerCase();
  const byRole = EL_SETTINGS_BY_ROLE[voiceRole] ?? EL_SETTINGS_BY_ROLE.main;
  const byEmotion = EL_SETTINGS_BY_EMOTION[emo] ?? EL_SETTINGS_BY_EMOTION.neutral;
  return mergeVoiceSettings(byRole, byEmotion);
}

function buildCacheKey(provider, payload) {
  const text = payload.text || '';
  const role = normalizeVoiceRole(payload.voice, payload.emotion);
  const emo = String(payload.emotion || 'neutral').toLowerCase();
  const character = String(payload.character || 'zara').toLowerCase();
  const grade = String(payload.grade || 'grade3').toLowerCase();
  const source = `${provider}|${character}|${grade}|${role}|${emo}|${text}`;
  return crypto.createHash('md5').update(source).digest('hex');
}

async function callTikTokTTS({ text, voice, emotion }) {
  const voiceId = resolveTikTokVoice(voice, emotion);
  const chunks = splitTextForTTS(text);
  const buffers = [];
  for (const chunk of chunks) {
    const res = await fetch(TIKTOK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chunk, voice: voiceId }),
    });
    const data = await res.json();
    if (!data.success || !data.data) throw new Error(`TikTok: ${JSON.stringify(data)}`);
    buffers.push(Buffer.from(data.data, 'base64'));
  }
  return { buffer: Buffer.concat(buffers), voiceId };
}

async function callElevenLabsTTS({ text, voice, emotion }) {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY missing');
  }
  const voiceId = resolveElevenLabsVoiceId(voice, emotion);
  const voiceSettings = resolveElevenLabsSettings(voice, emotion);
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: voiceSettings,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 180)}`);
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), voiceId, modelId, voiceSettings };
}

router.post('/tts', async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      text,
      voice = 'main',
      emotion = 'happy',
      character = 'zara',
      grade = 'Grade 3',
      userEmail,
      role,
      topic,
      subject,
    } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });

    const payload = { text, voice, emotion, character, grade };
    const providers = USE_ELEVENLABS_PRIMARY ? ['elevenlabs', 'tiktok'] : ['tiktok', 'elevenlabs'];
    const failures = [];

    for (const provider of providers) {
      const key = buildCacheKey(provider, payload);
      const file = `${key}.mp3`;
      const fullPath = path.join(AUDIO_DIR, file);
      const audioUrl = `/data/audio/${file}`;

      if (fs.existsSync(fullPath)) {
        const audio = fs.readFileSync(fullPath).toString('base64');
        logEvent('ai_lesson_tts', {
          userEmail,
          role,
          source: 'lesson_tts',
          status: 'success',
          latencyMs: Date.now() - startedAt,
          topic,
          subject,
          grade,
          meta: { provider, cached: true, voiceRole: normalizeVoiceRole(voice, emotion), emotion },
        }).catch(() => {});
        return res.json({
          audioUrl,
          audio,
          cached: true,
          provider,
          voiceRole: normalizeVoiceRole(voice, emotion),
          emotion,
        });
      }

      try {
        let result;
        if (provider === 'elevenlabs') {
          result = await callElevenLabsTTS(payload);
        } else {
          result = await callTikTokTTS(payload);
        }

        fs.writeFileSync(fullPath, result.buffer);
        console.log(
          `  TTS (${provider}) cached: ${(result.buffer.length / 1024).toFixed(0)}KB (${normalizeVoiceRole(voice, emotion)}/${emotion})`
        );

        logEvent('ai_lesson_tts', {
          userEmail,
          role,
          source: 'lesson_tts',
          status: 'success',
          latencyMs: Date.now() - startedAt,
          topic,
          subject,
          grade,
          meta: { provider, cached: false, voiceRole: normalizeVoiceRole(voice, emotion), emotion },
        }).catch(() => {});

        return res.json({
          audioUrl,
          audio: result.buffer.toString('base64'),
          cached: false,
          provider,
          voiceRole: normalizeVoiceRole(voice, emotion),
          emotion,
        });
      } catch (err) {
        failures.push(`${provider}: ${err.message.slice(0, 120)}`);
      }
    }

    console.warn('  TTS all providers failed:', failures.join(' | '));
    logEvent('ai_lesson_tts', {
      userEmail,
      role,
      source: 'lesson_tts',
      status: 'error',
      latencyMs: Date.now() - startedAt,
      topic,
      subject,
      grade,
      meta: { failures, emotion, voiceRole: normalizeVoiceRole(voice, emotion) },
    }).catch(() => {});
    res.json({
      audioUrl: null,
      audio: null,
      cached: false,
      error: 'all_failed',
      details: failures,
    });
  } catch (err) {
    console.error('TTS error:', err.message);
    logEvent('ai_lesson_tts', {
      userEmail: req.body?.userEmail,
      role: req.body?.role,
      source: 'lesson_tts',
      status: 'error',
      latencyMs: Date.now() - startedAt,
      topic: req.body?.topic,
      subject: req.body?.subject,
      grade: req.body?.grade,
      meta: { error: err.message },
    }).catch(() => {});
    res.json({ audioUrl: null, audio: null, cached: false, error: 'failed' });
  }
});
// GET /lesson/concept-image?q=clock+face+numbers
// Downloads a concept photo from Unsplash, caches it locally, returns the local path.
// Frontend calls this so images are served from our server (stable, no CORS issues).
const CONCEPT_IMG_DIR = path.join(__dirname, '../data/images/concepts');
try { fs.mkdirSync(CONCEPT_IMG_DIR, { recursive: true }); } catch (_) { /* read-only fs on Vercel, skip */ }

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
  const startedAt = Date.now();
  try {
    const { topic, context = '', userEmail, role, grade = 'Grade 3', subject = 'Mathematics' } = req.body;
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
    logEvent('ai_lesson_hook', {
      userEmail,
      role,
      source: 'lesson_hook',
      status: 'success',
      latencyMs: Date.now() - startedAt,
      topic,
      subject,
      grade,
      model: 'llama-3.1-8b-instant',
    }).catch(() => {});
    res.json({ topic, intro: parsed.intro ?? '', hook: parsed.hook ?? '', visual: parsed.visual ?? '' });
  } catch (err) {
    console.error('Error generating hook:', err.message);
    logEvent('ai_lesson_hook', {
      userEmail: req.body?.userEmail,
      role: req.body?.role,
      source: 'lesson_hook',
      status: 'error',
      latencyMs: Date.now() - startedAt,
      topic: req.body?.topic,
      subject: req.body?.subject,
      grade: req.body?.grade,
      meta: { error: err.message },
    }).catch(() => {});
    res.status(500).json({ error: 'Failed to generate hook' });
  }
});

// ── Scene audio: TikTok TTS + Groq Whisper word timings ──────────────────────
// GET /lesson/scene-audio?lessonId=...&sceneId=...&text=...
// Same pipeline as /stories/:id/audio — cached MP3 + .timings.json sidecar.
// Returns: { audioUrl, timings, timingProvider }

const SCENE_AUDIO_DIR = path.join(__dirname, '../data/audio/lessons');
try { fs.mkdirSync(SCENE_AUDIO_DIR, { recursive: true }); } catch (_) {}

const TIKTOK_API_LESSON   = 'https://tiktok-tts.weilnet.workers.dev/api/generation';
const TIKTOK_VOICE_LESSON = 'en_female_emotional'; // warm, teacher-like voice

function splitSceneText(text, maxLen = 190) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';
  for (const s of sentences) {
    const joined = current ? `${current} ${s}` : s;
    if (joined.length <= maxLen) { current = joined; }
    else { if (current) chunks.push(current); current = s.length > maxLen ? s.slice(0, maxLen) : s; }
  }
  if (current) chunks.push(current);
  return chunks.filter(c => c.trim().length > 0);
}

async function generateSceneViaTikTok(text) {
  const chunks  = splitSceneText(text);
  const buffers = [];
  for (const chunk of chunks) {
    const res  = await fetch(TIKTOK_API_LESSON, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chunk, voice: TIKTOK_VOICE_LESSON }),
    });
    const data = await res.json();
    if (!data.success || !data.data) throw new Error(`TikTok TTS failed: ${JSON.stringify(data)}`);
    buffers.push(Buffer.from(data.data, 'base64'));
  }
  return Buffer.concat(buffers);
}

async function generateSceneTimingsViaWhisper(mp3Path, text) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  try {
    const fileBuffer = fs.readFileSync(mp3Path);
    const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });
    const form = new FormData();
    form.append('file', blob, 'audio.mp3');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('language', 'en');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) return null;

    const data = await res.json();
    const whisperWords = data.words || [];
    if (!whisperWords.length) return null;

    const textWords = text.match(/\S+/g) || [];
    const norm      = w => w.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Map digits/numbers to their spoken word equivalents (TTS says "three" for "3")
    const NUM_WORDS = {
      '0':'zero','1':'one','2':'two','3':'three','4':'four','5':'five',
      '6':'six','7':'seven','8':'eight','9':'nine','10':'ten',
      '11':'eleven','12':'twelve','13':'thirteen','14':'fourteen','15':'fifteen',
      '16':'sixteen','17':'seventeen','18':'eighteen','19':'nineteen','20':'twenty',
      '30':'thirty','40':'forty','50':'fifty','60':'sixty','70':'seventy',
      '80':'eighty','90':'ninety','100':'hundred','1000':'thousand',
    };
    const normSpoken = w => {
      const n = norm(w);
      return NUM_WORDS[n] || n;
    };

    // Build a flat list of Whisper word objects with normalised text
    const ww = whisperWords.map(w => ({
      ...w,
      n: norm(w.word || ''),
      start: parseFloat((w.start ?? 0).toFixed(3)),
      end:   parseFloat((w.end   ?? ((w.start ?? 0) + 0.25)).toFixed(3)),
    })).filter(w => w.n.length > 0);

    // Greedy left-to-right alignment: for each text word find the best-matching
    // Whisper word starting from the last matched position.
    const timings  = [];
    let   wPtr     = 0;   // current search start in ww[]

    for (let ti = 0; ti < textWords.length; ti++) {
      const tn = norm(textWords[ti]);

      if (!tn) {
        // punctuation-only token — inherit previous timing
        const prev = timings[ti - 1];
        timings.push({ word: textWords[ti], startTime: prev?.endTime ?? 0, endTime: prev?.endTime ?? 0 });
        continue;
      }

      // 1) Try exact match within a window of the next 6 Whisper words
      //    Also try spoken-form of numbers (e.g. "3" → "three")
      const tnSpoken = normSpoken(textWords[ti]);
      let bestIdx = -1;
      const window = Math.min(wPtr + 6, ww.length);
      for (let wi = wPtr; wi < window; wi++) {
        if (ww[wi].n === tn || ww[wi].n === tnSpoken) { bestIdx = wi; break; }
      }

      // 2) Partial / prefix match in the same window
      if (bestIdx === -1) {
        for (let wi = wPtr; wi < window; wi++) {
          if (ww[wi].n.startsWith(tn) || tn.startsWith(ww[wi].n) ||
              ww[wi].n.startsWith(tnSpoken) || tnSpoken.startsWith(ww[wi].n)) {
            bestIdx = wi; break;
          }
        }
      }

      // 3) Fallback — proportional position (keeps monotone order)
      if (bestIdx === -1) {
        bestIdx = Math.min(
          Math.round((ti / Math.max(textWords.length - 1, 1)) * (ww.length - 1)),
          ww.length - 1,
        );
        bestIdx = Math.max(bestIdx, wPtr);
      }

      timings.push({
        word:      textWords[ti],
        startTime: ww[bestIdx].start,
        endTime:   ww[bestIdx].end,
      });

      wPtr = bestIdx + 1;
      if (wPtr >= ww.length) wPtr = ww.length - 1;
    }

    // Ensure strict monotone ordering
    for (let i = 1; i < timings.length; i++) {
      if (timings[i].startTime < timings[i - 1].startTime) {
        timings[i].startTime = timings[i - 1].startTime;
        timings[i].endTime   = Math.max(timings[i].endTime, timings[i].startTime + 0.05);
      }
    }
    return timings;
  } catch { return null; }
}

router.get('/scene-audio', async (req, res) => {
  const { lessonId, sceneId, text } = req.query;
  if (!lessonId || !sceneId || !text) {
    return res.status(400).json({ error: 'lessonId, sceneId and text required' });
  }

  const raw      = `lesson|${lessonId}|${sceneId}|${text}`;
  const cacheKey = crypto.createHash('md5').update(raw).digest('hex');

  try {
    // Serve from persistent cache (Cloudinary in prod → absolute URL; local disk in dev)
    const cached = await getCachedAudio(cacheKey, SCENE_AUDIO_DIR);
    if (cached) {
      let { mp3Url, timings } = cached;
      let timingProvider = timings ? 'whisper' : 'none';
      if (!timings) {
        // Audio cached without timings — run Whisper now (needs a local file path)
        const localPath = await getLocalPath(cacheKey, mp3Url);
        timings = await generateSceneTimingsViaWhisper(localPath, text);
        if (timings) { await saveTimings(cacheKey, SCENE_AUDIO_DIR, timings); timingProvider = 'whisper'; }
      }
      return res.json({ audioUrl: mp3Url, timings, timingProvider });
    }

    // Generate audio via TikTok TTS → persist to Cloudinary (saveAudio also writes a
    // tmp file we can hand to Whisper for word timings).
    const buffer = await generateSceneViaTikTok(text);
    const { mp3Url, tmpPath } = await saveAudio(cacheKey, SCENE_AUDIO_DIR, buffer, null);

    const timings = await generateSceneTimingsViaWhisper(tmpPath, text);
    let timingProvider = 'none';
    if (timings) { await saveTimings(cacheKey, SCENE_AUDIO_DIR, timings); timingProvider = 'whisper'; }

    res.json({ audioUrl: mp3Url, timings, timingProvider });
  } catch (err) {
    console.error('[lesson/scene-audio]', err.message);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

module.exports = router;


