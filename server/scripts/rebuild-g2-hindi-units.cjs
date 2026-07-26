/**
 * rebuild-g2-hindi-units.cjs — one-off correction for Grade 2 Hindi (Sarangi).
 *
 * The earlier G1/G2 structural rebuild (rebuild-g1g2-units.cjs) trusted the
 * auto-extracted curriculum JSON, which flattened this book's 25 chapters
 * into 25 fake top-level "units" and, for a few of them, wrote the chapter's
 * TYPE LABEL ("सुनें कहानी!" / "Listen to story") as if it were the title.
 *
 * The real book has 5 Units, each containing several chapters, confirmed by
 * visually reading every chapter's opening page (data/ncert_books/grade2/hindi/
 * bhsr101.pdf .. bhsr125.pdf) — the page banner prints "इकाई N: <name>" at
 * the start of a unit and the chapter's own title beside its number banner.
 *
 *   Unit 1 परिवार:        ch1 चित्र और बातचीत, ch2 घर, ch3 माला की चाँदी की पायल,
 *                          ch4 माँ, ch5 थाथू और मैं, ch6 चींटा, ch7 टिल्लू जी
 *   Unit 2 रंग ही रंग:     ch8 तीन दोस्त, ch9 दुनिया रंग-बिरंगी, ch10 कौन,
 *                          ch11 बैंगनी जोजो, ch12 तोसिया का सपना
 *   Unit 3 हरी-भरी धरती:   ch13 चित्र और बातचीत, ch14 बीज, ch15 किसान,
 *                          ch16 मूली, ch17 बरसात और मेंढक
 *   Unit 4 मित्रता:        ch18 शेर और चूहे की दोस्ती, ch19 आउट,
 *                          ch20 छुपन-छुपाई, ch21 हाथी साइकिल चला रहा था
 *   Unit 5 आकाश:          ch22 चार दिशाएँ, ch23 चंदा मामा,
 *                          ch24 गिरे ताल में चंदा मामा, ch25 सबसे बड़ा छाता
 *
 * The two existing "real" content rows both carry the mislabeled title
 * "सुनें कहानी!" and were generated against that wrong grounding — they are
 * discarded, not carried over, since content grounded in a type label rather
 * than the actual chapter is not trustworthy.
 *
 *   node scripts/rebuild-g2-hindi-units.cjs            # dry run
 *   node scripts/rebuild-g2-hindi-units.cjs --apply
 */
require('dotenv').config();
const APPLY = process.argv.includes('--apply');

const UNITS = [
  { unitNo: 1, title: 'परिवार', chapters: [
    'चित्र और बातचीत', 'घर', 'माला की चाँदी की पायल', 'माँ', 'थाथू और मैं', 'चींटा', 'टिल्लू जी',
  ] },
  { unitNo: 2, title: 'रंग ही रंग', chapters: [
    'तीन दोस्त', 'दुनिया रंग-बिरंगी', 'कौन', 'बैंगनी जोजो', 'तोसिया का सपना',
  ] },
  { unitNo: 3, title: 'हरी-भरी धरती', chapters: [
    'चित्र और बातचीत', 'बीज', 'किसान', 'मूली', 'बरसात और मेंढक',
  ] },
  { unitNo: 4, title: 'मित्रता', chapters: [
    'शेर और चूहे की दोस्ती', 'आउट', 'छुपन-छुपाई', 'हाथी साइकिल चला रहा था',
  ] },
  { unitNo: 5, title: 'आकाश', chapters: [
    'चार दिशाएँ', 'चंदा मामा', 'गिरे ताल में चंदा मामा', 'सबसे बड़ा छाता',
  ] },
];

(async () => {
  const sb = require('../services/supabase');
  const GRADE = 'Grade 2', SUBJECT = 'Hindi';

  const { data: oldChapters } = await sb.from('syllabus_chapters').select('id').eq('grade', GRADE).eq('subject', SUBJECT);
  const oldIds = (oldChapters || []).map(c => c.id);
  console.log(`existing rows: ${oldIds.length}`);

  if (APPLY && oldIds.length) {
    const { data: oldTopics } = await sb.from('syllabus_topics').select('id').in('chapter_id', oldIds);
    const oldTopicIds = (oldTopics || []).map(t => t.id);
    if (oldTopicIds.length) {
      await sb.from('topic_resources').delete().in('topic_id', oldTopicIds);
      await sb.from('syllabus_topics').delete().in('id', oldTopicIds);
    }
    await sb.from('syllabus_chapters').delete().in('id', oldIds);
  }
  console.log('deleted old rows');

  let totalChapters = 0, totalTopics = 0;
  for (const unit of UNITS) {
    let chapterId = null;
    if (APPLY) {
      const { data: chRow, error } = await sb.from('syllabus_chapters').insert({
        grade: GRADE, subject: SUBJECT, curriculum: 'CBSE', unit_no: unit.unitNo, title: unit.title,
      }).select('id').single();
      if (error) { console.error(`FAILED unit ${unit.unitNo}:`, error.message); continue; }
      chapterId = chRow.id;
    }
    totalChapters++;
    console.log(`Unit ${unit.unitNo}: ${unit.title}  (${unit.chapters.length} chapters)`);

    let order = 0;
    for (const name of unit.chapters) {
      order++;
      if (APPLY) {
        const { error } = await sb.from('syllabus_topics').insert({
          chapter_id: chapterId, name, kind: 'Topic', topic_order: order, content_origin: 'official_textbook',
        });
        if (error) console.error(`  FAILED topic insert (${name}):`, error.message);
      }
      totalTopics++;
    }
  }

  console.log(`\nTOTAL: ${totalChapters} units, ${totalTopics} chapters${APPLY ? '' : '\n[dry run — pass --apply to write]'}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
