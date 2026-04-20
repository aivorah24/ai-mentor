const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

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
const GRANDMOTHER_VOICE_ID = process.env.EL_VOICE_GRANDMOTHER || 'wGcFBfKz5yUQqhqr0mVy';
const GRANDFATHER_VOICE_ID = process.env.EL_VOICE_GRANDFATHER || 'JBFqnCBsd6RMkjVDRZzb';
const EL_VOICE_SETTINGS = {
  grandmother: { stability: 0.72, similarity_boost: 0.78, style: 0.50, use_speaker_boost: false },
  grandfather: { stability: 0.65, similarity_boost: 0.78, style: 0.50, use_speaker_boost: true  },
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

async function generateViaElevenLabs(text, narrator) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('No ElevenLabs API key');
  const voiceId  = narrator === 'grandfather' ? GRANDFATHER_VOICE_ID : GRANDMOTHER_VOICE_ID;
  const settings = EL_VOICE_SETTINGS[narrator] ?? EL_VOICE_SETTINGS.grandmother;
  const modelId  = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: settings }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Try ElevenLabs first (Maria Moody when on paid plan), fall back to TikTok
async function generateAndCacheAudio(text, narrator) {
  if (process.env.ELEVENLABS_API_KEY) {
    try { return { buffer: await generateViaElevenLabs(text, narrator), provider: 'elevenlabs' }; }
    catch (err) {
      // Fall through to TikTok on any ElevenLabs failure (401, 402, quota, unusual activity, etc.)
      console.log(`  EL failed (${err.message.slice(0,80)}) → falling back to TikTok for ${narrator}`);
    }
  }
  return { buffer: await generateViaTikTok(text, narrator), provider: 'tiktok' };
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

  const cacheKey  = storyCacheKey(story.id, pageNum, narrator);
  const cacheFile = path.join(AUDIO_DIR, `${cacheKey}.mp3`);
  const audioUrl  = `/data/audio/${cacheKey}.mp3`;

  // ── Serve from cache instantly ───────────────────────────────────────────
  if (fs.existsSync(cacheFile)) {
    return res.json({ audioUrl, cached: true, narrator });
  }

  // ── Generate once, cache forever ─────────────────────────────────────────
  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'ElevenLabs API key not configured' });
  }

  try {
    const { buffer, provider } = await generateAndCacheAudio(page.text, narrator);
    fs.writeFileSync(cacheFile, buffer);
    console.log(`  Story TTS cached: ${(buffer.length / 1024).toFixed(0)}KB (${story.id}/p${pageNum}/${narrator}/${provider})`);
    return res.json({ audioUrl, cached: false, narrator, provider });
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
          const { buffer, provider } = await generateAndCacheAudio(page.text, narrator);
          fs.writeFileSync(cacheFile, buffer);
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
