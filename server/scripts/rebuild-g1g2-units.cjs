/**
 * rebuild-g1g2-units.cjs — fix the Grade 1 / Grade 2 chapter structure.
 *
 * Root cause: Grade 1/2 NCERT books are genuinely two levels (Unit -> Topic,
 * e.g. Unit "My Family and Me" directly containing the poem "Two Little
 * Hands" and the lesson "Greetings"). The app's schema is three levels
 * (Chapter -> Topic). Whatever first ingested these grades forced the shape
 * by promoting every individual topic into its own fake "Chapter" row,
 * discarding the real Unit grouping and mismatching sibling topics onto the
 * wrong parent along the way (duplicates, 0-subtopic chapters, "Chapter 2
 * contains a topic that belongs to Chapter 4", etc).
 *
 * The source JSONs (server/data/curricula/cbse-grade{1,2}-*-extracted.json)
 * already have the correct Unit -> Topic shape — this is not a re-extraction,
 * just a re-migration from data that was always right.
 *
 * For each (grade, subject) with a source file:
 *   1. Snapshot any REAL (non-sample) generated topic_resources content,
 *      keyed by lowercased topic name, so it survives the rebuild.
 *   2. Delete the existing (broken) chapter/topic/resource rows.
 *   3. Insert one chapter row per Unit (title = unit title, unit_no = unitNo).
 *   4. Insert one topic row per item in that unit, in source order.
 *   5. Reattach any snapshotted real content whose name matches a new topic.
 *   6. Anything left over with no real content gets NOTHING inserted for it —
 *      it stays uncovered until the generation pipeline runs, rather than
 *      getting a fabricated placeholder that looks like real coverage.
 *
 *   node scripts/rebuild-g1g2-units.cjs            # dry run
 *   node scripts/rebuild-g1g2-units.cjs --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CUR_DIR = path.resolve(__dirname, '..', 'data', 'curricula');

const SOURCES = [
  { grade: 1, subject: 'English', file: 'cbse-grade1-english-aemr1-extracted.json' },
  { grade: 1, subject: 'Mathematics', file: 'cbse-grade1-mathematics-aejm1-extracted.json' },
  { grade: 2, subject: 'English', file: 'cbse-grade2-english-bemr1-extracted.json' },
  { grade: 2, subject: 'Hindi', file: 'cbse-grade2-hindi-bhsr1-extracted.json' },
  { grade: 2, subject: 'Mathematics', file: 'cbse-grade2-mathematics-bejm1-extracted.json' },
];
const ALLOWED_KIND = new Set(['Chapter', 'Story', 'Poem', 'Lesson', 'Activity', 'Topic']);

(async () => {
  const sb = require('../services/supabase');
  let totalChapters = 0, totalTopics = 0, totalReattached = 0;

  for (const src of SOURCES) {
    const file = path.join(CUR_DIR, src.file);
    if (!fs.existsSync(file)) { console.log(`SKIP G${src.grade} ${src.subject}: source file missing`); continue; }
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const units = doc.units || [];
    if (!units.length) { console.log(`SKIP G${src.grade} ${src.subject}: source has no units`); continue; }

    const gradeLabel = `Grade ${src.grade}`;
    console.log(`\n== G${src.grade} ${src.subject} (${src.file}) — ${units.length} units ==`);

    // 1. Snapshot real content by topic name.
    const { data: oldChapters } = await sb.from('syllabus_chapters').select('id').eq('grade', gradeLabel).eq('subject', src.subject);
    const oldChapterIds = (oldChapters || []).map(c => c.id);
    const realByName = new Map();
    if (oldChapterIds.length) {
      const { data: oldTopics } = await sb.from('syllabus_topics').select('id,name').in('chapter_id', oldChapterIds);
      for (const t of oldTopics || []) {
        const { data: res } = await sb.from('topic_resources').select('resource_type,status,static_payload,source_tier')
          .eq('topic_id', t.id).eq('resource_type', 'AI_EXPLANATION').maybeSingle();
        if (res && !res.static_payload?.isSample && res.source_tier !== 'PLACEHOLDER') {
          realByName.set(String(t.name || '').trim().toLowerCase(), res);
        }
      }
    }
    console.log(`  real content snapshotted: ${realByName.size} topic(s)`);

    // 2. Delete broken rows.
    if (APPLY && oldChapterIds.length) {
      const { data: oldTopics } = await sb.from('syllabus_topics').select('id').in('chapter_id', oldChapterIds);
      const oldTopicIds = (oldTopics || []).map(t => t.id);
      if (oldTopicIds.length) {
        await sb.from('topic_resources').delete().in('topic_id', oldTopicIds);
        await sb.from('syllabus_topics').delete().in('id', oldTopicIds);
      }
      await sb.from('syllabus_chapters').delete().in('id', oldChapterIds);
    }
    console.log(`  deleted: ${oldChapterIds.length} old chapter row(s)`);

    // 3-5. Insert clean Unit -> Topic structure.
    let reattached = 0;
    for (const unit of units) {
      let chapterId = null;
      if (APPLY) {
        const { data: chRow, error: chErr } = await sb.from('syllabus_chapters').insert({
          grade: gradeLabel, subject: src.subject, curriculum: 'CBSE',
          unit_no: unit.unitNo, title: unit.title,
        }).select('id').single();
        if (chErr) { console.error(`  FAILED chapter insert (unit ${unit.unitNo}): ${chErr.message}`); continue; }
        chapterId = chRow.id;
      }
      totalChapters++;
      console.log(`  Unit ${unit.unitNo}: ${unit.title}  (${(unit.topics || []).length} topics)`);

      let order = 0;
      for (const topic of unit.topics || []) {
        order++;
        const kind = ALLOWED_KIND.has(topic.kind) ? topic.kind : 'Topic';
        let topicId = null;
        if (APPLY) {
          const { data: tRow, error: tErr } = await sb.from('syllabus_topics').insert({
            chapter_id: chapterId, name: topic.name, kind, topic_order: order,
            page: topic.page ?? null, content_origin: 'official_textbook',
          }).select('id').single();
          if (tErr) { console.error(`    FAILED topic insert (${topic.name}): ${tErr.message}`); continue; }
          topicId = tRow.id;
        }
        totalTopics++;

        const real = realByName.get(String(topic.name || '').trim().toLowerCase());
        if (real) {
          reattached++; totalReattached++;
          console.log(`    reattaching real content -> "${topic.name}"`);
          if (APPLY && topicId) {
            await sb.from('topic_resources').insert({
              topic_id: topicId, resource_type: 'AI_EXPLANATION', status: real.status || 'READY',
              static_payload: real.static_payload, source_tier: real.source_tier || 'ORIGINAL_AI',
            });
          }
        }
      }
    }
    console.log(`  content reattached: ${reattached}/${realByName.size}`);
  }

  console.log(`\nTOTAL: ${totalChapters} chapters, ${totalTopics} topics, ${totalReattached} real-content reattachments${APPLY ? '' : '\n[dry run — pass --apply to write]'}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
