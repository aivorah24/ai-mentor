const mockCreate = jest.fn();

jest.mock('groq-sdk', () =>
  jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }))
);

const {
  generateAnswer,
  generateAnswerStream,
  buildPrompts,
} = require('../services/llm');

describe('LLM guardrails', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  test('buildPrompts includes strict anti-hallucination rules when context exists', () => {
    const { systemPrompt } = buildPrompts({
      question: 'Explain fractions',
      context: 'A fraction means part of a whole.',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
    });

    expect(systemPrompt).toContain('Use ONLY the reference content below as your factual source.');
    expect(systemPrompt).toContain('Never invent facts, names, dates, formulas, or examples');
    expect(systemPrompt).toContain('ONLY to the topic: "Fractions"');
  });

  test('buildPrompts includes recent conversation and continuity rules', () => {
    const { systemPrompt, userPrompt } = buildPrompts({
      question: 'Can you explain more please?',
      context: '',
      grade: 'Grade 3',
      subject: 'Science',
      history: [
        { role: 'user', text: 'What is a food chain?' },
        { role: 'assistant', text: 'A food chain shows who eats whom in nature.' },
      ],
    });

    expect(systemPrompt).toContain('Follow conversation continuity rules');
    expect(userPrompt).toContain('Recent Conversation:');
    expect(userPrompt).toContain('Student: What is a food chain?');
    expect(userPrompt).toContain('Coach: A food chain shows who eats whom in nature.');
  });

  test('buildPrompts enables child math tutor format for math-like questions', () => {
    const { systemPrompt } = buildPrompts({
      question: 'Give another fraction example',
      context: 'A fraction means part of a whole.',
      grade: 'Grade 3',
      subject: 'Mathematics',
    });

    expect(systemPrompt).toContain('Math teaching format (mandatory)');
    expect(systemPrompt).toContain('Step 1:');
    expect(systemPrompt).toContain('Answer:');
    expect(systemPrompt).toContain('Do NOT switch to another concept');
  });

  test('generateAnswer uses safe no-context topic mode instead of hard fallback', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'A fraction is part of a whole. Step 1: ...' } }],
    });

    const answer = await generateAnswer({
      question: 'Explain fractions with examples',
      context: '',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
    });

    expect(answer).toContain('fraction');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const req = mockCreate.mock.calls[0][0];
    expect(req.messages[0].content).toContain('Curriculum content is not available right now.');
    expect(req.messages[0].content).toContain('ONLY about "Fractions"');
  });

  test('generateAnswer calls Groq with strict prompt when context exists', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'A fraction is part of a whole.' } }],
    });

    const answer = await generateAnswer({
      question: 'What is a fraction?',
      context: 'A fraction means part of a whole.',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
    });

    expect(answer).toBe('A fraction is part of a whole.');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const req = mockCreate.mock.calls[0][0];
    expect(req.model).toBe('llama-3.1-8b-instant');
    expect(req.messages[0].content).toContain('Use ONLY the reference content below as your factual source.');
    expect(req.messages[1].content).toContain('Curriculum Content:');
  });

  test('generateAnswerStream works in no-context topic mode and streams tokens', async () => {
    async function* fakeNoContextStream() {
      yield { choices: [{ delta: { content: 'A fraction is part of a whole. ' } }] };
      yield { choices: [{ delta: { content: 'Step 1: ...' } }] };
    }

    mockCreate.mockResolvedValueOnce(fakeNoContextStream());

    const onToken = jest.fn();
    const full = await generateAnswerStream({
      question: 'Explain fractions',
      context: '',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
      onToken,
    });

    expect(full).toContain('fraction');
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('generateAnswerStream assembles streamed chunks when context exists', async () => {
    async function* fakeStream() {
      yield { choices: [{ delta: { content: 'Fractions ' } }] };
      yield { choices: [{ delta: { content: 'are parts of a whole.' } }] };
    }

    mockCreate.mockResolvedValueOnce(fakeStream());

    const onToken = jest.fn();
    const full = await generateAnswerStream({
      question: 'Explain fractions',
      context: 'A fraction means part of a whole.',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
      onToken,
    });

    expect(full).toBe('Fractions are parts of a whole.');
    expect(onToken).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
