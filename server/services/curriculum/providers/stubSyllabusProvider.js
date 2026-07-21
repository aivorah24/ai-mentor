/**
 * Shared implementation backing ICSE and Cambridge. Both behave identically:
 * read real structure from syllabus_chapters/syllabus_topics (honestly
 * returning empty arrays if nothing has been ingested — no fabricated/static
 * fallback data), and resolve resources through resourceResolver against
 * topic_resources — which server/services/curriculum/ingestionService.js
 * populates once a real syllabus/AI-enrichment pipeline run has published
 * content for this curriculum. Until then, everything resolves COMING_SOON
 * via the resolver's placeholder tier.
 *
 * This proves the CurriculumProvider interface is genuinely generic: ICSE/
 * Cambridge get the exact same ResolvedTopicContent shape CBSE returns, and
 * once ingestionService.js has run, search() finds the same Qdrant-embedded
 * content the resolver already knows about — no curriculum-specific branch
 * anywhere outside this provider.
 */
const supabase = require('../../../services/supabase');
const { resolveAllResources } = require('../resourceResolver');
const { client: qdrantClient, resolveCollection } = require('../../qdrant');
const { embed } = require('../../embeddings');

/**
 * @param {{ id: string, displayName: string, dbCurriculumValue: string }} meta
 * @returns {import('../types').CurriculumProvider}
 */
function makeStubSyllabusProvider({ id, displayName, dbCurriculumValue }) {
  async function listGrades() {
    const { data } = await supabase
      .from('syllabus_chapters')
      .select('grade')
      .eq('curriculum', dbCurriculumValue);
    const grades = Array.from(new Set((data || []).map((r) => r.grade))).sort();
    return grades.map((g) => ({ id: g, label: g }));
  }

  async function listSubjects(gradeId) {
    const { data } = await supabase
      .from('syllabus_chapters')
      .select('subject')
      .eq('curriculum', dbCurriculumValue)
      .eq('grade', gradeId);
    const subjects = Array.from(new Set((data || []).map((r) => r.subject))).sort();
    return subjects.map((s) => ({ id: s, label: s }));
  }

  async function listUnitsAndChapters(gradeId, subjectId) {
    const { data } = await supabase
      .from('syllabus_chapters')
      .select('id, unit_no, title')
      .eq('curriculum', dbCurriculumValue)
      .eq('grade', gradeId)
      .eq('subject', subjectId)
      .order('unit_no', { ascending: true });
    const chapters = (data || []).map((c) => ({ id: c.id, unitId: null, title: c.title, order: c.unit_no, status: 'COMING_SOON' }));
    return { units: [], chapters };
  }

  async function listTopics(chapterId) {
    const { data } = await supabase
      .from('syllabus_topics')
      .select('id, chapter_id, topic_order, name, kind')
      .eq('chapter_id', chapterId)
      .order('topic_order', { ascending: true });
    return (data || []).map((t) => ({ id: t.id, chapterId: t.chapter_id, name: t.name, order: t.topic_order, kind: t.kind }));
  }

  async function getTopicContent(topicId) {
    const { data: topicRow } = await supabase
      .from('syllabus_topics')
      .select('id, chapter_id, topic_order, name, kind')
      .eq('id', topicId)
      .maybeSingle();

    const resources = await resolveAllResources({ topicId });
    return {
      topic: topicRow
        ? { id: topicRow.id, chapterId: topicRow.chapter_id, name: topicRow.name, order: topicRow.topic_order, kind: topicRow.kind }
        : { id: topicId, chapterId: '', name: '', order: 0 },
      resources,
    };
  }

  async function search(query, opts = {}) {
    // Real semantic search over whatever has been ingested for this
    // curriculum via ingestionService.js. Returns [] (not an error) if
    // nothing's been embedded yet — the common case today.
    try {
      const { collection, qdrantCurriculum, qdrantGrade } = resolveCollection(dbCurriculumValue, opts.gradeId || null);
      const vector = await embed(query);
      const must = [{ key: 'curriculum', match: { value: qdrantCurriculum } }];
      if (opts.gradeId) must.push({ key: 'grade', match: { value: qdrantGrade } });
      if (opts.subjectId) must.push({ key: 'subject', match: { value: opts.subjectId } });

      const results = await qdrantClient.search(collection, {
        vector, limit: opts.limit || 10, filter: { must }, with_payload: true,
      });
      return results.map((r) => ({
        topicId: r.payload.topic, // synthetic id: legacy points don't carry a real syllabus_topics UUID
        snippet: (r.payload.text || '').slice(0, 180),
        score: r.score,
      }));
    } catch {
      return [];
    }
  }

  return {
    meta: { id, displayName },
    listGrades,
    listSubjects,
    listUnitsAndChapters,
    listTopics,
    getTopicContent,
    search,
  };
}

module.exports = { makeStubSyllabusProvider };
