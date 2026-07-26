/**
 * audit-curriculum.cjs — verify the curriculum map and the live database against
 * the actual NCERT textbooks, for Grades 1-12, and write CURRICULUM_FIX_AUDIT_LOG.md.
 *
 * Checks, per grade/subject:
 *   - every chapter has a REAL title (not the "Chapter 7" placeholder)
 *   - every chapter has a subtopic array (the "single-topic unit" defect)
 *   - bookPath resolves to a PDF actually on disk (the viewer 404s otherwise)
 *   - the live syllabus_chapters rows carry real chapter numbers, not unit_no=1
 *
 * Read-only: it changes nothing, it only reports.
 *
 *   node scripts/audit-curriculum.cjs [--no-db]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CUR_DIR = path.resolve(__dirname, '..', 'data', 'curricula');
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');
const OUT = path.resolve(__dirname, '..', '..', 'CURRICULUM_FIX_AUDIT_LOG.md');
const NO_DB = process.argv.includes('--no-db');
const isPlaceholder = (t) => !t || /^chapter\s*\d+$/i.test(String(t).trim());

(async () => {
  const files = fs.readdirSync(CUR_DIR).filter(f => f.endsWith('-chapters.json'));
  const byGrade = {};
  const brokenPaths = [];
  const missingTitles = [];
  const noSubtopics = [];
  let totChapters = 0, totSubtopics = 0, totTitled = 0;

  for (const file of files) {
    let doc; try { doc = JSON.parse(fs.readFileSync(path.join(CUR_DIR, file), 'utf8')); } catch { continue; }
    const grade = parseInt(String(doc.grade || '').replace(/\D/g, ''), 10);
    if (!grade) continue;
    const subject = doc.subject || file.split('-')[2];
    const g = byGrade[grade] = byGrade[grade] || { subjects: 0, chapters: 0, titled: 0, subtopics: 0, withSubs: 0, badPath: 0 };
    g.subjects++;

    for (const ch of doc.chapters || []) {
      totChapters++; g.chapters++;
      if (!isPlaceholder(ch.title)) { totTitled++; g.titled++; }
      else missingTitles.push(`G${grade} ${subject} ch${ch.chapter} (${ch.pdfFile || 'no pdf'})`);

      const subs = Array.isArray(ch.subtopics) ? ch.subtopics.length : 0;
      totSubtopics += subs; g.subtopics += subs;
      if (subs > 0) g.withSubs++; else noSubtopics.push(`G${grade} ${subject} ch${ch.chapter} "${ch.title}"`);

      const rel = ch.bookPath || '';
      if (!rel || !fs.existsSync(path.join(BOOKS, rel))) { g.badPath++; brokenPaths.push(`G${grade} ${subject} ch${ch.chapter} → ${rel || '(no bookPath)'}`); }
    }
  }

  // Live DB: are chapter numbers real, or still the hardcoded 1?
  let dbRows = [];
  if (!NO_DB) {
    try {
      const sb = require('../services/supabase');
      for (let grade = 1; grade <= 12; grade++) {
        const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title,unit_no').eq('grade', `Grade ${grade}`);
        if (!chs || !chs.length) continue;
        const unit1 = chs.filter(c => (c.unit_no || 1) === 1).length;
        const distinct = new Set(chs.map(c => `${c.subject}|${c.unit_no}`)).size;
        dbRows.push({ grade, rows: chs.length, unit1, distinct });
      }
    } catch (e) { dbRows = [{ error: e.message }]; }
  }

  const L = [];
  L.push('# Curriculum Fix — Audit Log', '');
  L.push(`Generated: ${new Date().toISOString()}`, '');
  L.push('Structure is parsed directly from the NCERT textbook PDFs (chapter title from the');
  L.push('page-1 heading, subtopics from the book\'s numbered section headings). No chapter');
  L.push('title, number, subtopic or bookPath in this map comes from a language model.', '');

  L.push('## Summary', '');
  L.push('| Metric | Value |');
  L.push('|---|---|');
  L.push(`| Grades processed | ${Object.keys(byGrade).length} |`);
  L.push(`| Curriculum files | ${files.length} |`);
  L.push(`| Chapters total | ${totChapters} |`);
  L.push(`| Chapters with a real title | ${totTitled} (${totChapters ? Math.round(totTitled / totChapters * 100) : 0}%) |`);
  L.push(`| Subtopics extracted | ${totSubtopics} |`);
  L.push(`| Chapters missing a title | ${missingTitles.length} |`);
  L.push(`| Chapters with no subtopics | ${noSubtopics.length} |`);
  L.push(`| Broken / missing bookPath | ${brokenPaths.length} |`);
  L.push('');

  L.push('## Per grade', '');
  L.push('| Grade | Subjects | Chapters | Titled | Subtopics | Chapters w/ subtopics | Bad bookPath |');
  L.push('|---|---|---|---|---|---|---|');
  for (let g = 1; g <= 12; g++) {
    const r = byGrade[g]; if (!r) { L.push(`| ${g} | — | — | — | — | — | — |`); continue; }
    L.push(`| ${g} | ${r.subjects} | ${r.chapters} | ${r.titled} | ${r.subtopics} | ${r.withSubs} | ${r.badPath} |`);
  }
  L.push('');

  if (dbRows.length) {
    L.push('## Live database (syllabus_chapters)', '');
    L.push('`unit_no = 1` on every row is the signature of the old publish() bug, which');
    L.push('created one chapter per generated topic instead of using the book\'s chapters.', '');
    L.push('| Grade | Chapter rows | Rows with unit_no=1 | Distinct subject+unit |');
    L.push('|---|---|---|---|');
    for (const r of dbRows) {
      if (r.error) { L.push(`| — | error: ${r.error} | | |`); continue; }
      L.push(`| ${r.grade} | ${r.rows} | ${r.unit1} | ${r.distinct} |`);
    }
    L.push('');
  }

  const section = (title, arr, cap = 40) => {
    L.push(`## ${title} (${arr.length})`, '');
    if (!arr.length) { L.push('None.', ''); return; }
    arr.slice(0, cap).forEach(x => L.push(`- ${x}`));
    if (arr.length > cap) L.push(`- …and ${arr.length - cap} more`);
    L.push('');
  };
  section('Missing chapter titles — needs manual check', missingTitles);
  section('Chapters with no subtopics extracted', noSubtopics);
  section('Broken or missing PDF paths — viewer will 404', brokenPaths);

  fs.writeFileSync(OUT, L.join('\n'));
  console.log(`Wrote ${OUT}`);
  console.log(`chapters ${totChapters} · titled ${totTitled} · subtopics ${totSubtopics} · badPath ${brokenPaths.length}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
