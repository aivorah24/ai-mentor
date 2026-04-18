/**
 * Aivorah — Story Illustrations Scraper
 * Downloads public domain illustrations from archive.org and Wikimedia Commons
 * Only images are downloaded — no text content is extracted or stored.
 *
 * Run: node scripts/scrape_story_images.js
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const OUT_DIR = path.join(__dirname, '../data/images/stories');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) { console.log(`  skip (exists): ${path.basename(destPath)}`); return resolve(); }
    const file = fs.createWriteStream(destPath);
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Aivorah-Educational-App/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return download(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', err => { file.close(); try { fs.unlinkSync(destPath); } catch {} reject(err); });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    let data = '';
    client.get(url, { headers: { 'User-Agent': 'Aivorah-Educational-App/1.0' } }, res => {
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function downloadWithRetry(url, destPath, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await download(url, destPath);
      return;
    } catch (err) {
      if (err.message.includes('429') && attempt < retries) {
        const wait = attempt * 3000;
        console.log(`  429 rate-limit — waiting ${wait/1000}s before retry ${attempt}/${retries-1}...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

// ── Wikimedia Commons: fetch image URLs from a category ──────────────────────

async function getWikimediaImages(category, limit = 20) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(category)}&cmtype=file&cmlimit=${limit}&format=json`;
  const data = await fetchJson(api);
  const members = data?.query?.categorymembers || [];

  const urls = [];
  for (const m of members) {
    const fname = m.title.replace('File:', '');
    if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(fname)) continue;

    // Use imageinfo API to get direct download URL (avoids redirect chains)
    try {
      const infoApi = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(m.title)}&prop=imageinfo&iiprop=url&format=json`;
      const info = await fetchJson(infoApi);
      const pages = Object.values(info?.query?.pages || {});
      const directUrl = pages[0]?.imageinfo?.[0]?.url;
      if (directUrl) urls.push(directUrl);
      await sleep(200);
    } catch {
      urls.push(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fname)}`);
    }
  }
  return urls;
}

// ── Download tasks ────────────────────────────────────────────────────────────

const TASKS = [

  // ── RAMAYANA: Chitra Ramayana (1916) — Public Domain ────────────────────
  {
    story: 'ramayana_rama_sita',
    source: 'wikimedia',
    category: 'Chitra Ramayana',
    limit: 30,
    // We'll pick the best ones after download
  },

  // ── RAMAYANA: Hanuman ────────────────────────────────────────────────────
  {
    story: 'hanuman',
    source: 'wikimedia',
    category: 'Chitra Ramayana',  // same collection has Hanuman scenes
    limit: 30,
  },

  // ── BHAGAVATAM: Miniature paintings — Public Domain (pre-1924) ───────────
  {
    story: 'prahlada',
    source: 'wikimedia',
    category: 'Prahlada',
    limit: 15,
  },
  {
    story: 'dhruva',
    source: 'wikimedia',
    category: 'Dhruva',
    limit: 15,
  },
  {
    story: 'ambarisha',
    source: 'wikimedia',
    category: 'Bhagavata Purana',
    limit: 20,
  },
  {
    story: 'bharat',
    source: 'wikimedia',
    category: 'Bharata (Bhagavata Purana)',
    limit: 15,
  },

  // ── BHAGAVAD GITA: Arjuna & Krishna ──────────────────────────────────────
  {
    story: 'bhagavad_gita_arjuna',
    source: 'wikimedia',
    category: 'Bhagavad Gita',
    limit: 20,
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\nAivorah Story Image Scraper');
  console.log('Sources: Wikimedia Commons (Public Domain / CC BY-SA)\n');

  const storyImageMap = {}; // storyId → ['/data/images/stories/...', ...]

  for (const task of TASKS) {
    const storyDir = path.join(OUT_DIR, task.story);
    fs.mkdirSync(storyDir, { recursive: true });

    console.log(`\n[${task.story}] Fetching from: ${task.category}`);

    let urls = [];
    try {
      urls = await getWikimediaImages(task.category, task.limit);
      console.log(`  Found ${urls.length} images`);
    } catch (err) {
      console.error(`  Failed to fetch list: ${err.message}`);
      continue;
    }

    const downloaded = [];
    for (let i = 0; i < urls.length; i++) {
      const url  = urls[i];
      const ext  = url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
      const file = `page_${String(i + 1).padStart(2, '0')}.${ext}`;
      const dest = path.join(storyDir, file);
      try {
        await downloadWithRetry(url, dest);
        downloaded.push(`/data/images/stories/${task.story}/${file}`);
        console.log(`  [${i+1}/${urls.length}] ${file}`);
        await sleep(1500); // polite delay — 1.5s between downloads
      } catch (err) {
        console.error(`  [${i+1}] Failed: ${err.message}`);
        await sleep(2000);
      }
    }

    if (!storyImageMap[task.story]) storyImageMap[task.story] = [];
    storyImageMap[task.story].push(...downloaded);
  }

  // ── Update bhagavata_stories.json with downloaded images ─────────────────
  const STORIES_PATH = path.join(__dirname, '../data/bhagavata_stories.json');
  const stories = JSON.parse(fs.readFileSync(STORIES_PATH, 'utf8'));

  for (const story of stories) {
    const images = storyImageMap[story.id] || [];
    if (images.length === 0) continue;

    // Set cover image = first downloaded image
    story.coverImageUrl = images[0];

    // Assign images to pages (cycle if fewer images than pages)
    story.pages.forEach((page, idx) => {
      page.imageUrl = images[idx % images.length] || null;
    });

    console.log(`\nUpdated ${story.id}: cover=${story.coverImageUrl}, ${images.length} images for ${story.pages.length} pages`);
  }

  fs.writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2));
  console.log('\nDone! bhagavata_stories.json updated with image paths.');
  console.log('Restart server to serve new images.\n');
}

run().catch(console.error);
