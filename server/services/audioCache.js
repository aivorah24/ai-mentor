/**
 * audioCache.js
 * Persistent audio cache using Cloudinary (survives Cloud Run deployments/restarts).
 * Falls back to local disk when Cloudinary is not configured (local dev).
 *
 * Flow:
 *   1. Check Cloudinary for <cacheKey>.mp3  → serve immediately if found
 *   2. If missing, generate audio → upload to Cloudinary → return URL
 *   3. Timings stored as a Cloudinary raw asset: <cacheKey>.timings.json
 */

const fs   = require('fs');
const path = require('path');

const CLOUDINARY_CONFIGURED = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

// Lazy-load cloudinary only if configured (avoids crash in dev without creds)
let cloudinary = null;
if (CLOUDINARY_CONFIGURED) {
  const { v2 } = require('cloudinary');
  v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  cloudinary = v2;
}

const TMP_DIR = path.join(__dirname, '../data/audio/_tmp');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (_) {}

// ── Cloudinary helpers ────────────────────────────────────────────────────────

async function cloudinaryExists(publicId, resourceType = 'video') {
  try {
    await cloudinary.api.resource(publicId, { resource_type: resourceType });
    return true;
  } catch { return false; }
}

async function uploadToCloudinary(buffer, publicId, resourceType = 'video') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: resourceType, overwrite: false },
      (err, result) => { if (err) reject(err); else resolve(result.secure_url); }
    );
    stream.end(buffer);
  });
}

async function downloadFromCloudinary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cloudinary fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function cloudinaryAudioUrl(publicId) {
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/${publicId}.mp3`;
}

function cloudinaryRawUrl(publicId) {
  // The raw timings asset is uploaded with public_id `<cacheKey>_timings` (no
  // extension), so the delivery URL must NOT append `.json` — otherwise the
  // fetch 404s and cached word-timings are silently lost (highlighting works on
  // the first play, then disappears on every cached replay).
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/${publicId}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check if audio is cached (Cloudinary or local disk).
 * Returns { mp3Url, timings } if found, or null if not cached.
 * mp3Url is an absolute URL (Cloudinary CDN) or a local /data/audio path.
 */
async function getCachedAudio(cacheKey, localDir) {
  if (CLOUDINARY_CONFIGURED) {
    const audioId   = `aivorah/audio/${cacheKey}`;
    const timingsId = `aivorah/audio/${cacheKey}_timings`;

    // Check if audio exists on Cloudinary
    if (await cloudinaryExists(audioId, 'video')) {
      const mp3Url = cloudinaryAudioUrl(audioId);

      // Fetch timings if available
      let timings = null;
      try {
        const timRaw = await fetch(cloudinaryRawUrl(timingsId));
        if (timRaw.ok) timings = await timRaw.json();
      } catch {}

      return { mp3Url, timings };
    }
    return null;
  }

  // Local fallback
  const localMp3  = path.join(localDir, `${cacheKey}.mp3`);
  const localTim  = path.join(localDir, `${cacheKey}.timings.json`);
  if (fs.existsSync(localMp3)) {
    let timings = null;
    if (fs.existsSync(localTim)) {
      try { timings = JSON.parse(fs.readFileSync(localTim, 'utf8')); } catch {}
    }
    const mp3Url = `/data/audio/${path.relative(path.join(__dirname, '../data/audio'), localDir).replace(/\\/g, '/')}/${cacheKey}.mp3`;
    return { mp3Url, timings };
  }
  return null;
}

/**
 * Save audio buffer + optional timings to persistent cache.
 * Returns the public mp3Url.
 */
async function saveAudio(cacheKey, localDir, mp3Buffer, timings) {
  if (CLOUDINARY_CONFIGURED) {
    const audioId   = `aivorah/audio/${cacheKey}`;
    const timingsId = `aivorah/audio/${cacheKey}_timings`;

    // Write to tmp file for Whisper (needs a real file path)
    const tmpPath = path.join(TMP_DIR, `${cacheKey}.mp3`);
    fs.writeFileSync(tmpPath, mp3Buffer);

    // Upload audio
    const mp3Url = await uploadToCloudinary(mp3Buffer, audioId, 'video');

    // Upload timings as raw JSON if provided
    if (timings) {
      const timBuf = Buffer.from(JSON.stringify(timings));
      await uploadToCloudinary(timBuf, timingsId, 'raw');
    }

    return { mp3Url, tmpPath };
  }

  // Local fallback
  try { fs.mkdirSync(localDir, { recursive: true }); } catch (_) {}
  const localMp3 = path.join(localDir, `${cacheKey}.mp3`);
  const localTim = path.join(localDir, `${cacheKey}.timings.json`);
  fs.writeFileSync(localMp3, mp3Buffer);
  if (timings) fs.writeFileSync(localTim, JSON.stringify(timings));

  const relDir = path.relative(path.join(__dirname, '../data/audio'), localDir).replace(/\\/g, '/');
  return { mp3Url: `/data/audio/${relDir}/${cacheKey}.mp3`, tmpPath: localMp3 };
}

/**
 * Save timings for an already-cached audio entry (e.g. after running Whisper post-hoc).
 */
async function saveTimings(cacheKey, localDir, timings) {
  if (CLOUDINARY_CONFIGURED) {
    const timingsId = `aivorah/audio/${cacheKey}_timings`;
    const timBuf = Buffer.from(JSON.stringify(timings));
    await uploadToCloudinary(timBuf, timingsId, 'raw').catch(e => console.error('[audioCache] timings upload failed:', e.message));
    return;
  }
  const localTim = path.join(localDir, `${cacheKey}.timings.json`);
  try { fs.writeFileSync(localTim, JSON.stringify(timings)); } catch {}
}

/**
 * Get local tmp path for an audio file (needed for Whisper which reads from disk).
 * Downloads from Cloudinary if not already on disk.
 */
async function getLocalPath(cacheKey, mp3Url) {
  const tmpPath = path.join(TMP_DIR, `${cacheKey}.mp3`);
  if (fs.existsSync(tmpPath)) return tmpPath;
  if (CLOUDINARY_CONFIGURED && mp3Url.startsWith('http')) {
    const buf = await downloadFromCloudinary(mp3Url);
    fs.writeFileSync(tmpPath, buf);
  }
  return tmpPath;
}

module.exports = { getCachedAudio, saveAudio, saveTimings, getLocalPath, CLOUDINARY_CONFIGURED };
