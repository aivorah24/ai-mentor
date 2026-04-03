               \/**
 * generate-all-scene-images.js
 * Generates cartoon images for every scene in all 14 NCERT chapters
 * using Hugging Face FLUX.1-schnell (free), then uploads to Cloudinary.
 *
 * Run: node scripts/generate-all-scene-images.js
 * Resumable — already uploaded images are skipped automatically.
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

const LESSONS_DIR  = path.join(__dirname, '../data/lessons');
const IMAGES_DIR   = path.join(__dirname, '../data/images/scenes');
const URL_MAP_FILE = path.join(__dirname, '../data/cloudinary_urls.json');
const HF_TOKEN     = process.env.HF_TOKEN;
const HF_URL       = 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';

// Load existing URL map (skip already-done images)
const urlMap = fs.existsSync(URL_MAP_FILE)
  ? JSON.parse(fs.readFileSync(URL_MAP_FILE, 'utf8'))
  : {};

// ── Build a clear, focused prompt for each scene ──────────────────────────────
function buildPrompt(topic, scene) {
  const visual = (scene.visual || '').slice(0, 60);
  const hint   = (scene.text  || '').slice(0, 80);
  return [
    `Bright cheerful cartoon educational illustration for Grade 3 children age 8.`,
    `Subject: ${topic}.`,
    visual ? `Scene: ${visual}.` : `Concept: ${hint}.`,
    `Style: flat cartoon, bold outlines, vibrant colours, Indian cultural context, clean white background, NO text or numbers written in image.`,
  ].join(' ');
}

// ── Generate one image via HuggingFace FLUX ───────────────────────────────────
async function generateImage(prompt, savePath) {
  const res = await fetch(HF_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type':  'application/json',
      'x-use-cache':   'false',
    },
    body: JSON.stringify({ inputs: prompt }),
  });

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
async function uploadToCloudinary(localPath, relKey) {
  const publicId = 'ai_mentor/' + relKey.replace(/\.[^.]+$/, '');
  const result   = await cloudinary.uploader.upload(localPath, {
    public_id:     publicId,
    overwrite:     false,
    resource_type: 'image',
  });
  return result.secure_url;
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  if (!HF_TOKEN) { console.error('HF_TOKEN missing in .env'); process.exit(1); }

  const scriptFiles = fs.readdirSync(LESSONS_DIR)
    .filter(f => /^ch\d+_script\.json$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

  console.log(`Found ${scriptFiles.length} chapter scripts.\n`);
  let generated = 0, skipped = 0, failed = 0;

  for (const file of scriptFiles) {
    const script = JSON.parse(fs.readFileSync(path.join(LESSONS_DIR, file), 'utf8'));
    const chNum  = script.chapter;
    const topic  = script.topic;
    const scenes = script.scenes || [];

    console.log(`\n── Ch${chNum}: ${topic} (${scenes.length} scenes) ──`);

    for (const scene of scenes) {
      const sceneNum = String(scene.scene).padStart(2, '0');
      const relKey   = `scenes/ch${chNum}/scene_${sceneNum}.jpg`;
      const savePath = path.join(IMAGES_DIR, `ch${chNum}`, `scene_${sceneNum}.jpg`);

      process.stdout.write(`  Scene ${sceneNum} ... `);

      // Skip if already on Cloudinary
      if (urlMap[relKey]) {
        console.log('SKIP (already on Cloudinary)');
        skipped++;
        continue;
      }

      // Upload existing local file if present
      if (fs.existsSync(savePath)) {
        try {
          const url = await uploadToCloudinary(savePath, relKey);
          urlMap[relKey] = url;
          fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));
          console.log('UPLOADED (existing file)');
          skipped++;
          continue;
        } catch { /* fall through to regenerate */ }
      }

      // Generate via FLUX
      try {
        const prompt = buildPrompt(topic, scene);
        await generateImage(prompt, savePath);

        const url = await uploadToCloudinary(savePath, relKey);
        urlMap[relKey] = url;
        fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));

        console.log(`OK (${(fs.statSync(savePath).size / 1024).toFixed(0)}KB)`);
        generated++;
      } catch (err) {
        console.log(`FAILED — ${err.message.slice(0, 80)}`);
        failed++;
      }

      // Small delay to avoid hammering the API
      await delay(2000);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Generated & uploaded : ${generated}`);
  console.log(`Skipped (already done): ${skipped}`);
  console.log(`Failed               : ${failed}`);
  console.log(`\nAll done! App now serves Cloudinary images for every scene.`);
}

run().catch(console.error);
