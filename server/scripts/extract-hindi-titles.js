/**
 * extract-hindi-titles.js — recover Hindi chapter titles from Kruti-Dev PDFs by
 * looking at how the text is SET, not just what it says.
 *
 * Reading raw page text and taking the first line produced author names, page
 * footers ("दूवाZ/74") and biography fragments, because a chapter opening page
 * carries all of those. A heading is distinguishable by its typography: it is
 * set several points larger than body copy and sits in the upper part of the
 * page. pdfjs exposes per-item height and position, so that is what we filter on.
 *
 * Order of trust:
 *   1. data/curricula/ncert_catalog/hindi_official_titles.json — human-verified
 *   2. this layout parser, if its result is unambiguous
 *   3. otherwise leave "Chapter N" — an honest placeholder beats a wrong title
 *
 *   node scripts/extract-hindi-titles.js --pdf <file>        # inspect one book
 *   node scripts/extract-hindi-titles.js --grades 7,8 --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { krutiToUnicode, isDevanagari } = require('./convert-kruti-dev.js');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
// The layout parser is useful for investigation but not trustworthy enough to
// write: it returns author names and half-headings often enough that a demo
// build should take verified catalog entries only.
const CATALOG_ONLY = !process.argv.includes('--allow-layout');
const CATALOG = path.resolve(__dirname, '..', 'data', 'curricula', 'ncert_catalog', 'hindi_official_titles.json');

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/** Largest-set text runs near the top of the first pages. */
async function headingCandidates(file, maxPages = 2) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise;
  const items = [];
  for (let p = 1; p <= Math.min(maxPages, doc.numPages); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const it of content.items) {
      const str = String(it.str || '').trim();
      if (!str) continue;
      const h = Math.abs(it.transform[3]) || it.height || 0;      // glyph height ~ font size
      const y = it.transform[5];
      items.push({ str, h, y, fromTop: vp.height - y, page: p });
    }
  }
  await doc.destroy();
  if (!items.length) return [];

  // Body copy is whatever size most of the page is set in; a heading is clearly
  // larger than that, not merely above average.
  const sizes = items.map(i => Math.round(i.h)).filter(Boolean).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 10;
  const threshold = median * 1.45;

  return items
    .filter(i => i.h >= threshold)
    .filter(i => i.fromTop < 380)                                  // upper part of the page
    .filter(i => i.str.length >= 3 && i.str.length <= 60)
    .sort((a, b) => b.h - a.h || a.fromTop - b.fromTop)
    .slice(0, 8);
}

/** Reject anything that is clearly not a chapter name. */
function plausibleTitle(t) {
  const s = String(t || '').trim();
  if (!s || !isDevanagari(s)) return false;
  if (/[A-Za-z0-9\/]/.test(s)) return false;                       // page refs, stray Latin
  if (/[।]/.test(s)) return false;                                 // a sentence
  if (s.length < 4 || s.length > 44) return false;
  if (s.split(/\s+/).length > 7) return false;
  const half = s.slice(0, Math.floor(s.length / 2));               // doubled author names
  if (half.length > 5 && s.startsWith(half + half)) return false;
  // Residual encoding debris the mapping could not resolve.
  if (/[ऀ-ॿ]{0,2}[ऀ-ः]{2,}/.test(s)) return false;
  // A heading can be split across text items, leaving a phrase that stops mid
  // thought ("पत्रकारीय लेखन के"). A title ending on a postposition or a dash is
  // a fragment, and a fragment on screen looks like a bug.
  if (/(के|की|का|और|से|में|–|-)$/.test(s)) return false;
  if (s.split(/\s+/).length < 2 && s.length < 8) return false;   // lone fragment
  return true;
}

const catalog = (() => { try { return JSON.parse(fs.readFileSync(CATALOG, 'utf8')); } catch { return {}; } })();

/**
 * Catalog keys may be a book code ("kham1") or a readable name
 * ("g11_hindi_aroh"). Both are accepted so whoever fills the file can use
 * whichever they know — requiring the internal code would make the file
 * awkward to write by hand, which is the whole point of it.
 */
function catalogLookup(bookCode, grade, chapterNo) {
  const want = `ch${chapterNo}`;
  // Match on the BOOK, never on grade alone. Grade 11 Hindi ships four books
  // (Aroh, Vitan, Antra, Antral) whose chapter numbers all restart at 1, so a
  // grade-level match put Aroh's "नमक का दरोगा" onto chapter 1 of Abhivyakti
  // aur Madhyam — a correct title on the wrong chapter, which is worse than no
  // title at all. Only an explicit book-code key is trusted.
  const entry = catalog?.[bookCode];
  return (entry && entry[want]) || null;
}

async function titleFor(bookCode, chapterNo, file, grade) {
  // 1. verified catalog
  const fromCatalog = catalogLookup(bookCode, grade, chapterNo);
  if (fromCatalog) return { title: fromCatalog, source: 'catalog' };
  if (CATALOG_ONLY) return null;
  // 2. layout parser
  try {
    for (const cand of await headingCandidates(file)) {
      const conv = krutiToUnicode(cand.str);
      if (plausibleTitle(conv)) return { title: conv, source: 'layout' };
    }
  } catch { /* unreadable pdf */ }
  return null;                                                     // 3. leave placeholder
}

(async () => {
  const one = arg('--pdf');
  if (one) {
    const cands = await headingCandidates(path.resolve(one));
    console.log(`heading candidates in ${path.basename(one)}:`);
    for (const c of cands) {
      const conv = krutiToUnicode(c.str);
      console.log(`  h=${c.h.toFixed(1)} top=${c.fromTop.toFixed(0)} ${plausibleTitle(conv) ? 'OK ' : '   '} ${JSON.stringify(c.str.slice(0, 34))} -> ${conv.slice(0, 40)}`);
    }
    return;
  }

  const GRADES = (arg('--grades', '2,7,8,9,10,11,12') || '').split(',').map(n => parseInt(n, 10)).filter(Boolean);
  const sb = require('../services/supabase');
  const syllabus = require('../services/syllabus-map');
  const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');
  let found = 0, left = 0;

  for (const grade of GRADES) {
    const { data: chs } = await sb.from('syllabus_chapters')
      .select('id,title,unit_no').eq('grade', `Grade ${grade}`).eq('subject', 'Hindi');
    for (const ch of chs || []) {
      if (!/^chapter\s*\d+$/i.test(String(ch.title || '').trim())) continue;
      const rec = syllabus.chaptersFor(grade, 'Hindi').find(c => c.chapter === ch.unit_no);
      if (!rec || !rec.bookPath) { left++; continue; }
      const file = path.join(BOOKS, rec.bookPath);
      if (!fs.existsSync(file)) { left++; continue; }

      const hit = await titleFor(String(rec.pdfFile || '').replace(/\d{2}\.pdf$/i, ''), ch.unit_no, file, grade);
      if (!hit) { left++; continue; }
      console.log(`G${grade} ch${ch.unit_no} [${hit.source}] -> ${hit.title}`);
      if (APPLY) await sb.from('syllabus_chapters').update({ title: hit.title }).eq('id', ch.id);
      found++;
    }
  }
  console.log(`\ntitles resolved: ${found} · left as placeholder: ${left}${APPLY ? '' : '  [dry run — pass --apply to write]'}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
