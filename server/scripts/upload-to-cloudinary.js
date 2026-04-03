/**
 * upload-to-cloudinary.js
 * One-time script: uploads all local images to Cloudinary and saves a URL map.
 * Run once: node scripts/upload-to-cloudinary.js
 * After running, local images can be deleted to free disk space.
 */

require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const fs   = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const IMAGES_DIR  = path.join(__dirname, '../data/images');
const URL_MAP_FILE = path.join(__dirname, '../data/cloudinary_urls.json');

// Load existing map so we can resume if interrupted
const urlMap = fs.existsSync(URL_MAP_FILE)
  ? JSON.parse(fs.readFileSync(URL_MAP_FILE, 'utf8'))
  : {};

// Collect all image files (skip concepts folder — already deleted)
function collectImages(dir, base = IMAGES_DIR) {
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      results.push(...collectImages(full, base));
    } else if (/\.(png|jpg|jpeg|webp)$/i.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

async function uploadImage(localPath) {
  // Use relative path as the Cloudinary public_id (e.g. ncert/grade3/cemm101_page1)
  const rel       = path.relative(IMAGES_DIR, localPath).replace(/\\/g, '/');
  const publicId  = 'ai_mentor/' + rel.replace(/\.[^.]+$/, ''); // strip extension

  // Skip if already uploaded
  if (urlMap[rel]) {
    return { rel, url: urlMap[rel], skipped: true };
  }

  const result = await cloudinary.uploader.upload(localPath, {
    public_id:    publicId,
    overwrite:    false,
    resource_type: 'image',
    folder:       '',
  });

  urlMap[rel] = result.secure_url;
  return { rel, url: result.secure_url, skipped: false };
}

async function run() {
  console.log('Collecting images...');
  const images = collectImages(IMAGES_DIR);
  console.log(`Found ${images.length} images to upload.\n`);

  let uploaded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < images.length; i++) {
    const localPath = images[i];
    const rel = path.relative(IMAGES_DIR, localPath).replace(/\\/g, '/');
    process.stdout.write(`[${i + 1}/${images.length}] ${rel} ... `);

    try {
      const { url, skipped: wasSkipped } = await uploadImage(localPath);
      if (wasSkipped) {
        console.log('SKIPPED (already uploaded)');
        skipped++;
      } else {
        console.log('OK');
        uploaded++;
      }
      // Save map after every upload so progress is not lost
      fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone! Uploaded: ${uploaded} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`URL map saved to: ${URL_MAP_FILE}`);
  console.log('\nNext step: server will now serve Cloudinary URLs instead of local paths.');
}

run().catch(console.error);
