/**
 * CBSE / NCERT CurriculumProvider — an adapter over EXISTING code paths.
 * Zero behavior change for CBSE: routes/curriculum.js and routes/ncert.js
 * are left completely untouched; this provider calls the same underlying
 * Qdrant reads via legacy/cbseQdrantReader.js (an extraction, not a rewrite)
 * and ports the exact same availability heuristics already in ncert.js
 * (`hasContent`, `SCIENCE_READY_TOPICS`) rather than replacing them.
 */
const { readSubjects, topicHasContent, topicHasImages } = require('../legacy/cbseQdrantReader');
const { resolveAllResources } = require('../resourceResolver');
const supabase = require('../../../services/supabase');

// Ported verbatim from routes/ncert.js:184-186 — the one existing
// hand-maintained allow-list for "practice is actually ready" on CBSE.
const SCIENCE_READY_TOPICS = new Set(['Living and Non-Living Things']);

const meta = { id: 'NCERT', displayName: 'CBSE (NCERT)' };

async function listGrades() {
  // Existing CBSE ingestion covers Class 3 (NCERT Maths Mela) plus whatever
  // grades have been through the newer syllabus-import flow. No single
  // existing endpoint enumerates "all ingested grades" today, so this
  // conservatively surfaces the grades the current UI already targets.
  return [3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: `grade-${n}`, label: `Grade ${n}` }));
}

async function listSubjects(gradeId) {
  const grade = gradeLabelFromId(gradeId);
  const { subjects } = await readSubjects({ curriculum: 'NCERT', grade });
  return subjects.map((s) => ({ id: s.subject, label: s.subject }));
}

async function listUnitsAndChapters(gradeId, subjectId) {
  const grade = gradeLabelFromId(gradeId);
  const { subjects } = await readSubjects({ curriculum: 'NCERT', grade });
  const match = subjects.find((s) => s.subject === subjectId);
  if (!match) return { units: [], chapters: [] };

  // Prefer real structure from syllabus_chapters when this grade/subject has
  // been through the teacher syllabus-import flow.
  const { data: chapterRows } = await supabase
    .from('syllabus_chapters')
    .select('id, unit_no, title')
    .eq('curriculum', 'CBSE')
    .eq('grade', grade)
    .eq('subject', subjectId)
    .order('unit_no', { ascending: true });

  if (chapterRows && chapterRows.length > 0) {
    const chapters = chapterRows.map((c) => ({ id: c.id, unitId: null, title: c.title, order: c.unit_no, status: 'READY' }));
    return { units: [], chapters };
  }

  // Legacy flat content — synthesize one chapter per Qdrant "unit" grouping,
  // same grouping the current UI already derives from `unit`/`chapter` fields.
  const chapters = match.topics.map((t, i) => ({
    id: `${subjectId}::${t.topic}`,
    unitId: null,
    title: t.unit || t.topic,
    order: t.chapter || i,
    status: 'READY',
  }));
  return { units: [], chapters };
}

async function listTopics(chapterId) {
  // Real syllabus_topics rows for imported CBSE content.
  const { data: topicRows } = await supabase
    .from('syllabus_topics')
    .select('id, chapter_id, topic_order, name, kind')
    .eq('chapter_id', chapterId)
    .order('topic_order', { ascending: true });
  if (topicRows && topicRows.length > 0) {
    return topicRows.map((t) => ({ id: t.id, chapterId: t.chapter_id, name: t.name, order: t.topic_order, kind: t.kind }));
  }

  // Legacy flat content: chapterId is the synthetic `${subject}::${topic}` key
  // built in listUnitsAndChapters — a single topic per synthetic chapter.
  const legacyTopic = chapterId.split('::')[1];
  if (!legacyTopic) return [];
  return [{ id: chapterId, chapterId, name: legacyTopic, order: 0 }];
}

async function getTopicContent(topicId) {
  // Real syllabus_topics row — go through the generic resolver against topic_resources.
  const { data: topicRow } = await supabase
    .from('syllabus_topics')
    .select('id, chapter_id, topic_order, name, kind, intro')
    .eq('id', topicId)
    .maybeSingle();

  if (topicRow) {
    const resources = await resolveAllResources({ topicId });
    return {
      topic: { id: topicRow.id, chapterId: topicRow.chapter_id, name: topicRow.name, order: topicRow.topic_order, kind: topicRow.kind },
      resources,
    };
  }

  // Legacy flat content — topicId is the synthetic `${subject}::${topic}` key.
  const [subject, topicName] = topicId.includes('::') ? topicId.split('::') : [null, topicId];
  const [hasContent, hasImages] = await Promise.all([
    topicHasContent({ curriculum: 'NCERT', topic: topicName }),
    topicHasImages({ curriculum: 'NCERT', topic: topicName }),
  ]);

  const resources = await resolveAllResources({
    topicId,
    legacyResolvers: {
      // Book/AI explanation are backed by the same Qdrant text chunks the
      // existing RAG chat and PDF viewer already serve — READY whenever any
      // content exists for the topic (matches ncert.js's `hasContent`).
      BOOK_REFERENCE: async () => (hasContent
        ? { id: `${topicId}:BOOK_REFERENCE`, topicId, resourceType: 'BOOK_REFERENCE', status: 'READY', sourceTier: 'OFFICIAL_BOOK', source: 'NCERT textbook', payload: null }
        : null),
      AI_EXPLANATION: async () => (hasContent
        ? { id: `${topicId}:AI_EXPLANATION`, topicId, resourceType: 'AI_EXPLANATION', status: 'READY', sourceTier: 'OFFICIAL_BOOK', source: 'NCERT textbook', payload: null }
        : null),
      IMAGES: async () => ({
        id: `${topicId}:IMAGES`, topicId, resourceType: 'IMAGES',
        status: hasImages ? 'READY' : 'COMING_SOON',
        sourceTier: hasImages ? 'OFFICIAL_BOOK' : 'PLACEHOLDER',
        source: hasImages ? 'NCERT textbook' : null,
        payload: null,
      }),
      PRACTICE: async () => ({
        id: `${topicId}:PRACTICE`, topicId, resourceType: 'PRACTICE',
        status: SCIENCE_READY_TOPICS.has(topicName) || hasContent ? 'READY' : 'COMING_SOON',
        sourceTier: 'OFFICIAL_BOOK',
        source: null,
        payload: null,
      }),
      // Honestly report what doesn't exist for CBSE today rather than
      // fabricating availability — matches none of these being built yet.
      FLASHCARDS: async () => ({ id: `${topicId}:FLASHCARDS`, topicId, resourceType: 'FLASHCARDS', status: 'NOT_AVAILABLE', sourceTier: null, source: null, payload: null }),
      WORKSHEETS: async () => ({ id: `${topicId}:WORKSHEETS`, topicId, resourceType: 'WORKSHEETS', status: 'NOT_AVAILABLE', sourceTier: null, source: null, payload: null }),
      OER_MAPPING: async () => ({ id: `${topicId}:OER_MAPPING`, topicId, resourceType: 'OER_MAPPING', status: 'NOT_AVAILABLE', sourceTier: null, source: null, payload: null }),
      AUDIO: async () => ({ id: `${topicId}:AUDIO`, topicId, resourceType: 'AUDIO', status: 'NOT_AVAILABLE', sourceTier: null, source: null, payload: null }),
    },
  });

  return { topic: { id: topicId, chapterId: subject ? `${subject}::chapter` : '', name: topicName, order: 0 }, resources };
}

async function search(query, opts = {}) {
  // Thin delegation to the existing search route's underlying pieces would
  // require pulling in embeddings — out of scope for this pass; the v1
  // /curriculum/search route remains the supported search path for CBSE.
  return [];
}

function gradeLabelFromId(gradeId) {
  const m = String(gradeId || '').match(/(\d+)/);
  return m ? `Grade ${m[1]}` : gradeId;
}

module.exports = { meta, listGrades, listSubjects, listUnitsAndChapters, listTopics, getTopicContent, search };
