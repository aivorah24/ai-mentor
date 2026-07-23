/**
 * generate-chapter-manifest.js
 * Builds a chapter manifest (the input file generate-chapter-subject-content.js
 * needs) for a grade/subject whose textbook PDFs are on disk but which has no
 * hand-authored manifest yet (everything except G6).
 *
 * The chapter NUMBER comes from the PDF filename (ground truth); the chapter
 * TITLE is heuristically extracted from the PDF's first page. NCERT title pages
 * vary by subject: Science/Social repeat the title 2x at the top, Maths opens
 * with "N.N <section title>". We detect the repeated-phrase case, fall back to
 * the section-title case, and flag anything low-confidence as needsTitleReview
 * so a human can fix just those before publishing.
 *
 * Usage:
 *   cd server && node scripts/generate-chapter-manifest.js \
 *     --bookdir data/ncert_books/grade7/science --grade 7 \
 *     --subject "Science" --imagesubject Science \
 *     --out data/curricula/cbse-g7-science-chapters.json --book Curiosity
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}
const BOOK_DIR = path.resolve(__dirname, '..', argVal('--bookdir'));
const GRADE = parseInt(argVal('--grade'), 10);
const SUBJECT = argVal('--subject');
const IMAGE_SUBJECT = argVal('--imagesubject');
const OUT_FILE = path.resolve(__dirname, '..', argVal('--out'));
const BOOK = argVal('--book', '');

async function firstPageText(pdfPath) {
  let first = '';
  await pdf(fs.readFileSync(pdfPath), {
    pagerender: (pd) =>
      pd.getTextContent().then((tc) => {
        const t = tc.items.map((i) => i.str).join(' ');
        if (!first) first = t;
        return t;
      }),
  });
  return first.replace(/\s+/g, ' ').trim();
}

// Longest immediately-or-nearly-repeated word phrase near the start — the title
// on NCERT Science/Social pages is printed twice, so it's the strongest signal.
function repeatedLeadingPhrase(words, maxLen = 10) {
  for (let len = maxLen; len >= 2; len--) {
    for (let start = 0; start <= 3; start++) {
      const a = words.slice(start, start + len).join(' ').toLowerCase();
      // look for the same phrase appearing again shortly after
      for (let j = start + len; j <= start + len + 3 && j + len <= words.length; j++) {
        const b = words.slice(j, j + len).join(' ').toLowerCase();
        if (a && a === b) return words.slice(start, start + len).join(' ');
      }
    }
  }
  return null;
}

// Collapse an immediately-repeated phrase: "Title Title rest" → "Title rest".
// NCERT prints the chapter title twice at the top of the page.
function dedupRepeat(text) {
  const w = text.split(' ').filter(Boolean);
  for (let len = Math.floor(w.length / 2); len >= 2; len--) {
    const a = w.slice(0, len).join(' ').toLowerCase();
    const b = w.slice(len, len * 2).join(' ').toLowerCase();
    if (a === b) return w.slice(0, len).join(' ');
  }
  return text;
}

function extractTitle(rawFirstPage, chapterNum) {
  let t = rawFirstPage
    .replace(/CHAPTER\s*\d+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // drop a leading standalone chapter number
  t = t.replace(new RegExp('^' + chapterNum + '\\b'), '').trim();

  const words = t.split(' ').filter(Boolean);

  // Strongest signal: the title is printed right before the standalone chapter
  // number — "<Title> N <narrative…>". Take the text before that number, then
  // collapse the doubled-title repeat.
  const numIdx = words.findIndex((w, i) => i > 0 && w === String(chapterNum));
  if (numIdx > 1 && numIdx <= 12) {
    const cand = dedupRepeat(words.slice(0, numIdx).join(' '));
    if (cand.split(' ').length >= 2 && cand.length >= 5) {
      return { title: cleanTitle(cand), confidence: numIdx <= 9 ? 'high' : 'medium' };
    }
  }

  // Next: repeated title phrase anywhere near the start (Science / Social).
  const rep = repeatedLeadingPhrase(words);
  if (rep && rep.split(' ').length >= 2) {
    return { title: cleanTitle(rep), confidence: 'medium' };
  }

  // Maths — "N.N <section title>" then a sentence.
  const sec = t.match(/^\d+\.\d+\s+([A-Z][^.!?]{2,60})/);
  if (sec) {
    return { title: cleanTitle(sec[1]), confidence: 'medium' };
  }

  // Fallback: first few words, flagged for review.
  const guess = words.slice(0, 7).join(' ');
  return { title: cleanTitle(guess), confidence: 'low' };
}

function cleanTitle(s) {
  return s
    .replace(/[–—-]\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9 :,'’&()!?.-]/g, '')
    .trim()
    .replace(/^[-–—:,\s]+/, '')
    .slice(0, 80)
    .trim();
}

function chapterNumFromFile(fname) {
  const m = fname.match(/(\d{2})\.pdf$/i);
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  const files = fs
    .readdirSync(BOOK_DIR)
    .filter((f) => /\.pdf$/i.test(f))
    .map((f) => ({ file: f, chapter: chapterNumFromFile(f) }))
    .filter((f) => f.chapter !== null)
    .sort((a, b) => a.file.localeCompare(b.file));

  const chapters = [];
  const flagged = [];
  for (const { file, chapter } of files) {
    const p = path.join(BOOK_DIR, file);
    let title, confidence;
    try {
      const fp = await firstPageText(p);
      ({ title, confidence } = extractTitle(fp, chapter));
    } catch (err) {
      title = `Chapter ${chapter}`;
      confidence = 'low';
      console.error(`  ! ${file}: ${err.message}`);
    }
    const entry = { chapter, pdfFile: file, title, kind: 'Non-fiction' };
    if (confidence !== 'high') { entry.needsTitleReview = true; flagged.push(entry); }
    chapters.push(entry);
    console.log(`  ch${String(chapter).padStart(2, '0')} [${confidence}] ${file} → "${title}"`);
  }

  const manifest = {
    curriculum: 'CBSE',
    grade: `Grade ${GRADE}`,
    subject: SUBJECT,
    book: BOOK,
    imageSubject: IMAGE_SUBJECT,
    chapters,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${chapters.length} chapters → ${OUT_FILE}`);
  if (flagged.length) console.log(`⚠ ${flagged.length} title(s) need review (needsTitleReview:true).`);
  else console.log('✓ All titles extracted with high confidence.');
}

main().catch((e) => { console.error(e); process.exit(1); });
