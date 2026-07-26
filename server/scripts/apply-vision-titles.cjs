/**
 * apply-vision-titles.cjs — apply vision-transcribed chapter titles to the DB.
 *
 * Source of truth is ONLY files on disk under
 * server/data/curricula/ncert_catalog/vision/*.json — never text retyped by
 * the orchestrator. Each file is written directly by a vision-transcription
 * agent (it looked at the rendered PDF page and typed what it saw) using the
 * Write tool, so there is no hand-copy step between "read the page" and
 * "the title lands in a file".
 *
 * File format (array of records):
 * [
 *   { "bookCode": "kham1", "chapter": 1, "title": "जनसंचार माध्यम और लेखन", "grade": 11, "subject": "Hindi" },
 *   ...
 * ]
 * bookCode must be the exact NCERT book code (e.g. "kham1", "jemh1") — never
 * inferred from grade+subject, since multiple books share a grade/subject.
 *
 *   node scripts/apply-vision-titles.cjs                 # dry run, all files
 *   node scripts/apply-vision-titles.cjs --apply
 *   node scripts/apply-vision-titles.cjs --file g1-g2.json --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const ONLY_FILE = arg('--file');
const DIR = path.resolve(__dirname, '..', 'data', 'curricula', 'ncert_catalog', 'vision');

function plausible(title) {
  const s = String(title || '').trim();
  if (!s) return false;
  if (/^chapter\s*\d+$/i.test(s)) return false;             // still a placeholder
  if (s.length < 3 || s.length > 80) return false;
  return true;
}

(async () => {
  if (!fs.existsSync(DIR)) { console.error('no vision dir:', DIR); process.exit(1); }
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && (!ONLY_FILE || f === ONLY_FILE));
  if (!files.length) { console.log('no vision JSON files found in', DIR); return; }

  const sb = require('../services/supabase');
  const syllabus = require('../services/syllabus-map');

  let applied = 0, skippedBad = 0, skippedNoMatch = 0, skippedAlreadyReal = 0;
  const log = [];

  for (const file of files) {
    let records;
    try { records = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); }
    catch (e) { console.error(`SKIP ${file}: invalid JSON (${e.message})`); continue; }
    if (!Array.isArray(records)) { console.error(`SKIP ${file}: not an array`); continue; }

    for (const rec of records) {
      const { bookCode, chapter, title, grade, subject } = rec || {};
      if (!bookCode || !chapter || !plausible(title)) { skippedBad++; continue; }

      // Resolve which chapter row this book+chapter is, via syllabus-map,
      // restricted to grade+subject if given (narrows search, never widens).
      const candidates = [];
      const grades = grade ? [grade] : [1,2,3,4,5,6,7,8,9,10,11,12];
      for (const g of grades) {
        const subjects = subject ? [subject] : syllabus.subjectsFor(g);
        for (const subj of subjects || []) {
          const chs = syllabus.chaptersFor(g, subj) || [];
          for (const c of chs) {
            if (c.chapter === chapter && String(c.pdfFile || '').startsWith(bookCode)) {
              candidates.push({ grade: g, subject: subj, chapterNo: c.chapter });
            }
          }
        }
      }
      if (!candidates.length) { skippedNoMatch++; log.push(`NO MATCH  ${bookCode} ch${chapter} "${title}"`); continue; }

      for (const cand of candidates) {
        const { data: row } = await sb.from('syllabus_chapters')
          .select('id,title').eq('grade', `Grade ${cand.grade}`).eq('subject', cand.subject).eq('unit_no', cand.chapterNo).maybeSingle();
        if (!row) { skippedNoMatch++; log.push(`NO ROW    ${bookCode} ch${chapter} G${cand.grade} ${cand.subject}`); continue; }
        const existing = String(row.title || '').trim();
        if (existing && !/^chapter\s*\d+$/i.test(existing) && existing !== title) {
          skippedAlreadyReal++; log.push(`KEEP      G${cand.grade} ${cand.subject} ch${chapter} already "${existing}", vision said "${title}"`); continue;
        }
        log.push(`APPLY     G${cand.grade} ${cand.subject} ch${chapter} -> "${title}" [${bookCode}]`);
        if (APPLY) await sb.from('syllabus_chapters').update({ title }).eq('id', row.id);
        applied++;
      }
    }
  }

  console.log(log.join('\n'));
  console.log(`\nfiles: ${files.length}  applied: ${applied}  bad-record: ${skippedBad}  no-match: ${skippedNoMatch}  kept-existing-real: ${skippedAlreadyReal}${APPLY ? '' : '\n[dry run — pass --apply to write]'}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
