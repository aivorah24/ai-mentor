/**
 * Module 5 — illustrationAgent
 * Produces illustration PROMPTS + placement per meaningful concept (poem = 1 per
 * stanza, story = scene by scene, science = concept diagram, math = visual
 * manipulatives, social = map/timeline). NO image rendering pipeline exists yet
 * — this outputs prompts + placement only.
 *
 * It ALSO attaches any REAL extracted NCERT figure for the chapter (via the
 * existing figure filter / image index) so the Learn panel can show a genuine
 * on-topic image. It NEVER inserts a blank/placeholder box: figureUrl stays
 * undefined when no real figure passes the filter (reusing the pipeline's rule).
 */
const fs = require('fs');
const path = require('path');
const { callLLM } = require('./callLLM');

const IMAGE_MANIFEST = path.join(__dirname, '../../data/ncert_image_jsonl/ncert_images_index.json');
const MIN_FIGURE_AREA = 20000;
let _manifest = null;
function loadManifest() {
  if (_manifest) return _manifest;
  try { _manifest = JSON.parse(fs.readFileSync(IMAGE_MANIFEST, 'utf8')); }
  catch { _manifest = []; }
  return _manifest;
}

// Reuse the pipeline's figure-selection rule: real content illustrations only,
// exclude page-1 banners + wide-short banner strips + tiny icons.
function pickRealFigures({ subject, grade, chapter, code, chapterTitle, max = 4 }) {
  const manifest = loadManifest();
  const inChapter = manifest.filter(
    (m) => m.subject === subject && m.grade === grade && m.chapter === chapter && m.page > 1 &&
      (!code || (m.url || m.public_id || '').includes(code)),
  );
  const byArea = (a, b) => b.width * b.height - a.width * a.height;
  let ranked = inChapter.filter((m) => m.width / m.height < 2).sort(byArea);
  if (!ranked.length) ranked = inChapter.sort(byArea);
  const figures = [];
  const seenPages = new Set();
  for (const im of ranked) {
    if (im.width * im.height < MIN_FIGURE_AREA) continue;
    if (seenPages.has(im.page)) continue;
    seenPages.add(im.page);
    figures.push({ url: im.url, caption: chapterTitle });
    if (figures.length >= max) break;
  }
  if (figures.length === 0 && ranked[0]) figures.push({ url: ranked[0].url, caption: chapterTitle });
  return figures;
}

async function illustrate({ lesson, strategy, chapterMeta = {} }) {
  // 1. Generate placement-aware prompts (no rendering).
  const system = `You write concise text-to-image PROMPTS for child-friendly educational illustrations. Return strict JSON only.`;
  const anchor = strategy.illustration === 'per-stanza' ? 'one prompt per stanza/line of the poem'
    : strategy.illustration === 'scene-by-scene' ? 'one prompt per key scene of the story'
    : strategy.illustration === 'visual-manipulative' ? 'visual manipulatives (counters, blocks, number lines) for the maths idea'
    : strategy.illustration === 'map' ? 'a clear labelled map'
    : strategy.illustration === 'timeline' ? 'a clear labelled timeline'
    : 'concept diagrams';
  const anchorText = (lesson.originalLesson.length ? lesson.originalLesson : lesson.simplifiedExplanation).slice(0, 8).join('\n');
  const user = `Topic: "${lesson.title}" (Grade ${lesson.grade} ${lesson.subject}, ${strategy.type}).
Produce illustration prompts: ${anchor}.
Content to illustrate:
"""${anchorText.slice(0, 2500)}"""

Return JSON exactly:
{ "illustrationPrompts": [ { "placement": "where it goes (e.g. 'stanza 1', 'scene 2', 'concept card 1')", "prompt": "a vivid, child-friendly, culturally-Indian illustration prompt", "altText": "short accessibility alt text" } ] }

Rules:
- 2-6 prompts, warm and age-appropriate, grounded in the content above.
- No markdown, no text outside the JSON.`;
  let prompts = [];
  try {
    const out = await callLLM(system, user);
    prompts = Array.isArray(out.illustrationPrompts) ? out.illustrationPrompts.filter((p) => p && p.prompt) : [];
  } catch (e) {
    prompts = [];
  }
  lesson.illustrationPrompts = prompts;

  // 2. Attach real extracted NCERT figures if we know the chapter mapping.
  let figures = [];
  if (chapterMeta.chapterNo != null && chapterMeta.imageSubject) {
    figures = pickRealFigures({
      subject: chapterMeta.imageSubject, grade: lesson.grade, chapter: chapterMeta.chapterNo,
      code: chapterMeta.code, chapterTitle: lesson.title,
    });
  }
  lesson.figures = figures;
  lesson.figureUrl = figures[0]?.url; // undefined when none — never a placeholder box
  return lesson;
}

module.exports = { illustrate, pickRealFigures };
