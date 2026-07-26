/**
 * apply-generic-title-fixes.cjs — reads vision-transcribed titles from
 * server/data/curricula/ncert_catalog/vision-titles/*.json (each written
 * directly by a vision agent, keyed by chapterId — no hand-retyping) and
 * writes them onto syllabus_chapters.title.
 *
 * File format: array of { chapterId, title }.
 *
 *   node scripts/apply-generic-title-fixes.cjs            # dry run
 *   node scripts/apply-generic-title-fixes.cjs --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DIR = path.resolve(__dirname, '..', 'data', 'curricula', 'ncert_catalog', 'vision-titles');

(async () => {
  if (!fs.existsSync(DIR)) { console.error('no dir:', DIR); process.exit(1); }
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
  if (!files.length) { console.log('no files in', DIR); return; }

  const sb = require('../services/supabase');
  let applied = 0, skippedBad = 0, skippedNotFound = 0, skippedNotGeneric = 0;

  for (const file of files) {
    let records;
    try { records = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); }
    catch (e) { console.error(`SKIP ${file}: invalid JSON (${e.message})`); continue; }
    if (!Array.isArray(records)) { console.error(`SKIP ${file}: not an array`); continue; }

    for (const rec of records) {
      const { chapterId, title } = rec || {};
      if (!chapterId || !title || !String(title).trim() || /^chapter\s*\d+$/i.test(String(title).trim())) { skippedBad++; continue; }

      const { data: row } = await sb.from('syllabus_chapters').select('id,title').eq('id', chapterId).maybeSingle();
      if (!row) { skippedNotFound++; console.log(`NOT FOUND  ${chapterId}`); continue; }
      if (!/^chapter\s*\d+$/i.test(String(row.title || '').trim())) { skippedNotGeneric++; console.log(`SKIP (already real: "${row.title}")  ${chapterId}`); continue; }

      console.log(`APPLY  ${chapterId}  "${row.title}" -> "${title}"`);
      if (APPLY) await sb.from('syllabus_chapters').update({ title }).eq('id', chapterId);
      applied++;
    }
  }

  console.log(`\nfiles: ${files.length}  applied: ${applied}  bad: ${skippedBad}  not-found: ${skippedNotFound}  already-real: ${skippedNotGeneric}${APPLY ? '' : '\n[dry run — pass --apply to write]'}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
