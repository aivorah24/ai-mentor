/**
 * Registry fallback for any curriculum string that has no registered
 * provider (IB, NIOS, State Boards, or a typo'd/unsupported value). Always
 * returns well-formed, honestly-empty data — never throws, never fabricates
 * content. This is the provider that proves "unsupported curriculum" is a
 * safe, handled state rather than a crash.
 * @type {import('../types').CurriculumProvider}
 */
const meta = { id: 'NOT_AVAILABLE_STUB', displayName: 'Not yet available' };

async function listGrades() { return []; }
async function listSubjects() { return []; }
async function listUnitsAndChapters() { return { units: [], chapters: [] }; }
async function listTopics() { return []; }

async function getTopicContent(topicId) {
  const resources = [
    'AI_EXPLANATION', 'IMAGES', 'AUDIO', 'PRACTICE',
    'FLASHCARDS', 'WORKSHEETS', 'BOOK_REFERENCE', 'OER_MAPPING',
  ].map((resourceType) => ({
    id: `${topicId}:${resourceType}:not-available`,
    topicId,
    resourceType,
    status: 'NOT_AVAILABLE',
    sourceTier: null,
    source: null,
    payload: null,
  }));
  return { topic: { id: topicId, chapterId: '', name: '', order: 0 }, resources };
}

async function search() { return []; }

module.exports = { meta, listGrades, listSubjects, listUnitsAndChapters, listTopics, getTopicContent, search };
