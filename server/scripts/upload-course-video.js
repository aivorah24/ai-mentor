/**
 * upload-course-video.js
 * Uploads a single teacher-course video to Cloudinary and prints the URL.
 * Usage: node scripts/upload-course-video.js "C:\\path\\to\\video.mp4" [public_id]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const localPath = process.argv[2];
const publicId  = process.argv[3] || 'teacher_course_' + Date.now();

if (!localPath) { console.error('Provide a video path'); process.exit(1); }

(async () => {
  console.log('Uploading', localPath, '...');
  const result = await cloudinary.uploader.upload(localPath, {
    resource_type: 'video',
    folder: 'aivorah/videos',
    public_id: publicId,
    overwrite: true,
    chunk_size: 6_000_000,
  });
  console.log('\nDONE URL:', result.secure_url);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
