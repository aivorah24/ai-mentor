/**
 * orchestrate-ncert.js
 * Resumable end-to-end driver for building CBSE content across grades.
 *
 * For each book code (from a catalog list like `code=first-last`):
 *   1. download the prelims PDF (<code>ps.pdf) → detect subject + chapter titles
 *   2. download each chapter PDF (<code><NN>.pdf) into data/ncert_books/grade<G>/<subject>/
 *   3. build a chapter manifest (real TOC titles when available)
 *   4. (unless --nogen) run generate-chapter-subject-content.js → writes the syllabus .ts
 *   5. checkpoint after every book so a re-run skips finished work
 *
 * Downloads/manifests are deterministic and always safe to run. Generation is
 * LLM-gated and will progress until free quotas wall, then resume next run.
 *
 * Usage:
 *   node scripts/orchestrate-ncert.js --list data/curricula/ncert_catalog/english_medium.txt --grades 6,7,8,9,10
 *   node scripts/orchestrate-ncert.js --list ... --nogen        # foundation only (download + manifests)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pdf = require('pdf-parse');

function argVal(flag, def) { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : def; }
const LIST_FILE = path.resolve(__dirname, '..', argVal('--list'));
const GRADES = (argVal('--grades', '') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const NO_GEN = process.argv.includes('--nogen');
const LITE = process.argv.includes('--lite'); // forward to the generator: 1 call/chapter
const PDF_BASE = 'https://ncert.nic.in/textbook/pdf/';
const BOOKS_ROOT = path.resolve(__dirname, '..', 'data/ncert_books');
const CURRICULA = path.resolve(__dirname, '..', 'data/curricula');
const IMAGE_INDEX = path.resolve(__dirname, '..', 'data/ncert_image_jsonl/ncert_images_index.json');
const CKPT_FILE = path.resolve(__dirname, '..', 'data/curricula/ncert_catalog/orchestrator_checkpoint.json');
const SYLLABUS_OUT_DIR = path.resolve(__dirname, '..', '..', 'AIMentorApp/src/data');

const CLASS_LETTER = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12 };

// Map a subject name (read off the prelims page) to the app's folder + the
// subject label used in the image index. Returns null for non-core/unknown.
const SUBJECTS = {
  social_science: { folder: 'social_science', image: 'Social_Science', label: 'Social Science' },
  mathematics: { folder: 'mathematics', image: 'Mathematics', label: 'Mathematics' },
  evs: { folder: 'evs', image: 'EVS', label: 'Environmental Studies' },
  physics: { folder: 'physics', image: 'Physics', label: 'Physics' },
  chemistry: { folder: 'chemistry', image: 'Chemistry', label: 'Chemistry' },
  biology: { folder: 'biology', image: 'Biology', label: 'Biology' },
  science: { folder: 'science', image: 'Science', label: 'Science' },
  english: { folder: 'english', image: 'English', label: 'English' },
};
function classify(s) {
  if (/social\s*science/.test(s)) return SUBJECTS.social_science;
  // "math" also catches Math-Magic / Maths Mela / Joyful Mathematics (G1-5).
  if (/mathematics|maths|\bmath\b|math-magic|maths mela|joyful mathematics/.test(s)) return SUBJECTS.mathematics;
  if (/environmental|\bevs\b|looking around|our wondrous world|world around us/.test(s)) return SUBJECTS.evs;
  if (/physics/.test(s)) return SUBJECTS.physics;
  if (/chemistry/.test(s)) return SUBJECTS.chemistry;
  if (/biology/.test(s)) return SUBJECTS.biology;
  if (/\bscience\b/.test(s)) return SUBJECTS.science;
  if (/\benglish\b/.test(s)) return SUBJECTS.english;
  return null;
}
// First-priority, deterministic override: the book code's subject infix (after
// the grade+medium prefix, before the volume digit). More reliable than parsing
// title-page text, which can vary with PDF extraction/OCR. Unknown infixes fall
// through to title-page detection (mapSubject).
function codeSubject(code) {
  const infix = String(code).replace(/^[a-l]e/, '').replace(/\d+$/, '');
  const map = {
    cu: 'science', sc: 'science',
    // G1-5 English-medium maths readers (jm=Joyful Mathematics, mm=Maths Mela).
    gp: 'mathematics', mh: 'mathematics', jm: 'mathematics', mm: 'mathematics',
    es: 'social_science', ss: 'social_science',
    // English readers: pr=Poorvi, be=Beehive, en=English, sa=Santoor,
    // mr=Marigold, rd=Raindrops, md=Mridang.
    pr: 'english', be: 'english', en: 'english', sa: 'english', mr: 'english', rd: 'english', md: 'english',
    ph: 'physics', ch: 'chemistry', bo: 'biology',
    ap: 'evs', ev: 'evs',
  };
  return map[infix] ? SUBJECTS[map[infix]] : null;
}

// The authoritative subject is the "Textbook of <Subject>" line on the title
// page — NOT loose keyword matching (the copyright boilerplate mentions
// "social science", which made every book match Social Science before).
function mapSubject(text) {
  const t = text.toLowerCase();
  const m = t.match(/textbook of ([a-z ]+?)(?:\s+(?:grade|for|part|class|\d)|\s*$)/);
  if (m) { const r = classify(m[1].trim()); if (r) return r; }
  // Fallback: recognisable NCERT book names on the title page.
  if (/ganita\s*prakash/.test(t)) return SUBJECTS.mathematics;
  if (/curiosity/.test(t)) return SUBJECTS.science;
  if (/exploring\s*society/.test(t)) return SUBJECTS.social_science;
  if (/poorvi|santoor|mridang|marigold|honeydew|honeycomb/.test(t)) return SUBJECTS.english;
  if (/looking\s*around/.test(t)) return SUBJECTS.evs;
  return null;
}

async function downloadPdf(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) return true; // cached
  // NCERT's server intermittently drops connections; retry a few times so a
  // transient network blip doesn't fatal the whole book.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) { if (res.status === 404) return false; throw new Error(`HTTP ${res.status}`); }
      const ct = res.headers.get('content-type') || '';
      if (!/pdf/i.test(ct)) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10000) return false;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return true;
    } catch (e) {
      if (attempt === 3) { console.log(`  ! download failed after retries: ${url.split('/').pop()} (${e.message})`); return false; }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return false;
}

async function pdfPages(file) {
  const pages = [];
  await pdf(fs.readFileSync(file), { pagerender: (pd) => pd.getTextContent().then((tc) => { pages.push(tc.items.map((i) => i.str).join(' ')); return ''; }) });
  return pages;
}

function loadCkpt() { try { return JSON.parse(fs.readFileSync(CKPT_FILE, 'utf8')); } catch { return {}; } }
function saveCkpt(c) { fs.mkdirSync(path.dirname(CKPT_FILE), { recursive: true }); fs.writeFileSync(CKPT_FILE, JSON.stringify(c, null, 2)); }

let imageIndexCache = null;
function gradeSubjectHasImages(grade, imageSubject) {
  if (!imageIndexCache) { try { imageIndexCache = JSON.parse(fs.readFileSync(IMAGE_INDEX, 'utf8')); } catch { imageIndexCache = []; } }
  return imageIndexCache.some((m) => m.grade === grade && m.subject === imageSubject);
}

async function processBook(code, first, last, ckpt) {
  const grade = CLASS_LETTER[code[0]];
  if (GRADES.length && !GRADES.includes(grade)) return;
  if (ckpt[code] && ckpt[code].status === 'done') { console.log(`  [skip] ${code} already done`); return; }

  console.log(`\n=== ${code} (Grade ${grade}, chapters ${first}-${last}) ===`);
  const tmpDir = path.join(BOOKS_ROOT, `_tmp_${code}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // 1. prelims → subject + titles
  const prelimsFile = path.join(tmpDir, `${code}ps.pdf`);
  let subject = codeSubject(code), titles = {}; // deterministic override first
  if (await downloadPdf(`${PDF_BASE}${code}ps.pdf`, prelimsFile)) {
    try {
      const pages = await pdfPages(prelimsFile);
      const head = pages.slice(0, 3).join(' ');
      if (!subject) subject = mapSubject(head); // fall back to title-page detection

      // NCERT contents pages list rows as "Chapter N <Title> <pagenum>". Parse
      // the title as everything between the chapter number and the trailing page
      // number (which precedes the next "Chapter"/"Answer"/"Contents"/end).
      const contents = (pages.find((p) => /contents/i.test(p)) || '').replace(/\s+/g, ' ');
      const rowRe = /Chapter\s+(\d+)\s+(.+?)\s+\d{1,3}(?=\s+Chapter\s+\d|\s+Answer|\s+Contents|\s*$)/g;
      let m;
      while ((m = rowRe.exec(contents)) !== null) {
        const n = parseInt(m[1], 10);
        const title = m[2].replace(/\s+/g, ' ').trim();
        if (n >= 1 && n <= last && title.length >= 3 && title.length <= 90) titles[n] = title;
      }
    } catch (e) { console.log(`  ! prelims parse failed: ${e.message}`); }
  }
  if (!subject) { console.log(`  ! subject not detected/core — flagging`); ckpt[code] = { status: 'skipped-subject', grade }; saveCkpt(ckpt); return; }
  console.log(`  subject: ${subject.label} | ${Object.keys(titles).length} TOC titles found`);

  // 2. download chapters into the real book dir
  const bookDir = path.join(BOOKS_ROOT, `grade${grade}`, subject.folder);
  const chapters = [];
  for (let n = 1; n <= last; n++) {
    const nn = String(n).padStart(2, '0');
    const fname = `${code}${nn}.pdf`;
    const ok = await downloadPdf(`${PDF_BASE}${fname}`, path.join(bookDir, fname));
    if (ok) chapters.push({ chapter: n, pdfFile: fname, title: titles[n] || `Chapter ${n}`, kind: 'Non-fiction', needsTitleReview: !titles[n] });
    else console.log(`  ! ch${nn} download failed/absent`);
  }
  if (chapters.length === 0) { ckpt[code] = { status: 'no-chapters', grade, subject: subject.label }; saveCkpt(ckpt); return; }
  console.log(`  downloaded ${chapters.length}/${last} chapters`);

  // 3. manifest
  const manifestFile = path.join(CURRICULA, `cbse-g${grade}-${subject.folder}-${code}-chapters.json`);
  fs.writeFileSync(manifestFile, JSON.stringify({ curriculum: 'CBSE', grade: `Grade ${grade}`, subject: subject.label, code, imageSubject: subject.image, chapters }, null, 2));

  const hasImages = gradeSubjectHasImages(grade, subject.image);
  ckpt[code] = { status: NO_GEN ? 'foundation' : 'generating', grade, subject: subject.label, chapters: chapters.length, hasImages, manifestFile };
  saveCkpt(ckpt);

  // 4. generate (unless foundation-only)
  if (!NO_GEN) {
    const varName = `CBSE_G${grade}_${subject.folder.toUpperCase()}_${code.toUpperCase()}_SYLLABUS`;
    const outTs = path.join(SYLLABUS_OUT_DIR, `cbseG${grade}${subject.folder.replace(/_/g, '')}_${code}Syllabus.ts`);
    try {
      execFileSync('node', [
        path.join(__dirname, 'generate-chapter-subject-content.js'),
        '--manifest', path.relative(path.resolve(__dirname, '..'), manifestFile),
        '--out', path.relative(path.resolve(__dirname, '..', '..'), outTs),
        '--varname', varName,
        '--bookdir', path.relative(path.resolve(__dirname, '..'), bookDir),
        '--imagesubject', subject.image,
        '--grade', String(grade),
        '--code', code,
        ...(LITE ? ['--lite'] : []),
      ], { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
      ckpt[code].status = 'done';
    } catch (e) {
      console.log(`  ! generation error for ${code}: ${e.message}`);
      ckpt[code].status = 'gen-failed';
    }
    saveCkpt(ckpt);
  }
}

// Single-instance lock so overlapping scheduled fires (or a leftover process)
// don't run two orchestrators against the same checkpoint. A killed process
// leaves a stale lock, which is ignored once older than the freshness window.
const LOCK_FILE = path.resolve(__dirname, '..', 'data/curricula/ncert_catalog/.orchestrator.lock');
const LOCK_FRESH_MS = 30 * 60 * 1000;
function touchLock() { try { fs.writeFileSync(LOCK_FILE, `${process.pid} ${Date.now()}`); } catch (e) {} }

async function main() {
  try {
    const st = fs.statSync(LOCK_FILE);
    if (Date.now() - st.mtimeMs < LOCK_FRESH_MS) {
      console.log('Another orchestrator instance is running (fresh lock) — exiting.');
      process.exit(0);
    }
  } catch (e) { /* no lock */ }
  touchLock();
  process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch (e) {} });

  const lines = fs.readFileSync(LIST_FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const ckpt = loadCkpt();
  let done = 0;
  for (const line of lines) {
    const m = line.match(/^([a-z]+\d+)=(\d+)-(\d+)$/i);
    if (!m) continue;
    touchLock(); // keep the lock fresh across a long pass
    try {
      await processBook(m[1], parseInt(m[2], 10), parseInt(m[3], 10), ckpt);
    } catch (e) {
      console.log(`  ! ${m[1]} fatal: ${e.message}`);
      ckpt[m[1]] = { status: 'error', error: e.message };
      saveCkpt(ckpt);
    }
    done++;
  }
  console.log(`\nOrchestrator pass complete over ${done} catalog entries. Checkpoint: ${CKPT_FILE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
