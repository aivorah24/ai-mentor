/**
 * Upload story images to Cloudinary and update bhagavata_stories.json
 * Run: node server/scripts/upload_story_images.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const MAX_BYTES = 9 * 1024 * 1024; // 9MB safe limit

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const STORIES_DIR = path.join(__dirname, '../data/images/stories');
const STORIES_JSON = path.join(__dirname, '../data/bhagavata_stories.json');
const URL_MAP_FILE = path.join(__dirname, '../data/cloudinary_urls.json');

async function uploadImage(localPath, publicId) {
  console.log(`  Uploading ${path.basename(localPath)}...`);
  let uploadPath = localPath;
  let tmpFile = null;

  const stat = fs.statSync(localPath);
  if (stat.size > MAX_BYTES) {
    console.log(`    (compressing ${Math.round(stat.size / 1024)}KB → max 9MB)`);
    tmpFile = path.join(os.tmpdir(), `story_upload_${Date.now()}.jpg`);
    await sharp(localPath)
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(tmpFile);
    uploadPath = tmpFile;
  }

  const result = await cloudinary.uploader.upload(uploadPath, {
    public_id: publicId,
    folder: 'ai_mentor/stories',
    overwrite: false,
    resource_type: 'image',
  });

  if (tmpFile) fs.unlinkSync(tmpFile);
  return result.secure_url;
}

async function main() {
  const urlMap = fs.existsSync(URL_MAP_FILE)
    ? JSON.parse(fs.readFileSync(URL_MAP_FILE, 'utf8'))
    : {};

  const stories = fs.readdirSync(STORIES_DIR).filter(d =>
    fs.statSync(path.join(STORIES_DIR, d)).isDirectory()
  );

  // storyId -> pageFile -> cloudinary URL
  const storyImageUrls = {};

  for (const storyId of stories) {
    const dir = path.join(STORIES_DIR, storyId);
    const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).sort();
    if (files.length === 0) {
      console.log(`${storyId}: no images, skipping`);
      continue;
    }
    console.log(`\n${storyId}: ${files.length} images`);
    storyImageUrls[storyId] = {};

    for (const file of files) {
      const localPath = path.join(dir, file);
      const mapKey = `stories/${storyId}/${file}`;

      if (urlMap[mapKey]) {
        console.log(`  ${file}: already uploaded`);
        storyImageUrls[storyId][file] = urlMap[mapKey];
      } else {
        const publicId = `${storyId}/${path.parse(file).name}`;
        const url = await uploadImage(localPath, publicId);
        urlMap[mapKey] = url;
        storyImageUrls[storyId][file] = url;
        console.log(`  ${file} -> ${url}`);
      }
    }
  }

  // Save updated URL map
  fs.writeFileSync(URL_MAP_FILE, JSON.stringify(urlMap, null, 2));
  console.log('\nURL map updated.');

  // Now update bhagavata_stories.json
  const storiesData = JSON.parse(fs.readFileSync(STORIES_JSON, 'utf8'));

  for (const story of storiesData) {
    const imgs = storyImageUrls[story.id];
    if (!imgs) {
      // No images available — null out all imageUrls
      story.coverImageUrl = null;
      for (const page of story.pages) page.imageUrl = null;
      continue;
    }

    const files = Object.keys(imgs).sort(); // page_01.jpg, page_02.jpg, ...

    // Assign images to pages evenly
    for (let i = 0; i < story.pages.length; i++) {
      const fileIndex = Math.min(i, files.length - 1);
      story.pages[i].imageUrl = imgs[files[fileIndex]];
    }

    // Cover = first image
    story.coverImageUrl = imgs[files[0]];
  }

  fs.writeFileSync(STORIES_JSON, JSON.stringify(storiesData, null, 2));
  console.log('bhagavata_stories.json updated with Cloudinary URLs!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
