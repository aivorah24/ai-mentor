/**
 * generate-challenge-images.js
 * Generates cartoon banner images for every challenge using HuggingFace FLUX.1-schnell,
 * then uploads to Cloudinary under ai_mentor/challenges/{challengeId}.
 *
 * Run: node scripts/generate-challenge-images.js
 * Resumable — already uploaded challenges are skipped automatically.
 */

require('dotenv').config();
const fs         = require('fs');
const path       = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const CHALLENGES_FILE = path.join(__dirname, '../data/challenges.json');
const IMAGES_DIR      = path.join(__dirname, '../data/images/challenges');
const URL_MAP_FILE    = path.join(__dirname, '../data/cloudinary_urls.json');
// HF free-tier inference API (standard endpoint, no router credits needed)
const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL = 'stabilityai/stable-diffusion-2-1';
const HF_URL   = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

// Load existing URL map (skip already-done images)
const urlMap = fs.existsSync(URL_MAP_FILE)
  ? JSON.parse(fs.readFileSync(URL_MAP_FILE, 'utf8'))
  : {};

// ── Build a clear, focused prompt for each challenge ─────────────────────────
function buildPrompt(challenge) {
  const gradeAge = challenge.grade === 'Grade 3' ? 'age 8' : challenge.grade === 'Grade 4' ? 'age 9' : 'age 10';
  const desc = (challenge.description || '').slice(0, 100);
  return [
    `Bright cheerful cartoon educational illustration for ${challenge.grade} children ${gradeAge}.`,
    `Maths topic: ${challenge.title}.`,
    desc ? `Concept: ${desc}.` : '',
    `Style: flat cartoon, bold outlines, vibrant colours, Indian cultural context, clean white background, fun and engaging for kids, NO text or numbers written in image.`,
  ].filter(Boolean).join(' ');
}

// ── Generate one image via HF free inference API ──────────────────────────────
async function generateImage(prompt, savePath) {
  const res = await fetch(HF_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  // Model may be loading — wait and retry once
  if (res.status === 503) {
    const json = await res.json().catch(() => ({}));
    const wait = (json.estimated_time || 20) * 1000;
    console.log(`  (model loading, waiting ${Math.ceil(wait/1000)}s...)`);
    await delay(wait);
    return generateImage(prompt, savePath); // one retry
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HF ${res.status}: ${txt.slice(0, 150)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error('Response too small — likely an error');

  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, buf);
}

// ── Upload to Cloudinary ──────────────────────────────────────────────────────
async function uploadToCloudinary(localPath, publicId) {
  const result = await cloudinary.uploader.upload(localPath, {
    public_id:     publicId,
    overwrite:     false,
    resource_type: 'image',
  });
  return result.secure_url;
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const all = JSON.parse(fs.readFileSync(CHALLENGES_FILE, 'utf8'));
  // Only Grade 3 for now — images ingested for Grade 3 NCERT content
  const challenges = all.filter(c => c.grade === 'Grade 3');
  console.log(`Found ${challenges.length} Grade 3 challenges.\n`);

  let generated = 0, skipped = 0, failed = 0;

  for (const ch of challenges) {
    const relKey   = `challenges/${ch.id}.png`;
    const savePath = path.join(IMAGES_DIR, `${ch.id}.png`);
    const publicId = `ai_mentor/challenges/${ch.id}`;

    process.stdout.write(`  [${ch.grade}] ${ch.title} ... `);

    // Skip if already on Cloudinary
    if (urlMap[relKey]) {
      console.log('SKIP (already on Cloudinary)');
      skipped++;
      continue;
    }

    // Upload existing local file if present
    if (fs.existsSync(savePath)) {
      try {
        const url = await uploadToCloudinary(savePath, publicId);
        urlMap[relKey] = url;
        fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));
        console.log('UPLOADED (existing file)');
        skipped++;
        continue;
      } catch { /* fall through to regenerate */ }
    }

    // Generate via FLUX
    try {
      const prompt = buildPrompt(ch);
      await generateImage(prompt, savePath);

      const url = await uploadToCloudinary(savePath, publicId);
      urlMap[relKey] = url;
      fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));

      console.log(`OK (${(fs.statSync(savePath).size / 1024).toFixed(0)}KB)`);
      generated++;
      await delay(1500); // rate limit buffer
    } catch (err) {
      console.log(`FAILED — ${err.message.slice(0, 80)}`);
      failed++;
      await delay(3000);
    }
  }

  console.log(`\n── Done ──`);
  console.log(`Generated: ${generated}  Skipped: ${skipped}  Failed: ${failed}`);
  console.log(`URL map saved to: ${URL_MAP_FILE}`);
}

run().catch(err => { console.error(err); process.exit(1); });
