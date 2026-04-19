/**
 * Unit Tests — Curriculum API
 * Tests /curriculum, /curriculum/subjects, /curriculum/search endpoints.
 */

const SERVER_URL = 'http://localhost:3001';

global.fetch = jest.fn();

function mockFetch(data: object, ok = true) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  });
}

// ── Helpers matching the frontend fetch pattern ──────────────────────────────
async function fetchCurriculum(curriculum = 'IB_PYP') {
  const res = await fetch(`${SERVER_URL}/curriculum?curriculum=${curriculum}`);
  if (!res.ok) throw new Error('Server error');
  return res.json();
}

async function fetchSubjects(grade: string, curriculum = 'IB_PYP') {
  const res = await fetch(
    `${SERVER_URL}/curriculum/subjects?grade=${encodeURIComponent(grade)}&curriculum=${curriculum}`
  );
  if (!res.ok) throw new Error('Server error');
  return res.json();
}

async function searchCurriculum(q: string, grade: string, limit = 12) {
  const res = await fetch(
    `${SERVER_URL}/curriculum/search?q=${encodeURIComponent(q)}&grade=${encodeURIComponent(grade)}&limit=${limit}`
  );
  if (!res.ok) throw new Error('Server error');
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Curriculum API — /curriculum', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns grades, topics array and totalTopics', async () => {
    mockFetch({
      grades: ['Grade 3', 'Grade 4', 'Grade 5'],
      topics: [{ grade: 'Grade 3', subject: 'Mathematics', unit: 'Number', topic: 'Addition', content_type: 'lesson' }],
      grouped: { 'Grade 3': { Mathematics: [{ topic: 'Addition', unit: 'Number' }] } },
      totalTopics: 36,
    });

    const data = await fetchCurriculum('IB_PYP');

    expect(data.grades).toEqual(['Grade 3', 'Grade 4', 'Grade 5']);
    expect(data.totalTopics).toBe(36);
    expect(Array.isArray(data.topics)).toBe(true);
    expect(data.topics[0].subject).toBe('Mathematics');
  });

  it('throws on server error', async () => {
    mockFetch({}, false);
    await expect(fetchCurriculum()).rejects.toThrow('Server error');
  });
});

describe('Curriculum API — /curriculum/subjects', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns subjects array for given grade', async () => {
    mockFetch({
      subjects: [
        { subject: 'Mathematics', topicCount: 5, topics: [{ topic: 'Addition', unit: 'Number', description: '' }] },
        { subject: 'Science', topicCount: 4, topics: [] },
      ],
    });

    const data = await fetchSubjects('Grade 3', 'IB_PYP');

    expect(data.subjects).toHaveLength(2);
    expect(data.subjects[0].subject).toBe('Mathematics');
    expect(data.subjects[0].topicCount).toBe(5);
  });

  it('encodes grade with spaces correctly in URL', async () => {
    mockFetch({ subjects: [] });

    await fetchSubjects('Grade 3');

    const url = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain('grade=Grade%203');
  });
});

describe('Curriculum API — /curriculum/search', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns matching topics for search query', async () => {
    mockFetch({
      topics: [
        { topic: 'Addition', subject: 'Mathematics', grade: 'Grade 3', unit: 'Number', score: 0.95, snippet: 'Number — Addition', description: '' },
      ],
    });

    const data = await searchCurriculum('addition', 'Grade 3');

    expect(data.topics).toHaveLength(1);
    expect(data.topics[0].topic).toBe('Addition');
    expect(data.topics[0].score).toBeGreaterThan(0.9);
  });

  it('returns empty array when no results', async () => {
    mockFetch({ topics: [] });

    const data = await searchCurriculum('xyznonexistent', 'Grade 3');

    expect(data.topics).toHaveLength(0);
  });

  it('passes correct limit param', async () => {
    mockFetch({ topics: [] });

    await searchCurriculum('math', 'Grade 4', 5);

    const url = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain('limit=5');
  });
});
