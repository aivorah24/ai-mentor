/**
 * extract-figures-yolo.cjs — Recover figures from NCERT books whose diagrams are
 * VECTOR art, which the pdfjs extractor cannot see.
 *
 * extract-figures-to-cloudinary.js walks `paintImageXObject` operators, so it only
 * finds diagrams that were embedded as raster pictures. NCERT Mathematics draws its
 * diagrams as vector paths instead → that extractor reports ~0 figures for maths, and
 * every maths lesson falls back to "Illustration coming soon". This script renders the
 * page instead (PyMuPDF) and detects figure regions with DocLayout-YOLO, via the
 * layout service's /extract-book-figures endpoint.
 *
 * Uploads use the SAME Cloudinary public_id scheme as the pdfjs extractor
 * (ncert/grade<G>/<Subject>/<code>_p<page>_<n>), so both paths land in one namespace
 * and `rebuild-figures-index.cjs` merges them into the canonical index.
 *
 * Deliberately writes its OWN index + checkpoint files: the pdfjs extractor rewrites
 * the main index wholesale after every book, so two concurrent writers would clobber
 * each other. Run rebuild-figures-index.cjs afterwards to merge from Cloudinary.
 *
 * Prereq: the layout service must be running (start-layout-service.bat, port 5050).
 *
 * Usage:
 *   node scripts/extract-figures-yolo.cjs --grades 6,7 --subjects mathematics
 *   node scripts/extract-figures-yolo.cjs --grades 6 --subjects mathematics --retry
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

const BOOKS_ROOT = path.resolve(__dirname, '..', 'data', 'ncert_books');
const CKPT_FILE  = path.resolve(__dirname, '..', 'data', 'figures-yolo-checkpoint.json');
const INDEX_FILE = path.resolve(__dirname, '..', 'data', 'ncert_figures_index_yolo.json');

const argVal = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const LAYOUT_URL = process.env.LAYOUT_SERVICE_URL || 'http://localhost:5050';
const GRADES   = (argVal('--grades', '') || '').split(',').map(s => parseInt(s, 10)).filter(Boolean);
const SUBJECTS = (argVal('--subjects', 'mathematics') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const CONF     = argVal('--conf', '0.25');
const DPI      = argVal('--dpi', '160');
const RETRY    = process.argv.includes('--retry');
const DRY      = process.argv.includes('--dry');
const PDF_TIMEOUT_MS = (+argVal('--timeout', 0) || 900) * 1000;
const UPLOAD_CONCURRENCY = +argVal('--upload-concurrency', 0) || 8;

const subjectLabel = (folder) => {
  const map = { english: 'English', mathematics: 'Mathematics', science: 'Science', social_science: 'Social Science', evs: 'EVS', physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology' };
  return map[folder] || folder.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const loadJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function discover() {
  const out = [];
  for (const gd of fs.readdirSync(BOOKS_ROOT)) {
    const m = gd.match(/^grade(\d+)$/); if (!m) continue;
    const grade = parseInt(m[1], 10);
    if (GRADES.length && !GRADES.includes(grade)) continue;
    const gdir = path.join(BOOKS_ROOT, gd);
    for (const subj of fs.readdirSync(gdir)) {
      if (SUBJECTS.length && !SUBJECTS.includes(subj.toLowerCase())) continue;
      const sdir = path.join(gdir, subj);
      if (!fs.statSync(sdir).isDirectory()) continue;
      for (const f of fs.readdirSync(sdir)) {
        if (!/\.pdf$/i.test(f)) continue;
        out.push({ grade, subject: subjectLabel(subj), abs: path.join(sdir, f), code: f.replace(/\.pdf$/i, ''), rel: `grade${grade}/${subj}/${f}` });
      }
    }
  }
  return out.sort((a, b) => a.grade - b.grade || a.rel.localeCompare(b.rel));
}

async function detectFigures(pdfPath) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }), path.basename(pdfPath));
  const url = `${LAYOUT_URL}/extract-book-figures?conf=${CONF}&dpi=${DPI}&types=figure`;
  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(PDF_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`layout ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).figures || [];
}

(async () => {
  console.log(`\n=== NCERT vector figures (YOLO) → Cloudinary (${new Date().toISOString()}) ===`);

  // Fail fast with a clear message: without the service every book would "skip"
  // and the run would look like the books simply have no figures.
  try {
    const h = await fetch(`${LAYOUT_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!h.ok) throw new Error(`status ${h.status}`);
  } catch (e) {
    console.error(`Layout service unreachable at ${LAYOUT_URL} (${e.message}).`);
    console.error('Start it first:  start-layout-service.bat   (or: python server/python/layout_service.py)');
    process.exit(1);
  }

  const ckpt = loadJson(CKPT_FILE, { done: {} });
  const index = loadJson(INDEX_FILE, []);
  const pdfs = discover();
  console.log(`Discovered ${pdfs.length} PDF(s) [grades=${GRADES.join(',') || 'all'} subjects=${SUBJECTS.join(',')}]. Already done: ${Object.keys(ckpt.done).length}.`);
  if (DRY) { pdfs.forEach(p => console.log('  ' + p.rel)); return; }

  let i = 0, totalNew = 0;
  for (const p of pdfs) {
    i++;
    const prev = ckpt.done[p.rel];
    if (prev && !(RETRY && prev.retryable)) continue;
    process.stdout.write(`[${i}/${pdfs.length}] ${p.rel} … `);
    try {
      const figs = await detectFigures(p.abs);

      const queue = figs.map((f, k) => ({ f, k }));
      const results = [];
      const worker = async () => {
        for (;;) {
          const job = queue.shift();
          if (!job) return;
          const { f, k } = job;
          const publicId = `ncert/grade${p.grade}/${p.subject.replace(/\s+/g, '_')}/${p.code}_p${f.page}_${k}`;
          try {
            const res = await new Promise((resolve, reject) => {
              cloudinary.uploader.upload_stream(
                { public_id: publicId, folder: '', resource_type: 'image', overwrite: true },
                (err, r) => err ? reject(err) : resolve(r)
              ).end(Buffer.from(f.pngBase64, 'base64'));
            });
            results.push({ grade: p.grade, subject: p.subject, code: p.code, page: f.page, url: res.secure_url, w: f.w, h: f.h });
          } catch { /* one bad upload must not fail the book */ }
        }
      };
      await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
      results.sort((a, b) => a.page - b.page);
      index.push(...results);
      totalNew += results.length;

      ckpt.done[p.rel] = { figures: results.length, at: new Date().toISOString() };
      fs.writeFileSync(CKPT_FILE, JSON.stringify(ckpt, null, 2));
      fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
      console.log(`${results.length} figure(s)`);
    } catch (e) {
      ckpt.done[p.rel] = { figures: 0, error: e.message, retryable: true, at: new Date().toISOString() };
      fs.writeFileSync(CKPT_FILE, JSON.stringify(ckpt, null, 2));
      console.log(`! ${e.message} (skipped)`);
    }
  }

  console.log(`\n=== DONE. ${totalNew} new figure(s) this run; ${index.length} total in ${INDEX_FILE}. ===`);
  console.log('Now merge into the canonical index:  node scripts/rebuild-figures-index.cjs');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
