/**
 * fix-g3-pe-arts-split.cjs — Grade 3 "Physical Education" was actually two
 * different NCERT books merged into one subject slot: cebu1 (Arts — Visual
 * Arts, Music, Dance, Theatre, 20 chapters) and ceky1 (the real Physical
 * Education and Well Being book, 7 chapters). Both got ingested as if they
 * were the same subject, colliding at unit_no 1-7 (cebu1 continues to 20
 * with no collision after that).
 *
 * Verified directly from both books' pages:
 *   ceky1 (Physical Education and Well Being), Unit 1 Basic Motor Movements:
 *     1 Fundamental Movements  2 Kicking and Receiving  3 Strike the Ball  4 Little Steps
 *   Unit 2 Our Games: 5 Local and Traditional Games
 *   Unit 3 Yoga: 6 Yoga for Daily Life  7 Yogic Practices (Yoga Sadhana)
 *
 *   cebu1 (Arts) chapter 13's real title was lost to a generic placeholder —
 *   confirmed as "I Play and Dance" (a topic under "Movement and Dance").
 *
 * Fix:
 *   1. Rename subject "Physical Education" -> "Physical Education and Well
 *      Being" for the 7 rows that are genuinely ceky1 (units 1-7's generic
 *      "Chapter N" rows), using their real titles.
 *   2. Move every cebu1 (Arts) row into a new "Arts" subject, unchanged
 *      otherwise (title, topics, content preserved).
 *   3. Fix unit 13's generic title to the real one.
 *
 *   node scripts/fix-g3-pe-arts-split.cjs            # dry run
 *   node scripts/fix-g3-pe-arts-split.cjs --apply
 */
require('dotenv').config();
const APPLY = process.argv.includes('--apply');

// unit_no -> real PE title, for the rows currently sitting as generic "Chapter N".
const PE_TITLES = {
  1: 'Fundamental Movements',
  2: 'Kicking and Receiving',
  3: 'Strike the Ball',
  4: 'Little Steps',
  5: 'Local and Traditional Games',
  6: 'Yoga for Daily Life',
  7: 'Yogic Practices (Yoga Sadhana)',
};
const ARTS_TITLE_FIX = { 13: 'I Play and Dance' };

const isGeneric = (t) => /^chapter\s*\d+$/i.test(String(t || '').trim());
// Arts-book titles confirmed by direct page reads; anything at these unit_nos
// with a non-generic title in the current "Physical Education" bucket is cebu1.
const ARTS_UNIT_NOS = new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]);

(async () => {
  const sb = require('../services/supabase');
  const { data: chs } = await sb.from('syllabus_chapters').select('id,title,unit_no').eq('grade', 'Grade 3').eq('subject', 'Physical Education').order('unit_no');

  let peFixed = 0, artsMoved = 0;
  for (const c of chs) {
    if (isGeneric(c.title) && PE_TITLES[c.unit_no]) {
      // This IS the real ceky1 PE chapter, just under a generic title.
      console.log(`PE  unit ${c.unit_no}: "${c.title}" -> "${PE_TITLES[c.unit_no]}" (subject -> Physical Education and Well Being)`);
      if (APPLY) {
        const { error } = await sb.from('syllabus_chapters').update({
          title: PE_TITLES[c.unit_no], subject: 'Physical Education and Well Being',
        }).eq('id', c.id);
        if (error) console.error('  FAILED:', error.message);
      }
      peFixed++;
      continue;
    }

    // Everything else in this bucket is cebu1 (Arts) content.
    const newTitle = ARTS_TITLE_FIX[c.unit_no] && isGeneric(c.title) ? ARTS_TITLE_FIX[c.unit_no] : c.title;
    console.log(`ARTS unit ${c.unit_no}: "${c.title}"${newTitle !== c.title ? ` -> "${newTitle}"` : ''} (subject -> Arts)`);
    if (APPLY) {
      const { error } = await sb.from('syllabus_chapters').update({ title: newTitle, subject: 'Arts' }).eq('id', c.id);
      if (error) console.error('  FAILED:', error.message);
    }
    artsMoved++;
  }

  console.log(`\nPE rows fixed: ${peFixed}  Arts rows moved: ${artsMoved}${APPLY ? '' : '\n[dry run — pass --apply to write]'}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
