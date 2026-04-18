/**
 * Downloads Chitra Ramayana illustrations (Public Domain, 1916)
 * from Wikimedia Commons and uploads to Cloudinary.
 * Run: node scripts/fetch_ramayana_images.js
 */
require('dotenv').config();
const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const STORIES_PATH = path.join(__dirname, '../data/bhagavata_stories.json');
const URL_MAP_FILE = path.join(__dirname, '../data/cloudinary_urls.json');
const TMP_DIR      = path.join(__dirname, '../data/images/stories/tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const urlMap = fs.existsSync(URL_MAP_FILE)
  ? JSON.parse(fs.readFileSync(URL_MAP_FILE, 'utf8'))
  : {};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) return resolve();
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, { headers: { 'User-Agent': 'Aivorah-Educational/1.0' } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close(); fs.unlinkSync(dest);
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close(); try { fs.unlinkSync(dest); } catch {}
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', err => { file.close(); try { fs.unlinkSync(dest); } catch {}; reject(err); });
    };
    get(url);
  });
}

async function uploadToCloudinary(localPath, publicId) {
  const key = publicId.replace('ai_mentor/', '');
  if (urlMap[key]) { console.log(`  skip (already on Cloudinary): ${key}`); return urlMap[key]; }
  const result = await cloudinary.uploader.upload(localPath, {
    public_id: publicId,
    folder: '',
    overwrite: false,
    resource_type: 'image',
  });
  urlMap[key] = result.secure_url;
  fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));
  console.log(`  uploaded: ${result.secure_url}`);
  return result.secure_url;
}

// Specific Chitra Ramayana images — curated for each story page
// Source: Wikimedia Commons, Public Domain (1916 paintings by Balasaheb Pant Pratinidhi)
const RAMA_SITA_IMAGES = [
  { page: 1, file: 'rama_sita_p1.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/d/d7/Maruti_meets_Rama.jpg' },
  { page: 2, file: 'rama_sita_p2.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/f/f3/Kaikeyi_told_Dasharatha_that_he_must_fulfil_her_wish.jpg' },
  { page: 3, file: 'rama_sita_p3.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Building_a_Bridge_to_Sri_Lanka.jpg' },
  { page: 4, file: 'rama_sita_p4.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/5/5c/Hanumans_finds_Sita_in_Ashokavana.jpg' },
  { page: 5, file: 'rama_sita_p5.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/9/9d/Killing_of_Rawana_Painting_by_Balasaheb_Pant_Pratinidhi.jpg' },
  { page: 6, file: 'rama_sita_p6.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Killing_of_Kabandha.jpg' },
];

const HANUMAN_IMAGES = [
  { page: 1, file: 'hanuman_p1.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/c/cb/Hanuman_Mistakes_the_Sun_for_a_Fruit.jpg' },
  { page: 2, file: 'hanuman_p2.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/5/52/Hanuman_Encounters_Sita_in_Ashokavana.jpg' },
  { page: 3, file: 'hanuman_p3.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a6/Hanuman_leapt_with_all_his_might_from_the_top_of_Mahendra_Hill.jpg' },
  { page: 4, file: 'hanuman_p4.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Hanuman_set_all_Lanka_on_fire.jpg' },
  { page: 5, file: 'hanuman_p5.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Hanuman_returns_with_sanjeevani_mountain_for_laxmana%27s_life.jpg' },
];

async function processStory(storyId, images) {
  console.log(`\nProcessing: ${storyId}`);
  const pageImageMap = {};

  for (const img of images) {
    const tmpPath  = path.join(TMP_DIR, img.file);
    const publicId = `ai_mentor/stories/${storyId}/${img.file.replace('.jpg','')}`;

    console.log(`  [page ${img.page}] downloading...`);
    let downloaded = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await downloadFile(img.url, tmpPath);
        downloaded = true;
        break;
      } catch (err) {
        if (err.message.includes('429') && attempt < 5) {
          const wait = attempt * 5000;
          console.log(`    rate-limited, waiting ${wait/1000}s (attempt ${attempt}/5)...`);
          await sleep(wait);
        } else {
          console.error(`  [page ${img.page}] download failed: ${err.message}`);
          break;
        }
      }
    }
    if (downloaded) {
      try {
        const cdnUrl = await uploadToCloudinary(tmpPath, publicId);
        pageImageMap[img.page] = cdnUrl;
      } catch (err) {
        console.error(`  [page ${img.page}] upload failed: ${err.message}`);
      }
    }
    await sleep(3000); // 3s between each image
  }
  return pageImageMap;
}

async function run() {
  console.log('\nAivorah — Ramayana Image Fetcher + Cloudinary Uploader');
  console.log('Source: Chitra Ramayana (1916) — Public Domain\n');

  const stories = JSON.parse(fs.readFileSync(STORIES_PATH, 'utf8'));

  // Process Rama and Sita
  const ramaSitaMap = await processStory('ramayana_rama_sita', RAMA_SITA_IMAGES);
  const ramaSita = stories.find(s => s.id === 'ramayana_rama_sita');
  if (ramaSita) {
    ramaSita.coverImageUrl = ramaSitaMap[1] || null;
    ramaSita.pages.forEach(p => { if (ramaSitaMap[p.pageNumber]) p.imageUrl = ramaSitaMap[p.pageNumber]; });
  }

  // Process Hanuman
  const hanumanMap = await processStory('hanuman', HANUMAN_IMAGES);
  const hanuman = stories.find(s => s.id === 'hanuman');
  if (hanuman) {
    hanuman.coverImageUrl = hanumanMap[1] || null;
    hanuman.pages.forEach(p => { if (hanumanMap[p.pageNumber]) p.imageUrl = hanumanMap[p.pageNumber]; });
  }

  fs.writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2));
  console.log('\nDone! bhagavata_stories.json updated with Cloudinary image URLs.');

  // Clean up tmp
  try { fs.rmSync(TMP_DIR, { recursive: true }); } catch {}
}

run().catch(console.error);
