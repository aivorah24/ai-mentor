const { embed } = require('./embeddings');
const { searchContent, resolveCollection } = require('./qdrant');
const { resolveImageUrl } = require('./cloudinaryUrls');

const FOLLOW_UP_HINT_RE = /\b(more|another|examples?|same|that|this|again|please|explain more|real examples?)\b/i;

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function overlapRatio(aText, bText) {
  const a = new Set(tokenize(aText));
  const b = new Set(tokenize(bText));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / a.size;
}

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'assistant' || r === 'ai' || r === 'bot') return 'assistant';
  if (r === 'user' || r === 'human' || r === 'student') return 'user';
  return '';
}

function isLikelyFollowUp(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q) return false;
  const words = q.split(/\s+/).filter(Boolean);
  return words.length <= 7 && FOLLOW_UP_HINT_RE.test(q);
}

function getRecentUserQuestion(history) {
  if (!Array.isArray(history) || history.length === 0) return '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i] || {};
    if (normalizeRole(item.role) === 'user' && String(item.text || '').trim()) {
      return String(item.text).trim();
    }
  }
  return '';
}

function buildRetrievalQuestion({ question, topic, history }) {
  const q = String(question || '').trim();
  if (!q || topic || !isLikelyFollowUp(q)) return q;

  const previousUserQuestion = getRecentUserQuestion(history);
  if (!previousUserQuestion) return q;
  if (previousUserQuestion.toLowerCase() === q.toLowerCase()) return q;

  return `${previousUserQuestion}\nFollow-up question: ${q}`;
}

function inferSubjectFromText({ question, topic, history = [] }) {
  const text = `${question || ''} ${topic || ''} ${Array.isArray(history) ? history.map((h) => h?.text || '').join(' ') : ''}`.toLowerCase();
  const mathSignals = [
    'fraction', 'decimal', 'percent', 'addition', 'subtraction', 'multiply', 'division',
    'equation', 'algebra', 'geometry', 'perimeter', 'area', 'volume', 'ratio', 'number',
    'math', 'mathematics',
  ];
  if (mathSignals.some((k) => text.includes(k))) return 'Mathematics';

  const scienceSignals = ['photosynthesis', 'plant', 'water cycle', 'ecosystem', 'science', 'force', 'motion'];
  if (scienceSignals.some((k) => text.includes(k))) return 'Science';

  return '';
}

function rankResults({ results, question, topic, minScore, minVectorScore = 0, max }) {
  const topicText = String(topic || '').trim();

  return results
    .map((r) => {
      const p = r.payload || {};
      const haystack = `${p.topic || ''} ${p.unit || ''} ${p.content || ''}`;
      const lexical = Math.max(
        overlapRatio(question, haystack),
        topicText ? overlapRatio(topicText, haystack) : 0
      );
      const vectorScore = Number(r.score || 0);
      const blendedScore = (0.8 * vectorScore) + (0.2 * lexical);
      return { ...r, blendedScore };
    })
    .filter((r) => (r.score || 0) >= minVectorScore && r.blendedScore >= minScore)
    .sort((a, b) => b.blendedScore - a.blendedScore)
    .slice(0, max);
}

function buildContext(results) {
  if (!results.length) return '';
  return results
    .map((r) => {
      const p = r.payload || {};
      // Image chunks: include caption in context so LLM knows the image exists
      if (p.content_type === 'image' && p.image_url) {
        return `[${p.subject || ''} > ${p.topic || ''}]\n[IMAGE] ${p.text || ''}`;
      }
      return `[${p.subject || ''} > ${p.unit || ''} > ${p.topic || ''}]\n${p.text || p.content || ''}`;
    })
    .join('\n\n---\n\n');
}

function buildSources(results) {
  return results.map((r) => {
    const p = r.payload || {};
    return {
      subject: p.subject,
      unit: p.unit,
      topic: p.topic,
      score: Math.round((r.blendedScore || r.score || 0) * 100) / 100,
    };
  });
}

function buildImages(results) {
  return results
    .filter((r) => {
      const p = r.payload || {};
      return p.content_type === 'image' && (p.image_url || p.image_path);
    })
    .map((r) => {
      const p = r.payload || {};
      // Prefer image_url (Cloudinary); fall back to resolving image_path via Cloudinary map
      const url = p.image_url || resolveImageUrl(p.image_path);
      const captionSource = p.text || p.content || '';
      return {
        url,
        caption: captionSource.replace(/^\[IMAGE\]\s*/i, '').split('\n')[0].replace(/\*\*/g, '').replace(/\*/g, ''),
        subject: p.subject || '',
        grade: p.grade || '',
        topic: p.topic || '',
      };
    });
}

async function retrieveCurriculumContext({
  question,
  curriculum,
  grade,
  subject,
  topic,
  history = [],
  maxSources = 5,
}) {
  const inferredSubject = subject || inferSubjectFromText({ question, topic, history });
  const effectiveSubject = inferredSubject || undefined;
  const retrievalQuestion = buildRetrievalQuestion({ question, topic, history });
  const vector = await embed(retrievalQuestion);

  // Normalise curriculum + grade to match what's stored in Qdrant
  const normCurriculum = curriculum ? curriculum.replace(/_/g, ' ').trim() : curriculum;
  const { collection: qdrantCollection, qdrantGrade, qdrantCurriculum } = resolveCollection(normCurriculum, grade);

  const strictResults = await searchContent({
    vector,
    curriculum: qdrantCurriculum,
    grade: qdrantGrade,
    subject: effectiveSubject,
    topic,
    limit: 10,
    collection: qdrantCollection,
  });

  let selected = rankResults({
    results: strictResults,
    question: retrievalQuestion,
    topic,
    minScore: 0.28,
    minVectorScore: 0.18,
    max: maxSources,
  });
  let strategy = 'strict_topic';
  let broadResults = [];

  if (selected.length === 0) {
    broadResults = await searchContent({
      vector,
      curriculum: qdrantCurriculum,
      grade: qdrantGrade,
      subject: effectiveSubject,
      limit: 12,
      collection: qdrantCollection,
    });

    selected = rankResults({
      results: broadResults,
      question: retrievalQuestion,
      topic,
      minScore: 0.22,
      minVectorScore: 0.12,
      max: maxSources,
    });
    strategy = 'broad_subject';
  }

  return {
    context: buildContext(selected),
    sources: buildSources(selected),
    images: buildImages(selected.filter((r) => (r.score || 0) >= 0.30)),
    meta: {
      strategy,
      strictCandidates: strictResults.length,
      broadCandidates: broadResults.length,
      selected: selected.length,
      usedFollowUpExpansion: retrievalQuestion !== String(question || '').trim(),
      subjectUsed: effectiveSubject || '',
      subjectInferred: Boolean(!subject && effectiveSubject),
    },
  };
}

/**
 * Dedicated NCERT image retrieval for IB PYP fallback.
 * Searches ONLY image chunks in the NCERT collection via vector similarity.
 * No topic filter (NCERT image topics are captions, not real topic names).
 */
async function retrieveNcertImages({ question, subject, topic, grade, maxImages = 3 }) {
  const queryText = `${question || ''} ${topic || ''}`.trim();
  if (!queryText) return [];

  const vector = await embed(queryText);

  // Resolve the NCERT grade to search.
  // IB PYP Grade 3/4/5 students → search NCERT Grade 3/4/5 only (never show Grade 8 diagrams to Grade 3 kids).
  // If no grade given, default to Grade 3/4/5 range (safe for primary school).
  const gradeNum = String(grade || '').match(/(\d+)/)?.[1];
  const ncertGrade = gradeNum ? parseInt(gradeNum, 10) : null;

  // Only allow primary grades (3–5). Higher grade images are too complex for primary students.
  // If the student's grade maps to a higher NCERT grade, skip NCERT images entirely.
  if (ncertGrade && ncertGrade > 5) return [];

  const { collection: ncertCollection } = resolveCollection('NCERT', ncertGrade ? `Grade ${ncertGrade}` : undefined);

  // Infer subject from the question if not provided
  const effectiveSubject = subject || inferSubjectFromText({ question, topic, history: [] });

  // Search with subject + grade + topic filter for relevant images
  const results = await searchContent({
    vector,
    curriculum: 'NCERT',
    grade: ncertGrade || undefined,
    subject: effectiveSubject || undefined,
    topic: topic || undefined,
    contentType: 'image',
    limit: maxImages + 4,
    collection: ncertCollection,
  });

  // Higher threshold — NCERT images shown to IB PYP students must be very confident matches.
  // Better to show no image than a wrong/confusing one.
  const MIN_IMAGE_SCORE = 0.65;
  let relevant = results.filter((r) => (r.score || 0) >= MIN_IMAGE_SCORE);

  // Validate caption relevance: image caption/text must share multiple keywords with the question
  const questionWords = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  relevant = relevant.filter((r) => {
    const caption = ((r.payload?.text || '') + ' ' + (r.payload?.topic || '')).toLowerCase();
    // Require at least 2 keyword matches for confidence, or 1 if it's a very specific term
    const matches = questionWords.filter(w => caption.includes(w));
    return matches.length >= 2 || (matches.length === 1 && matches[0].length >= 6);
  });

  // Filter out generic/unhelpful captions (e.g. "This image illustrates...")
  const GENERIC_CAPTION_RE = /^this image (illustrates|shows|depicts|represents)/i;
  relevant = relevant.filter((r) => {
    const caption = (r.payload?.text || '').trim();
    // If the caption is just a generic "This image illustrates X" with no real detail, skip it
    if (GENERIC_CAPTION_RE.test(caption) && caption.length < 80) return false;
    return true;
  });

  // If subject-filtered search found nothing, try broader but with even higher threshold
  // Broad fallback — still enforce grade filter and raise threshold
  if (relevant.length === 0) {
    const broadResults = await searchContent({
      vector,
      curriculum: 'NCERT',
      grade: ncertGrade || undefined,   // never cross grade boundaries
      contentType: 'image',
      limit: maxImages + 2,
      collection: ncertCollection,
    });
    relevant = broadResults
      .filter((r) => (r.score || 0) >= 0.68)  // higher bar for broad search
      .filter((r) => {
        const caption = ((r.payload?.text || '') + ' ' + (r.payload?.topic || '')).toLowerCase();
        const matches = questionWords.filter(w => caption.includes(w));
        return matches.length >= 2;
      })
      .filter((r) => !GENERIC_CAPTION_RE.test((r.payload?.text || '').trim()));
  }

  return buildImages(relevant).slice(0, maxImages);
}

module.exports = {
  retrieveCurriculumContext,
  retrieveNcertImages,
  buildRetrievalQuestion,
  isLikelyFollowUp,
  inferSubjectFromText,
  rankResults,
  overlapRatio,
  buildImages,
};
