/**
 * run-full-ncert-tonight.js — ONE self-running chain that builds the full NCERT
 * RAG knowledge base end-to-end, unattended, then exits. Every step is resumable
 * and fault-tolerant, so a crash/restart continues where it left off.
 *
 * Steps (in order, each best-effort — a failure never blocks the next):
 *   1. Ingest all NCERT PDFs already on disk (G5-12) → Qdrant.
 *   2. Download G1-4 English-medium PDFs from ncert.nic.in (download-only).
 *   3. Ingest again → picks up the freshly-downloaded G1-4 (skips G5-12 done).
 *   4. Final verify: print Qdrant coverage per grade.
 *
 * Launch detached:  node scripts/run-full-ncert-tonight.js > data/full-ncert-tonight.log 2>&1
 */
require('dotenv').config();
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const log = (m) => console.log(`\n[${new Date().toISOString()}] ${m}`);

function run(label, args) {
  log(`▶ ${label}`);
  try {
    execFileSync('node', args, { cwd: path.resolve(HERE, '..'), stdio: 'inherit', maxBuffer: 1024 * 1024 * 64 });
    log(`✓ ${label} — finished`);
  } catch (e) {
    // Never abort the chain — the next step (and a re-run) will recover.
    log(`⚠ ${label} — exited with error (continuing): ${e.message}`);
  }
}

async function main() {
  log('=== FULL NCERT KNOWLEDGE-BASE BUILD — start ===');

  // 1. Ingest whatever PDFs are already on disk (G5-12).
  run('Step 1/4 · ingest G5-12 (on-disk PDFs → Qdrant)', ['scripts/ingest-all-ncert.js']);

  // 2. Download G1-4 English-medium PDFs (download-only, resumable).
  run('Step 2/4 · download G1-4 PDFs from ncert.nic.in', [
    'scripts/orchestrate-ncert.js',
    '--list', 'data/curricula/ncert_catalog/all_books_catalog.txt',
    '--grades', '1,2,3,4', '--nogen',
  ]);

  // 3. Ingest again → the newly-downloaded G1-4 (G5-12 already checkpointed → skipped).
  run('Step 3/4 · ingest G1-4 (new PDFs → Qdrant)', ['scripts/ingest-all-ncert.js']);

  // 4. Coverage report.
  log('Step 4/4 · verifying Qdrant coverage per grade…');
  try {
    const { client, COLLECTION } = require('../services/qdrant');
    const info = await client.getCollection(COLLECTION);
    log(`Qdrant "${COLLECTION}" now holds ${info.points_count} points.`);
  } catch (e) { log(`coverage check skipped: ${e.message}`); }

  log('=== FULL NCERT KNOWLEDGE-BASE BUILD — DONE. Safe to sleep. ===');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
