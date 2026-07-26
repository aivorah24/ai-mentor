// batch-list-topics.cjs — the QUALITY-GATED worklist for the G1-12 batch.
// Emits only topics that are safe to generate a real lesson from:
//   1. Subject must be OFFICIAL NCERT for that grade (ncert-official-subjects.json)
//   2. Topic must be a REAL named lesson — NOT a raw book-code stub (aejm101,
//      bejm106, cemm109 … = <letter><digits>) which have no title/content.
//   3. Topic must have actual grounded TEXT in Qdrant (empty stubs are skipped).
//
//   node scripts/batch-list-topics.cjs <grade>   e.g. 1
require('dotenv').config();
const q = require('../services/qdrant');
const OFFICIAL = require('./ncert-official-subjects.json').byGrade;

const isCodeStub = (t) => /^[a-z]{3,5}\d{2,4}$/i.test(String(t || '').trim());

(async () => {
  const grade = process.argv[2];
  if (!grade) { console.error('usage: batch-list-topics.cjs <grade>'); process.exit(1); }
  const allowed = (OFFICIAL[String(grade)] || []).map(s => s.toLowerCase());
  const norm = s => (s || '').toLowerCase() === 'evs' ? 'environmental studies' : (s || '').toLowerCase();

  // Collect {subject -> {topic -> hasText}} for this grade from the NCERT collection.
  const map = {};
  let next = null;
  for (let i = 0; i < 80; i++) {
    const r = await q.client.scroll(q.COLLECTION, { limit: 250, offset: next, with_payload: true, with_vector: false });
    for (const p of (r.points || [])) {
      const pl = p.payload || {};
      const g = String(pl.grade || '').replace('Grade ', '').replace('Class ', '');
      const gn = { I: '1', II: '2', III: '3' }[g] || g;
      if (gn !== String(grade)) continue;
      const subj = pl.subject || '';
      if (!allowed.includes(norm(subj))) continue;         // gate 1: official subject
      const topic = pl.topic || '';
      if (!topic || isCodeStub(topic)) continue;           // gate 2: no code stubs
      map[subj] = map[subj] || {};
      map[subj][topic] = map[subj][topic] || false;
      // ingestion writes `content`; older data uses `text` — accept either.
      if (((pl.content || '') + (pl.text || '')).trim().length > 40) map[subj][topic] = true; // gate 3: real text
    }
    next = r.next_page_offset; if (!next) break;
  }

  const worklist = [];
  for (const [subject, topics] of Object.entries(map)) {
    for (const [topic, hasText] of Object.entries(topics)) {
      if (hasText) worklist.push({ grade: Number(grade), subject, topic });
    }
  }
  worklist.sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
  console.log(JSON.stringify(worklist, null, 1));
  console.error(`\n[batch] Grade ${grade}: ${worklist.length} generatable topics (official subject + real title + grounded text).`);
})();
