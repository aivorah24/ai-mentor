/**
 * upload-new-videos.js
 * Uploads the newly created lesson videos to Cloudinary.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const VIDEOS_DIR = path.join(__dirname, '../data/videos');
const VIDEOS_TO_UPLOAD = [
  'addition_final.mp4',
  'living_nonliving_final.mp4'
];

async function uploadVideo(filename) {
  const localPath = path.join(VIDEOS_DIR, filename);
  if (!fs.existsSync(localPath)) {
    console.error(`❌ File not found: ${localPath}`);
    return null;
  }

  console.log(`📤 Uploading ${filename} to Cloudinary...`);
  try {
    const result = await cloudinary.uploader.upload(localPath, {
      resource_type: 'video',
      folder: 'aivorah/videos',
      public_id: filename.replace('.mp4', ''),
      overwrite: true
    });
    console.log(`✅ Uploaded: ${result.secure_url}`);
    return { filename, url: result.secure_url };
  } catch (err) {
    console.error(`❌ Failed to upload ${filename}:`, err.message);
    return null;
  }
}

async function run() {
  const results = [];
  for (const filename of VIDEOS_TO_UPLOAD) {
    const res = await uploadVideo(filename);
    if (res) results.push(res);
  }

  console.log('\n--- UPLOAD SUMMARY ---');
  console.log(JSON.stringify(results, null, 2));
  console.log('\nCopy these URLs to update your videos.json and VIDEO_MAP.');
}

run().catch(console.error);
