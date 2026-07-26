/**
 * Module 6 — audioAgent
 * Builds a sentence-by-sentence narration script (never word-by-word),
 * teacher-like with natural pauses, per-sentence highlight markers + estimated
 * timestamps. Strips NCERT page furniture via the shared cleaner so no print
 * junk is ever spoken. MATHS = NO audio (founder directive) — returns null.
 *
 * The output feeds the LessonScreen "Listen" tab as listenParts (heading+text),
 * plus a richer audioNarrationScript with sentence markers for the highlighter.
 */
const { cleanForAudio } = require('./textCleaner');

const WPM = 130; // gentle read-aloud pace for young learners

function splitSentences(text) {
  return text.replace(/([.!?])\s+/g, '$1|').split('|').map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {{ lesson:object, strategy:object, sourceText:string }} args
 * @returns {{ audioNarrationScript:object|null, listenParts:Array|undefined }}
 */
function buildAudio({ lesson, strategy, sourceText }) {
  if (strategy.audio === false) {
    return { audioNarrationScript: null, listenParts: undefined, skipped: 'maths-no-audio' };
  }
  // Prefer the verbatim original (poem/story) so the child hears the real text;
  // fall back to the simplified explanation.
  const base = (lesson.originalLesson && lesson.originalLesson.join(' ').trim().length > 40)
    ? lesson.originalLesson.join(' ')
    : (lesson.simplifiedExplanation.join(' ') || sourceText);
  const clean = cleanForAudio(base);
  const sentences = splitSentences(clean);
  if (!sentences.length) return { audioNarrationScript: null, listenParts: undefined, skipped: 'no-clean-text' };

  // Sentence-by-sentence markers with running timestamps.
  let t = 0;
  const markers = sentences.map((s, i) => {
    const words = s.split(/\s+/).length;
    const dur = Math.max(1.2, (words / WPM) * 60);
    const start = t; t += dur + 0.4; // + natural pause
    return { index: i, text: s, startSec: Number(start.toFixed(1)), durationSec: Number(dur.toFixed(1)) };
  });

  // Group into 2-4 Listen "parts" for the tab UI.
  const target = Math.ceil(sentences.length / 3) || 1;
  const parts = []; let cur = [];
  for (const s of sentences) { cur.push(s); if (cur.length >= target) { parts.push(cur.join(' ')); cur = []; } }
  if (cur.length) parts.push(cur.join(' '));
  const listenParts = parts.slice(0, 4).map((p, i) => ({ heading: `Part ${i + 1}`, text: p }));

  return {
    audioNarrationScript: {
      voice: 'teacher-warm',
      totalSec: Number(t.toFixed(1)),
      sentences: markers,
    },
    listenParts,
    estListeningSec: Number(t.toFixed(1)),
  };
}

module.exports = { buildAudio };
