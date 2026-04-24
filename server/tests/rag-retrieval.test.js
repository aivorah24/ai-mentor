const { embed } = require('../services/embeddings');
const { searchContent } = require('../services/qdrant');
const { retrieveCurriculumContext, buildRetrievalQuestion } = require('../services/rag');

jest.mock('../services/embeddings', () => ({
  embed: jest.fn(),
}));

jest.mock('../services/qdrant', () => ({
  searchContent: jest.fn(),
}));

function makePoint({ score = 0.8, topic = 'Fractions', content = 'A fraction is part of a whole.' } = {}) {
  return {
    score,
    payload: {
      subject: 'Mathematics',
      unit: 'Numbers',
      topic,
      content,
    },
  };
}

describe('retrieveCurriculumContext()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    embed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  test('uses strict topic retrieval first and returns context', async () => {
    searchContent.mockResolvedValueOnce([
      makePoint({ score: 0.89, topic: 'Fractions' }),
      makePoint({ score: 0.83, topic: 'Fractions', content: '3/4 means three parts out of four.' }),
    ]);

    const out = await retrieveCurriculumContext({
      question: 'Explain fractions with example',
      curriculum: 'IB_PYP',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
    });

    expect(searchContent).toHaveBeenCalledTimes(1);
    expect(searchContent.mock.calls[0][0]).toMatchObject({ topic: 'Fractions' });
    expect(out.context).toContain('Fractions');
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.meta.strategy).toBe('strict_topic');
  });

  test('falls back to broader subject retrieval when strict has no useful hits', async () => {
    searchContent
      .mockResolvedValueOnce([]) // strict
      .mockResolvedValueOnce([
        makePoint({ score: 0.72, topic: 'Fractions' }),
        makePoint({ score: 0.64, topic: 'Fractions', content: '1/2 means one of two equal parts.' }),
      ]); // broad

    const out = await retrieveCurriculumContext({
      question: 'What is fraction?',
      curriculum: 'IB_PYP',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
    });

    expect(searchContent).toHaveBeenCalledTimes(2);
    expect(searchContent.mock.calls[0][0]).toMatchObject({ topic: 'Fractions' });
    expect(searchContent.mock.calls[1][0].topic).toBeUndefined();
    expect(out.meta.strategy).toBe('broad_subject');
    expect(out.sources.length).toBeGreaterThan(0);
  });

  test('returns empty context if all retrieval scores are too weak', async () => {
    searchContent
      .mockResolvedValueOnce([makePoint({ score: 0.05, content: 'Unrelated text' })])
      .mockResolvedValueOnce([makePoint({ score: 0.04, content: 'Another weak text' })]);

    const out = await retrieveCurriculumContext({
      question: 'Tell me about fractions',
      curriculum: 'IB_PYP',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
    });

    expect(out.context).toBe('');
    expect(out.sources).toEqual([]);
  });

  test('expands short follow-up query with prior user message when no topic is provided', async () => {
    searchContent
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await retrieveCurriculumContext({
      question: 'Some real examples please',
      curriculum: 'IB_PYP',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [
        { role: 'user', text: 'Can you explain fractions?' },
        { role: 'assistant', text: 'Fractions are parts of a whole.' },
      ],
    });

    expect(embed).toHaveBeenCalledWith(expect.stringContaining('Can you explain fractions?'));
    expect(embed).toHaveBeenCalledWith(expect.stringContaining('Follow-up question: Some real examples please'));
  });

  test('infers Mathematics subject when user asks math question without explicit subject', async () => {
    searchContent
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await retrieveCurriculumContext({
      question: 'Can you explain fractions?',
      curriculum: 'IB_PYP',
      grade: 'Grade 3',
      history: [],
    });

    expect(searchContent).toHaveBeenCalledTimes(2);
    expect(searchContent.mock.calls[0][0].subject).toBe('Mathematics');
    expect(searchContent.mock.calls[1][0].subject).toBe('Mathematics');
  });
});

describe('buildRetrievalQuestion()', () => {
  test('returns unchanged question for non-follow-up prompts', () => {
    const out = buildRetrievalQuestion({
      question: 'What is photosynthesis?',
      topic: '',
      history: [{ role: 'user', text: 'Previous' }],
    });
    expect(out).toBe('What is photosynthesis?');
  });
});
