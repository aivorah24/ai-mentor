/**
 * generate-challenge-images-gemini.js
 * Generates cartoon banner images for IB PYP challenges using Gemini,
 * saves locally and updates cloudinary_urls.json for serving.
 *
 * Run: node scripts/generate-challenge-images-gemini.js
 * Resumable — already generated challenges are skipped.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const CHALLENGES_FILE = path.join(__dirname, '../data/challenges.json');
const IMAGES_DIR      = path.join(__dirname, '../data/images/challenges');
const URL_MAP_FILE    = path.join(__dirname, '../data/cloudinary_urls.json');

const GEMINI_MODEL = 'gemini-2.5-flash-image';
const GEMINI_API   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const delay = ms => new Promise(r => setTimeout(r, ms));

// Load existing URL map
const urlMap = fs.existsSync(URL_MAP_FILE)
  ? JSON.parse(fs.readFileSync(URL_MAP_FILE, 'utf8'))
  : {};

// Category-specific visual themes (avoid elements that inherently contain text like scoreboards, books with visible pages, signs)
const CATEGORY_VISUALS = {
  'School Challenge': 'golden trophy, medals, students competing, school stage with curtains, team spirit, confetti',
  'Olympiad':         'brain with gears, puzzle pieces, magnifying glass, lightbulb moment, thinking cap, maze',
  'Advanced Practice': 'rocket launch, climbing mountain, target bullseye, telescope, exploration, compass',
};

// Subject-specific visual elements
const SUBJECT_VISUALS = {
  'Mathematics':      'numbers, geometric shapes, calculator, ruler, graphs',
  'Science':          'microscope, test tubes, planets, magnifying glass, leaves',
  'English':          'open book, pen, speech bubbles, letters, quill',
  'Social Studies':   'globe, map, compass, people holding hands, flag',
  'ICT':              'laptop, coding symbols, robot, circuit board, wifi',
  'Mixed':            'books, globe, calculator, microscope, lightbulb — mix of subjects',
};

function buildPrompt(challenge) {
  const categoryVis = CATEGORY_VISUALS[challenge.category] || 'books and learning';
  const subjectVis  = SUBJECT_VISUALS[challenge.subject] || 'books and learning tools';
  const gradeAge    = challenge.grade === 'Grade 3' ? '8-year-old' : challenge.grade === 'Grade 4' ? '9-year-old' : '10-year-old';

  return `Create a bright, cheerful cartoon-style educational banner illustration for an IB PYP ${challenge.grade} challenge called "${challenge.title}".

Category: ${challenge.category} (visual elements: ${categoryVis})
Subject: ${challenge.subject} (visual elements: ${subjectVis})
Description: ${challenge.description}

Style requirements:
- Flat cartoon style with bold outlines and vibrant colours
- Indian school context — diverse Indian children in school uniforms
- Fun, engaging, motivating for ${gradeAge} children
- Wide banner format (landscape, roughly 2:1 ratio)
- Clean composition, not cluttered
- White or light gradient background
- IMPORTANT: Absolutely NO text, NO numbers, NO letters, NO words, NO writing of any kind anywhere in the image. Do not include scoreboards, signs, banners with writing, book pages with visible text, or any element that would contain written characters.`;
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
  const challenges = JSON.parse(fs.readFileSync(CHALLENGES_FILE, 'utf8'));
  console.log(`Found ${challenges.length} challenges total.\n`);

  let generated = 0, skipped = 0, failed = 0;

  for (const ch of challenges) {
    const relKey   = `challenges/${ch.id}.png`;
    const savePath = path.join(IMAGES_DIR, `${ch.id}.png`);
    const servePath = `/data/images/challenges/${ch.id}.png`;

    process.stdout.write(`  [${ch.grade}] ${ch.title} ... `);

    // Skip if already exists locally
    if (fs.existsSync(savePath)) {
      // Update URL map to point to local serve path
      if (!urlMap[relKey]) {
        urlMap[relKey] = servePath;
        fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));
      }
      console.log('SKIP (exists)');
      skipped++;
      continue;
    }

    // Generate via Gemini
    try {
      const prompt = buildPrompt(ch);
      await generateWithGemini(prompt, savePath);

      urlMap[relKey] = servePath;
      fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));

      const size = (fs.statSync(savePath).size / 1024).toFixed(0);
      console.log(`OK (${size}KB)`);
      generated++;
      await delay(2000); // rate limit
    } catch (err) {
      console.log(`FAILED — ${err.message.slice(0, 100)}`);
      failed++;
      await delay(3000);
    }
  }

  console.log(`\n── Done ──`);
  console.log(`Generated: ${generated}  Skipped: ${skipped}  Failed: ${failed}`);
  console.log(`URL map: ${URL_MAP_FILE}`);
}

run().catch(err => { console.error(err); process.exit(1); });
