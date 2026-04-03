/**
 * cloudinaryUrls.js
 * Resolves image paths to Cloudinary CDN URLs when available,
 * falls back to local /data/images/ path otherwise.
 */

const fs   = require('fs');
const path = require('path');

const URL_MAP_FILE = path.join(__dirname, '../data/cloudinary_urls.json');

// Load map at startup — refreshes automatically if file changes
function loadMap() {
  if (fs.existsSync(URL_MAP_FILE)) {
    try { return JSON.parse(fs.readFileSync(URL_MAP_FILE, 'utf8')); } catch {}
  }
  return {};
}

let _map = loadMap();

// Watch for file changes so server doesn't need restart after upload
if (fs.existsSync(URL_MAP_FILE)) {
  fs.watch(URL_MAP_FILE, () => { _map = loadMap(); });
}

/**
 * Resolve a local image path to the best available URL.
 * @param {string} localPath  e.g. "/data/images/ncert/grade3/cemm101_page1.png"
 *                            or   "data/images/scenes/ch2/scene_02.png"
 * @returns {string}  Cloudinary CDN URL if uploaded, else original local path
 */
function resolveImageUrl(localPath) {
  if (!localPath) return null;

  // Normalise to a relative key like "ncert/grade3/cemm101_page1.png"
  const rel = localPath
    .replace(/\\/g, '/')
    .replace(/^.*data\/images\//, '');

  return _map[rel] || localPath;
}

module.exports = { resolveImageUrl };
