/**
 * semantic-rekey.cjs — place the lessons that lexical matching could not, by
 * comparing MEANING instead of shared words.
 *
 * migrate-chapters.cjs matches a topic to a chapter by substring: the topic name
 * has to contain the chapter title or one of its subtopics. That leaves lessons
 * whose wording never overlaps the syllabus — "Behavior of Terms in Infinite
 * G.P." belongs under Ch 8 Sequences and Series but shares no word with it — so
 * they stayed under the old invented one-topic chapters with unit_no = 1, which
 * is exactly what an evaluator browsing the grade would see.
 *
 * Here each chapter is embedded once as "title + its subtopics", the topic name
 * is embedded, and the best cosine match wins. Embeddings are local (MiniLM), so
 * this costs no API tokens.
 *
 * A match below --min-score is NOT forced onto a chapter: a wrong chapter is a
 * worse outcome than an honest leftover, so those are reported for review.
 *
 *   node scripts/semantic-rekey.cjs --grades 11,12 --dry
 *   node scripts/semantic-rekey.cjs --grades 11,12
 */
require('dotenv').config();
const sb = require('../services/supabase');
const { embed } = require('../services/embeddings');
const syllabus = require('../services/syllabus-map');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', arg('--grade', '')) || '').split(',').map(s => parseInt(s, 10)).filter(Boolean);
const MIN = parseFloat(arg('--min-score', '0.30'));
const DRY = process.argv.includes('--dry');

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

(async () => {
  if (!GRADES.length) { console.error('usage: --grades 11,12 [--dry]'); process.exit(1); }
  const totals = { candidates: 0, rekeyed: 0, lowScore: 0, noChapters: 0, removed: 0 };
  const lowExamples = [], moves = [];

  for (const grade of GRADES) {
    const { data: chs } = await sb.from('syllabus_chapters')
      .select('id,subject,title,unit_no').eq('grade', `Grade ${grade}`);
    if (!chs || !chs.length) continue;

    // Which rows are real NCERT chapters, and which are the leftovers.
    const realBySubject = {};
    const leftovers = [];
    for (const c of chs) {
      const mapped = syllabus.chaptersFor(grade, c.subject).find(x => x.title === c.title);
      if (mapped) {
        (realBySubject[c.subject] = realBySubject[c.subject] || []).push({ row: c, rec: mapped });
      } else {
        leftovers.push(c);
      }
    }

    // Embed each real chapter once: its title plus the subtopics it teaches.
    const vecCache = {};
    for (const [subject, list] of Object.entries(realBySubject)) {
      vecCache[subject] = [];
      for (const item of list) {
        // A placeholder title ("Chapter 1") carries no meaning and drags the
        // chapter's embedding toward every other placeholder, which is why
        // "Average Interest on Drawings" failed to reach Accountancy Ch 1 even
        // though that chapter lists "Maintenance of Capital Accounts of
        // Partners". Where the title is a placeholder, let the subtopics — which
        // are real — carry the comparison alone.
        const useTitle = item.rec.title && !/^chapter\s*\d+$/i.test(item.rec.title);
        const parts = [...(useTitle ? [item.rec.title] : []), ...(item.rec.subtopics || []).map(s => s.title)];
        const text = parts.length ? parts.join('. ') : (item.rec.title || '');
        vecCache[subject].push({ ...item, vec: await embed(`${text} ${subject} grade ${grade}`) });
      }
    }

    const emptied = [];
    for (const c of leftovers) {
      const { data: tps } = await sb.from('syllabus_topics').select('id,name,chapter_id').eq('chapter_id', c.id);
      const pool = vecCache[c.subject] || [];
      if (!pool.length) { totals.noChapters += (tps || []).length; continue; }

      for (const tp of tps || []) {
        totals.candidates++;
        const tv = await embed(`${tp.name} ${c.subject} grade ${grade}`);
        let best = null, bestScore = -1;
        for (const cand of pool) {
          const s = cosine(tv, cand.vec);
          if (s > bestScore) { bestScore = s; best = cand; }
        }
        if (!best || bestScore < MIN) {
          totals.lowScore++;
          if (lowExamples.length < 40) lowExamples.push(`G${grade} ${c.subject} :: ${tp.name} (best ${bestScore.toFixed(3)})`);
          continue;
        }

        // Order within the chapter by the closest subtopic, so units read sensibly.
        let order = 99;
        const subs = best.rec.subtopics || [];
        if (subs.length) {
          let bs = -1;
          for (let i = 0; i < subs.length; i++) {
            const sv = await embed(`${subs[i].title} ${c.subject}`);
            const s = cosine(tv, sv);
            if (s > bs) { bs = s; order = i + 1; }
          }
        }

        if (!DRY) {
          await sb.from('syllabus_topics').update({ chapter_id: best.row.id, topic_order: order }).eq('id', tp.id);
          // Keep the payload's chapter label in step with where it now lives.
          const { data: res } = await sb.from('topic_resources')
            .select('id,static_payload').eq('topic_id', tp.id).eq('resource_type', 'AI_EXPLANATION');
          for (const r of res || []) {
            const p = r.static_payload || {};
            await sb.from('topic_resources').update({
              static_payload: {
                ...p, chapterTitle: best.rec.title,
                pdfFile: best.rec.pdfFile || p.pdfFile,
                bookPath: best.rec.bookPath || p.bookPath,
              },
            }).eq('id', r.id);
          }
        }
        totals.rekeyed++;
        emptied.push(c.id);
        if (moves.length < 25) moves.push(`G${grade} "${tp.name}" → Ch${best.rec.chapter} ${best.rec.title} (${bestScore.toFixed(3)})`);
      }
    }

    // Remove the invented chapter rows that no longer hold anything.
    for (const id of [...new Set(emptied)]) {
      const { data: left } = await sb.from('syllabus_topics').select('id').eq('chapter_id', id).limit(1);
      if (!left || !left.length) {
        if (!DRY) await sb.from('syllabus_chapters').delete().eq('id', id);
        totals.removed++;
      }
    }
    console.log(`G${grade} done — ${JSON.stringify(totals)}${DRY ? ' [DRY]' : ''}`);
  }

  console.log('\nTOTAL', JSON.stringify(totals));
  if (moves.length) { console.log('\nSample re-keys:'); moves.forEach(m => console.log('  ' + m)); }
  if (lowExamples.length) {
    console.log(`\nBelow --min-score ${MIN} — left in place rather than mis-filed:`);
    lowExamples.forEach(x => console.log('  - ' + x));
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
