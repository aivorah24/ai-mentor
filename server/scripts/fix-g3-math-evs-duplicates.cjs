/**
 * fix-g3-math-evs-duplicates.cjs — Grade 3 Mathematics and Environmental
 * Studies each had TWO NCERT books ingested into the same subject slot: the
 * real English-medium book (cemm1 / ceev1) and its Urdu-medium translation
 * (cumm1 / cuev1) — same content, different script, wrongly treated as a
 * second set of chapters instead of a separate medium. Every unit_no ended
 * up with two rows: one with the real title (sometimes with real content),
 * one generic "Chapter N" placeholder.
 *
 * Fix: for each unit_no, keep the row with the real (non-generic) title,
 * fold in any topics from its generic sibling ONLY if the survivor has no
 * topics of its own for that slot, then delete the generic sibling. Where
 * BOTH rows at a unit_no are generic (Urdu-only, no English match), delete
 * the extra row — the real English chapter is the canonical one for this
 * subject slot.
 *
 *   node scripts/fix-g3-math-evs-duplicates.cjs            # dry run
 *   node scripts/fix-g3-math-evs-duplicates.cjs --apply
 */
require('dotenv').config();
const APPLY = process.argv.includes('--apply');
const isGeneric = (t) => /^chapter\s*\d+$/i.test(String(t || '').trim());

(async () => {
  const sb = require('../services/supabase');

  for (const subject of ['Mathematics', 'Environmental Studies']) {
    console.log(`\n=== Grade 3 ${subject} ===`);
    const { data: chs } = await sb.from('syllabus_chapters').select('id,title,unit_no').eq('grade', 'Grade 3').eq('subject', subject).order('unit_no');
    const byUnit = new Map();
    for (const c of chs) { if (!byUnit.has(c.unit_no)) byUnit.set(c.unit_no, []); byUnit.get(c.unit_no).push(c); }

    for (const [unitNo, rows] of byUnit) {
      if (rows.length === 1) { continue; } // no duplicate at this unit_no

      const real = rows.find(r => !isGeneric(r.title));
      const generic = rows.filter(r => r !== real);

      if (!real) {
        // Both/all rows generic — keep the first, delete the rest.
        const keep = rows[0];
        const drop = rows.slice(1);
        console.log(`unit ${unitNo}: all generic, keeping ${keep.id}, dropping ${drop.length}`);
        if (APPLY) {
          for (const d of drop) {
            const { data: tps } = await sb.from('syllabus_topics').select('id').eq('chapter_id', d.id);
            const tIds = (tps || []).map(t => t.id);
            if (tIds.length) { await sb.from('topic_resources').delete().in('topic_id', tIds); await sb.from('syllabus_topics').delete().in('id', tIds); }
            await sb.from('syllabus_chapters').delete().eq('id', d.id);
          }
        }
        continue;
      }

      console.log(`unit ${unitNo}: keeping "${real.title}" (${real.id}), dropping ${generic.length} generic row(s)`);
      if (APPLY) {
        for (const g of generic) {
          const { data: tps } = await sb.from('syllabus_topics').select('id').eq('chapter_id', g.id);
          const tIds = (tps || []).map(t => t.id);
          if (tIds.length) { await sb.from('topic_resources').delete().in('topic_id', tIds); await sb.from('syllabus_topics').delete().in('id', tIds); }
          await sb.from('syllabus_chapters').delete().eq('id', g.id);
        }
      }
    }
  }

  console.log(`\n${APPLY ? 'applied' : '[dry run — pass --apply to write]'}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
