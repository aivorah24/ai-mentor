// Authoritative chapter/unit list per curriculum + grade + subject.
//
// Single source of truth for "how many chapters does this subject have" and
// "what are the unit/chapter names" — read from the hand-verified manifests in
// data/curricula/*-chapters.json. Every UI surface (subject cards, the mastery
// card, the topic-scores strip, progress) should derive its unit/chapter numbers
// from here so they can never disagree.
//
// IB PYP has no chapter manifests (its units come from the ingested topic
// payloads instead) — callers fall back to unit-from-topics when this returns [].

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'curricula');

let INDEX = null; // key -> Map<titleLower, {chapter, title}>

function norm(s) {
  return String(s || '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

// CBSE content is the NCERT textbooks — treat the two labels as one partition.
function normCurriculum(c) {
  const n = norm(c);
  if (n === 'ncert' || n === 'cbse') return 'cbse';
  if (n === 'ib pyp' || n === 'ib_pyp' || n === 'ibpyp') return 'ib pyp';
  return n;
}

function gradeKey(g) {
  const m = String(g).match(/(\d+)/);
  return m ? `grade ${m[1]}` : norm(g);
}

function keyOf(curriculum, grade, subject) {
  return `${normCurriculum(curriculum)}|${gradeKey(grade)}|${norm(subject)}`;
}

const PLACEHOLDER_RE = /^(chapter|unit)\s*\d+$/i;

function build() {
  // Per subject key we track two things:
  //  • realTitles — union of genuine chapter titles across the subject's book
  //    files, deduped by title (handles multi-volume subjects correctly).
  //  • maxRows    — the largest single-file chapter count, used as a fallback
  //    count for subjects whose manifests only ever got placeholder titles
  //    ("Chapter 1", "Chapter 2", …) — the count is real even if titles aren't.
  const agg = new Map(); // key -> { realTitles: Map<titleLower,{chapter,title}>, maxRows: number }
  let files = [];
  try {
    // Manifests are named *-chapters.json or *-topics.json (unit-based, e.g. English).
    files = fs.readdirSync(DIR).filter((f) => /-(chapters|topics)\.json$/i.test(f));
  } catch {
    return new Map();
  }
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      // Manifests come in two shapes: chapter-based (`chapters[]` with `title`)
      // and unit-based (`units[]` with `unit`). Normalise both to {chapter,title}.
      const rows = Array.isArray(data.chapters) ? data.chapters
        : Array.isArray(data.units) ? data.units
        : [];
      if (!rows.length || !data.subject || !data.grade) continue;
      const key = keyOf(data.curriculum, data.grade, data.subject);
      if (!agg.has(key)) agg.set(key, { realTitles: new Map(), maxRows: 0 });
      const entry = agg.get(key);
      for (const ch of rows) {
        const title = String(ch.title || ch.unit || '').trim();
        if (!title || PLACEHOLDER_RE.test(title)) continue; // untitled — counted via maxRows
        const tk = title.toLowerCase();
        if (!entry.realTitles.has(tk)) entry.realTitles.set(tk, { chapter: ch.chapter ?? null, title });
      }
      // Largest single book file's chapter count — the true number of chapters
      // even when that file's titles are placeholders ("Chapter 1", …).
      entry.maxRows = Math.max(entry.maxRows, rows.length);
    } catch {
      /* skip malformed manifest */
    }
  }

  // Resolve each subject to its final chapter list. The count is the larger of
  // the real-title union (correct for multi-volume subjects) and the biggest
  // single manifest (correct for placeholder-only manifests). Real titles fill
  // the list first; any remaining slots get generic "Chapter N" labels so the
  // count is always right even when some titles are missing.
  const idx = new Map();
  for (const [key, entry] of agg) {
    const real = [...entry.realTitles.values()].sort((a, b) => (a.chapter || 0) - (b.chapter || 0));
    const count = Math.max(real.length, entry.maxRows);
    if (count === 0) continue;
    const list = real.slice();
    for (let i = real.length; i < count; i++) list.push({ chapter: i + 1, title: `Chapter ${i + 1}` });
    idx.set(key, list);
  }
  return idx;
}

function getIndex() {
  if (!INDEX) INDEX = build();
  return INDEX;
}

// Returns [{ chapter, title }, ...] sorted by chapter number; [] when unknown.
function getChapters(curriculum, grade, subject) {
  return getIndex().get(keyOf(curriculum, grade, subject)) || [];
}

function getChapterCount(curriculum, grade, subject) {
  return getChapters(curriculum, grade, subject).length;
}

// Test/ops hook — drop the cache so a freshly written manifest is picked up
// without restarting the process.
function reload() {
  INDEX = null;
  return getIndex().size;
}

module.exports = { getChapters, getChapterCount, reload };
