/**
 * sanitize-chapter-titles.cjs — revert implausible extracted titles to the
 * "Chapter N" placeholder so nothing false reaches the UI.
 *
 * The page-1 caps heuristic works on senior textbooks, which print the chapter
 * name as a heading ("SETS"). Primary readers have no such heading — the story
 * starts immediately — so the heuristic latched onto page content and produced
 * titles like "E-I-E-I-O", "Note" and an alphabet strip for Grade 1 English.
 *
 * A visibly wrong chapter name is worse than an honest placeholder: a
 * placeholder reads as "not filled in yet", while a wrong one looks like the
 * product misunderstands the syllabus. Anything failing the shape tests below
 * is reset and marked needsTitleReview for manual entry.
 *
 *   node scripts/sanitize-chapter-titles.cjs [--dry]
 */
const fs = require('fs');
const path = require('path');

const CUR_DIR = path.resolve(__dirname, '..', 'data', 'curricula');
const DRY = process.argv.includes('--dry');

// Words that signal page furniture rather than a chapter name.
const JUNK = /^(note|notes|contents|index|preface|foreword|answers|appendix|glossary|summary|exercise|activity|reprint|published|dmm|let us|do this|learning objectives?|objectives?|introduction|after studying this chapter|key terms|questions?|from vouchers|gst|pushpush|recap|revision|about the author|short stories|the author|poem|poems|prose|unit|fact sheet on global inequalities|physiography)$/i;

function implausible(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (/^chapter\s*\d+$/i.test(t)) return false;        // already a placeholder
  const words = t.split(/\s+/);
  // Real NCERT titles do run long ("Water Scarcity and the Need for Water
  // Conservation and Management"), so length alone must not disqualify one.
  if (words.length > 12) return true;
  if (t.length < 3 || t.length > 90) return true;
  if (JUNK.test(t)) return true;
  // Overlapping text layers render as a repeated fragment ("Al Equaal Equa",
  // "Notes for the Teachernotes for the Teacher"). A word repeating three or
  // more times is that artefact, not a title.
  const counts = {};
  for (const w of words.map(x => x.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean)) {
    counts[w] = (counts[w] || 0) + 1;
    if (counts[w] >= 3) return true;
  }
  if (/(\b\w{3,}\b)\1/i.test(t.replace(/\s+/g, ''))) return true;
  // Alphabet strips and initialisms: mostly one-or-two letter tokens.
  const shortTokens = words.filter(w => w.replace(/[^A-Za-z]/g, '').length <= 2).length;
  if (words.length >= 3 && shortTokens / words.length > 0.5) return true;
  if (!/[A-Za-z]{3}/.test(t)) return true;              // no real word in it
  return false;
}

let files = 0, reverted = 0, kept = 0;
const examples = [];

for (const file of fs.readdirSync(CUR_DIR).filter(f => f.endsWith('-chapters.json'))) {
  const full = path.join(CUR_DIR, file);
  let doc; try { doc = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
  let touched = false;
  for (const ch of doc.chapters || []) {
    if (/^chapter\s*\d+$/i.test(String(ch.title || '').trim())) continue;
    if (implausible(ch.title)) {
      if (examples.length < 25) examples.push(`${file.replace('-chapters.json', '')} ch${ch.chapter}: ${JSON.stringify(ch.title)}`);
      ch.title = `Chapter ${ch.chapter}`;
      ch.needsTitleReview = true;
      reverted++; touched = true;
    } else kept++;
  }
  if (touched && !DRY) fs.writeFileSync(full, JSON.stringify(doc, null, 1));
  files++;
}

console.log(`${files} file(s) · kept ${kept} real titles · reverted ${reverted} implausible${DRY ? ' [DRY]' : ''}`);
examples.forEach(e => console.log('  reverted:', e));
