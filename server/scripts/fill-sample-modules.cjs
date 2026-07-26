/**
 * fill-sample-modules.cjs — give every remaining empty chapter a clearly
 * labelled SAMPLE module, so no chapter renders as an empty container.
 *
 * Used only where real generation cannot run: the book text is too sparse to
 * ground a lesson (the picture-led G1-G5 readers) or the source PDF was never
 * shipped (Grade 11 English "Hornbill" is absent from both disk and Supabase).
 *
 * Everything written here is marked `isSample: true` and carries a visible
 * on-screen banner — "Interactive Practice Module — Sample Lesson". That label
 * is the whole point: a placeholder a viewer can identify is honest, while an
 * invented lesson dressed as NCERT content is not. The chapter title, number and
 * book path still come from the real textbook map, so the structure around the
 * sample is genuine.
 *
 *   node scripts/fill-sample-modules.cjs --grades 1,2,3 [--dry]
 */
require('dotenv').config();
const sb = require('../services/supabase');
const syllabus = require('../services/syllabus-map');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', '') || '').split(',').map(n => parseInt(n, 10)).filter(Boolean);
const DRY = process.argv.includes('--dry');

const SAMPLE_BANNER = 'Interactive Practice Module — Sample Lesson';

function sampleLesson({ grade, subject, chapterTitle, chapterNo, bookPath }) {
  return {
    instructionalType: 'Sample',
    grade: Number(grade),
    subject,
    isSample: true,                       // read by the UI to show the banner
    sampleLabel: SAMPLE_BANNER,
    chapterTitle,
    pdfFile: bookPath ? bookPath.split('/').pop() : undefined,
    bookPath: bookPath || undefined,
    intro: `${SAMPLE_BANNER}. This is a preview placeholder for “${chapterTitle}” `
      + `(Chapter ${chapterNo}, Grade ${grade} ${subject}). The full lesson is being prepared from the NCERT textbook.`,
    keyLearnings: [
      `Open the original ${subject} textbook pages for Chapter ${chapterNo}`,
      'Practise with the questions printed in the chapter',
      'Ask Aivorah about anything in this chapter',
    ],
    whatYoullLearn: [`What Chapter ${chapterNo}, “${chapterTitle}”, covers in your textbook`],
    body: [
      `${SAMPLE_BANNER}.`,
      `This chapter — “${chapterTitle}” — is part of the Grade ${grade} ${subject} syllabus, and its pages are `
      + `available in the textbook viewer beside this panel.`,
      'A full guided lesson for this chapter has not been written yet. Until then, read the chapter in the book '
      + 'and use Ask Aivorah for anything you want explained.',
    ],
    thinkAndReflect: [`After reading Chapter ${chapterNo}, what is the one idea you would explain to a friend?`],
    keyTakeaways: [`Chapter ${chapterNo}: ${chapterTitle} — read it in the textbook panel.`],
    activity: 'Read the chapter in the book viewer, then ask Aivorah one question about it.',
  };
}

(async () => {
  if (!GRADES.length) { console.error('usage: --grades 1,2,3 [--dry]'); process.exit(1); }
  let created = 0, skipped = 0, failed = 0;

  for (const grade of GRADES) {
    // Create chapter rows for any subject the textbook map knows about but the
    // database has never seen. Hindi, Urdu and Sanskrit have books on disk yet
    // no published content, so without this they have no rows to fill and the
    // subject stays invisible instead of showing its chapters.
    const { data: existing0 } = await sb.from('syllabus_chapters').select('subject,title').eq('grade', `Grade ${grade}`);
    const haveBySubject = {};
    for (const c of existing0 || []) (haveBySubject[c.subject] = haveBySubject[c.subject] || new Set()).add(c.title);

    for (const subject of syllabus.subjectsFor(grade)) {
      for (const rec of syllabus.chaptersFor(grade, subject)) {
        if (haveBySubject[subject] && haveBySubject[subject].has(rec.title)) continue;
        if (!DRY) {
          await sb.from('syllabus_chapters').insert({
            grade: `Grade ${grade}`, subject, curriculum: 'CBSE',
            unit_no: rec.chapter, title: rec.title,
          });
        }
        (haveBySubject[subject] = haveBySubject[subject] || new Set()).add(rec.title);
      }
    }

    const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title,unit_no').eq('grade', `Grade ${grade}`);
    const bySubject = {};
    for (const c of chs || []) (bySubject[c.subject] = bySubject[c.subject] || []).push(c);

    for (const [subject, rows] of Object.entries(bySubject)) {
      const mapped = syllabus.chaptersFor(grade, subject);
      for (const row of rows) {
        // A chapter counts as filled only when a topic has a READY lesson behind
        // it. Checking for a topic alone was wrong: an earlier run left topic
        // rows whose resource insert had failed, and those orphans then made
        // this script skip the very chapters it needed to fix.
        const { data: tps } = await sb.from('syllabus_topics').select('id').eq('chapter_id', row.id);
        const topicIds = (tps || []).map(t => t.id);
        let hasLesson = false;
        if (topicIds.length) {
          const { data: res } = await sb.from('topic_resources')
            .select('topic_id').eq('resource_type', 'AI_EXPLANATION').eq('status', 'READY').in('topic_id', topicIds);
          hasLesson = (res || []).length > 0;
        }
        if (hasLesson) { skipped++; continue; }

        // Reuse an orphan topic rather than adding a second one for the chapter.
        const orphanId = topicIds[0];

        const rec = mapped.find(m => m.title === row.title) || mapped.find(m => m.chapter === row.unit_no);
        const payload = sampleLesson({
          grade, subject,
          chapterTitle: row.title,
          chapterNo: row.unit_no || (rec && rec.chapter) || 1,
          bookPath: rec && rec.bookPath,
        });

        if (!DRY) {
          let tp = orphanId ? { id: orphanId } : null, tpErr = null;
          if (!tp) ({ data: tp, error: tpErr } = await sb.from('syllabus_topics')
            .insert({
              chapter_id: row.id, topic_order: 1, name: row.title,
              // `content_origin` and `kind` are CHECK-constrained columns —
              // 'sample_placeholder'/'Sample' are rejected outright, and the
              // failure is silent unless the error is read. The sample nature is
              // carried by the payload's isSample flag and the resource's
              // source_tier instead.
              kind: 'Lesson', intro: payload.intro, content_origin: 'ai_generated',
            }).select('id').single());
          if (tpErr) { failed++; if (failed <= 3) console.error('  topic insert failed:', tpErr.message); }
          if (tp) {
            const { error: resErr } = await sb.from('topic_resources').insert({
              topic_id: tp.id, resource_type: 'AI_EXPLANATION', status: 'READY',
              source_tier: 'PLACEHOLDER', source: 'Sample module (no lesson generated yet)',
              static_payload: payload,
            });
            if (resErr) { failed++; if (failed <= 3) console.error('  resource insert failed:', resErr.message); }
            else created++;
          }
        }
      }
    }
    console.log(`G${grade}: ${created} sample module(s) created, ${skipped} chapter(s) already had content${DRY ? ' [DRY]' : ''}`);
  }
  console.log(`\nTOTAL sample modules: ${created}${DRY ? ' [DRY]' : ''}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
