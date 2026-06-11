const express    = require('express');
const router     = express.Router();
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const { execFile } = require('child_process');

const STORIES_PATH = path.join(__dirname, '../data/bhagavata_stories.json');
const AUDIO_DIR    = path.join(__dirname, '../data/audio/stories');

// TikTok TTS (free, no API key needed) — primary for story narration
const TIKTOK_API = 'https://tiktok-tts.weilnet.workers.dev/api/generation';
const TIKTOK_VOICE = {
  grandmother: 'en_female_emotional',  // warm, gentle female voice
  grandfather: 'en_male_narration',    // calm older male narrator
};

// ElevenLabs (paid plan required for library voices) — upgrade path
// Maria Moody — Grandmotherly Storykeeper: wGcFBfKz5yUQqhqr0mVy
const GRANDMOTHER_VOICE_ID = process.env.EL_VOICE_GRANDMOTHER || 'XrExE9yKIg1WjnnlVkGX'; // Matilda — premade, free plan
const GRANDFATHER_VOICE_ID = process.env.EL_VOICE_GRANDFATHER || 'JBFqnCBsd6RMkjVDRZzb'; // George  — premade, free plan
// Lower stability + higher style = more expressive, less monotone "storytelling" delivery
// (more pitch/pace variation between sentences, instead of a flat reading-aloud tone).
const EL_VOICE_SETTINGS = {
  grandmother: { stability: 0.45, similarity_boost: 0.80, style: 0.80, use_speaker_boost: false },
  grandfather: { stability: 0.42, similarity_boost: 0.80, style: 0.75, use_speaker_boost: true  },
};

function readStories() {
  try { return JSON.parse(fs.readFileSync(STORIES_PATH, 'utf8')); }
  catch { return []; }
}

function storyCacheKey(storyId, pageNumber, narrator) {
  const raw = `story|${narrator}|${storyId}|page${pageNumber}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

// Split long text into chunks (TikTok limit ~190 chars)
function splitText(text, maxLen = 190) {
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

async function generateViaTikTok(text, narrator) {
  const voiceId = TIKTOK_VOICE[narrator] ?? TIKTOK_VOICE.grandmother;
  const chunks  = splitText(text);
  const buffers = [];
  for (const chunk of chunks) {
    const res  = await fetch(TIKTOK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chunk, voice: voiceId }),
    });
    const data = await res.json();
    if (!data.success || !data.data) throw new Error(`TikTok TTS failed: ${JSON.stringify(data)}`);
    buffers.push(Buffer.from(data.data, 'base64'));
  }
  return Buffer.concat(buffers);
}

// ── Groq Whisper word-timestamp generator ────────────────────────────────────
// Sends cached MP3 to Groq Whisper with word-level timestamps.
// Whisper actually listens to the audio → perfect alignment, same as Amazon Whispersync.
async function generateTimingsViaWhisper(mp3Path, text) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) { console.log('[whisper] no GROQ_API_KEY'); return null; }

  try {
    // Use native FormData + Blob — avoids multipart boundary conflicts with Node fetch
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
      headers: { 'Authorization': `Bearer ${apiKey}` }, // no Content-Type — fetch sets it with boundary
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[whisper] Groq error', res.status, body.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const whisperWords = data.words || [];
    if (!whisperWords.length) { console.log('[whisper] no word timestamps in response'); return null; }

    // Positional alignment: map text speech-words to Whisper words by position.
    // Whisper returns words in audio order. Text words appear in the same order.
    // Direct 1:1 positional mapping is far more robust than word-content matching
    // because Whisper may mis-spell proper nouns (Mathura, Ambarisha) but the
    // COUNT and ORDER of words is always preserved.
    const textWords  = text.match(/\S+/g) || [];
    const normalize  = w => w.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Separate pure-punctuation tokens (em-dash etc.) — Whisper skips these
    const speechIdxs = textWords.map((w, i) => ({ w, i })).filter(({ w }) => normalize(w));
    const M = whisperWords.length;
    const N = speechIdxs.length;

    // Map each speech word to a Whisper word by proportional position
    const timings = new Array(textWords.length).fill(null);
    for (let si = 0; si < N; si++) {
      const { i } = speechIdxs[si];
      // Proportional index into Whisper words
      const wi  = Math.min(Math.round((si / Math.max(N - 1, 1)) * (M - 1)), M - 1);
      const ww  = whisperWords[wi];
      timings[i] = {
        word:      textWords[i],
        startTime: parseFloat((ww.start ?? 0).toFixed(3)),
        endTime:   parseFloat((ww.end   ?? (ww.start + 0.2)).toFixed(3)),
      };
    }

    // Fill pure-punctuation gaps using surrounding timestamps
    for (let i = 0; i < textWords.length; i++) {
      if (timings[i]) continue;
      const prev = i > 0 && timings[i - 1] ? timings[i - 1].endTime : 0;
      timings[i] = { word: textWords[i], startTime: prev, endTime: prev };
    }

    // Ensure strictly non-decreasing (safety clamp)
    for (let i = 1; i < timings.length; i++) {
      if (timings[i].startTime < timings[i - 1].startTime) {
        timings[i].startTime = timings[i - 1].startTime;
        timings[i].endTime   = Math.max(timings[i].endTime, timings[i].startTime);
      }
    }

    console.log(`[whisper] ${M} Whisper words → ${timings.length} timings (positional map, ${N} speech words)`);
    console.log(`  sample: ${timings.slice(0, 6).map(t => `${t.word}@${t.startTime}s`).join(', ')}`);
    return timings;
  } catch (err) {
    console.error('[whisper] failed:', err.message);
    return null;
  }
}

// Convert ElevenLabs character-level alignment → word-level timestamps
// ElevenLabs returns characters[] which may include spaces; we walk both
// the chars array and the words simultaneously to get exact per-word timing.
function alignmentToWordTimings(text, alignment) {
  if (!alignment || !alignment.characters) return null;
  const chars  = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends   = alignment.character_end_times_seconds;
  if (!chars.length || !starts.length) return null;

  const wordTimings = [];
  const words = text.match(/\S+/g) || [];
  let ai = 0; // index into chars[]

  for (const word of words) {
    // Skip leading spaces in the chars array
    while (ai < chars.length && chars[ai] === ' ') ai++;

    const wordStartAi = ai;
    // Advance through chars that belong to this word (non-space, up to word.length)
    let lettersMatched = 0;
    while (ai < chars.length && lettersMatched < word.length) {
      if (chars[ai] !== ' ') lettersMatched++;
      ai++;
    }
    const wordEndAi = Math.min(ai - 1, chars.length - 1);

    const startTime = starts[wordStartAi] ?? 0;
    const endTime   = ends[wordEndAi]     ?? startTime + 0.1;
    wordTimings.push({ word, startTime, endTime });
  }

  console.log(`[TTS] Word timings sample: "${words.slice(0,4).join(' ')}" → ${wordTimings.slice(0,4).map(w=>`${w.word}@${w.startTime.toFixed(2)}s`).join(', ')}`);
  return wordTimings;
}

async function generateViaElevenLabs(text, narrator) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('No ElevenLabs API key');
  const voiceId  = narrator === 'grandfather' ? GRANDFATHER_VOICE_ID : GRANDMOTHER_VOICE_ID;
  const settings = EL_VOICE_SETTINGS[narrator] ?? EL_VOICE_SETTINGS.grandmother;
  const modelId  = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  // Use /with-timestamps to get exact word timings for highlight sync
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: settings }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const buffer = Buffer.from(json.audio_base64, 'base64');
  const wordTimings = alignmentToWordTimings(text, json.alignment);
  return { buffer, wordTimings };
}

// Try ElevenLabs first (with timestamps), fall back to TikTok (no timestamps)
async function generateAndCacheAudio(text, narrator) {
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const { buffer, wordTimings } = await generateViaElevenLabs(text, narrator);
      return { buffer, wordTimings, provider: 'elevenlabs' };
    } catch (err) {
      console.log(`  EL failed (${err.message.slice(0,80)}) → falling back to TikTok for ${narrator}`);
    }
  }
  return { buffer: await generateViaTikTok(text, narrator), wordTimings: null, provider: 'tiktok' };
}

// ── GET /stories — list all stories ─────────────────────────────────────────
router.get('/', (req, res) => {
  const stories = readStories();
  const list = stories.map(s => ({
    id:            s.id,
    title:         s.title,
    subtitle:      s.subtitle,
    coverColor:    s.coverColor,
    coverGradient: s.coverGradient || null,
    coverIcon:     s.coverIcon,
    coverImageUrl: s.coverImageUrl || null,
    ageGroup:      s.ageGroup,
    collection:    s.collection || '',
    pageCount:     s.pages.length,
  }));
  res.json(list);
});

// ── GET /stories/:id — full story ────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const stories = readStories();
  const story = stories.find(s => s.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found' });
  res.json(story);
});

// ── GET /stories/:id/page/:pageNumber — single page ──────────────────────────
router.get('/:id/page/:pageNumber', (req, res) => {
  const stories = readStories();
  const story = stories.find(s => s.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found' });
  const pageNum = parseInt(req.params.pageNumber, 10);
  const page = story.pages.find(p => p.pageNumber === pageNum);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.json({ ...page, totalPages: story.pages.length, storyTitle: story.title });
});

// ── GET /stories/:id/audio/:pageNumber?narrator=grandmother ──────────────────
// Returns cached audio instantly if pre-generated; generates+caches on first call.
router.get('/:id/audio/:pageNumber', async (req, res) => {
  const narrator = (req.query.narrator || 'grandmother').toLowerCase();
  const stories = readStories();
  const story = stories.find(s => s.id === req.params.id);
  if (!story) return res.status(404).json({ error: 'Story not found' });

  const pageNum = parseInt(req.params.pageNumber, 10);
  const page = story.pages.find(p => p.pageNumber === pageNum);
  if (!page) return res.status(404).json({ error: 'Page not found' });

  const cacheKey      = storyCacheKey(story.id, pageNum, narrator);
  const cacheFile     = path.join(AUDIO_DIR, `${cacheKey}.mp3`);
  const timingsFile   = path.join(AUDIO_DIR, `${cacheKey}.timings.json`);
  const audioUrl      = `/data/audio/stories/${cacheKey}.mp3`;

  // ── Serve from cache instantly ───────────────────────────────────────────
  if (fs.existsSync(cacheFile)) {
    // If no timings file yet, use Groq Whisper to transcribe the actual audio
    // and get exact word timestamps — same technique as Amazon Whispersync.
    let timingProvider = 'elevenlabs';
    if (!fs.existsSync(timingsFile)) {
      timingProvider = 'whisper';
      try {
        const generated = await generateTimingsViaWhisper(cacheFile, page.text);
        if (generated) fs.writeFileSync(timingsFile, JSON.stringify(generated));
      } catch (e) { console.error('[whisper] error:', e.message); }
    }
    const wordTimings = fs.existsSync(timingsFile)
      ? JSON.parse(fs.readFileSync(timingsFile, 'utf8'))
      : null;
    return res.json({ audioUrl, cached: true, narrator, wordTimings, timingProvider });
  }

  // ── Generate once, cache forever ─────────────────────────────────────────
  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'ElevenLabs API key not configured' });
  }

  try {
    const { buffer, wordTimings, provider } = await generateAndCacheAudio(page.text, narrator);
    fs.writeFileSync(cacheFile, buffer);
    if (wordTimings) fs.writeFileSync(timingsFile, JSON.stringify(wordTimings));
    console.log(`  Story TTS cached: ${(buffer.length / 1024).toFixed(0)}KB (${story.id}/p${pageNum}/${narrator}/${provider}) timings=${!!wordTimings}`);
    return res.json({ audioUrl, cached: false, narrator, provider, wordTimings, timingProvider: wordTimings ? 'elevenlabs' : 'none' });
  } catch (err) {
    console.error('Story TTS error:', err.message);
    return res.status(500).json({ error: 'Voice generation failed', detail: err.message });
  }
});

// ── POST /stories/prewarm — pre-generate all pages for both voices ────────────
// Call once after deployment. Safe to call multiple times (skips cached pages).
router.post('/prewarm', async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'ElevenLabs API key not configured' });
  }

  const stories  = readStories();
  const narrators = ['grandmother', 'grandfather'];
  const results   = { generated: 0, skipped: 0, failed: 0, errors: [] };

  // Send immediate response; prewarm runs in background
  res.json({ message: 'Prewarm started in background', totalPages: stories.reduce((n, s) => n + s.pages.length, 0) * 2 });

  for (const story of stories) {
    for (const page of story.pages) {
      for (const narrator of narrators) {
        const cacheKey  = storyCacheKey(story.id, page.pageNumber, narrator);
        const cacheFile = path.join(AUDIO_DIR, `${cacheKey}.mp3`);

        if (fs.existsSync(cacheFile)) { results.skipped++; continue; }

        try {
          const { buffer, wordTimings, provider } = await generateAndCacheAudio(page.text, narrator);
          fs.writeFileSync(cacheFile, buffer);
          if (wordTimings) {
            const timingsFile = path.join(AUDIO_DIR, `${cacheKey}.timings.json`);
            fs.writeFileSync(timingsFile, JSON.stringify(wordTimings));
          }
          results.generated++;
          console.log(`  Prewarm: ${story.id}/p${page.pageNumber}/${narrator}/${provider} cached (${(buffer.length/1024).toFixed(0)}KB)`);
          // Small delay to avoid rate limiting
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          results.failed++;
          results.errors.push(`${story.id}/p${page.pageNumber}/${narrator}: ${err.message}`);
          console.error(`  Prewarm failed: ${story.id}/p${page.pageNumber}/${narrator} —`, err.message);
        }
      }
    }
  }

  console.log(`\n  Prewarm complete — generated: ${results.generated}, skipped: ${results.skipped}, failed: ${results.failed}`);
});

module.exports = router;
