/**
 * migrate-chapters.cjs — re-key EXISTING lessons onto their real NCERT chapters,
 * and give each one its textbook path.
 *
 * publish() used to invent a syllabus_chapters row per generated topic with
 * unit_no hardcoded to 1. The result: Grade 11 Mathematics listed "Area of a
 * Triangle" as a chapter instead of Ch 1 Sets, every unit held exactly one
 * topic, and no lesson recorded which book it came from so the split-screen
 * reader had nothing to open. pipeline.cjs now resolves chapters through
 * services/syllabus-map; this brings already-published content into line.
 *
 * Per lesson:
 *   1. resolve the real chapter (payload.sourceChapters → syllabus map, else
 *      re-run the grounding search, else match the topic against subtopics)
 *   2. move the topic under that chapter (creating it with the right unit_no)
 *   3. write pdfFile + bookPath into the payload for the reader panel
 *   4. delete the leftover empty one-topic chapter row
 *
 * Deterministic and token-free — only local embeddings, Qdrant and the map.
 * Back up first: node -e "..." (see CURRICULUM_FIX_AUDIT_LOG.md).
 *
 *   node scripts/migrate-chapters.cjs --grades 11,12 --dry
 *   node scripts/migrate-chapters.cjs --grades 1,2,3,4,5,6,7,8,9,10,11,12
 */
require('dotenv').config();
const sb = require('../services/supabase');
const { embed } = require('../services/embeddings');
const { searchGrounding } = require('../services/qdrant');
const syllabus = require('../services/syllabus-map');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', arg('--grade', '')) || '').split(',').map(s => parseInt(s, 10)).filter(Boolean);
const DRY = process.argv.includes('--dry');

const stats = { scanned: 0, mapped: 0, moved: 0, linked: 0, unmapped: 0, chaptersRemoved: 0 };
const unmappedExamples = [];

async function resolveFor(grade, subject, topicName, payload) {
  // 1. provenance already recorded by the fixed pipeline
  let rec = syllabus.resolveChapter({
    grade, subject, topic: topicName,
    chapterCodes: Array.isArray(payload?.sourceChapters) ? payload.sourceChapters : [],
  });
  if (rec) return rec;
  // 2. re-run the same grounding the generator used
  try {
    const vector = await embed(`${topicName} ${subject} grade ${grade}`);
    const { chunks } = await searchGrounding({ vector, curriculum: 'NCERT', grade: Number(grade), subject, limit: 6 });
    const codes = [...new Set((chunks || []).map(c => c?.payload?.topic)
      .filter(c => /^[a-z]{4,6}\d{3}$/i.test(c)))];
    rec = syllabus.resolveChapter({ grade, subject, topic: topicName, chapterCodes: codes });
  } catch { /* leave unmapped */ }
  return rec;
}

(async () => {
  if (!GRADES.length) { console.error('usage: --grades 11,12 [--dry]'); process.exit(1); }

  for (const grade of GRADES) {
    const { data: chs } = await sb.from('syllabus_chapters')
      .select('id,subject,title,unit_no').eq('grade', `Grade ${grade}`);
    if (!chs || !chs.length) { console.log(`G${grade}: no chapters`); continue; }

    // Real chapter rows, created on demand and reused across topics.
    const realChapter = new Map();   // "subject|title" → id
    const emptied = [];

    for (const ch of chs) {
      const { data: tps } = await sb.from('syllabus_topics').select('id,name,chapter_id').eq('chapter_id', ch.id);
      for (const tp of tps || []) {
        const { data: res } = await sb.from('topic_resources')
          .select('id,static_payload').eq('topic_id', tp.id)
          .eq('resource_type', 'AI_EXPLANATION').eq('status', 'READY');
        const row = (res || [])[0];
        if (!row) continue;
        stats.scanned++;
        const payload = row.static_payload || {};

        const rec = await resolveFor(grade, ch.subject, tp.name, payload);
        if (!rec) {
          stats.unmapped++;
          if (unmappedExamples.length < 30) unmappedExamples.push(`G${grade} ${ch.subject} :: ${tp.name}`);
          continue;
        }
        stats.mapped++;

        // Ensure the real chapter row exists with the book's own number.
        const key = `${ch.subject}|${rec.title}`;
        let targetId = realChapter.get(key);
        if (!targetId) {
          const { data: found } = await sb.from('syllabus_chapters').select('id')
            .eq('grade', `Grade ${grade}`).eq('subject', ch.subject).eq('title', rec.title).maybeSingle();
          if (found) {
            targetId = found.id;
            if (!DRY) await sb.from('syllabus_chapters').update({ unit_no: rec.chapter }).eq('id', found.id);
          } else if (!DRY) {
            const { data: made } = await sb.from('syllabus_chapters')
              .insert({ grade: `Grade ${grade}`, subject: ch.subject, curriculum: 'CBSE', unit_no: rec.chapter, title: rec.title })
              .select('id').single();
            targetId = made && made.id;
          }
          if (targetId) realChapter.set(key, targetId);
        }

        // Move the topic under the real chapter, in book order.
        if (targetId && targetId !== tp.chapter_id) {
          let order = 99;
          const i = (rec.subtopics || []).findIndex(s =>
            String(tp.name).toLowerCase().includes(String(s.title || '').toLowerCase()));
          if (i >= 0) order = i + 1;
          if (!DRY) await sb.from('syllabus_topics').update({ chapter_id: targetId, topic_order: order }).eq('id', tp.id);
          stats.moved++;
          emptied.push(ch.id);
        }

        // Book link for the split-screen reader.
        if (!payload.pdfFile || !payload.bookPath) {
          if (!DRY) {
            await sb.from('topic_resources').update({
              static_payload: {
                ...payload,
                pdfFile: rec.pdfFile || payload.pdfFile,
                bookPath: rec.bookPath || payload.bookPath,
                chapterTitle: rec.title,
              },
            }).eq('id', row.id);
          }
          stats.linked++;
        }
      }
    }

    // Drop the one-topic placeholder chapters that are now empty.
    for (const id of [...new Set(emptied)]) {
      const { data: left } = await sb.from('syllabus_topics').select('id').eq('chapter_id', id).limit(1);
      if (!left || !left.length) {
        if (!DRY) await sb.from('syllabus_chapters').delete().eq('id', id);
        stats.chaptersRemoved++;
      }
    }
    console.log(`G${grade}: scanned ${stats.scanned} · mapped ${stats.mapped} · moved ${stats.moved} · linked ${stats.linked} · unmapped ${stats.unmapped} · empty chapters removed ${stats.chaptersRemoved}${DRY ? ' [DRY]' : ''}`);
  }

  console.log('\nTOTAL', JSON.stringify(stats));
  if (unmappedExamples.length) {
    console.log('\nUnmapped examples (kept as-is, nothing deleted):');
    unmappedExamples.forEach(x => console.log('  -', x));
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
