/**
 * extract-ncert-structure.cjs — build the REAL NCERT chapter/subtopic map from
 * the textbook PDFs, and write it into data/curricula/*.json.
 *
 * Why this exists: the app's curriculum was being invented by the generator.
 * publish() created one "chapter" per generated topic with unit_no hardcoded to
 * 1, so Grade 11 Mathematics showed "Area of a Triangle" and "Angle of
 * Elevation" as chapters instead of NCERT's Ch 1 Sets, Ch 2 Relations and
 * Functions. Chapter structure must come from the book, never from a model.
 *
 * Everything here is deterministic — no LLM:
 *   - chapter title  : the all-caps heading on page 1 ("SETS")
 *   - subtopics      : numbered section headings ("1.2 Sets and their
 *                      Representations"), which ARE the syllabus subtopics
 *   - pdfFile        : already in the curricula file, and matches the
 *                      ncert-books storage path grade<N>/<subject>/<code>.pdf
 *
 *   node scripts/extract-ncert-structure.cjs --grade 11 --subject mathematics
 *   node scripts/extract-ncert-structure.cjs --grades 11,12 [--dry]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADES = (arg('--grades', arg('--grade', '')) || '').split(',').map(s => s.trim()).filter(Boolean);
const SUBJECT = (arg('--subject', '') || '').toLowerCase();
const DRY = process.argv.includes('--dry');
const CUR_DIR = path.resolve(__dirname, '..', 'data', 'curricula');
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');

// Lines that look like a title but are not one: running headers, front matter,
// and the epigraph attributions NCERT prints above each chapter opening.
const NOT_A_TITLE = /MATHEMATICS|PHYSICS|CHEMISTRY|BIOLOGY|CHAPTER|INTRODUCTION|EXERCISE|NCERT|REPRINT|PUBLISHED|SUMMARY|APPENDIX/i;

function titleFromPage1(text) {
  const lines = text.split(/\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const isHeading = (l) => /^[A-Z][A-Z \-'&,]{2,45}$/.test(l)
    && !NOT_A_TITLE.test(l)
    && !/^[A-Z]\.[A-Z]/.test(l);                    // author initials, e.g. "G .H. HARDY"
  for (let i = 0; i < lines.length; i++) {
    if (!isHeading(lines[i])) continue;
    // A long title wraps onto the next line ("COMPLEX NUMBERS AND" /
    // "QUADRATIC EQUATIONS"), so take the following heading lines too — without
    // this, chapter 4 came out as "Complex Numbers and".
    const parts = [lines[i]];
    for (let j = i + 1; j < lines.length && parts.length < 3 && isHeading(lines[j]); j++) parts.push(lines[j]);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return null;
}

function subtopicsFrom(text, chapterNo) {
  // "1.2 Sets and their Representations" — the numbered section headings are the
  // book's own subtopic list, so they need no interpretation.
  const re = new RegExp(`(?:^|\\n)\\s*(${chapterNo})\\.(\\d{1,2})\\s*([A-Z][A-Za-z][A-Za-z \\-'&,()]{3,60})`, 'g');
  const seen = new Map();
  let m;
  while ((m = re.exec(text))) {
    const key = `${m[1]}.${m[2]}`;
    const t = m[3].replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '');
    if (!seen.has(key) && !/^Introduction$/i.test(t)) seen.set(key, t);
  }
  return [...seen.entries()]
    .sort((a, b) => parseInt(a[0].split('.')[1], 10) - parseInt(b[0].split('.')[1], 10))
    .map(([section, title]) => ({ section, title }));
}

const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
  .replace(/\b(And|Or|Of|The|To|In|A|An|With|For)\b/g, (w) => w.toLowerCase())
  .replace(/^./, (c) => c.toUpperCase());

(async () => {
  const files = fs.readdirSync(CUR_DIR).filter(f => f.endsWith('-chapters.json'));
  let done = 0;

  for (const file of files) {
    const full = path.join(CUR_DIR, file);
    const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
    const gradeNum = String(doc.grade || '').replace(/\D/g, '');
    if (GRADES.length && !GRADES.includes(gradeNum)) continue;
    const subjFolder = file.split('-')[2];                       // cbse-g11-mathematics-kemh1-...
    if (SUBJECT && subjFolder !== SUBJECT) continue;

    let changed = 0, missing = 0;
    for (const ch of doc.chapters || []) {
      const p = path.join(BOOKS, `grade${gradeNum}`, subjFolder, ch.pdfFile || '');
      if (!ch.pdfFile || !fs.existsSync(p)) { missing++; continue; }
      let parsed;
      try { parsed = await pdf(fs.readFileSync(p)); } catch { missing++; continue; }

      // NCERT PDFs keep their InDesign source name in the footer
      // ("Chapter 7.indd"), which is the book's OWN chapter number. For primary
      // books the file index is not the chapter number — Grade 1 English ships
      // aemr101 and aemr102 as two parts of Chapter 1, and aemr105 as Chapter 2
      // — so trusting the filename numbered those chapters wrongly.
      const indd = parsed.text.match(/Chapter\s*(\d{1,2})\.indd/i);
      if (indd) {
        const n = parseInt(indd[1], 10);
        if (n > 0 && n < 40) ch.chapter = n;
      } else {
        // Part II volumes restart their FILE numbering at 01 (lemh201) while the
        // book continues the chapter sequence — Integrals is Chapter 7, not 1.
        // Trusting the filename made Part II collide with Part I and the whole
        // second half of the subject disappeared: Grade 12 Maths showed 7 of its
        // 13 chapters. The section headings carry the real number ("7.1
        // Introduction"), so read it from those.
        const intro = parsed.text.match(/(\d{1,2})\.1\s*Introduction/);
        let n = intro ? parseInt(intro[1], 10) : 0;
        if (!n) {
          // No "N.1 Introduction" — take the most common section prefix instead.
          const tally = {};
          const re = /(?:^|\n)\s*(\d{1,2})\.(\d{1,2})\s+[A-Z]/g;
          let m;
          while ((m = re.exec(parsed.text))) tally[m[1]] = (tally[m[1]] || 0) + 1;
          const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
          if (best && best[1] >= 3) n = parseInt(best[0], 10);
        }
        if (n > 0 && n < 40) ch.chapter = n;
      }

      const firstPage = parsed.text.split(/\f/)[0] || parsed.text.slice(0, 3000);
      const raw = titleFromPage1(firstPage);
      if (raw) { ch.title = titleCase(raw); delete ch.needsTitleReview; changed++; }

      const subs = subtopicsFrom(parsed.text, ch.chapter);
      if (subs.length) ch.subtopics = subs;
      // The storage path the reader panel should open.
      ch.bookPath = `grade${gradeNum}/${subjFolder}/${ch.pdfFile}`;
    }

    // Within one volume the chapters run in file order. A PDF whose own text
    // gives no usable number falls back to its filename index, which in a Part II
    // volume is wrong — Chemistry kech202 fell back to 2, collided with Part I's
    // Chapter 2 and was dropped, losing Organic Chemistry entirely. Its
    // neighbours (kech201 = 7, kech203 = 9) fix it without guessing: inside a
    // volume the sequence must increase with the file index.
    const ordered = (doc.chapters || []).slice().sort((a, b) => String(a.pdfFile).localeCompare(String(b.pdfFile)));
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1], cur = ordered[i];
      if (cur.chapter > prev.chapter) continue;             // already increasing
      const next = ordered[i + 1];
      const candidate = prev.chapter + 1;
      // Only correct when it genuinely sits between its neighbours.
      if (!next || candidate < next.chapter) {
        console.log(`   ~ ${cur.pdfFile}: chapter ${cur.chapter} -> ${candidate} (from volume order)`);
        cur.chapter = candidate;
      }
    }

    // Several PDFs can belong to ONE chapter (primary readers split a chapter
    // across files). Merge them so the app shows the book's chapters, not the
    // publisher's file list, and keep every PDF so the reader can open each part.
    const merged = new Map();
    for (const ch of doc.chapters || []) {
      const key = ch.chapter;
      if (!merged.has(key)) { merged.set(key, { ...ch, pdfFiles: [ch.pdfFile].filter(Boolean) }); continue; }
      const m = merged.get(key);
      if (ch.pdfFile && !m.pdfFiles.includes(ch.pdfFile)) m.pdfFiles.push(ch.pdfFile);
      if ((!m.title || /^Chapter \d+$/i.test(m.title)) && ch.title && !/^Chapter \d+$/i.test(ch.title)) {
        m.title = ch.title; delete m.needsTitleReview;
      }
      if ((ch.subtopics || []).length > (m.subtopics || []).length) m.subtopics = ch.subtopics;
    }
    doc.chapters = [...merged.values()].sort((a, b) => (a.chapter || 0) - (b.chapter || 0));

    if (changed || missing) {
      console.log(`${file}: ${changed} titled, ${missing} unreadable`);
      (doc.chapters || []).slice(0, 4).forEach(c =>
        console.log(`   ch${c.chapter} ${JSON.stringify(c.title)} · ${(c.subtopics || []).length} subtopics`));
    }
    if (!DRY && changed) fs.writeFileSync(full, JSON.stringify(doc, null, 1));
    done++;
  }
  console.log(`\n${done} curriculum file(s) processed${DRY ? ' [DRY — nothing written]' : ''}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
