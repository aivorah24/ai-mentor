/**
 * audit-content-coverage.cjs — accurate per-grade/subject content coverage,
 * batching .in() lookups so large chapter/topic counts don't silently fail
 * against Supabase's URL length limit (the bug that made an earlier ad-hoc
 * check misreport Grade 6 as having 0 topics when it actually has 710).
 *
 * Writes a list of every topic still needing real content to
 * server/data/curricula/ncert_catalog/missing-content-topics.json so the
 * generation pass has one authoritative worklist instead of re-querying.
 *
 *   node scripts/audit-content-coverage.cjs
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

(async () => {
  const sb = require('../services/supabase');
  const grades = Array.from({ length: 12 }, (_, i) => i + 1);
  const perGrade = [];
  const missing = [];

  for (const g of grades) {
    const { data: chs, error: chErr } = await sb.from('syllabus_chapters').select('id,title,subject,unit_no').eq('grade', `Grade ${g}`);
    if (chErr) { console.error(`G${g} chapter fetch failed:`, chErr.message); continue; }
    const chById = new Map((chs || []).map(c => [c.id, c]));
    const chIds = [...chById.keys()];

    let topics = [];
    for (const batch of chunks(chIds, 80)) {
      const { data, error } = await sb.from('syllabus_topics').select('id,name,chapter_id').in('chapter_id', batch);
      if (error) { console.error(`G${g} topic batch failed:`, error.message); continue; }
      topics.push(...(data || []));
    }

    let withContent = 0, withoutContent = 0;
    const topicIds = topics.map(t => t.id);
    const resByTopic = new Map();
    for (const batch of chunks(topicIds, 80)) {
      const { data, error } = await sb.from('topic_resources').select('topic_id,static_payload,source_tier')
        .eq('resource_type', 'AI_EXPLANATION').in('topic_id', batch);
      if (error) { console.error(`G${g} resource batch failed:`, error.message); continue; }
      for (const r of data || []) resByTopic.set(r.topic_id, r);
    }

    for (const t of topics) {
      const res = resByTopic.get(t.id);
      const isReal = res && !res.static_payload?.isSample && res.source_tier !== 'PLACEHOLDER';
      if (isReal) withContent++;
      else {
        withoutContent++;
        const ch = chById.get(t.chapter_id);
        missing.push({ grade: g, subject: ch?.subject, chapterTitle: ch?.title, chapterId: t.chapter_id, topicId: t.id, topicName: t.name });
      }
    }
    perGrade.push({ grade: g, chapters: chIds.length, topics: topics.length, withContent, withoutContent });
    console.log(`G${g}  chapters=${chIds.length}  topics=${topics.length}  withContent=${withContent}  withoutContent=${withoutContent}`);
  }

  console.table(perGrade);
  const totals = perGrade.reduce((a, r) => ({ chapters: a.chapters + r.chapters, topics: a.topics + r.topics, withContent: a.withContent + r.withContent, withoutContent: a.withoutContent + r.withoutContent }), { chapters: 0, topics: 0, withContent: 0, withoutContent: 0 });
  console.log('TOTALS', totals);

  const out = path.resolve(__dirname, '..', 'data', 'curricula', 'ncert_catalog', 'missing-content-topics.json');
  fs.writeFileSync(out, JSON.stringify(missing, null, 1));
  console.log(`\nworklist written: ${out} (${missing.length} topics)`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
