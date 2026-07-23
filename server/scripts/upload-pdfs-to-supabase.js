/**
 * upload-pdfs-to-supabase.js — Persist all NCERT source PDFs to Supabase Storage
 * (bucket "ncert-books") so ingestion no longer depends on local/ephemeral disk
 * (Cloud Run) and the source of truth lives in the cloud. Resumable + idempotent.
 *
 * Path in bucket mirrors disk: grade<N>/<subject>/<code>.pdf
 *
 * Usage:  node scripts/upload-pdfs-to-supabase.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');

const BOOKS_ROOT = path.resolve(__dirname, '..', 'data', 'ncert_books');
const CKPT_FILE  = path.resolve(__dirname, '..', 'data', 'supabase-pdf-upload-checkpoint.json');
const BUCKET     = 'ncert-books';

const loadCkpt = () => { try { return JSON.parse(fs.readFileSync(CKPT_FILE, 'utf8')); } catch { return { done: {}, count: 0 }; } };
const saveCkpt = (c) => fs.writeFileSync(CKPT_FILE, JSON.stringify(c, null, 2));

function discover() {
  const out = [];
  for (const gd of fs.readdirSync(BOOKS_ROOT)) {
    const m = gd.match(/^grade(\d+)$/); if (!m) continue;        // skip _tmp_* dirs
    const gdir = path.join(BOOKS_ROOT, gd);
    for (const subj of fs.readdirSync(gdir)) {
      const sdir = path.join(gdir, subj);
      if (!fs.statSync(sdir).isDirectory()) continue;
      for (const f of fs.readdirSync(sdir)) {
        if (!/\.pdf$/i.test(f)) continue;
        const abs = path.join(sdir, f);
        if (fs.statSync(abs).size < 5000) continue;              // skip empty/placeholder
        out.push({ abs, key: `${gd}/${subj}/${f}` });
      }
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

async function ensureBucket() {
  const { data } = await supabase.storage.listBuckets();
  if (!(data || []).some(b => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error && !/exists/i.test(error.message)) throw error;
    console.log(`[bucket] created "${BUCKET}"`);
  } else {
    console.log(`[bucket] "${BUCKET}" exists`);
  }
}

async function main() {
  console.log(`\n=== Upload NCERT PDFs → Supabase Storage (${new Date().toISOString()}) ===`);
  await ensureBucket();
  const ckpt = loadCkpt();
  const files = discover();
  console.log(`Discovered ${files.length} PDF(s). Already uploaded: ${Object.keys(ckpt.done).length}.`);

  let i = 0;
  for (const f of files) {
    i++;
    if (ckpt.done[f.key]) continue;
    try {
      const body = fs.readFileSync(f.abs);
      const { error } = await supabase.storage.from(BUCKET).upload(f.key, body, {
        contentType: 'application/pdf', upsert: true,
      });
      if (error) throw error;
      ckpt.done[f.key] = { size: body.length, at: new Date().toISOString() };
      ckpt.count = Object.keys(ckpt.done).length;
      if (i % 20 === 0) saveCkpt(ckpt);
      if (i % 50 === 0) console.log(`  [${i}/${files.length}] uploaded`);
    } catch (e) {
      console.log(`  ! ${f.key}: ${e.message}`);
    }
  }
  saveCkpt(ckpt);
  console.log(`\n=== DONE. ${Object.keys(ckpt.done).length}/${files.length} PDFs in Supabase Storage bucket "${BUCKET}". ===`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
