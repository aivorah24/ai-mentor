/**
 * generate-chapter-no-llm.js
 *
 * Standalone, isolated proof-of-concept: builds chapter content WITHOUT any
 * LLM call, as a candidate fallback path for when OpenRouter/Groq quotas are
 * fully exhausted (see autopass.log — this happens for real, repeatedly).
 *
 * Deliberately kept separate from generate-chapter-subject-content.js so the
 * main LLM pipeline (currently running/recovering) is never touched by this
 * experiment. Nothing here writes into AIMentorApp/src/data or the shared
 * orchestrator checkpoint — output goes to a local sample file for review.
 *
 * Pipeline, all rule-based:
 *   1. Body: raw extracted PDF text, lightly cleaned (whitespace/OCR-artifact
 *      strip, same cleanPageText()/stripActivityCallouts() used by the LLM
 *      script), chunked into paragraphs. NOT rewritten/simplified.
 *   2. Figures: reuse the same ncert_images_index.json lookup the LLM script
 *      uses (pickFiguresForChapter) — no new extraction logic.
 *   3. Quiz: rule-based cloze (fill-in-the-blank) questions — picks
 *      capitalized multi-word terms and frequent non-stopword content words
 *      from the chapter text, blanks them out in the sentence they appear in.
 *   4. Audio: reuse the existing non-AI TikTok TTS call used by
 *      pregenerate-audio.js (no ElevenLabs/LLM — free text-to-speech API).
 *   5. Runs the SAME validateChapter() gate as the LLM pipeline, unmodified.
 *
 * Usage:
 *   node scripts/generate-chapter-no-llm.js --bookdir <dir> --code geky1 --grade 7
 *     --imagesubject Physical_Education --chapter 1 --pdf geky101.pdf --title "Chapter 1"
 *     --out <path-to-write-sample-json>
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pdf = require('pdf-parse');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}
const BOOK_DIR = argVal('--bookdir');
const CODE = argVal('--code');
const GRADE = parseInt(argVal('--grade', '7'), 10);
const IMAGE_SUBJECT = argVal('--imagesubject');
const CHAPTER_NUM = parseInt(argVal('--chapter', '1'), 10);
const PDF_FILE = argVal('--pdf');
const TITLE = argVal('--title', `Chapter ${CHAPTER_NUM}`);
const OUT_FILE = argVal('--out');
const MAX_FIGURES = 6;
const MIN_FIGURE_AREA = 20000;
const IMAGE_MANIFEST = path.join(__dirname, '../data/ncert_image_jsonl/ncert_images_index.json');
const AUDIO_DIR = path.join(__dirname, '../data/audio');

// ---------------------------------------------------------------------------
// 1. Raw text extraction + light cleanup (identical logic to the LLM script,
//    copied rather than imported so this file has zero dependency on it).
// ---------------------------------------------------------------------------
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

function cleanPageText(raw, bookTitleHint) {
  return raw
    .replace(/Chapter\s*\d+\.indd\s*\d+/gi, ' ')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*[AP]M/gi, ' ')
    .replace(/\d{1,2}-(?:\d{2}|[A-Za-z]{3})-\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*[AP]M/gi, ' ')
    .replace(/Reprint\s*20\d{2}-\d{2}/gi, ' ')
    .replace(new RegExp(bookTitleHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
    .replace(/\bChapter\b/g, ' ')
    .replace(/(?:^|\s)\d{1,3}(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripActivityCallouts(text) {
  return text.replace(/Activity\s*\d+\.\d+\s*:[^?]{0,200}\?/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Split cleaned raw text into paragraph-sized chunks — no rewriting, just
// grouping consecutive sentences up to ~120 words so the Learn panel gets
// readable paragraphs instead of one giant wall of text.
function rawTextToParagraphs(fullText, targetWords = 120) {
  const sentences = fullText.replace(/([.!?])\s+/g, '$1|').split('|').map((s) => s.trim()).filter(Boolean);
  const paras = [];
  let cur = [];
  let curWords = 0;
  for (const sent of sentences) {
    const w = sent.split(/\s+/).length;
    if (curWords + w > targetWords && cur.length > 0) {
      paras.push(cur.join(' '));
      cur = [];
      curWords = 0;
    }
    cur.push(sent);
    curWords += w;
  }
  if (cur.length) paras.push(cur.join(' '));
  return paras;
}

// ---------------------------------------------------------------------------
// 2. Figures — identical lookup logic to generate-chapter-subject-content.js,
//    reading the SAME already-built image index. No new extraction here.
// ---------------------------------------------------------------------------
function pickImagesForChapter(manifest, chapter) {
  const inChapter = manifest.filter(
    (m) => m.subject === IMAGE_SUBJECT && m.grade === GRADE && m.chapter === chapter && m.page > 1 &&
    (!CODE || (m.url || m.public_id || '').includes(CODE))
  );
  const byArea = (a, b) => b.width * b.height - a.width * a.height;
  const contentImgs = inChapter.filter((m) => m.width / m.height < 2).sort(byArea);
  if (contentImgs.length) return contentImgs;
  return inChapter.sort(byArea);
}
function pickFiguresForChapter(manifest, chapter, chapterTitle) {
  const ranked = pickImagesForChapter(manifest, chapter);
  const figures = [];
  const seenPages = new Set();
  for (const im of ranked) {
    if (im.width * im.height < MIN_FIGURE_AREA) continue;
    if (seenPages.has(im.page)) continue;
    seenPages.add(im.page);
    figures.push({ url: im.url, caption: chapterTitle });
    if (figures.length >= MAX_FIGURES) break;
  }
  if (figures.length === 0 && ranked[0]) figures.push({ url: ranked[0].url, caption: chapterTitle });
  return figures;
}

// ---------------------------------------------------------------------------
// 3. Rule-based cloze quiz — no LLM. Picks salient terms two ways:
//    (a) capitalized multi-word phrases (proper nouns / named concepts)
//    (b) most frequent capitalized-or-plain content words, stopwords removed
//    then blanks each term out in ONE sentence where it appears.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','to','in','on','for','with','is','are','was','were','be','been',
  'this','that','these','those','it','its','as','at','by','from','into','over','under','not','no','can',
  'will','would','should','could','you','your','we','our','they','their','he','she','his','her','them',
  'what','which','who','when','where','why','how','also','more','than','then','so','such','some','all',
  'each','other','about','if','do','does','did','has','have','had','one','two','three','let','us','chapter',
]);

function extractSentences(text) {
  return text.replace(/([.!?])\s+/g, '$1|').split('|').map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 6);
}

function extractCandidateTerms(text) {
  // (a) Capitalized multi-word phrases, e.g. "Body Mass Index", "Warm Up".
  const phraseMatches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g) || [];
  const phraseFreq = new Map();
  for (const p of phraseMatches) {
    if (/^(The|This|These|Chapter|Activity)\b/.test(p)) continue;
    phraseFreq.set(p, (phraseFreq.get(p) || 0) + 1);
  }
  // (b) Frequent single content words (lowercased for counting, keep original case).
  const words = text.match(/\b[A-Za-z]{4,}\b/g) || [];
  const wordFreq = new Map();
  for (const w of words) {
    const lw = w.toLowerCase();
    if (STOPWORDS.has(lw)) continue;
    wordFreq.set(lw, (wordFreq.get(lw) || 0) + 1);
  }
  const rankedPhrases = [...phraseFreq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const rankedWords = [...wordFreq.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { rankedPhrases, rankedWords };
}

function buildClozeQuiz(text, maxQuestions = 5) {
  const sentences = extractSentences(text);
  const { rankedPhrases, rankedWords } = extractCandidateTerms(text);
  const usedSentences = new Set();
  const questions = [];

  function tryTerm(term, displayTerm) {
    if (questions.length >= maxQuestions) return;
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    for (let i = 0; i < sentences.length; i++) {
      if (usedSentences.has(i)) continue;
      if (re.test(sentences[i])) {
        const blanked = sentences[i].replace(re, '_____');
        if (blanked === sentences[i]) continue; // safety: replace must have taken effect
        usedSentences.add(i);
        questions.push({ type: 'cloze', prompt: blanked, answer: displayTerm });
        return;
      }
    }
  }

  for (const term of rankedPhrases) tryTerm(term, term);
  for (const term of rankedWords) tryTerm(term, term);

  return questions;
}

// ---------------------------------------------------------------------------
// 4. Audio — reuse the same non-AI TikTok TTS call pregenerate-audio.js uses.
// ---------------------------------------------------------------------------
const TIKTOK_API = 'https://tiktok-tts.weilnet.workers.dev/api/generation';
const VOICE_MAIN = 'en_us_001';

function splitTextForTTS(text, maxLen = 190) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';
  for (const s of sentences) {
    const joined = current ? `${current} ${s}` : s;
    if (joined.length <= maxLen) current = joined;
    else { if (current) chunks.push(current); current = s.length > maxLen ? s.slice(0, maxLen) : s; }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.trim().length > 0);
}

async function generateAudio(text, label) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const cacheKey = crypto.createHash('md5').update(`tiktok|${VOICE_MAIN}|${text}`).digest('hex');
  const audioFile = `${cacheKey}.mp3`;
  const audioPath = path.join(AUDIO_DIR, audioFile);
  if (fs.existsSync(audioPath)) { console.log(`  [audio] SKIP (cached): ${label}`); return `/data/audio/${audioFile}`; }

  const chunks = splitTextForTTS(text);
  const buffers = [];
  for (const chunk of chunks) {
    try {
      const res = await fetch(TIKTOK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk, voice: VOICE_MAIN }),
      });
      const data = await res.json();
      if (!data.success || !data.data) throw new Error(`TikTok failed: ${JSON.stringify(data).slice(0, 150)}`);
      buffers.push(Buffer.from(data.data, 'base64'));
    } catch (e) {
      console.log(`  [audio] ! chunk failed: ${e.message} — skipping audio for this chapter`);
      return null;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const buffer = Buffer.concat(buffers);
  fs.writeFileSync(audioPath, buffer);
  console.log(`  [audio] OK (${(buffer.length / 1024).toFixed(0)}KB): ${label} → /data/audio/${audioFile}`);
  return `/data/audio/${audioFile}`;
}

// ---------------------------------------------------------------------------
// 5. Same validation gate as the LLM pipeline — copied verbatim, unmodified.
// ---------------------------------------------------------------------------
const MIN_BODY_CHARS = 200;
const MIN_BODY_PARAS = 2;
function validateChapter(c) {
  const reasons = [];
  const bodyText = (c.body || []).join(' ').trim();
  if ((c.body || []).length < MIN_BODY_PARAS) reasons.push(`body has <${MIN_BODY_PARAS} paragraphs`);
  if (bodyText.length < MIN_BODY_CHARS) reasons.push(`body too short (${bodyText.length}<${MIN_BODY_CHARS} chars)`);
  if (bodyText && c.intro && bodyText === c.intro.trim()) reasons.push('body duplicates intro');
  if (!c.figureUrl) reasons.push('no figure image');
  if (!c.listenParts || c.listenParts.length === 0) reasons.push('no listen parts');
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n=== No-LLM sample: ${CODE} Grade ${GRADE} ${IMAGE_SUBJECT} — "${TITLE}" (${PDF_FILE}) ===`);
  const pages = await extractPages(path.join(BOOK_DIR, PDF_FILE));
  const rawText = stripActivityCallouts(pages.map((p) => cleanPageText(p, TITLE)).join(' '));
  console.log(`  extracted ${rawText.length} chars of raw text across ${pages.length} pages`);

  const body = rawTextToParagraphs(rawText);
  const listenParts = body.map((text, i) => ({ heading: `Part ${i + 1}`, text }));

  let imageManifest = [];
  try { imageManifest = JSON.parse(fs.readFileSync(IMAGE_MANIFEST, 'utf8')); } catch (e) {}
  const figures = pickFiguresForChapter(imageManifest, CHAPTER_NUM, TITLE);
  const figureUrl = figures[0]?.url;
  console.log(`  ${figures.length} figure(s) selected from the existing image index (subject="${IMAGE_SUBJECT}")`);

  const quiz = buildClozeQuiz(rawText, 5);
  console.log(`  ${quiz.length} rule-based cloze question(s) built`);

  const audioUrl = await generateAudio(rawText.slice(0, 600), TITLE);

  const chapter = {
    name: TITLE,
    intro: `Chapter ${CHAPTER_NUM}: ${TITLE}.`, // no LLM-written intro — plain fact string
    body,
    figures,
    figureUrl,
    figureCaption: TITLE,
    listenParts,
    quiz,
    audioUrl,
  };

  const check = validateChapter(chapter);
  chapter.needsReview = !check.ok;
  console.log(`\n  validateChapter(): ${check.ok ? 'PASS' : 'FAIL'}${check.ok ? '' : ' — ' + check.reasons.join('; ')}`);

  if (OUT_FILE) {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(chapter, null, 2));
    console.log(`\n  Wrote sample → ${OUT_FILE}`);
  }
  return chapter;
}

main().catch((e) => { console.error(e); process.exit(1); });
