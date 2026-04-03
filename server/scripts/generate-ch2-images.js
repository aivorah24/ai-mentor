/**
 * scripts/generate-ch2-images.js
 * Generates all scene images for Chapter 2 (Toy Joy) using Gemini API
 * Run: node scripts/generate-ch2-images.js
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// Using pollinations.ai — completely free, no API key needed
// Generates high-quality images from text prompts
const OUT_DIR    = path.join(__dirname, '../data/images/scenes/ch2');

fs.mkdirSync(OUT_DIR, { recursive: true });

// Detailed prompts for each scene that needs an image
// Set START_FROM to generate only from a specific scene onward
const START_FROM = 8; // scenes 8, 9, 10, 11

const ALL_SCENES = [
  {
    file: 'scene_02.jpg',
    prompt: `A colorful toy train engine made of geometric 3D shapes — a red cylinder chimney, yellow cone on top, blue cube cab, grey cuboid body. Bright cartoon illustration style, white background, educational, Grade 3 kids book style. No text in image.`,
  },
  {
    file: 'scene_03.jpg',
    prompt: `A bright red 3D cylinder shape highlighted with a glowing outline. Next to it: a red drum and a water bottle showing the same cylinder shape. Arrows connecting all three. Bright cheerful colors, pastel background, cartoon educational illustration for Grade 3 kids. No text in image.`,
  },
  {
    file: 'scene_04.jpg',
    prompt: `A large yellow 3D cone with a round flat base and a sharp pointed tip, glowing outline. Beside it: a cartoon ice cream cone and a colorful party hat. Arrows showing the cone shape in each. Bright cheerful cartoon style, white background, Grade 3 kids education. No text in image.`,
  },
  {
    file: 'scene_05.jpg',
    prompt: `A big blue 3D cube with all 6 visible square faces shown clearly, glowing outline. Beside it: a red dice with dots. Both shapes on a clean white surface. Bright cartoon illustration style, cheerful colors, educational for Grade 3 kids. No text in image.`,
  },
  {
    file: 'scene_06.jpg',
    prompt: `A grey 3D cuboid (wider and longer than tall) with glowing outline. Beside it: a school eraser and a rectangular hardcover book. Arrows pointing to show "longer side". Bright cartoon illustration, white background, educational Grade 3 kids style. No text in image.`,
  },
  {
    file: 'scene_07.jpg',
    prompt: `Side-by-side comparison illustration: on the left a perfect blue cube with all equal sides highlighted with equal-length arrows on all edges. On the right a green rectangular cuboid with clearly different-length sides shown with arrows. A thought bubble between them shows the cube fitting inside the cuboid concept. Cartoon educational style, bright cheerful colors, white background, Grade 3 kids book. No text in image.`,
  },
  {
    file: 'scene_08.jpg',
    prompt: `A happy young Indian girl named Jaya, age 8, wearing a school uniform, proudly holding up a homemade toy rocket she built from cardboard boxes — blue cylinder body, red cone tip. She is smiling with excitement. Colorful Indian home room background. Cartoon illustration style, bright colors, Grade 3 kids education. No text in image.`,
  },
  {
    file: 'scene_09.jpg',
    prompt: `A cute friendly cartoon elephant made entirely from 3D shape boxes — a large grey cuboid as the body, four grey cylinder legs, a round sphere head, a small cone tail. Each shape part has a soft glow showing it is a geometric shape. White background, bright cheerful colors, educational cartoon illustration for Grade 3 kids. No text in image.`,
  },
  {
    file: 'scene_10.jpg',
    prompt: `A fun colorful board game mat on the floor with a path of 3D shapes — cube, cuboid, cone, cylinder in sequence. A cartoon Indian child is rolling a large colorful dice. The shapes on the path are large and clear. Bright Indian children game illustration style, overhead view, cheerful colors. No text in image.`,
  },
  {
    file: 'scene_11.jpg',
    prompt: `Two large labeled boxes side by side: the left box has things that ROLL — a cylinder and a cone inside, with curvy arrow showing rolling motion. The right box has things that STACK — a cube and a cuboid stacked neatly. A happy cylinder character is shown with arrows pointing to BOTH boxes since it can do both. Bright cartoon educational style, white background, Grade 3 kids. No text in image.`,
  },
];

// Start from scene number (inclusive)
const SCENES = ALL_SCENES.filter(s => {
  const num = parseInt(s.file.replace('scene_', '').replace('.jpg', ''), 10);
  return num >= START_FROM;
});

async function generateImage(scene) {
  const outPath = path.join(OUT_DIR, scene.file);

  if (fs.existsSync(outPath)) {
    console.log(`  SKIP (exists): ${scene.file}`);
    return true;
  }

  console.log(`  Generating: ${scene.file} ...`);

  try {
    // Pollinations.ai — free image generation, no API key needed
    const encoded = encodeURIComponent(scene.prompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=800&height=600&model=flux&nologo=true&seed=${Math.floor(Math.random() * 9999)}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'AITutor/1.0' },
    });

    if (!res.ok) {
      console.error(`  ERROR ${scene.file}: HTTP ${res.status}`);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buffer);
    console.log(`  SAVED: ${scene.file} (${(buffer.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    console.error(`  EXCEPTION ${scene.file}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`Generating ${SCENES.length} Chapter 2 scene images (via pollinations.ai)...`);
  console.log(`Output: ${OUT_DIR}\n`);

  // Filter: only scenes that don't already exist
  const pending = SCENES.filter(s => !fs.existsSync(path.join(OUT_DIR, s.file)));
  console.log(`Pending: ${pending.length} images\n`);

  let ok = 0, fail = 0;
  for (const scene of pending) {
    const success = await generateImage(scene);
    if (success) ok++; else fail++;
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\nDone! ${ok} generated, ${fail} failed.`);
  if (fail === 0) {
    console.log('All images ready at: server/data/images/scenes/ch2/');
  }
}

main();
