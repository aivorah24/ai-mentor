// One-off migration: upload bedtime-story images + cached audio to Cloudinary,
// then rewrite bhagavata_stories.json (image URLs) and write an audio URL map
// that server/routes/stories.js consults before falling back to local files.
//
// Run:  node server/scripts/uploadStoryAssetsToCloudinary.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ROOT        = path.join(__dirname, '..');
const IMAGES_DIR  = path.join(ROOT, 'data/images/stories');
const AUDIO_DIR   = path.join(ROOT, 'data/audio/stories');
const STORIES_PATH = path.join(ROOT, 'data/bhagavata_stories.json');
const AUDIO_MAP_PATH = path.join(ROOT, 'data/audio_cloudinary_map.json');

function walk(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some(e => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

async function uploadOne(filePath, folder, publicId, resourceType) {
  const res = await cloudinary.uploader.upload(filePath, {
    folder, public_id: publicId, resource_type: resourceType, overwrite: true,
  });
  return res.secure_url;
}

async function main() {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.error('Cloudinary env vars not found (run from server/ with .env present)');
    process.exit(1);
  }

  // ── 1. Images ────────────────────────────────────────────────────────────
  const images = walk(IMAGES_DIR, ['.jpg', '.jpeg', '.png']);
  console.log(`Found ${images.length} images`);
  const imageUrlByRel = {}; // "/data/images/stories/<id>/page_NN.jpg" -> cloudinary url
  for (let i = 0; i < images.length; i++) {
    const full = images[i];
    const rel = '/' + path.relative(ROOT, full).replace(/\\/g, '/'); // /data/images/stories/<id>/page_NN.jpg
    const storyId = path.basename(path.dirname(full));
    const base = path.basename(full, path.extname(full));
    try {
      const url = await uploadOne(full, `aivorah/stories/images/${storyId}`, base, 'image');
      imageUrlByRel[rel] = url;
      console.log(`  [${i + 1}/${images.length}] ${rel} -> ${url}`);
    } catch (e) {
      console.error(`  FAILED ${rel}:`, e.message);
    }
  }

  // ── 2. Audio (mp3 + timings.json) ───────────────────────────────────────
  const mp3s = walk(AUDIO_DIR, ['.mp3']);
  console.log(`Found ${mp3s.length} audio files`);
  const audioMap = fs.existsSync(AUDIO_MAP_PATH) ? JSON.parse(fs.readFileSync(AUDIO_MAP_PATH, 'utf8')) : {};
  for (let i = 0; i < mp3s.length; i++) {
    const full = mp3s[i];
    const cacheKey = path.basename(full, '.mp3');
    const timingsFile = path.join(AUDIO_DIR, `${cacheKey}.timings.json`);
    if (audioMap[cacheKey]?.audioUrl) { console.log(`  [${i + 1}/${mp3s.length}] ${cacheKey} (skip, already mapped)`); continue; }
    try {
      const audioUrl = await uploadOne(full, 'aivorah/stories/audio', cacheKey, 'video'); // Cloudinary serves audio via "video" resource type
      let timingsUrl = null;
      if (fs.existsSync(timingsFile)) {
        timingsUrl = await uploadOne(timingsFile, 'aivorah/stories/audio', `${cacheKey}_timings`, 'raw');
      }
      audioMap[cacheKey] = { audioUrl, timingsUrl };
      console.log(`  [${i + 1}/${mp3s.length}] ${cacheKey} -> ${audioUrl}`);
    } catch (e) {
      console.error(`  FAILED ${cacheKey}:`, e.message);
    }
    if (i % 10 === 0) fs.writeFileSync(AUDIO_MAP_PATH, JSON.stringify(audioMap, null, 2));
  }
  fs.writeFileSync(AUDIO_MAP_PATH, JSON.stringify(audioMap, null, 2));

  // ── 3. Rewrite bhagavata_stories.json image URLs ───────────────────────────
  const stories = JSON.parse(fs.readFileSync(STORIES_PATH, 'utf8'));
  let replaced = 0;
  for (const story of stories) {
    if (story.coverImageUrl && imageUrlByRel[story.coverImageUrl]) {
      story.coverImageUrl = imageUrlByRel[story.coverImageUrl]; replaced++;
    }
    for (const page of story.pages) {
      if (page.imageUrl && imageUrlByRel[page.imageUrl]) {
        page.imageUrl = imageUrlByRel[page.imageUrl]; replaced++;
      }
    }
  }
  fs.writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2));
  console.log(`\nDone. Replaced ${replaced} image URLs. Audio map: ${Object.keys(audioMap).length} entries -> ${AUDIO_MAP_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
