/**
 * scripts/pregenerate-audio.js
 * Pre-generates TTS audio for all lesson scenes + quiz explanations.
 * Saves to server/data/audio/ — served statically, zero API calls during lessons.
 *
 * Usage:
 *   node scripts/pregenerate-audio.js          — all chapters
 *   node scripts/pregenerate-audio.js --ch 2   — chapter 2 only
 */
require('dotenv').config();

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const AUDIO_DIR  = path.join(__dirname, '../data/audio');
const LESSONS_DIR = path.join(__dirname, '../data/lessons');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const TIKTOK_API   = 'https://tiktok-tts.weilnet.workers.dev/api/generation';
const VOICE_MAIN   = 'en_us_001';    // Clear American female — Ms. Zara
const VOICE_COMIC  = 'en_us_rocket'; // High energy — wrong answers

// ── Split long text at sentence boundaries (TikTok ~190 char limit) ──────────
function splitText(text, maxLen = 190) {
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

// ── Generate audio via TikTok TTS, save to disk ───────────────────────────────
async function generateAudio(text, voice, label) {
  const cacheKey  = crypto.createHash('md5').update(`tiktok|${voice}|${text}`).digest('hex');
  const audioFile = `${cacheKey}.mp3`;
  const audioPath = path.join(AUDIO_DIR, audioFile);

  if (fs.existsSync(audioPath)) {
    process.stdout.write(`  SKIP (cached): ${label}\n`);
    return `/data/audio/${audioFile}`;
  }

  const chunks  = splitText(text);
  const buffers = [];

  for (const chunk of chunks) {
    const res  = await fetch(TIKTOK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: chunk, voice }),
    });
    const data = await res.json();
    if (!data.success || !data.data) throw new Error(`TikTok failed: ${JSON.stringify(data)}`);
    buffers.push(Buffer.from(data.data, 'base64'));
    await new Promise(r => setTimeout(r, 300)); // small delay between chunks
  }

  const buffer = Buffer.concat(buffers);
  fs.writeFileSync(audioPath, buffer);
  process.stdout.write(`  OK (${(buffer.length / 1024).toFixed(0)}KB): ${label}\n`);

  return `/data/audio/${audioFile}`;
}

// ── Process one chapter script ────────────────────────────────────────────────
async function processChapter(scriptFile) {
  const raw    = fs.readFileSync(scriptFile, 'utf8');
  const script = JSON.parse(raw);

  console.log(`\nChapter ${script.chapter} — "${script.topic}"`);
  console.log(`  Scenes: ${script.scenes.length}, Quiz: ${script.quiz?.length ?? 0}`);

  let ok = 0, fail = 0;

  // ── Scenes ────────────────────────────────────────────────────────────────
  for (const scene of script.scenes) {
    try {
      await generateAudio(scene.text, VOICE_MAIN, `Scene ${scene.scene}`);
      ok++;
    } catch (e) {
      console.error(`  ERROR Scene ${scene.scene}: ${e.message.slice(0, 80)}`);
      fail++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Quiz explanations (spoken after wrong answer with comic voice) ────────
  if (script.quiz?.length) {
    for (let i = 0; i < script.quiz.length; i++) {
      const q = script.quiz[i];
      if (!q.explanation) continue;
      try {
        await generateAudio(q.explanation, VOICE_COMIC, `Quiz ${i + 1} explanation`);
        ok++;
      } catch (e) {
        console.error(`  ERROR Quiz ${i + 1}: ${e.message.slice(0, 80)}`);
        fail++;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`  Done: ${ok} generated, ${fail} failed`);
  return { ok, fail };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args   = process.argv.slice(2);
  const chFlag = args.indexOf('--ch');
  const onlyCh = chFlag >= 0 ? parseInt(args[chFlag + 1], 10) : null;

  const files = fs.readdirSync(LESSONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(LESSONS_DIR, f));

  const filtered = onlyCh
    ? files.filter(f => {
        try {
          const s = JSON.parse(fs.readFileSync(f, 'utf8'));
          return s.chapter === onlyCh;
        } catch { return false; }
      })
    : files;

  if (filtered.length === 0) {
    console.log('No matching chapter scripts found.');
    return;
  }

  console.log(`Pre-generating audio for ${filtered.length} chapter(s)...`);
  console.log(`Voice: ${VOICE_MAIN} (main), ${VOICE_COMIC} (comic)\n`);

  let totalOk = 0, totalFail = 0;
  for (const f of filtered) {
    const { ok, fail } = await processChapter(f);
    totalOk   += ok;
    totalFail += fail;
  }

  console.log(`\nAll done! ${totalOk} audio files ready, ${totalFail} failed.`);
  console.log(`Saved to: ${AUDIO_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
