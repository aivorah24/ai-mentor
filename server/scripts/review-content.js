/**
 * review-content.js
 * Content QA pipeline — validates the AI-generated Listen-tab content
 * against the real NCERT chapter it's supposed to teach, scores it on a
 * rubric, and (if the score is low) improves only the gaps rather than
 * regenerating the whole chapter.
 *
 * Scope for this run: CBSE / Grade 6 / English only. Built modular so a
 * future curriculum can plug in its own topic manifest + syllabus reader
 * without touching the scoring/improve logic.
 *
 * Usage:
 *   cd server && node scripts/review-content.js
 *   node scripts/review-content.js --topic "The Chair"   # single chapter
 *   node scripts/review-content.js --force                # re-review even if already reviewed
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { extractPages, findFuzzyRange, extractFullChapterSections } = require('./lib/pdfText');
const { readTopicContent } = require('./lib/readCurrentSyllabus');

const BOOK_DIR = path.join(__dirname, '../data/ncert_books/grade6/english');
const IMAGE_MANIFEST = path.join(__dirname, '../data/ncert_image_jsonl/ncert_images_index.json');
const MANIFEST_FILE = path.join(__dirname, '../data/curricula/cbse-g6-english-topics.json');
const OUT_DIR = path.join(__dirname, '../data/generated');
const METADATA_FILE = path.join(OUT_DIR, 'englishG6ReviewMetadata.json');
const LOG_DIR = path.join(OUT_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'englishG6Review.log');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const PUBLISH_THRESHOLD = 95;

const args = process.argv.slice(2);
const onlyTopic = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : null;
const force = args.includes('--force');

// ── Structured logging — one JSON line per step, per chapter ────────────────
fs.mkdirSync(LOG_DIR, { recursive: true });
function log(step, topic, data) {
  const entry = { ts: new Date().toISOString(), step, topic, ...data };
  console.log(`[${step}] ${topic}${data.summary ? ' — ' + data.summary : ''}`);
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

function findImagesForChapter(manifest, chapter, startPage, endPage) {
  return manifest.filter(
    (m) => m.subject === 'English' && m.grade === 6 && m.chapter === chapter &&
      m.page >= startPage && m.page <= endPage,
  );
}

async function callGroqJSON(system, user) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in server/.env');
  let lastErr;
  for (const model of GROQ_MODELS) {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body,
      });
      if (res.ok) {
        const data = await res.json();
        return JSON.parse(data.choices?.[0]?.message?.content || '{}');
      }
      const errText = await res.text();
      if (res.status === 429) {
        if (/tokens per day|requests per day/i.test(errText)) {
          lastErr = new Error(`Groq daily quota: ${errText.slice(0, 150)}`);
          break;
        }
        const waitMatch = errText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? parseFloat(waitMatch[1]) + 1 : 15 * (attempt + 1);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        lastErr = new Error(`Groq 429: ${errText.slice(0, 150)}`);
        continue;
      }
      throw new Error(`Groq ${res.status}: ${errText.slice(0, 300)}`);
    }
  }
  throw lastErr;
}

// ── Step 2: Review — score generated content against the original chapter ──
async function reviewChapter(topicName, original, generated) {
  const system = `You are a strict CBSE Grade 6 English curriculum reviewer. You compare an AI-generated "Listen along" learning experience against the REAL textbook chapter it is supposed to teach, and score it honestly. Be skeptical — do not give high scores by default. Return strict JSON only.`;

  // Include keyIdea — it's a separate field from the real narrative text,
  // and things like illustration references get written there, not into
  // the verbatim `text`. Leaving it out meant the reviewer could never see
  // (or credit) illustration mentions even when they existed.
  const generatedText = generated.listenParts
    .map((p) => `[${p.heading}] ${p.text}${p.keyIdea ? `\n(Summary/key idea for this part: ${p.keyIdea})` : ''}`)
    .join('\n\n');
  const generatedVocab = generated.vocab.map((v) => `${v.word}: ${v.definition}`).join('; ');

  const user = `Chapter: "${topicName}"

=== ORIGINAL TEXTBOOK CHAPTER ===
Pre-reading activities: ${original.preReading.slice(0, 800) || '(none found)'}
Main narrative: ${original.narrative}
Post-story activities/exercises: ${original.postStory.slice(0, 1500) || '(none found)'}

=== CURRENT AI-GENERATED CONTENT ===
Intro: ${generated.intro}
Body summary: ${generated.body.join(' ')}
Listen-along parts: ${generatedText}
Vocabulary taught: ${generatedVocab || '(none)'}
Number of illustrations referenced: ${generated.figureUrl ? 1 : 0}
Comprehension questions included: ${generated.listenParts.filter((p) => p.hasPauseThink).length}

Score the AI-generated content against the original chapter on these 9 dimensions, each 0-100:
- coverage: are all important concepts/plot points from the original covered?
- storyFlow: does the simplified version preserve the story's sequence and logic correctly?
- learningObjectives: could a student achieve this chapter's intended learning outcomes from the generated content alone?
- vocabulary: are the important new/difficult words from the original explained?
- activities: are pre-reading, discussion, and reflection elements represented in some form (even if reworded as comprehension questions)?
- illustrations: does ANY part's text OR "key idea" summary reference/describe the textbook illustration (e.g. "As shown in the picture...")? Check both fields, not just the main text.
- readability: is the generated content's language level appropriate for an average Grade 6 student?
- hallucination: does the AI-generated content introduce facts, characters, or events NOT in the original chapter? (0 = no hallucination/perfectly faithful, 100 = severely hallucinated — score LOW is GOOD here)
- engagement: is the generated content likely to keep a Grade 6 student interested?

Return JSON exactly:
{
  "coverage": 0-100, "storyFlow": 0-100, "learningObjectives": 0-100, "vocabulary": 0-100,
  "activities": 0-100, "illustrations": 0-100, "readability": 0-100, "hallucination": 0-100, "engagement": 0-100,
  "missing": ["specific short phrases naming what's missing or weak — be concrete, e.g. 'Character motivation for X', 'Vocabulary word: Y', 'No reference to the illustration'"]
}`;

  const scores = await callGroqJSON(system, user);
  const dims = ['coverage', 'storyFlow', 'learningObjectives', 'vocabulary', 'activities', 'illustrations', 'readability', 'engagement'];
  const overall = dims.reduce((sum, d) => sum + (scores[d] ?? 0), 0) / dims.length
    - (scores.hallucination ?? 0) * 0.3; // hallucination penalises overall, doesn't average in directly
  return { ...scores, overall: Math.max(0, Math.round(overall * 10) / 10) };
}

// ── Step 4: Improve — fill only the gaps the reviewer flagged ───────────────
async function improveChapter(topicName, original, generated, missing) {
  const system = `You add SUPPLEMENTARY content to an existing Grade 6 English "Listen along" learning experience, to fix specific gaps a reviewer found. You must NOT rewrite or replace existing good content — only produce ADDITIONS. Ground everything in the real chapter text given. Return strict JSON only.`;

  const user = `Chapter: "${topicName}"

Original chapter narrative (for grounding — do not introduce anything not supported by this):
${original.narrative}

Current vocabulary already taught: ${generated.vocab.map((v) => v.word).join(', ') || '(none)'}

Reviewer found these specific gaps:
${missing.map((m, i) => `${i + 1}. ${m}`).join('\n')}

For each gap that is a MISSING VOCABULARY WORD, add it to "additionalVocab".
For each gap that is a MISSING STORY BEAT / character detail / illustration reference / concept, write ONE additional listen-part addressing it in "additionalPart" (a single part: heading + text (a real, grounded 2-4 sentence addition, not invented) + keyIdea). If multiple non-vocab gaps exist, address the most important one only (one small addition, not a rewrite).
If a gap doesn't clearly map to either, skip it.

Return JSON exactly:
{
  "additionalVocab": [ { "word": "...", "definition": "..." } ],
  "additionalPart": { "heading": "...", "text": "...", "keyIdea": "..." } or null
}`;

  return callGroqJSON(system, user);
}

// ── Step 1: Load — original chapter (PDF) + current generated content ──────
async function loadOriginal(unit, topic, pdfPagesCache) {
  if (!pdfPagesCache[unit.pdfFile]) {
    pdfPagesCache[unit.pdfFile] = await extractPages(path.join(BOOK_DIR, unit.pdfFile));
  }
  const pages = pdfPagesCache[unit.pdfFile];

  // Reuse the same fuzzy title search the generation pipeline uses.
  const { findFuzzyIndex } = require('./lib/pdfText');
  const startPage = findFuzzyIndex(pages.join(' \f '), topic.match) !== -1
    ? pages.findIndex((p) => findFuzzyRange(p, topic.match))
    : -1;
  // Fallback: search page-by-page (more reliable than the joined-text index above).
  let resolvedStart = startPage;
  if (resolvedStart === -1) {
    resolvedStart = pages.findIndex((p) => findFuzzyRange(p, topic.match));
  }
  if (resolvedStart === -1) return null;

  // End page = start of next topic in this unit, or end of book section.
  const idx = unit.topics.indexOf(topic);
  const nextTopic = unit.topics[idx + 1];
  let endPage = pages.length - 1;
  if (nextTopic) {
    const nextStart = pages.findIndex((p) => findFuzzyRange(p, nextTopic.match));
    if (nextStart !== -1) endPage = Math.max(resolvedStart, nextStart - 1);
  }

  const sections = extractFullChapterSections(pages, resolvedStart, endPage);
  return { ...sections, startPage: resolvedStart + 1, endPage: endPage + 1 }; // 1-indexed for image lookup
}

// ── Step 5: Store metadata ───────────────────────────────────────────────
function loadMetadata() {
  if (!fs.existsSync(METADATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8')); } catch { return []; }
}
function saveMetadata(all) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(METADATA_FILE, JSON.stringify(all, null, 2));
}

// ── Applying an "improve" pass back into cbseG6EnglishSyllabus.ts ──────────
function applyImprovement(topicName, additionalVocab, additionalPart) {
  const { TS_FILE } = require('./lib/readCurrentSyllabus');
  let src = fs.readFileSync(TS_FILE, 'utf8');
  const nameEscaped = topicName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function tsStringLiteral(s) {
    return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  if (additionalVocab && additionalVocab.length > 0) {
    const vocabArrRe = new RegExp(`(name:\\s*'${nameEscaped}'[\\s\\S]{0,20000}?vocab:\\s*\\[[\\s\\S]*?\\n)(\\s*)(\\],)`);
    const m = src.match(vocabArrRe);
    if (m) {
      const newLines = additionalVocab
        .map((v) => `${m[2]}{ word: ${tsStringLiteral(v.word)}, definition: ${tsStringLiteral(v.definition)} },\n`)
        .join('');
      src = src.replace(vocabArrRe, (whole, before, indent, close) => `${before}${newLines}${indent}${close}`);
    }
  }

  if (additionalPart) {
    const listenPartsArrRe = new RegExp(`(name:\\s*'${nameEscaped}'[\\s\\S]{0,20000}?listenParts:\\s*\\[[\\s\\S]*?\\n)(\\s*)(\\],)`);
    const m = src.match(listenPartsArrRe);
    if (m) {
      const indent = m[2];
      const partSrc =
        `${indent}{\n` +
        `${indent}  heading: ${tsStringLiteral(additionalPart.heading)},\n` +
        `${indent}  text: ${tsStringLiteral(additionalPart.text)},\n` +
        `${indent}  keyIdea: ${tsStringLiteral(additionalPart.keyIdea)},\n` +
        `${indent}},\n`;
      src = src.replace(listenPartsArrRe, (whole, before, ind, close) => `${before}${partSrc}${ind}${close}`);
    }
  }

  fs.writeFileSync(TS_FILE, src);
}

// ── Main pipeline ────────────────────────────────────────────────────────
async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const imageManifest = JSON.parse(fs.readFileSync(IMAGE_MANIFEST, 'utf8'));
  const existingMetadata = loadMetadata();
  const metaByName = new Map(existingMetadata.map((m) => [m.chapter, m]));
  const pdfPagesCache = {};

  for (const unit of manifest.units) {
    for (const topic of unit.topics) {
      if (onlyTopic && topic.name !== onlyTopic) continue;
      if (!force && metaByName.has(topic.name)) {
        console.log(`= "${topic.name}" already reviewed — skipping (use --force to redo)`);
        continue;
      }

      // Step 1: Load
      const original = await loadOriginal(unit, topic, pdfPagesCache);
      if (!original) {
        log('load', topic.name, { summary: 'could not locate chapter in source PDF', ok: false });
        continue;
      }
      const generated = readTopicContent(topic.name);
      if (!generated || generated.listenParts.length === 0) {
        log('load', topic.name, { summary: 'no generated content found in syllabus file', ok: false });
        continue;
      }
      const images = findImagesForChapter(imageManifest, unit.chapter, original.startPage, original.endPage);
      log('load', topic.name, {
        summary: `narrative ${original.narrative.length} chars, ${images.length} images, ${generated.listenParts.length} generated parts`,
        ok: true,
      });

      // Step 2 + 3: Review + Score
      let scores;
      try {
        scores = await reviewChapter(topic.name, original, generated);
      } catch (err) {
        log('review', topic.name, { summary: `FAILED: ${err.message}`, ok: false });
        continue;
      }
      log('review', topic.name, { summary: `overall ${scores.overall}`, scores });

      let version = 'v1';
      let finalScores = scores;

      // Step 4: Improve (only if below threshold)
      if (scores.overall < PUBLISH_THRESHOLD && scores.missing?.length > 0) {
        try {
          const improvement = await improveChapter(topic.name, original, generated, scores.missing);
          const hasVocab = improvement.additionalVocab?.length > 0;
          const hasPart = !!improvement.additionalPart;
          if (hasVocab || hasPart) {
            applyImprovement(topic.name, improvement.additionalVocab, improvement.additionalPart);
            log('improve', topic.name, {
              summary: `added ${improvement.additionalVocab?.length || 0} vocab, ${hasPart ? 1 : 0} part`,
              improvement,
            });
            // Re-review against the improved content to get the final score.
            const regenerated = readTopicContent(topic.name);
            finalScores = await reviewChapter(topic.name, original, regenerated);
            version = 'v2';
            log('review', topic.name, { summary: `re-reviewed after improve: overall ${finalScores.overall}`, scores: finalScores });
          } else {
            log('improve', topic.name, { summary: 'reviewer found gaps but nothing concrete to add', ok: false });
          }
        } catch (err) {
          log('improve', topic.name, { summary: `FAILED: ${err.message}`, ok: false });
        }
      } else {
        log('improve', topic.name, { summary: 'skipped — score already at/above threshold', ok: true });
      }

      // Step 5: Store metadata
      const record = {
        chapter: topic.name,
        unit: unit.unit,
        coverage: finalScores.coverage,
        storyFlow: finalScores.storyFlow,
        learningObjectives: finalScores.learningObjectives,
        vocabulary: finalScores.vocabulary,
        activities: finalScores.activities,
        illustrations: finalScores.illustrations,
        readability: finalScores.readability,
        hallucination: finalScores.hallucination,
        engagement: finalScores.engagement,
        overall: finalScores.overall,
        missing: finalScores.missing || [],
        published: finalScores.overall >= PUBLISH_THRESHOLD,
        version,
        reviewedAt: new Date().toISOString(),
      };
      metaByName.set(topic.name, record);
      saveMetadata(Array.from(metaByName.values()));
      log('store', topic.name, { summary: `published=${record.published}, version=${version}` });
    }
  }

  console.log(`\nDone. ${metaByName.size} chapters reviewed. Metadata → ${METADATA_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
