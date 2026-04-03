/**
 * scripts/ingest-scene-images.js
 * Ingests lesson scene images into Qdrant with Groq Vision captions.
 * - Images stay on disk (gitignored, served by Express)
 * - Qdrant stores: path + caption + metadata (chapter, scene, topic)
 * - lesson.js queries Qdrant to get image paths dynamically
 *
 * Usage:
 *   node scripts/ingest-scene-images.js           — ingest all chapters
 *   node scripts/ingest-scene-images.js --ch 2    — ingest only chapter 2
 */
require('dotenv').config();

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Generate a deterministic UUID v4-like ID from a string key
function deterministicId(key) {
  const hash = crypto.createHash('md5').update(key).digest('hex');
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}

const { embed }                      = require('../services/embeddings');
const { client, COLLECTION }         = require('../services/qdrant');
const Groq                           = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Chapter metadata map ──────────────────────────────────────────────────────
const CHAPTER_META = {
  1:  { topic: 'Where to Look for Numbers', unit: 'Numbers' },
  2:  { topic: 'Fun with Numbers',            unit: 'Geometry' },
  3:  { topic: 'Give and Take',             unit: 'Addition & Subtraction' },
  4:  { topic: 'Long and Short',            unit: 'Measurement' },
  5:  { topic: 'Shapes and Designs',        unit: 'Geometry' },
  6:  { topic: 'Fun with Give and Take',    unit: 'Addition & Subtraction' },
  7:  { topic: 'Time Goes On',              unit: 'Time' },
  8:  { topic: 'Who is Heavier?',           unit: 'Weight & Mass' },
  9:  { topic: 'How Many Times?',           unit: 'Multiplication & Division' },
  10: { topic: 'Play with Patterns',        unit: 'Patterns' },
  11: { topic: 'Jugs and Mugs',             unit: 'Capacity' },
  12: { topic: 'Can we Share?',             unit: 'Division & Fractions' },
  13: { topic: 'Smart Charts',              unit: 'Data Handling' },
  14: { topic: 'Rupees and Paise',          unit: 'Money' },
};

const SCENES_BASE = path.join(__dirname, '../data/images/scenes');

// ── Caption one scene image via Groq Vision ───────────────────────────────────
async function captionSceneImage(imgPath, topic, scene) {
  try {
    const buf    = fs.readFileSync(imgPath);
    const base64 = buf.toString('base64');
    const ext    = path.extname(imgPath).toLowerCase().replace('.', '');
    const mime   = ext === 'png' ? 'image/png' : 'image/jpeg';

    const res = await groq.chat.completions.create({
      model:      'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          {
            type: 'text',
            text: `This is a cartoon educational illustration for Scene ${scene} of the chapter "${topic}" (NCERT Grade 3 Maths).
Describe what is shown in this image in 2-3 sentences. Focus on the shapes, objects, characters, and the math concept being illustrated. Be specific and educational.`,
          },
        ],
      }],
    });

    return res.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error(`  Vision caption error: ${err.message}`);
    return `Scene ${scene} illustration for chapter: ${topic}`;
  }
}

// ── Ingest images for one chapter ────────────────────────────────────────────
async function ingestChapter(chNum) {
  const meta   = CHAPTER_META[chNum];
  const chDir  = path.join(SCENES_BASE, `ch${chNum}`);

  if (!meta) { console.log(`  Chapter ${chNum}: no metadata, skip`); return 0; }
  if (!fs.existsSync(chDir)) { console.log(`  Chapter ${chNum}: folder not found (${chDir}), skip`); return 0; }

  const files = fs.readdirSync(chDir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .sort();

  if (files.length === 0) { console.log(`  Chapter ${chNum}: no images found`); return 0; }

  console.log(`\nChapter ${chNum} — "${meta.topic}" (${files.length} images)`);

  const points = [];

  for (const file of files) {
    // Extract scene number from filename: scene_03.jpg → 3
    const match = file.match(/scene[_-]?(\d+)/i);
    const scene = match ? parseInt(match[1], 10) : 0;

    const imgPath   = path.join(chDir, file);
    const servePath = `/data/images/scenes/ch${chNum}/${file}`;

    process.stdout.write(`  ${file} (scene ${scene}) ... `);

    // Caption via Groq Vision
    const caption = await captionSceneImage(imgPath, meta.topic, scene);

    // Embed the caption
    const textForEmbed = `Chapter ${chNum} scene ${scene}: ${meta.topic}. ${caption}`;
    const vector       = await embed(textForEmbed);

    points.push({
      id:      deterministicId(`scene_image_ch${chNum}_s${scene}`),
      vector,
      payload: {
        curriculum:   'NCERT',
        grade:        'Class 3',
        subject:      'Mathematics',
        chapter:      chNum,
        scene:        scene,
        topic:        meta.topic,
        unit:         meta.unit,
        content_type: 'scene_image',
        image_path:   servePath,
        content:      caption,
      },
    });

    console.log('ok');

    // Small delay to avoid Groq rate limits
    await new Promise(r => setTimeout(r, 800));
  }

  // Upsert all points for this chapter
  if (points.length > 0) {
    await client.upsert(COLLECTION, { points, wait: true });
    console.log(`  Upserted ${points.length} scene image records to Qdrant`);
  }

  return points.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args    = process.argv.slice(2);
  const chFlag  = args.indexOf('--ch');
  const onlyCh  = chFlag >= 0 ? parseInt(args[chFlag + 1], 10) : null;

  const chapters = onlyCh ? [onlyCh] : Object.keys(CHAPTER_META).map(Number);

  console.log(`Ingesting scene images into Qdrant...`);
  console.log(`Chapters: ${chapters.join(', ')}\n`);

  let total = 0;
  for (const ch of chapters) {
    total += await ingestChapter(ch);
  }

  console.log(`\nDone! ${total} scene images indexed in Qdrant.`);
}

main().catch(err => { console.error(err); process.exit(1); });
