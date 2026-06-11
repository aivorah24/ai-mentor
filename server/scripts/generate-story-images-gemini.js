/**
 * generate-story-images-gemini.js
 * Generates page illustrations for incomplete bedtime stories (Dhruva, Prahlada, Bharat)
 * using Gemini, saves locally under data/images/stories/<id>/, then the existing
 * upload_story_images.js script uploads them to Cloudinary and updates bhagavata_stories.json.
 *
 * Run: node scripts/generate-story-images-gemini.js
 * Resumable — already-generated pages are skipped.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const STORIES_FILE = path.join(__dirname, '../data/bhagavata_stories.json');
const IMAGES_DIR   = path.join(__dirname, '../data/images/stories');

const TARGET_STORY_IDS = ['dhruva', 'prahlada', 'bharat'];

const GEMINI_MODEL = 'gemini-2.5-flash-image';
const GEMINI_API   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const delay = ms => new Promise(r => setTimeout(r, ms));

function buildPrompt(story, page) {
  // First sentence or two of the page text gives the scene context without overloading the prompt
  const excerpt = page.text.split(/\n/)[0].slice(0, 280);

  return `Create a warm, gentle storybook illustration for a children's bedtime story titled "${story.title}" (Indian devotional/mythological tale, Srimad Bhagavatam tradition).

Scene: "${page.sceneLabel}"
Story moment: ${excerpt}

Style requirements:
- Soft, warm watercolor-style children's picture-book illustration
- Gentle pastel colour palette (warm golds, soft blues, gentle greens) — calm, soothing, suitable for bedtime
- Indian mythological setting — traditional clothing, palaces, forests, temples as appropriate to the scene
- Characters should look kind, expressive, and age-appropriate for young children (5-10 years)
- Wide landscape illustration (roughly 16:9), clean single-scene composition, not cluttered
- IMPORTANT: Absolutely NO text, NO letters, NO numbers, NO writing of any kind anywhere in the image — no signs, no scrolls with visible script, no banners.`;
}

async function generateWithGemini(prompt, savePath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

  const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }

  const data    = await res.json();
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!imgPart?.inlineData?.data) throw new Error('No image in Gemini response');

  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, Buffer.from(imgPart.inlineData.data, 'base64'));
}

async function run() {
  const stories = JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8'))
    .filter(s => TARGET_STORY_IDS.includes(s.id));

  console.log(`Generating images for ${stories.length} stories: ${stories.map(s => s.id).join(', ')}\n`);

  let generated = 0, skipped = 0, failed = 0;

  for (const story of stories) {
    console.log(`\n${story.title} (${story.id}) — ${story.pages.length} pages`);

    for (const page of story.pages) {
      const fileName = `page_${String(page.pageNumber).padStart(2, '0')}.jpg`;
      const savePath = path.join(IMAGES_DIR, story.id, fileName);

      process.stdout.write(`  [${page.pageNumber}] ${page.sceneLabel} ... `);

      if (fs.existsSync(savePath)) {
        console.log('SKIP (exists)');
        skipped++;
        continue;
      }

      try {
        const prompt = buildPrompt(story, page);
        await generateWithGemini(prompt, savePath);
        const size = (fs.statSync(savePath).size / 1024).toFixed(0);
        console.log(`OK (${size}KB)`);
        generated++;
        await delay(2500); // rate limit
      } catch (err) {
        console.log(`FAILED — ${err.message.slice(0, 120)}`);
        failed++;
        await delay(3500);
      }
    }
  }

  console.log(`\n── Done ──`);
  console.log(`Generated: ${generated}  Skipped: ${skipped}  Failed: ${failed}`);
  console.log(`Next: run "node scripts/upload_story_images.js" to push these to Cloudinary and update bhagavata_stories.json`);
}

run().catch(err => { console.error(err); process.exit(1); });
