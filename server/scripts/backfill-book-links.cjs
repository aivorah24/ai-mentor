/**
 * backfill-book-links.cjs — give every ALREADY-PUBLISHED lesson its real book
 * link and its real chapter number.
 *
 * Two defects this repairs, both found in a founder audit ("there is no real
 * book PDF; Chapter 2 is completely different"):
 *
 *  1. NO BOOK LINK. Lessons are generated from retrieved NCERT chunks, but the
 *     payload never recorded WHICH chapter, so `pdfFile` was null everywhere and
 *     the "real book" pane had nothing to open. pipeline.cjs now records it, but
 *     only for lessons published after that change — everything already live
 *     still has nothing.
 *
 *  2. FAKE CHAPTER NUMBERS. publish() creates one syllabus_chapters row per
 *     TOPIC with `unit_no` hardcoded to 1, so the app's "Chapter 2" is just the
 *     second row in arbitrary order, unrelated to the textbook's Chapter 2.
 *
 * The mapping is deterministic and needs NO LLM: a chunk's chapter code is the
 * book filename (kemh101 → kemh101.pdf → grade11/mathematics/kemh101.pdf) and
 * its last two digits are the chapter number (101 → Ch 1, 112 → Ch 12). Only
 * local embeddings + Qdrant are used, so this runs while the LLM quota is spent.
 *
 *   node scripts/backfill-book-links.cjs --grade 12 [--dry]
 *   node scripts/backfill-book-links.cjs --grades 6,7,8,9,10,11,12
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sb = require('../services/supabase');
const { embed } = require('../services/embeddings');
const { searchGrounding } = require('../services/qdrant');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', arg('--grade', '')) || '').split(',').map(s => parseInt(s, 10)).filter(Boolean);
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');   // redo lessons that already have a link
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');

// Storage/disk folder for a subject, matching the ncert-books bucket layout.
function subjectFolder(subject) {
  const s = String(subject || '').toLowerCase();
  if (s.includes('math')) return 'mathematics';
  if (s.includes('english')) return 'english';
  if (s.includes('hindi')) return 'hindi';
  if (s.includes('physic')) return 'physics';
  if (s.includes('chemist')) return 'chemistry';
  if (s.includes('biolog')) return 'biology';
  if (s.includes('account')) return 'accountancy';
  if (s.includes('business')) return 'business_studies';
  if (s.includes('econom')) return 'economics';
  if (s.includes('histor')) return 'history';
  if (s.includes('geograph')) return 'geography';
  if (s.includes('political')) return 'political_science';
  if (s.includes('sociolog')) return 'sociology';
  if (s.includes('psycholog')) return 'psychology';
  if (s.includes('computer')) return 'computer_science';
  if (s.includes('social')) return 'social_science';
  if (s.includes('evs') || s.includes('environ')) return 'evs';
  if (s.includes('science')) return 'science';
  return s.replace(/\s+/g, '_');
}

// kemh112 → 12. The trailing two digits are the chapter; the digit before them
// is the book part (Physics I/II), which is already encoded in the filename.
const chapterNo = (code) => {
  const m = String(code || '').match(/(\d{2})$/);
  const n = m ? parseInt(m[1], 10) : 0;
  return n > 0 && n < 40 ? n : null;
};

(async () => {
  if (!GRADES.length) { console.error('usage: --grades 11,12'); process.exit(1); }

  for (const grade of GRADES) {
    const { data: chs } = await sb.from('syllabus_chapters')
      .select('id,subject,title').eq('grade', `Grade ${grade}`);
    if (!chs || !chs.length) { console.log(`G${grade}: no chapters`); continue; }

    let linked = 0, already = 0, noCode = 0, missingPdf = 0, renumbered = 0;

    for (const ch of chs) {
      const { data: tps } = await sb.from('syllabus_topics').select('id,name').eq('chapter_id', ch.id);
      for (const tp of tps || []) {
        const { data: res } = await sb.from('topic_resources')
          .select('id,static_payload').eq('topic_id', tp.id)
          .eq('resource_type', 'AI_EXPLANATION').eq('status', 'READY');
        const row = (res || [])[0];
        if (!row || !row.static_payload) continue;
        const L = row.static_payload;
        if (L.pdfFile && !FORCE) { already++; continue; }

        // Re-run the SAME grounding the generator used, and keep the chapter it hits.
        let codes = [];
        try {
          const vector = await embed(`${tp.name} ${ch.subject} grade ${grade}`);
          const { chunks } = await searchGrounding({
            vector, curriculum: 'NCERT', grade: Number(grade), subject: ch.subject, limit: 6,
          });
          codes = [...new Set((chunks || [])
            .map(c => c?.payload?.topic)
            .filter(c => /^[a-z]{4,6}\d{3}$/i.test(c)))];
        } catch { /* fall through to noCode */ }

        if (!codes.length) { noCode++; continue; }
        const code = codes[0];
        const rel = `grade${grade}/${subjectFolder(ch.subject)}/${code}.pdf`;
        if (!fs.existsSync(path.join(BOOKS, rel))) missingPdf++;   // recorded anyway: Storage may still have it

        const num = chapterNo(code);
        if (!DRY) {
          await sb.from('topic_resources').update({
            static_payload: { ...L, pdfFile: `${code}.pdf`, bookPath: rel, sourceChapters: codes },
          }).eq('id', row.id);
          // Real chapter number, so "Chapter 2" means the book's Chapter 2.
          if (num && num !== ch.unit_no) {
            await sb.from('syllabus_chapters').update({ unit_no: num }).eq('id', ch.id);
            renumbered++;
          }
        }
        linked++;
      }
    }
    console.log(`G${grade}: linked ${linked} · already had ${already} · no chapter code ${noCode} · pdf not on disk ${missingPdf} · renumbered ${renumbered}${DRY ? '  [DRY]' : ''}`);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
