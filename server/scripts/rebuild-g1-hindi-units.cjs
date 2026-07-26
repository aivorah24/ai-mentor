/**
 * rebuild-g1-hindi-units.cjs — build Grade 1 Hindi from scratch.
 *
 * There was previously no real Grade 1 Hindi book anywhere in this project
 * (no PDF, no source JSON) — the 4 existing syllabus_chapters rows
 * ("Matching Pictures and Words", "Simple Hindi Words", "Swar and Vyanjan",
 * "Hindi Rhymes and Stories") were fabricated, not extracted from a real
 * textbook, and are discarded here rather than migrated.
 *
 * The real book — Sarangi Bhag 1 (NCERT code ahsr1) — was downloaded
 * directly from ncert.nic.in and every chapter's opening page was read
 * visually to build this map; nothing here is guessed.
 *
 *   node scripts/rebuild-g1-hindi-units.cjs            # dry run
 *   node scripts/rebuild-g1-hindi-units.cjs --apply
 */
require('dotenv').config();
const APPLY = process.argv.includes('--apply');

const UNITS = [
  { unitNo: 1, title: 'परिवार', chapters: [
    'चित्र और बातचीत', 'दादा-दादी', 'रीना का दिन', 'रानी भी',
  ] },
  { unitNo: 2, title: 'जीव-जगत', chapters: [
    'मुर्गा बोला कुकड़ू-कूँ', 'तीन साथी', 'वाह, मेरे घोड़े!', 'खतरे में साँप',
  ] },
  { unitNo: 3, title: 'हमारा खान-पान', chapters: [
    'आलू की सड़क', 'झूलम-झूली', 'भुट्टे', 'फूली रोटी',
  ] },
  { unitNo: 4, title: 'त्योहार और मेले', chapters: [
    'मेला', 'बरखा और मेघा', 'होली', 'जन्मदिवस पर पेड़ लगाओ',
  ] },
  { unitNo: 5, title: 'हरी-भरी दुनिया', chapters: [
    'हवा', 'कितनी प्यारी है ये दुनिया', 'चाँद का बच्चा',
  ] },
];

(async () => {
  const sb = require('../services/supabase');
  const GRADE = 'Grade 1', SUBJECT = 'Hindi';

  const { data: oldChapters } = await sb.from('syllabus_chapters').select('id').eq('grade', GRADE).eq('subject', SUBJECT);
  const oldIds = (oldChapters || []).map(c => c.id);
  console.log(`existing (fabricated) rows: ${oldIds.length}`);

  if (APPLY && oldIds.length) {
    const { data: oldTopics } = await sb.from('syllabus_topics').select('id').in('chapter_id', oldIds);
    const oldTopicIds = (oldTopics || []).map(t => t.id);
    if (oldTopicIds.length) {
      await sb.from('topic_resources').delete().in('topic_id', oldTopicIds);
      await sb.from('syllabus_topics').delete().in('id', oldTopicIds);
    }
    await sb.from('syllabus_chapters').delete().in('id', oldIds);
  }
  console.log('deleted fabricated rows');

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
