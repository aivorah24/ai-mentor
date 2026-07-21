/**
 * Extracted, byte-for-byte-equivalent copy of the Qdrant read logic that
 * lives inline in routes/curriculum.js's GET /subjects handler. Extraction
 * only — no behavior change. Verified against the live route's response by
 * server/tests/curriculum-cbse-adapter-snapshot.test.js.
 *
 * Existing routes/curriculum.js and routes/ncert.js are left untouched and
 * keep using their own inline copies — this module is a NEW read path used
 * only by the CBSE CurriculumProvider, so the legacy routes carry zero risk
 * from this refactor.
 */
const { client, resolveCollection } = require('../../qdrant');

/**
 * @param {{ curriculum: string, grade: string }} args normalized curriculum (e.g. 'NCERT') + grade string (e.g. 'Grade 6')
 * @returns {Promise<{ grade: string, curriculum: string, subjects: Array<{subject:string, topicCount:number, topics: Array<{topic:string, unit:string, description:string, chapter:number}>}> }>}
 */
async function readSubjects({ curriculum, grade }) {
  const { collection, qdrantCurriculum, qdrantGrade } = resolveCollection(curriculum, grade);

  const seen = new Set();
  const topicMap = {};
  let offset = null;

  do {
    const result = await client.scroll(collection, {
      filter: {
        must: [
          { key: 'curriculum', match: { value: qdrantCurriculum } },
          { key: 'grade', match: { value: qdrantGrade } },
        ],
        must_not: [{ key: 'content_type', match: { value: 'image' } }],
      },
      limit: 2000,
      offset: offset ?? undefined,
      with_payload: ['subject', 'topic', 'unit', 'textbook', 'description', 'chapter'],
      with_vector: false,
    });

    for (const point of result.points) {
      const p = point.payload;
      if (!p.topic || /^\[?IMAGE\]?/i.test(p.topic) || /^this image/i.test(p.topic)) continue;
      const key = `${p.subject}|${p.topic}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (!topicMap[p.subject]) topicMap[p.subject] = [];
        topicMap[p.subject].push({
          topic: p.topic,
          unit: p.unit || p.textbook || '',
          description: p.description || p.text || '',
          chapter: p.chapter || 0,
        });
      }
    }

    offset = result.next_page_offset ?? null;
  } while (offset !== null);

  const subjects = Object.entries(topicMap)
    .map(([subject, topics]) => ({
      subject,
      topicCount: topics.length,
      topics: topics.sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0) || a.topic.localeCompare(b.topic)),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  return { grade, curriculum, subjects };
}

/**
 * Whether ANY text or image chunk exists in Qdrant for a given topic —
 * ported verbatim from the boolean already computed inline in ncert.js's
 * /chapters handler (`hasContent`), so the CBSE provider's IMAGES/BOOK_REFERENCE
 * availability matches today's behavior exactly.
 * @param {{ curriculum: string, topic: string }} args
 */
async function topicHasContent({ curriculum, topic }) {
  const { collection } = resolveCollection(curriculum, null);
  const result = await client.scroll(collection, {
    filter: {
      must: [
        { key: 'curriculum', match: { value: curriculum } },
        { key: 'topic', match: { value: topic } },
      ],
    },
    limit: 1,
    with_payload: false,
    with_vector: false,
  });
  return result.points.length > 0;
}

/**
 * Whether an IMAGE chunk specifically exists for a topic — ported from the
 * `imageChunks` count already computed in ncert.js's /chapters handler.
 * @param {{ curriculum: string, topic: string }} args
 */
async function topicHasImages({ curriculum, topic }) {
  const { collection } = resolveCollection(curriculum, null);
  const result = await client.scroll(collection, {
    filter: {
      must: [
        { key: 'curriculum', match: { value: curriculum } },
        { key: 'topic', match: { value: topic } },
        { key: 'content_type', match: { value: 'image' } },
      ],
    },
    limit: 1,
    with_payload: false,
    with_vector: false,
  });
  return result.points.length > 0;
}

module.exports = { readSubjects, topicHasContent, topicHasImages };
