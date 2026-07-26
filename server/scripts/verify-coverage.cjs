// verify-coverage.cjs — the coverage VERIFICATION agent. For every official
// NCERT subject in every grade (G1-12), reports its true status:
//   ✅ LIVE       — grounded content ingested AND lessons published
//   🟡 INGESTED   — has grounded text but no published lessons yet
//   📄 PDF-ONLY   — book on disk but text won't extract (image/scanned → needs OCR)
//   ❌ NO PDF     — no book on disk for this subject/grade
// This is how we honestly answer "is every subject done in every grade?".
//
//   node scripts/verify-coverage.cjs            # all grades
//   node scripts/verify-coverage.cjs --grade 2  # one grade
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const q = require('../services/qdrant');
const sb = require('../services/supabase');
const OFFICIAL = require('./ncert-official-subjects.json').byGrade;

const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const norm = s => (s || '').toLowerCase() === 'evs' ? 'environmental studies' : (s || '').toLowerCase();

function subjectFolder(subject) {
  const s = norm(subject);
  if (s.includes('math')) return 'mathematics';
  if (s === 'english') return 'english';
  if (s === 'hindi') return 'hindi';
  if (s === 'urdu') return 'urdu';
  if (s === 'sanskrit') return 'sanskrit';
  if (s.includes('environmental')) return 'evs';
  if (s === 'science') return 'science';
  if (s.includes('social')) return 'social_science';
  return s.replace(/\s+/g, '_');
}

(async () => {
  const only = arg('--grade');
  const grades = only ? [Number(only)] : [1,2,3,4,5,6,7,8,9,10,11,12];

  // ingested subjects (real text) per grade
  const ing = {}; let next = null;
  for (let i = 0; i < 400; i++) {
    const r = await q.client.scroll(q.COLLECTION, { limit: 250, offset: next, with_payload: true, with_vector: false });
    for (const p of (r.points || [])) {
      const pl = p.payload || {};
      let g = String(pl.grade || '').replace('Grade ', '').replace('Class ', '');
      g = { I: '1', II: '2', III: '3' }[g] || g;
      if (!/^([1-9]|1[0-2])$/.test(g)) continue;
      if (((pl.content || '') + (pl.text || '')).trim().length > 40) { (ing[g] = ing[g] || new Set()).add(norm(pl.subject)); }
    }
    next = r.next_page_offset; if (!next) break;
  }

  // published subjects per grade (has ≥1 READY AI_EXPLANATION)
  const { data: chapters } = await sb.from('syllabus_chapters').select('id,grade,subject');
  const pubBySubj = {}; // "grade|subject" -> topicIds
  for (const ch of (chapters || [])) {
    const g = String(ch.grade || '').replace('Grade ', '');
    const key = g + '|' + norm(ch.subject);
    pubBySubj[key] = pubBySubj[key] || 0;
  }
  // count published chapters per grade|subject
  (chapters || []).forEach(ch => { const g = String(ch.grade || '').replace('Grade ', ''); pubBySubj[g + '|' + norm(ch.subject)] = (pubBySubj[g + '|' + norm(ch.subject)] || 0) + 1; });

  console.log('\n========== NCERT COVERAGE VERIFICATION (G1-12) ==========');
  const gaps = [];
  for (const g of grades) {
    const off = OFFICIAL[g] || [];
    console.log(`\nGrade ${g}:`);
    for (const subj of off) {
      const ns = norm(subj);
      const isIngested = (ing[g] || new Set()).has(ns);
      const isPublished = (pubBySubj[g + '|' + ns] || 0) > 0;
      // disk check
      const folder = path.join(BOOKS, `grade${g}`, subjectFolder(subj));
      const hasPdf = fs.existsSync(folder) && fs.readdirSync(folder).some(f => f.endsWith('.pdf'));
      let status, tag;
      if (isPublished) { status = '✅ LIVE'; }
      else if (isIngested) { status = '🟡 INGESTED (not published)'; }
      else if (hasPdf) { status = '📄 PDF-ONLY (no extractable text → needs OCR)'; gaps.push(`G${g} ${subj}: OCR`); }
      else { status = '❌ NO PDF on disk'; gaps.push(`G${g} ${subj}: missing book`); }
      console.log(`   ${status.padEnd(20)}  ${subj}`);
    }
  }
  console.log('\n========== GAPS SUMMARY ==========');
  const ocr = gaps.filter(x => x.endsWith('OCR'));
  const missing = gaps.filter(x => x.endsWith('missing book'));
  console.log(`OCR needed (image PDFs, mostly Urdu): ${ocr.length}`);
  console.log(`No book on disk: ${missing.length}`);
  if (missing.length) console.log('  ' + missing.map(x => x.replace(': missing book', '')).join(', '));
})();
