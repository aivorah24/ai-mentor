/**
 * textCleaner.js — the single strong NCERT page-furniture cleaner, reused by the
 * retrievalAgent (so understanding/generation never sees junk) and the audioAgent
 * (so the read-aloud voice never speaks "Reprint 2026-27 / Chapter 1.indd / Unit 1
 * ... Sight words / Note to the teacher"). Ported from
 * scripts/populate-g1-topic-content.js cleanForAudio + reclean-listen.js.
 */
function cleanForAudio(text) {
  return String(text)
    .replace(/\d{1,2}-\d{1,2}-\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?/g, ' ')
    .replace(/\bReprint\s*20\d{2}-\d{2}\b/gi, ' ')
    .replace(/Chapter\s*\d+\.indd\s*\d+/gi, ' ')
    .replace(/\bMridang\b/g, ' ')
    .replace(/\bUnit\s*\d+\b[^.]*?\bChapter\s*\d+\b[^.]*?(?=\bLet us\b|\bSight words\b|[A-Z][a-z])/gi, ' ')
    .replace(/\bLet us (sing|read|speak|do|write|match|play|learn|listen)\b/gi, ' ')
    .replace(/\b\d*\s*Sight words\b[^.]*?(?=[A-Z][a-z])/gi, ' ')
    .replace(/\bNew words\b[^.]*/gi, ' ')
    .replace(/\bNote to the teacher\b[^]*/gi, ' ')
    .replace(/\b[A-D]\.\s*(Repeat after the teacher|Talk in pairs|Read|Match|Circle|Look and say|Draw)\b[^]*/gi, ' ')
    .replace(/\b(Teacher|Children|Nitin|Neha)\s*:[^]*/gi, ' ')
    .replace(/\bNow circle\b[^.]*\.?/gi, ' ')
    .replace(/\bAsk your partner\b[^.]*\.?/gi, ' ')
    .replace(/[•·]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Lighter clean for the "understand/generate" corpus: drop only print furniture
// (dates, .indd marks, reprint stamps) but keep pedagogical structure so the
// understanding agent can still see activities/word lists as signal.
function cleanForCorpus(text) {
  return String(text)
    .replace(/\d{1,2}-\d{1,2}-\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?/g, ' ')
    .replace(/\bReprint\s*20\d{2}-\d{2}\b/gi, ' ')
    .replace(/Chapter\s*\d+\.indd\s*\d+/gi, ' ')
    .replace(/\bMridang\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = { cleanForAudio, cleanForCorpus };
