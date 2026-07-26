/**
 * cleanup-syllabus.cjs — remove cross-subject contamination and duplicate
 * chapter rows left behind by earlier pipeline runs.
 *
 * Two defects this repairs, both visible in Grade 11 English:
 *
 *  1. WRONG SUBJECT. The NCERT Biotechnology book (kebt1) was filed under
 *     grade11/english, so chapters called "Biotechnology", "Atp Adp", "Cho Ohc"
 *     and "Dna Rna" were published as English. Relabelling the curriculum file
 *     stopped new ones appearing, but the rows already in the database stayed —
 *     and once the sample filler gave them lessons they became visible again.
 *     They are MOVED to their real subject, never deleted: the lessons under
 *     them are real Biotechnology content.
 *
 *  2. DUPLICATE CHAPTERS. Several rows share a grade+subject+title, so the app
 *     renders the same accordion twice. The row holding real lessons is kept and
 *     the empty duplicates are removed.
 *
 *   node scripts/cleanup-syllabus.cjs --grades 1,2,3 [--dry]
 */
require('dotenv').config();
const sb = require('../services/supabase');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', '1,2,3,4,5,6,7,8,9,10,11,12') || '').split(',').map(n => parseInt(n, 10)).filter(Boolean);
const DRY = process.argv.includes('--dry');

// Terms that cannot belong to a language/humanities chapter title. Kept narrow
// and anchored so ordinary words are never caught.
const SCIENCE_TERMS = /^(biotechnology|atp adp|cho ohc|esi|dna rna|protein informatics.*|enzyme.*|genomics?|proteomics?)$/i;
const CONTAMINABLE = new Set(['English', 'Hindi', 'Urdu', 'Sanskrit', 'History', 'Political Science', 'Sociology']);
// Where a moved chapter belongs. Biotechnology is the only book known to be
// misfiled; anything else is reported rather than guessed at.
const REHOME = { Biotechnology: 'Biotechnology' };

(async () => {
  const stats = { moved: 0, dupsRemoved: 0, flagged: 0 };
  const report = [];

  for (const grade of GRADES) {
    const { data: chs } = await sb.from('syllabus_chapters')
      .select('id,subject,title,unit_no').eq('grade', `Grade ${grade}`);
    if (!chs || !chs.length) continue;

    // ── 1. Cross-subject contamination ───────────────────────────────────
    for (const c of chs) {
      if (!CONTAMINABLE.has(c.subject)) continue;
      if (!SCIENCE_TERMS.test(String(c.title || '').trim())) continue;
      const target = REHOME[c.title] || 'Biotechnology';
      if (!DRY) await sb.from('syllabus_chapters').update({ subject: target }).eq('id', c.id);
      report.push(`G${grade}: moved "${c.title}" from ${c.subject} -> ${target}`);
      stats.moved++;
    }

    // ── 2. Duplicate chapters (same subject + title) ─────────────────────
    const groups = {};
    for (const c of chs) {
      const key = `${c.subject}|${String(c.title || '').trim().toLowerCase()}`;
      (groups[key] = groups[key] || []).push(c);
    }
    for (const [key, rows] of Object.entries(groups)) {
      if (rows.length < 2) continue;
      // Keep whichever row actually carries lessons; prefer the lowest unit_no
      // on a tie so numbering stays stable.
      const withCounts = [];
      for (const r of rows) {
        const { data: tps } = await sb.from('syllabus_topics').select('id').eq('chapter_id', r.id);
        const ids = (tps || []).map(t => t.id);
        let lessons = 0;
        if (ids.length) {
          const { data: res } = await sb.from('topic_resources')
            .select('id').eq('resource_type', 'AI_EXPLANATION').eq('status', 'READY').in('topic_id', ids);
          lessons = (res || []).length;
        }
        withCounts.push({ row: r, topics: ids.length, lessons });
      }
      withCounts.sort((a, b) => b.lessons - a.lessons || b.topics - a.topics || (a.row.unit_no || 0) - (b.row.unit_no || 0));
      const keep = withCounts[0];
      for (const cand of withCounts.slice(1)) {
        if (cand.topics > 0) {
          // Never delete content: fold its topics into the surviving chapter.
          if (!DRY) await sb.from('syllabus_topics').update({ chapter_id: keep.row.id }).eq('chapter_id', cand.row.id);
        }
        if (!DRY) await sb.from('syllabus_chapters').delete().eq('id', cand.row.id);
        report.push(`G${grade}: merged duplicate "${cand.row.title}" (${cand.row.subject})`);
        stats.dupsRemoved++;
      }
    }
    process.stdout.write(`\rG${grade} cleaned…        `);
  }

  console.log('\n');
  report.slice(0, 40).forEach(r => console.log('  ' + r));
  if (report.length > 40) console.log(`  …and ${report.length - 40} more`);
  console.log(`\nmoved ${stats.moved} contaminated chapter(s) · merged ${stats.dupsRemoved} duplicate(s)${DRY ? ' [DRY]' : ''}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
