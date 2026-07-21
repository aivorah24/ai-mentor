/**
 * scripts/lib/pdfText.js
 * Shared PDF text-extraction helpers — used by both the content-generation
 * pipeline (generate-english-g6-listen-content.js) and the content-review
 * pipeline (review-content.js), so "what the real book actually says" is
 * read the same way in both places.
 */
const fs = require('fs');
const pdf = require('pdf-parse');

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// pdf-parse sometimes inserts letter-spacing gaps ("W hat a B ird t hought",
// or even "l et us r ead") from kerning in the PDF — strip ALL whitespace
// before matching titles/markers so "what a bird thought" still finds
// "W hat a B ird t hought".
function squash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Finds `needle` inside `text` tolerating extra whitespace/punctuation
// inserted between characters (the kerning-gap problem above), and returns
// the ORIGINAL string index where the match starts.
function findFuzzyRange(text, needle) {
  const target = squash(needle);
  if (!target) return null;
  let ni = 0;
  let matchStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toLowerCase();
    if (!/[a-z0-9]/.test(ch)) continue;
    if (ch === target[ni]) {
      if (ni === 0) matchStart = i;
      ni++;
      if (ni === target.length) return { start: matchStart, end: i + 1 };
    } else if (ch === target[0]) {
      matchStart = i;
      ni = 1;
    } else {
      ni = 0;
      matchStart = -1;
    }
  }
  return null;
}

function findFuzzyIndex(text, needle) {
  return findFuzzyRange(text, needle)?.start ?? -1;
}

async function extractPages(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const pages = [];
  await pdf(buf, {
    pagerender: (pageData) =>
      pageData.getTextContent().then((tc) => {
        const text = tc.items.map((i) => i.str).join(' ');
        pages.push(text);
        return text;
      }),
  });
  return pages;
}

// Strips repeating headers/footers/reprint stamps that aren't part of the story.
function cleanPageText(raw) {
  return raw
    .replace(/Unit\s*\d+\.indd\s*\d+/gi, ' ')
    .replace(/\d{1,2}-(?:\d{2}|[A-Za-z]{3})-\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*[AP]M/gi, ' ')
    .replace(/Reprint\s*20\d{2}-\d{2}/gi, ' ')
    .replace(/Poorvi\s*[—\-]?\s*G\s*rade\s*6/gi, ' ')
    .replace(/\bp\s*oorvi\b/gi, ' ')
    .replace(/(?:^|\s)\d{1,3}(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const WORKBOOK_MARKERS = [
  'let us think and reflect', 'let us learn', 'let us write',
  'let us explore', 'let us listen', 'let us speak',
];

// Given the full page range for a chapter, returns just the real narrative:
// trims the pre-reading activity + garbled title (starts at "Let us read"),
// and cuts before the first post-story workbook section.
function extractNarrative(pages, startPage, endPage) {
  let rawText = pages.slice(startPage, endPage + 1).map(cleanPageText).join(' ');

  const readMarker = findFuzzyRange(rawText, 'let us read');
  const usedReadMarker = !!readMarker;
  if (readMarker) rawText = rawText.slice(readMarker.end).trim();

  let cutAt = rawText.length;
  for (const marker of WORKBOOK_MARKERS) {
    const range = findFuzzyRange(rawText, marker);
    if (range && range.start < cutAt) cutAt = range.start;
  }
  rawText = rawText.slice(0, cutAt).trim();

  return { text: rawText, usedReadMarker };
}

// Also returns the surrounding activity text (pre-reading activities +
// post-story workbook sections) separately — needed by the review pipeline
// to check "are activities represented", even though it's deliberately
// excluded from the read-aloud narrative itself.
function extractFullChapterSections(pages, startPage, endPage) {
  const rawText = pages.slice(startPage, endPage + 1).map(cleanPageText).join(' ');
  const readMarker = findFuzzyRange(rawText, 'let us read');
  const preReading = readMarker ? rawText.slice(0, readMarker.start).trim() : '';
  const narrative = extractNarrative(pages, startPage, endPage);

  let postStoryStart = rawText.length;
  for (const marker of WORKBOOK_MARKERS) {
    const range = findFuzzyRange(rawText, marker);
    if (range && range.start < postStoryStart) postStoryStart = range.start;
  }
  const afterNarrativeStart = readMarker ? readMarker.end : 0;
  const postStory = postStoryStart > afterNarrativeStart
    ? rawText.slice(Math.max(postStoryStart, afterNarrativeStart)).trim()
    : '';

  return { preReading, narrative: narrative.text, postStory, fullRaw: rawText };
}

module.exports = {
  normalize, squash, findFuzzyRange, findFuzzyIndex,
  extractPages, cleanPageText, extractNarrative, extractFullChapterSections,
  WORKBOOK_MARKERS,
};
