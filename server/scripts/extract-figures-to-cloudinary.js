/**
 * extract-figures-to-cloudinary.js — Extract embedded FIGURES (diagrams/photos)
 * from NCERT book PDFs and upload them to Cloudinary for runtime lesson serving.
 * Builds an index {grade,subject,code,page,url,w,h} → data/ncert_figures_index.json,
 * so lessons can show the real diagram near the concept it explains.
 *
 * Extraction: pdfjs-dist operator list → paintImageXObject → raw pixels → sharp PNG.
 * Filters out tiny/decorative/banner images. Resumable per-PDF checkpoint.
 *
 * Usage:
 *   node scripts/extract-figures-to-cloudinary.js --test data/ncert_books/grade6/science/fesc101.pdf
 *        → extract ONE pdf to data/_figtest/ locally, NO upload (quality check)
 *   node scripts/extract-figures-to-cloudinary.js [--grades 6,7]   → full run + upload
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// pdfjs-dist v5 is ESM-only → load via dynamic import from this CJS script.
let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

const BOOKS_ROOT = path.resolve(__dirname, '..', 'data', 'ncert_books');
const CKPT_FILE  = path.resolve(__dirname, '..', 'data', 'figures-cloudinary-checkpoint.json');
const INDEX_FILE = path.resolve(__dirname, '..', 'data', 'ncert_figures_index.json');
const TEST_DIR   = path.resolve(__dirname, '..', 'data', '_figtest');

const argVal = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const TEST_PDF = argVal('--test');
const GRADES_ARG = argVal('--grades', '');
const ONLY_GRADES = GRADES_ARG ? GRADES_ARG.split(',').map(s => parseInt(s.trim(), 10)) : null;

const MIN_W = 90, MIN_H = 90;              // reject icons/bullets
const MAX_ASPECT = 6;                       // reject banner strips (very wide-short)

function subjectLabel(folder) {
  const map = { english: 'English', mathematics: 'Mathematics', science: 'Science', social_science: 'Social Science', evs: 'EVS', physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology' };
  return map[folder] || folder.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Convert a pdfjs image object {width,height,kind,data} to a PNG buffer via sharp.
async function imgToPng(img) {
  const { width, height, kind, data } = img;
  if (!width || !height || !data) return null;
  // pdfjs ImageKind: 1=GRAYSCALE_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP
  let channels, raw;
  if (kind === 3) { channels = 4; raw = Buffer.from(data.buffer || data); }
  else if (kind === 2) { channels = 3; raw = Buffer.from(data.buffer || data); }
  else if (kind === 1) {
    // 1bpp grayscale → expand to 8bpp
    channels = 1; const out = Buffer.alloc(width * height);
    for (let i = 0; i < out.length; i++) { const byte = data[i >> 3]; out[i] = (byte & (128 >> (i & 7))) ? 255 : 0; }
    raw = out;
  } else { return null; }
  const expected = width * height * channels;
  if (raw.length < expected) return null;                 // malformed
  return sharp(raw.slice(0, expected), { raw: { width, height, channels } }).png().toBuffer();
}

async function extractFromPdf(absPath) {
  const pdfjs = await loadPdfjs();
  const crypto = require('crypto');
  const data = new Uint8Array(fs.readFileSync(absPath));
  // Fonts are NOT needed for image extraction — do NOT set standardFontDataUrl
  // (in Node it makes pdfjs try to fetch font files, which HANGS every PDF).
  // verbosity:0 alone silences the harmless font warnings.
  const doc = await pdfjs.getDocument({
    data, disableWorker: true, isEvalSupported: false,
    verbosity: 0, // ERRORS only — no info/warning flood
  }).promise;
  const cands = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const ops = await page.getOperatorList();
    const seen = new Set();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
      const name = ops.argsArray[i][0];
      if (seen.has(name)) continue; seen.add(name);
      let img;
      try { img = await new Promise((res) => page.objs.get(name, res)); } catch { continue; }
      if (!img || !img.width) continue;
      if (img.width < MIN_W || img.height < MIN_H) continue;
      const aspect = Math.max(img.width, img.height) / Math.min(img.width, img.height);
      if (aspect > MAX_ASPECT) continue;                                  // banner strip
      // Full-page background/template: ~A4 aspect (0.68–0.74) and very large.
      const a2 = Math.min(img.width, img.height) / Math.max(img.width, img.height);
      if (img.width * img.height > 3_500_000 && a2 > 0.66 && a2 < 0.76) continue;
      let png; try { png = await imgToPng(img); } catch { png = null; }
      if (png && png.length > 1500) cands.push({ page: pageNo, png, w: img.width, h: img.height, hash: crypto.createHash('md5').update(png).digest('hex') });
    }
    page.cleanup();
  }
  await doc.destroy();
  // Drop images repeated across pages (logos/decorations/page frames): any hash
  // that appears on ≥3 distinct pages is a template, not a figure.
  const pagesByHash = {};
  for (const c of cands) (pagesByHash[c.hash] ||= new Set()).add(c.page);
  const isTemplate = (h) => pagesByHash[h].size >= 3;
  // Also dedupe exact repeats within the SAME page (keep first).
  const keptHashPerPage = new Set();
  const figures = [];
  for (const c of cands) {
    if (isTemplate(c.hash)) continue;
    const k = `${c.page}:${c.hash}`;
    if (keptHashPerPage.has(k)) continue; keptHashPerPage.add(k);
    figures.push({ page: c.page, png: c.png, w: c.w, h: c.h });
  }
  return figures;
}

async function runTest() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  console.log(`\n[TEST] extracting figures from ${TEST_PDF} → ${TEST_DIR} (no upload)`);
  const figs = await extractFromPdf(path.resolve(TEST_PDF));
  console.log(`  found ${figs.length} figure(s)`);
  figs.slice(0, 12).forEach((f, i) => {
    const out = path.join(TEST_DIR, `fig_p${f.page}_${i}.png`);
    fs.writeFileSync(out, f.png);
    console.log(`  wrote ${out} (${f.w}x${f.h}, ${(f.png.length / 1024).toFixed(0)}KB)`);
  });
  console.log(`[TEST] done — open ${TEST_DIR} to eyeball quality before the full run.`);
  process.exit(0);
}

const loadCkpt = () => { try { return JSON.parse(fs.readFileSync(CKPT_FILE, 'utf8')); } catch { return { done: {} }; } };
const saveCkpt = (c) => fs.writeFileSync(CKPT_FILE, JSON.stringify(c, null, 2));
const loadIndex = () => { try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return []; } };

function discover() {
  // Diagrams that matter for lessons live in Science/Maths/Social/EVS + the
  // G11-12 streams. English readers are scanned/decorative AND the main cause of
  // pdfjs hangs — skip them by default (pass --english to include).
  const SKIP = new Set(['english']);
  const INCLUDE_ENGLISH = process.argv.includes('--english');
  // G1-5 NCERT books are largely SCANNED page-images (no extractable vector
  // figures → pdfjs hangs, few real diagrams). Real, extractable diagrams live
  // in G6-12. Default to G6+; pass --lowergrades to attempt G1-5.
  const MIN_GRADE = process.argv.includes('--lowergrades') ? 1 : 6;
  const out = [];
  for (const gd of fs.readdirSync(BOOKS_ROOT)) {
    const m = gd.match(/^grade(\d+)$/); if (!m) continue;
    const grade = parseInt(m[1], 10);
    if (grade < MIN_GRADE) continue;
    if (ONLY_GRADES && !ONLY_GRADES.includes(grade)) continue;
    const gdir = path.join(BOOKS_ROOT, gd);
    for (const subj of fs.readdirSync(gdir)) {
      if (!INCLUDE_ENGLISH && SKIP.has(subj.toLowerCase())) continue;
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

async function runFull() {
  console.log(`\n=== NCERT figures → Cloudinary (${new Date().toISOString()}) ===`);
  const ckpt = loadCkpt();
  const index = loadIndex();
  const pdfs = discover();
  console.log(`Discovered ${pdfs.length} PDF(s). Already done: ${Object.keys(ckpt.done).length}.`);

  let i = 0;
  for (const p of pdfs) {
    i++;
    if (ckpt.done[p.rel]) continue;
    try {
      process.stdout.write(`[${i}/${pdfs.length}] ${p.rel} … `);
      // Per-PDF timeout: a single malformed/slow PDF must never stall the whole
      // pipeline. Good books extract in seconds; 45s is plenty, so slow/hanging
      // ones (some scanned G1 readers) skip fast instead of wasting minutes.
      const figs = await Promise.race([
        extractFromPdf(p.abs),
        new Promise((_, rej) => setTimeout(() => rej(new Error('extract-timeout')), 20000)),
      ]);
      let uploaded = 0;
      for (let k = 0; k < figs.length; k++) {
        const f = figs[k];
        const publicId = `ncert/grade${p.grade}/${p.subject.replace(/\s+/g, '_')}/${p.code}_p${f.page}_${k}`;
        const res = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream({ public_id: publicId, folder: '', resource_type: 'image', overwrite: true }, (err, r) => err ? reject(err) : resolve(r)).end(f.png);
        });
        index.push({ grade: p.grade, subject: p.subject, code: p.code, page: f.page, url: res.secure_url, w: f.w, h: f.h });
        uploaded++;
      }
      ckpt.done[p.rel] = { figures: uploaded, at: new Date().toISOString() };
      saveCkpt(ckpt);
      fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
      console.log(`${uploaded} figure(s)`);
    } catch (e) {
      // Checkpoint failures/timeouts too, so the pipeline ADVANCES instead of
      // re-hanging on the same book. `retryable:true` marks it for an optional
      // later pass (clear these entries to re-attempt).
      ckpt.done[p.rel] = { figures: 0, error: e.message, retryable: true, at: new Date().toISOString() };
      saveCkpt(ckpt);
      console.log(`! ${e.message} (skipped)`);
    }
  }
  console.log(`\n=== DONE. ${index.length} figures uploaded to Cloudinary; index → ${INDEX_FILE}. ===`);
  process.exit(0);
}

(TEST_PDF ? runTest() : runFull()).catch(e => { console.error('FATAL:', e); process.exit(1); });
