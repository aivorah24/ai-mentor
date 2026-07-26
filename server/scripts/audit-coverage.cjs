/**
 * audit-coverage.cjs — how complete is every grade/subject, as the student app
 * actually sees it (same endpoint the syllabus screen calls).
 *
 * Reports chapters, how many carry lessons, and whether the source PDFs exist —
 * so a gap can be told apart from a missing book, which needs downloading rather
 * than generating.
 *
 *   node scripts/audit-coverage.cjs [--grades 1,2,3] [--json out.json]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const syllabus = require('../services/syllabus-map');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', '1,2,3,4,5,6,7,8,9,10,11,12') || '').split(',').map(n => parseInt(n, 10)).filter(Boolean);
const JSON_OUT = arg('--json');
const BASE = process.env.AUDIT_BASE || 'http://localhost:3006';
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');

(async () => {
  const sb = require('../services/supabase');
  const rows = [];

  for (const grade of GRADES) {
    // Subjects the app can actually offer: anything with chapter rows or a map entry.
    const { data: chs } = await sb.from('syllabus_chapters').select('subject').eq('grade', `Grade ${grade}`);
    const dbSubjects = [...new Set((chs || []).map(c => c.subject).filter(Boolean))];
    const mapSubjects = [...new Set(
      (fs.existsSync(path.join(BOOKS, `grade${grade}`))
        ? fs.readdirSync(path.join(BOOKS, `grade${grade}`))
        : []
      ).map(f => f)
    )];
    const subjects = [...new Set([...dbSubjects])];

    for (const subject of subjects.sort()) {
      let units = [];
      try {
        const r = await fetch(`${BASE}/teacher/syllabus/current?grade=Grade%20${grade}&subject=${encodeURIComponent(subject)}&curriculum=CBSE`);
        units = (await r.json()).units || [];
      } catch { /* server down — leave empty */ }

      const withLessons = units.filter(u => (u.topics || []).length > 0).length;
      const pending = units.length - withLessons;
      const lessons = units.reduce((n, u) => n + (u.topics || []).length, 0);
      // Does the source book exist on disk? A missing PDF cannot be generated
      // from, and needs downloading rather than another pipeline run.
      const mapped = syllabus.chaptersFor(grade, subject);
      const missingPdf = mapped.filter(c => !c.bookPath || !fs.existsSync(path.join(BOOKS, c.bookPath))).length;

      rows.push({ grade, subject, chapters: units.length, withLessons, pending, lessons, mappedChapters: mapped.length, missingPdf });
    }
    process.stdout.write(`\rG${grade} audited…            `);
  }

  console.log('\n');
  console.log('grade | subject              | ch | live | pending | lessons | missingPDF');
  console.log('------|----------------------|----|------|---------|---------|-----------');
  for (const r of rows) {
    console.log(
      `G${String(r.grade).padEnd(4)}| ${r.subject.slice(0, 20).padEnd(20)} | ${String(r.chapters).padStart(2)} | ${String(r.withLessons).padStart(4)} | ${String(r.pending).padStart(7)} | ${String(r.lessons).padStart(7)} | ${String(r.missingPdf).padStart(9)}`
    );
  }
  const tot = rows.reduce((a, r) => ({
    chapters: a.chapters + r.chapters, live: a.live + r.withLessons,
    pending: a.pending + r.pending, lessons: a.lessons + r.lessons,
  }), { chapters: 0, live: 0, pending: 0, lessons: 0 });
  console.log(`\nTOTAL chapters ${tot.chapters} · with lessons ${tot.live} · pending ${tot.pending} · lessons ${tot.lessons}`);
  console.log(`Coverage: ${tot.chapters ? Math.round(tot.live / tot.chapters * 100) : 0}% of chapters have at least one lesson`);

  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1)); console.log(`\nWrote ${JSON_OUT}`); }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
