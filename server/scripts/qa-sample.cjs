/**
 * qa-sample.cjs — pick a representative sample of PUBLISHED lessons and build a
 * QA bundle for each, so the lesson-vision-qa reviewer can read real lessons as
 * the target-grade child.
 *
 * The rule gate (services/lesson-qa.js) checks STRUCTURE — an illustration
 * exists, worked examples have >=2 steps, quiz indices resolve, arithmetic adds
 * up. It cannot tell whether a lesson teaches the right thing or is grounded in
 * the NCERT chapter. Only the reviewer can, and it reads one lesson at a time,
 * so reviewing all ~1500 is not practical: sample instead, and treat what it
 * finds as systemic until proven otherwise.
 *
 *   node scripts/qa-sample.cjs --grades 11,12 --per-subject 2 --out ../qa_bundles
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sb = require('../services/supabase');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', '') || '').split(',').map(s => parseInt(s, 10)).filter(Boolean);
const PER_SUBJECT = +arg('--per-subject', 2);
const OUT = path.resolve(__dirname, '..', arg('--out', '../qa_bundles'));
const LIST_ONLY = process.argv.includes('--list');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const picked = [];

  for (const g of GRADES) {
    // Query per grade. Fetching every chapter at once silently truncates at
    // Supabase's 1000-row default — the corpus is already past that, so whole
    // grades vanished from the sample without any error.
    const { data: gradeChs } = await sb.from('syllabus_chapters')
      .select('id,grade,subject,title').eq('grade', `Grade ${g}`);
    const bySubject = {};
    for (const ch of gradeChs || []) (bySubject[ch.subject] = bySubject[ch.subject] || []).push(ch);

    for (const [subject, list] of Object.entries(bySubject)) {
      const found = [];
      // Walk chapters in order and take the first PER_SUBJECT topics that have a
      // published lesson — a deterministic spread rather than a random draw, so
      // repeat runs review the same lessons and findings stay comparable.
      for (const ch of list) {
        if (found.length >= PER_SUBJECT) break;
        const { data: tps } = await sb.from('syllabus_topics').select('id,name').eq('chapter_id', ch.id);
        for (const tp of tps || []) {
          if (found.length >= PER_SUBJECT) break;
          const { data: res } = await sb.from('topic_resources')
            .select('resource_type,status').eq('topic_id', tp.id).eq('status', 'READY');
          if ((res || []).some(r => r.resource_type === 'AI_EXPLANATION')) {
            found.push({ grade: g, subject, topicId: tp.id, name: tp.name });
          }
        }
      }
      picked.push(...found);
    }
  }

  console.log(`Sampled ${picked.length} published lesson(s) across grades ${GRADES.join(',')}`);
  if (LIST_ONLY) { picked.forEach(p => console.log(`  G${p.grade} ${p.subject} :: ${p.name}`)); return; }

  const manifest = [];
  for (const p of picked) {
    const safe = `g${p.grade}_${p.subject.replace(/\W+/g, '')}_${p.topicId}`.slice(0, 80);
    const out = path.join(OUT, `${safe}.json`);
    try {
      execFileSync('node', [path.join(__dirname, 'qa-gather.cjs'), p.topicId, out], { stdio: 'pipe' });
      manifest.push({ ...p, bundle: out });
      console.log(`  ✅ G${p.grade} ${p.subject} :: ${p.name}`);
    } catch (e) {
      console.log(`  ❌ G${p.grade} ${p.subject} :: ${p.name} — ${e.message.slice(0, 80)}`);
    }
  }
  fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`\n${manifest.length} bundle(s) → ${OUT}`);
})();
