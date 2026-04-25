/**
 * aiCoachEdgeCases.test.js
 * Heavy edge case & guardrail tests for the AI Coach (llm.js buildPrompts)
 * Tests run entirely offline — no Groq/network calls needed.
 */

// Mock Groq SDK so tests run without a real API key
jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  }));
});

const { buildPrompts, buildNoContextFallback } = require('../services/llm');

// ─── Helpers ────────────────────────────────────────────────────────────────

function userMsg(text) { return { role: 'user', text }; }
function aiMsg(text)   { return { role: 'assistant', text }; }

function systemOf(params) { return buildPrompts(params).systemPrompt; }
function userOf(params)   { return buildPrompts(params).userPrompt; }
function promptOf(params) { return buildPrompts(params); }

// ─── 1. SCOPE GUARDRAILS ─────────────────────────────────────────────────────

describe('1. Scope Guardrails', () => {

  test('Topic-locked: system prompt contains topic name', () => {
    const sys = systemOf({ question: 'what is it?', grade: 'Grade 3', subject: 'Mathematics', topic: 'Fractions' });
    expect(sys).toMatch(/Fractions/);
    expect(sys).toMatch(/Topic lock/i);
  });

  test('Topic-locked: off-topic redirect message in prompt', () => {
    const sys = systemOf({ question: 'who is Virat Kohli?', grade: 'Grade 3', subject: 'Mathematics', topic: 'Fractions' });
    expect(sys).toMatch(/Let's finish Fractions first/i);
  });

  test('No topic: IB subjects boundary in prompt', () => {
    const sys = systemOf({ question: 'what is photosynthesis?', grade: 'Grade 4', subject: 'Science' });
    expect(sys).toMatch(/Mathematics|Science|English/);
    expect(sys).toMatch(/school AI Coach/i);
  });

  test('No topic: off-topic redirect text present', () => {
    const sys = systemOf({ question: 'tell me about cricket', grade: 'Grade 5' });
    expect(sys).toMatch(/school subjects/i);
  });

  test('Grade label appears in system prompt', () => {
    const sys = systemOf({ question: 'what is addition?', grade: 'Grade 3' });
    expect(sys).toMatch(/Grade 3/);
  });

  test('No grade falls back gracefully', () => {
    const sys = systemOf({ question: 'what is addition?' });
    expect(sys).toMatch(/primary school/i);
  });
});

// ─── 2. MATH MODE DETECTION ──────────────────────────────────────────────────

describe('2. Math Mode Detection', () => {

  test('Math detected via subject', () => {
    const { mathMode } = promptOf({ question: 'explain it', subject: 'Mathematics', grade: 'Grade 3' });
    expect(mathMode).toBe(true);
  });

  test('Math detected via topic', () => {
    const { mathMode } = promptOf({ question: 'help me', topic: 'Fractions', grade: 'Grade 4' });
    expect(mathMode).toBe(true);
  });

  test('Math detected via numeric expression in question', () => {
    const { mathMode } = promptOf({ question: 'what is 4 + 5?', grade: 'Grade 3' });
    expect(mathMode).toBe(true);
  });

  test('Math detected via keyword "fraction" in question', () => {
    const { mathMode } = promptOf({ question: 'explain fractions please', grade: 'Grade 4' });
    expect(mathMode).toBe(true);
  });

  test('Math detected via keyword in conversation history', () => {
    const { mathMode } = promptOf({
      question: 'can you give me more?',
      grade: 'Grade 3',
      history: [aiMsg('Fractions are equal parts of a whole.'), userMsg('okay')],
    });
    expect(mathMode).toBe(true);
  });

  test('Non-math not flagged as math', () => {
    const { mathMode } = promptOf({ question: 'what is photosynthesis?', subject: 'Science', grade: 'Grade 5' });
    expect(mathMode).toBe(false);
  });

  test('x as multiplication operator detected', () => {
    const { mathMode } = promptOf({ question: '3 x 4?', grade: 'Grade 3' });
    expect(mathMode).toBe(true);
  });
});

// ─── 3. STUDENT ANSWERING PRACTICE QUESTION ──────────────────────────────────

describe('3. Practice Answer Detection', () => {

  test('Short numeric answer after "Try this" detected as practice', () => {
    const { systemPrompt } = promptOf({
      question: '5',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('Try this: what is 2 + 3?'), userMsg('5')],
    });
    expect(systemPrompt).toMatch(/STUDENT ANSWERED YOUR PRACTICE QUESTION/i);
  });

  test('Short answer after "how many" detected as practice', () => {
    const { systemPrompt } = promptOf({
      question: '4',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('How many parts does 1/4 have?'), userMsg('4')],
    });
    expect(systemPrompt).toMatch(/STUDENT ANSWERED YOUR PRACTICE QUESTION/i);
  });

  test('Student answer contains their text in prompt', () => {
    const { systemPrompt } = promptOf({
      question: '9',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('Try this: what is 4 + 5?'), userMsg('9')],
    });
    expect(systemPrompt).toMatch(/"9"/);
  });

  test('CRITICAL: Do NOT write Let me check is in prompt', () => {
    const { systemPrompt } = promptOf({
      question: '3',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('Try this: what is 1 + 2?'), userMsg('3')],
    });
    expect(systemPrompt).toMatch(/Do NOT write.*Let me check/i);
  });

  test('Start with That\'s correct or Almost there requirement in prompt', () => {
    const { systemPrompt } = promptOf({
      question: '6',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('Try this: what is 3 + 3?'), userMsg('6')],
    });
    expect(systemPrompt).toMatch(/That's correct|Almost there/);
  });

  test('Long reply NOT treated as practice answer', () => {
    const { systemPrompt } = promptOf({
      question: 'I think the answer is five because two plus three equals five',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('Try this: what is 2 + 3?')],
    });
    // Long reply (>6 words) should NOT trigger practice-answer mode
    expect(systemPrompt).not.toMatch(/STUDENT ANSWERED YOUR PRACTICE QUESTION/i);
  });

  test('No prior AI practice question: short reply not flagged as practice', () => {
    const { systemPrompt } = promptOf({
      question: '5',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('Fractions are equal parts of a whole.')],
    });
    expect(systemPrompt).not.toMatch(/STUDENT ANSWERED YOUR PRACTICE QUESTION/i);
  });

  test('Practice mode uses POWER model (70b) for accurate math verification', () => {
    const { model } = promptOf({
      question: '5',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('Try this: what is 2 + 3?'), userMsg('5')],
    });
    expect(model).toBe('llama-3.3-70b-versatile');
  });

  test('Explanation mode uses POWER model (70b)', () => {
    const { model } = promptOf({
      question: 'What is a fraction?',
      grade: 'Grade 4',
      subject: 'Mathematics',
    });
    expect(model).toBe('llama-3.3-70b-versatile');
  });
});

// ─── 4. TOKEN BUDGET ─────────────────────────────────────────────────────────

describe('4. Token Budget', () => {

  test('Practice answer check has lower max_tokens (220)', () => {
    const { maxTokens } = promptOf({
      question: '3',
      grade: 'Grade 3',
      subject: 'Mathematics',
      history: [aiMsg('Try this: what is 1 + 2?'), userMsg('3')],
    });
    expect(maxTokens).toBe(220);
  });

  test('Explanation has higher max_tokens (380)', () => {
    const { maxTokens } = promptOf({
      question: 'What is multiplication?',
      grade: 'Grade 4',
      subject: 'Mathematics',
    });
    expect(maxTokens).toBe(380);
  });

  test('Non-math explanation has max_tokens 380', () => {
    const { maxTokens } = promptOf({
      question: 'What is photosynthesis?',
      grade: 'Grade 5',
      subject: 'Science',
    });
    expect(maxTokens).toBe(380);
  });
});

// ─── 5. CONTEXT / RAG GROUNDING ──────────────────────────────────────────────

describe('5. RAG Context Grounding', () => {

  test('With context: user prompt contains curriculum content', () => {
    const up = userOf({
      question: 'what is a fraction?',
      context: 'A fraction is a part of a whole number.',
      grade: 'Grade 3',
      subject: 'Mathematics',
      topic: 'Fractions',
    });
    expect(up).toMatch(/Curriculum Content/i);
    expect(up).toMatch(/A fraction is a part of a whole number/);
  });

  test('With context: system prompt says to use ONLY curriculum content', () => {
    const sys = systemOf({
      question: 'what is a fraction?',
      context: 'A fraction is a part of a whole.',
      grade: 'Grade 3',
      subject: 'Mathematics',
    });
    expect(sys).toMatch(/Use ONLY it as your factual source/i);
  });

  test('Without context: system prompt says no curriculum available', () => {
    const sys = systemOf({
      question: 'what is a fraction?',
      grade: 'Grade 3',
      subject: 'Mathematics',
    });
    expect(sys).toMatch(/No curriculum content available/i);
  });

  test('hasContext flag true when context provided', () => {
    const { hasContext } = promptOf({
      question: 'what is it?',
      context: 'Some content here.',
      grade: 'Grade 3',
    });
    expect(hasContext).toBe(true);
  });

  test('hasContext flag false when context empty', () => {
    const { hasContext } = promptOf({ question: 'what is it?', grade: 'Grade 3', context: '' });
    expect(hasContext).toBe(false);
  });

  test('hasContext flag false when context whitespace only', () => {
    const { hasContext } = promptOf({ question: 'what is it?', grade: 'Grade 3', context: '   ' });
    expect(hasContext).toBe(false);
  });

  test('Anti-hallucination rule always present', () => {
    const sys = systemOf({ question: 'what is it?', grade: 'Grade 3' });
    expect(sys).toMatch(/never guess or invent/i);
  });
});

// ─── 6. CONVERSATION HISTORY ─────────────────────────────────────────────────

describe('6. Conversation History', () => {

  test('History appears in user prompt', () => {
    const up = userOf({
      question: 'give me another example',
      grade: 'Grade 3',
      history: [
        aiMsg('A fraction is a part of a whole.'),
        userMsg('I see'),
      ],
    });
    expect(up).toMatch(/Conversation so far/i);
    expect(up).toMatch(/A fraction is a part of a whole/);
  });

  test('Empty history: no conversation block in user prompt', () => {
    const up = userOf({ question: 'what is fractions?', grade: 'Grade 3', history: [] });
    expect(up).not.toMatch(/Conversation so far/i);
  });

  test('Null history handled without crash', () => {
    expect(() => promptOf({ question: 'test', grade: 'Grade 3', history: null })).not.toThrow();
  });

  test('History with invalid roles filtered out', () => {
    expect(() => promptOf({
      question: 'test',
      grade: 'Grade 3',
      history: [{ role: 'robot', text: 'beep boop' }, { role: 'user', text: 'hi' }],
    })).not.toThrow();
  });

  test('History with empty text entries filtered out', () => {
    const up = userOf({
      question: 'test',
      grade: 'Grade 3',
      history: [{ role: 'user', text: '' }, { role: 'assistant', text: 'hello' }],
    });
    expect(up).not.toMatch(/\nStudent: \n/);
  });

  test('History capped at 6 turns (no overflow)', () => {
    const longHistory = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? userMsg(`question ${i}`) : aiMsg(`answer ${i}`)
    );
    const up = userOf({ question: 'latest', grade: 'Grade 3', history: longHistory });
    // Only last 6 should be present — first message should be gone
    expect(up).not.toMatch(/question 0/);
  });

  test('History with only user messages handled', () => {
    expect(() => promptOf({
      question: 'test',
      grade: 'Grade 3',
      history: [userMsg('hi'), userMsg('hello'), userMsg('hey')],
    })).not.toThrow();
  });
});

// ─── 7. EDGE INPUTS ──────────────────────────────────────────────────────────

describe('7. Edge Inputs', () => {

  test('Empty question string handled without crash', () => {
    expect(() => promptOf({ question: '', grade: 'Grade 3' })).not.toThrow();
  });

  test('Very long question (500 chars) handled', () => {
    const longQ = 'a'.repeat(500);
    expect(() => promptOf({ question: longQ, grade: 'Grade 3' })).not.toThrow();
  });

  test('Special characters in question handled', () => {
    expect(() => promptOf({ question: '3 × 4 = ? ÷ 2', grade: 'Grade 3', subject: 'Mathematics' })).not.toThrow();
  });

  test('Emoji in question handled', () => {
    expect(() => promptOf({ question: '🍕 cut into 4 pieces, I eat 1, what fraction?', grade: 'Grade 3' })).not.toThrow();
  });

  test('Question with SQL injection attempt handled safely', () => {
    expect(() => promptOf({ question: "'; DROP TABLE students; --", grade: 'Grade 3' })).not.toThrow();
  });

  test('Question with XSS attempt handled safely', () => {
    expect(() => promptOf({ question: '<script>alert("xss")</script>', grade: 'Grade 3' })).not.toThrow();
  });

  test('Undefined subject falls back gracefully', () => {
    const sys = systemOf({ question: 'what is photosynthesis?', grade: 'Grade 4', subject: undefined });
    expect(sys).toMatch(/Ms. Zara/);
  });

  test('Undefined topic falls back gracefully', () => {
    const sys = systemOf({ question: 'help', grade: 'Grade 4', topic: undefined });
    expect(sys).toMatch(/Ms. Zara/);
  });

  test('Grade 6 falls back to primary school label', () => {
    const sys = systemOf({ question: 'what is algebra?', grade: 'Grade 6' });
    // Grade 6 not in getAgeGuardrails → gradeLabel = 'Grade 6'
    expect(sys).toMatch(/Grade 6/);
  });
});

// ─── 8. LANGUAGE / TONE RULES ────────────────────────────────────────────────

describe('8. Language & Tone Rules', () => {

  test('System prompt requires simple words', () => {
    const sys = systemOf({ question: 'what?', grade: 'Grade 3' });
    expect(sys).toMatch(/simple words/i);
  });

  test('System prompt requires encouragement at end', () => {
    const sys = systemOf({ question: 'what?', grade: 'Grade 3' });
    expect(sys).toMatch(/encouragement/i);
  });

  test('System prompt bans markdown', () => {
    const sys = systemOf({ question: 'what?', grade: 'Grade 3' });
    expect(sys).toMatch(/no markdown/i);
  });

  test('System prompt bans bullet points', () => {
    const sys = systemOf({ question: 'what?', grade: 'Grade 3' });
    expect(sys).toMatch(/no bullet points/i);
  });

  test('System prompt caps response length', () => {
    const sys = systemOf({ question: 'what?', grade: 'Grade 3' });
    expect(sys).toMatch(/6-8 lines/i);
  });

  test('Math teaching format includes step-by-step instruction', () => {
    const sys = systemOf({ question: 'what is multiplication?', subject: 'Mathematics', grade: 'Grade 4' });
    expect(sys).toMatch(/Step 1|worked example/i);
  });

  test('Math teaching format ends with practice question instruction', () => {
    const sys = systemOf({ question: 'what is addition?', subject: 'Mathematics', grade: 'Grade 3' });
    expect(sys).toMatch(/practice question/i);
  });

  test('Non-math teaching uses analogy instruction', () => {
    const sys = systemOf({ question: 'what is photosynthesis?', subject: 'Science', grade: 'Grade 5' });
    expect(sys).toMatch(/analogy/i);
  });
});

// ─── 9. NO-CONTEXT FALLBACK ──────────────────────────────────────────────────

describe('9. buildNoContextFallback', () => {

  test('Returns string mentioning topic', () => {
    const msg = buildNoContextFallback({ topic: 'Fractions', grade: 'Grade 3' });
    expect(msg).toMatch(/Fractions/);
  });

  test('Returns string mentioning grade', () => {
    const msg = buildNoContextFallback({ topic: 'Addition', grade: 'Grade 4' });
    expect(msg).toMatch(/Grade 4/);
  });

  test('No topic → still returns a string', () => {
    const msg = buildNoContextFallback({ grade: 'Grade 3' });
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(10);
  });

  test('No grade → uses "your grade" fallback', () => {
    const msg = buildNoContextFallback({ topic: 'Decimals' });
    expect(msg).toMatch(/your grade/i);
  });
});

// ─── 10. MULTI-GRADE SCOPE ───────────────────────────────────────────────────

describe('10. Multi-Grade Correctness', () => {

  ['Grade 3', 'Grade 4', 'Grade 5'].forEach(grade => {
    test(`${grade}: system prompt generates without crash`, () => {
      expect(() => systemOf({ question: 'what is area?', subject: 'Mathematics', grade })).not.toThrow();
    });

    test(`${grade}: grade label appears in system prompt`, () => {
      const sys = systemOf({ question: 'what is area?', grade });
      expect(sys).toMatch(new RegExp(grade));
    });
  });

  test('Grade 3 math: very simple language rule enforced', () => {
    const sys = systemOf({ question: 'what is addition?', grade: 'Grade 3', subject: 'Mathematics' });
    expect(sys).toMatch(/simple/i);
  });
});

// ─── 11. PROMPT STRUCTURE INTEGRITY ─────────────────────────────────────────

describe('11. Prompt Structure Integrity', () => {

  test('buildPrompts always returns all 6 keys', () => {
    const result = promptOf({ question: 'what is fractions?', grade: 'Grade 3' });
    expect(result).toHaveProperty('hasContext');
    expect(result).toHaveProperty('mathMode');
    expect(result).toHaveProperty('systemPrompt');
    expect(result).toHaveProperty('userPrompt');
    expect(result).toHaveProperty('model');
    expect(result).toHaveProperty('maxTokens');
  });

  test('systemPrompt is always a non-empty string', () => {
    const { systemPrompt } = promptOf({ question: 'hi', grade: 'Grade 3' });
    expect(typeof systemPrompt).toBe('string');
    expect(systemPrompt.length).toBeGreaterThan(50);
  });

  test('userPrompt always contains student question', () => {
    const { userPrompt } = promptOf({ question: 'what is half?', grade: 'Grade 3' });
    expect(userPrompt).toMatch(/what is half\?/i);
  });

  test('userPrompt labels student question as Student:', () => {
    const { userPrompt } = promptOf({ question: 'test question', grade: 'Grade 3' });
    expect(userPrompt).toMatch(/Student: test question/);
  });

  test('No unicode box-drawing characters in system prompt (token waste)', () => {
    const { systemPrompt } = promptOf({ question: 'test', grade: 'Grade 3' });
    expect(systemPrompt).not.toMatch(/═/);
  });

  test('Ms. Zara identity always present in system prompt', () => {
    const { systemPrompt } = promptOf({ question: 'test', grade: 'Grade 3' });
    expect(systemPrompt).toMatch(/Ms. Zara/);
  });

  test('model is one of the two known models', () => {
    const { model } = promptOf({ question: 'test', grade: 'Grade 3' });
    expect(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']).toContain(model);
  });
});
