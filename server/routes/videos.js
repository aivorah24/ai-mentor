const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const DB_PATH = path.join(__dirname, '../data/videos.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return []; }
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
function makeId() {
  return 'vid_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Convert any share URL to an embeddable URL
function toEmbedUrl(url) {
  if (!url) return url;

  // YouTube: youtu.be/ID or youtube.com/watch?v=ID
  const ytShort = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (ytShort) return `https://www.youtube.com/embed/${ytShort[1]}`;
  const ytLong = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
  if (ytLong) return `https://www.youtube.com/embed/${ytLong[1]}`;

  // Vimeo: vimeo.com/ID
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;

  // Vyond — multiple share URL formats all map to embed URL
  // Format 1: share.vyond.com/a/videos/ID  (new)
  const vy1 = url.match(/share\.vyond\.com\/a\/videos\/([^/?&#]+)/);
  if (vy1) return `https://www.vyond.com/embed/video/${vy1[1]}`;

  // Format 2: vyond.com/videos/share/ID
  const vy2 = url.match(/vyond\.com\/videos\/share\/([^/?&#]+)/);
  if (vy2) return `https://www.vyond.com/embed/video/${vy2[1]}`;

  // Format 3: vyond.com/share/video/ID  (older)
  const vy3 = url.match(/vyond\.com\/share\/video\/([^/?&#]+)/);
  if (vy3) return `https://www.vyond.com/embed/video/${vy3[1]}`;

  // Format 4: already an embed URL — pass through
  if (url.includes('vyond.com/embed/video/')) return url;

  // Loom: loom.com/share/ID
  const loom = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;

  // Canva: canva.com/design/<designId>/<token>/view
  // Convert share/view URLs to embeddable viewer URL.
  const canva = url.match(/canva\.com\/design\/([^/?#]+)\/([^/?#]+)/i);
  if (canva) return `https://www.canva.com/design/${canva[1]}/${canva[2]}/view?embed&meta`;

  // Already an embed URL or direct MP4 — return as-is
  return url;
}

// ── GET /videos?topic=xxx&grade=xxx ─────────────────────────
// Get videos for a topic (students)

router.get('/', (req, res) => {
  const { topic, grade } = req.query;
  const all = readDB();
  if (!topic) return res.json(all); // teacher: get all

  const matches = all.filter(v =>
    v.topic.toLowerCase() === (topic || '').toLowerCase() &&
    (!grade || !v.grade || v.grade.toLowerCase() === grade.toLowerCase())
  );
  res.json(matches);
});

// ── POST /videos ─────────────────────────────────────────────
// Teacher adds a video

router.post('/', (req, res) => {
  const { title, topic, grade, url, description, source } = req.body;
  if (!title || !topic || !url) {
    return res.status(400).json({ error: 'title, topic, url required' });
  }

  const video = {
    id:          makeId(),
    title,
    topic,
    grade:       grade || 'All Grades',
    url,
    embedUrl:    toEmbedUrl(url),
    description: description || '',
    source:      source || 'custom', // 'vyond' | 'youtube' | 'vimeo' | 'custom'
    createdAt:   new Date().toISOString(),
  };

  const all = readDB();
  all.push(video);
  writeDB(all);
  res.json(video);
});

// ── DELETE /videos/:id ───────────────────────────────────────

router.delete('/:id', (req, res) => {
  const all = readDB();
  const idx = all.findIndex(v => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  all.splice(idx, 1);
  writeDB(all);
  res.json({ ok: true });
});

module.exports = router;
