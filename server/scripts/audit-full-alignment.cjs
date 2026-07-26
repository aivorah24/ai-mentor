/**
 * audit-full-alignment.cjs — for every EXISTING (grade, subject) in the DB,
 * checks four things per chapter:
 *   1. Title real (not generic "Chapter N")
 *   2. No unit_no collisions (duplicate chapters at the same slot)
 *   3. Book linked (bookPath set in syllabus-map AND the PDF exists on disk)
 *   4. Content real per topic (not placeholder/sample/none) + "audio-ready"
 *      (Listen uses live browser TTS off listenParts/readText in the same
 *      payload — there is no separate audio asset to check; a topic with
 *      real content and a non-empty listenParts array IS audio-ready)
 *
 *   node scripts/audit-full-alignment.cjs [--grades 1,2,3]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', '1,2,3,4,5,6,7,8,9,10,11,12') || '').split(',').map(Number).filter(Boolean);
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');
function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

(async () => {
  const sb = require('../services/supabase');
  const syllabus = require('../services/syllabus-map');
  const rows = [];

  for (const g of GRADES) {
    const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title,unit_no').eq('grade', `Grade ${g}`);
    if (!chs || !chs.length) continue;
    const bySubject = new Map();
    for (const c of chs) { if (!bySubject.has(c.subject)) bySubject.set(c.subject, []); bySubject.get(c.subject).push(c); }

    for (const [subject, list] of bySubject) {
      const genericTitles = list.filter(c => /^chapter\s*\d+$/i.test(String(c.title || '').trim())).length;
      const unitCounts = new Map();
      for (const c of list) unitCounts.set(c.unit_no, (unitCounts.get(c.unit_no) || 0) + 1);
      const collisions = [...unitCounts.values()].filter(n => n > 1).length;

      // Book-linked check via syllabus-map + disk.
      const mapRecs = syllabus.chaptersFor(g, subject) || [];
      let bookLinked = 0, bookMissing = 0;
      for (const rec of mapRecs) {
        if (rec.bookPath && fs.existsSync(path.join(BOOKS, rec.bookPath))) bookLinked++;
        else bookMissing++;
      }

      // Content + audio-readiness per topic.
      const chIds = list.map(c => c.id);
      let topics = [];
      for (const batch of chunks(chIds, 80)) {
        const { data } = await sb.from('syllabus_topics').select('id').in('chapter_id', batch);
        topics.push(...(data || []));
      }
      let realContent = 0, audioReady = 0;
      const topicIds = topics.map(t => t.id);
      for (const batch of chunks(topicIds, 80)) {
        const { data } = await sb.from('topic_resources').select('static_payload,source_tier').eq('resource_type', 'AI_EXPLANATION').in('topic_id', batch);
        for (const r of data || []) {
          const isReal = !r.static_payload?.isSample && r.source_tier !== 'PLACEHOLDER';
          if (isReal) {
            realContent++;
            // Listen has three tiers (LessonScreen.tsx): listenParts, then
            // workedExamples (Math), then a generic intro+body+activity
            // fallback — so any topic with intro+body IS audio-ready, not
            // only ones with an explicit listenParts array.
            const p = r.static_payload || {};
            const audioCapable = (Array.isArray(p.listenParts) && p.listenParts.length > 0)
              || (Array.isArray(p.workedExamples) && p.workedExamples.length > 0)
              || (!!p.intro && Array.isArray(p.body) && p.body.length > 0);
            if (audioCapable) audioReady++;
          }
        }
      }

      rows.push({
        grade: g, subject,
        chapters: list.length, genericTitles, collisions,
        bookLinked, bookMissing,
        topics: topics.length, realContent, audioReady,
      });
    }
  }

  console.log('\n| Grade | Subject | Chapters | Generic titles | Unit collisions | Book linked | Book missing | Topics | Real content | Audio-ready |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| G${r.grade} | ${r.subject} | ${r.chapters} | ${r.genericTitles} | ${r.collisions} | ${r.bookLinked} | ${r.bookMissing} | ${r.topics} | ${r.realContent} | ${r.audioReady} |`);
  }

  const flagged = rows.filter(r => r.genericTitles > 0 || r.collisions > 0 || r.bookMissing > 0 || r.realContent < r.topics);
  console.log(`\n${rows.length} (grade, subject) pairs checked. ${flagged.length} have at least one issue.`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
