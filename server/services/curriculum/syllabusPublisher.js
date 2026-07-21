/**
 * Extracted, byte-for-byte-equivalent copy of the diff + publish logic that
 * lives inline in routes/syllabusImport.js (computeDiff + the insert loop in
 * POST /publish). Extraction only — no behavior change; routes/syllabusImport.js
 * is refactored to import and call these same functions instead of duplicating
 * them, so the existing teacher CBSE syllabus-import flow is unaffected.
 *
 * This is the shared "publish canonical units into syllabus_chapters/
 * syllabus_topics" primitive that both the teacher-upload flow (CBSE, school-
 * scoped) and the new generic curriculum ingestion service (server/services/
 * curriculum/ingestionService.js — platform-level, any curriculum) build on.
 */
const supabase = require('../supabase');

/**
 * Compares a draft units[] against whatever is currently live for a scope,
 * without writing anything.
 * @param {{grade:string, subject:string, curriculum:string, schoolId?:string, units:object[]}} args
 */
async function computeDiff({ grade, subject, curriculum, schoolId, units }) {
  const scopeMatch = { grade, subject, curriculum, ...(schoolId ? { school_id: schoolId } : {}) };
  const { data: oldChapters } = await supabase.from('syllabus_chapters').select('id, title').match(scopeMatch);
  const oldChapterIds = (oldChapters || []).map((c) => c.id);
  const { data: oldTopics } = oldChapterIds.length
    ? await supabase.from('syllabus_topics').select('name').in('chapter_id', oldChapterIds)
    : { data: [] };
  const oldTopicNames = new Set((oldTopics || []).map((t) => t.name));
  const oldTitles = new Set((oldChapters || []).map((c) => c.title));

  const newTopicNames = new Set();
  for (const u of units) for (const t of (u.topics || [])) newTopicNames.add(t.name);
  const newTitles = new Set(units.map((u) => u.title));

  return {
    addedTopics: [...newTopicNames].filter((n) => !oldTopicNames.has(n)),
    removedTopics: [...oldTopicNames].filter((n) => !newTopicNames.has(n)),
    addedUnits: [...newTitles].filter((t) => !oldTitles.has(t)),
    removedUnits: [...oldTitles].filter((t) => !newTitles.has(t)),
    unitCountBefore: oldChapters?.length || 0,
    topicCountBefore: oldTopicNames.size,
  };
}

/**
 * Replace-all publish of canonical units into syllabus_chapters/syllabus_topics
 * for a (grade, subject, curriculum[, schoolId]) scope. Ported verbatim from
 * routes/syllabusImport.js POST /publish's insert loop.
 * @param {{grade:string, subject:string, curriculum:string, schoolId?:string, units:object[]}} args
 * @returns {Promise<{diff: object, chapterIdsByUnitNo: Record<number,string>, topicIdsByName: Record<string,string>}>}
 */
async function publishUnits({ grade, subject, curriculum, schoolId, units }) {
  const diff = await computeDiff({ grade, subject, curriculum, schoolId, units });

  const scopeMatch = { grade, subject, curriculum, ...(schoolId ? { school_id: schoolId } : {}) };
  const { data: oldChapters } = await supabase.from('syllabus_chapters').select('id').match(scopeMatch);
  const oldChapterIds = (oldChapters || []).map((c) => c.id);
  if (oldChapterIds.length) await supabase.from('syllabus_chapters').delete().in('id', oldChapterIds);

  const chapterIdsByUnitNo = {};
  const topicIdsByName = {};

  for (const u of units) {
    const { data: chapter, error: chErr } = await supabase
      .from('syllabus_chapters')
      .insert({ grade, subject, curriculum, school_id: schoolId || null, unit_no: u.unitNo, title: u.title })
      .select('id')
      .single();
    if (chErr) throw new Error(chErr.message);
    chapterIdsByUnitNo[u.unitNo] = chapter.id;

    const topicRows = (u.topics || []).map((t, i) => ({
      chapter_id: chapter.id, topic_order: i, name: t.name, kind: t.kind || 'Story', page: t.page || '',
      intro: t.intro || '', body: t.body || [], vocab: t.vocab || [], activity: t.activity || '', figure_url: t.figureUrl || '',
    }));
    if (topicRows.length) {
      const { data: insertedTopics, error: tErr } = await supabase.from('syllabus_topics').insert(topicRows).select('id, name');
      if (tErr) throw new Error(tErr.message);
      for (const t of insertedTopics || []) topicIdsByName[t.name] = t.id;
    }
  }

  return { diff, chapterIdsByUnitNo, topicIdsByName };
}

module.exports = { computeDiff, publishUnits };
