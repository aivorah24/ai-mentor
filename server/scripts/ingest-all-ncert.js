/**
 * ingest-all-ncert.js — Overnight, resumable ingestion of ALL local NCERT book
 * PDFs into the Qdrant RAG knowledge base (collection aivorah_curriculum_chunks_v1).
 *
 * Walks server/data/ncert_books/grade{N}/{subject}/*.pdf, extracts text, chunks,
 * embeds LOCALLY (MiniLM 384-dim — no API key, no rate limits, so it can grind
 * through everything unattended), and upserts with payload {curriculum:'NCERT',
 * grade:<int>, subject:<label>, topic, content_type:'explanation', content,...}
 * matching exactly what qdrant.searchGrounding() filters on — so generation is
 * grounded the moment a file finishes.
 *
 * Resumable: a per-file checkpoint (data/ingest-ncert-checkpoint.json) records
 * every finished PDF, so a re-run (or a crash/restart) skips completed files.
 *
 * Usage:
 *   node scripts/ingest-all-ncert.js                 # all grades that have PDFs
 *   node scripts/ingest-all-ncert.js --grades 6,7    # subset
 *   node scripts/ingest-all-ncert.js --reset         # wipe checkpoint, re-ingest all
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pdf = require('pdf-parse');
const { embed } = require('../services/embeddings');
const { upsertContent, initCollection } = require('../services/qdrant');

const BOOKS_ROOT = path.resolve(__dirname, '..', 'data', 'ncert_books');
const CKPT_FILE  = path.resolve(__dirname, '..', 'data', 'ingest-ncert-checkpoint.json');

const argVal = (flag, def) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : def; };
const RESET  = process.argv.includes('--reset');
const GRADES_ARG = argVal('--grades', '');
const ONLY_GRADES = GRADES_ARG ? GRADES_ARG.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean) : null;

// Folder name → human subject label (matches the payloads searchGrounding filters on).
function subjectLabel(folder) {
  const map = {
    english: 'English', mathematics: 'Mathematics', science: 'Science',
    social_science: 'Social Science', physics: 'Physics', chemistry: 'Chemistry',
    biology: 'Biology', accountancy: 'Accountancy', business_studies: 'Business Studies',
    economics: 'Economics', history: 'History', political_science: 'Political Science',
    computer_science: 'Computer Science', geography: 'Geography',
  };
  return map[folder] || folder.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function chunkText(text, size = 350, overlap = 70) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const chunk = words.slice(i, i + size).join(' ');
    if (chunk.trim().length >= 50) chunks.push(chunk.trim());
  }
  return chunks;
}

function loadCkpt() { try { return JSON.parse(fs.readFileSync(CKPT_FILE, 'utf8')); } catch { return { files: {}, totals: { files: 0, chunks: 0 } }; } }
function saveCkpt(c) { fs.writeFileSync(CKPT_FILE, JSON.stringify(c, null, 2)); }

// Discover every gradeN/subject/*.pdf under the books root.
function discoverPdfs() {
  const out = [];
  for (const gd of fs.readdirSync(BOOKS_ROOT)) {
    const m = gd.match(/^grade(\d+)$/);
    if (!m) continue;                       // skip _tmp_* and non-grade dirs
    const grade = parseInt(m[1], 10);
    if (ONLY_GRADES && !ONLY_GRADES.includes(grade)) continue;
    const gradeDir = path.join(BOOKS_ROOT, gd);
    for (const subjFolder of fs.readdirSync(gradeDir)) {
      const subjDir = path.join(gradeDir, subjFolder);
      if (!fs.statSync(subjDir).isDirectory()) continue;
      for (const f of fs.readdirSync(subjDir)) {
        if (!/\.pdf$/i.test(f)) continue;
        out.push({ grade, subject: subjectLabel(subjFolder), file: path.join(subjDir, f), code: f.replace(/\.pdf$/i, ''), rel: `grade${grade}/${subjFolder}/${f}` });
      }
    }
  }
  return out.sort((a, b) => a.grade - b.grade || a.rel.localeCompare(b.rel));
}

async function ingestFile(pdfInfo, ckpt) {
  const buf = fs.readFileSync(pdfInfo.file);
  if (buf.length < 5000) { console.log(`  [skip] ${pdfInfo.rel} — empty/placeholder`); return 0; }
  let text = '';
  try { text = (await pdf(buf)).text || ''; } catch (e) { console.log(`  ! parse failed ${pdfInfo.rel}: ${e.message}`); return 0; }
  const chunks = chunkText(text);
  if (chunks.length === 0) { console.log(`  [skip] ${pdfInfo.rel} — no extractable text (scanned?)`); return 0; }

  let points = [];
  let written = 0;
  for (const chunk of chunks) {
    const vector = await embed(chunk);
    points.push({
      id: crypto.randomUUID(),
      vector,
      payload: {
        curriculum: 'NCERT',
        grade: pdfInfo.grade,            // integer — matches the NCERT collection
        subject: pdfInfo.subject,
        topic: pdfInfo.code,
        content_type: 'explanation',
        content: chunk,
        source: `ncert_books/${pdfInfo.rel}`,
        school_id: 'default',
      },
    });
    if (points.length >= 64) { await upsertContent(points); written += points.length; points = []; }
  }
  if (points.length) { await upsertContent(points); written += points.length; }
  return written;
}

async function main() {
  console.log(`\n=== NCERT full ingestion → Qdrant (${new Date().toISOString()}) ===`);
  await initCollection();
  if (RESET && fs.existsSync(CKPT_FILE)) fs.unlinkSync(CKPT_FILE);
  const ckpt = loadCkpt();

  const pdfs = discoverPdfs();
  console.log(`Discovered ${pdfs.length} PDF(s)${ONLY_GRADES ? ` for grades ${ONLY_GRADES.join(',')}` : ''}. Already done: ${Object.keys(ckpt.files).length}.`);

  let i = 0;
  for (const p of pdfs) {
    i++;
    if (ckpt.files[p.rel]) continue;                 // resume: skip finished
    const t0 = Date.now();
    process.stdout.write(`[${i}/${pdfs.length}] G${p.grade} ${p.subject} ${p.code} …`);
    try {
      const n = await ingestFile(p, ckpt);
      ckpt.files[p.rel] = { grade: p.grade, subject: p.subject, chunks: n, at: new Date().toISOString() };
      ckpt.totals.files += 1; ckpt.totals.chunks += n;
      saveCkpt(ckpt);
      console.log(` ${n} chunks (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      console.log(` ! ERROR: ${e.message}`);        // don't checkpoint → retried next run
    }
  }
  console.log(`\n=== DONE. Totals: ${ckpt.totals.files} files, ${ckpt.totals.chunks} chunks ingested. ===`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
