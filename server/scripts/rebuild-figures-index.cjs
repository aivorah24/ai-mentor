/**
 * rebuild-figures-index.cjs — Rebuild data/ncert_figures_index.json from what is
 * already in Cloudinary, without re-extracting any PDF.
 *
 * The extractor uploads with a deterministic public_id
 * (ncert/grade<G>/<Subject>/<code>_p<page>_<n>) and the Admin API returns width/
 * height, so every field of an index record can be recovered from the listing.
 * Used after the local index file was lost/truncated while the uploads survived.
 *
 * Usage: node scripts/rebuild-figures-index.cjs [--dry]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const INDEX_FILE = path.resolve(__dirname, '..', 'data', 'ncert_figures_index.json');
const DRY = process.argv.includes('--dry');

// ncert/grade6/English/fepr101_p26_0
const RE = /^ncert\/grade(\d{1,2})\/([^/]+)\/(.+?)_p(\d+)_(\d+)$/;

(async () => {
  const figures = [];
  let cursor, pages = 0, skipped = 0;

  do {
    const res = await cloudinary.api.resources({
      type: 'upload', prefix: 'ncert/', max_results: 500, next_cursor: cursor,
    });
    for (const r of res.resources) {
      const m = RE.exec(r.public_id);
      if (!m) { skipped++; continue; }
      figures.push({
        grade: parseInt(m[1], 10),
        subject: m[2],
        code: m[3],
        page: parseInt(m[4], 10),
        url: r.secure_url,
        w: r.width,
        h: r.height,
      });
    }
    cursor = res.next_cursor;
    process.stdout.write(`\r  listed ${++pages} page(s) · ${figures.length} figures`);
  } while (cursor);

  figures.sort((a, b) =>
    a.grade - b.grade || a.subject.localeCompare(b.subject) ||
    a.code.localeCompare(b.code) || a.page - b.page);

  const byGrade = {};
  for (const f of figures) byGrade[`G${f.grade}`] = (byGrade[`G${f.grade}`] || 0) + 1;
  console.log(`\n\n${figures.length} figures recovered (${skipped} non-figure assets ignored)`);
  console.log(byGrade);

  if (DRY) return console.log('\n--dry: index not written.');
  fs.writeFileSync(INDEX_FILE, JSON.stringify(figures, null, 2));
  console.log(`\nWrote ${INDEX_FILE}`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
