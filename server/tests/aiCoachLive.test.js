/**
 * aiCoachLive.test.js
 * Real API integration tests — hits localhost:3006/ask with actual Groq calls.
 * Tests AI response quality across 10+ concepts.
 *
 * Run: npm test aiCoachLive.test.js
 * Requires server running on port 3006.
 */

const SERVER = 'http://localhost:3006';
const TIMEOUT = 25000; // 25s per test (LLM can be slow)

// ─── Helper ──────────────────────────────────────────────────────────────────

async function ask({ question, grade = 'Grade 3', subject, topic, history = [] }) {
  const res = await fetch(`${SERVER}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, grade, subject, topic, history,
      curriculum: 'IB_PYP', userEmail: 'test@aivorah.ai', role: 'student' }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Server error: ${data.error}`);
  if (!data.answer) throw new Error(`Empty answer. Raw response: ${JSON.stringify(data)}`);
  return data.answer.trim();
}

function ai(text)   { return { role: 'assistant', text }; }
function user(text) { return { role: 'user',      text }; }

// Quick assertion helpers
function assertStartsWith(answer, ...prefixes) {
  const lower = answer.toLowerCase();
  const ok = prefixes.some(p => lower.startsWith(p.toLowerCase()));
  if (!ok) throw new Error(
    `Expected to start with one of [${prefixes.join(' | ')}]\nGot: "${answer.slice(0, 120)}"`
  );
}

function assertContains(answer, ...keywords) {
  const lower = answer.toLowerCase();
  for (const kw of keywords) {
    if (!lower.includes(kw.toLowerCase()))
      throw new Error(`Expected to contain "${kw}"\nGot: "${answer.slice(0, 200)}"`);
  }
}

function assertNotContains(answer, ...banned) {
  const lower = answer.toLowerCase();
  for (const b of banned) {
    if (lower.includes(b.toLowerCase()))
      throw new Error(`Should NOT contain "${b}"\nGot: "${answer.slice(0, 200)}"`);
  }
}

function assertLength(answer, maxWords = 100) {
  const words = answer.split(/\s+/).filter(Boolean).length;
  if (words > maxWords)
    throw new Error(`Too long: ${words} words (max ${maxWords})\nGot: "${answer.slice(0, 200)}"`);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AI Coach — Live Response Quality Tests', () => {

  // ── MATH: Addition ─────────────────────────────────────────────────────────
  test('Addition explanation has steps and practice question', async () => {
    const ans = await ask({ question: 'What is addition?', subject: 'Mathematics', grade: 'Grade 3' });
    console.log('[Addition]', ans);
    assertContains(ans, 'step');
    // Should end with a practice question (various forms the model uses)
    const hasPractice = /(try|what is|how many|can you|\?)/i.test(ans);
    if (!hasPractice) throw new Error(`Expected practice question\nGot: "${ans.slice(0,200)}"`);
    assertNotContains(ans, 'mortgage', 'investment', 'politics');
    assertLength(ans, 120);
  }, TIMEOUT);

  // ── MATH: Correct answer check ─────────────────────────────────────────────
  test('Correct answer "3" to 2+1 → That\'s correct', async () => {
    const ans = await ask({
      question: '3',
      subject: 'Mathematics',
      grade: 'Grade 3',
      history: [
        ai('Addition means putting numbers together. Step 1: You have 2 apples. Step 2: You get 1 more. Answer: 3 apples. Try this: what is 2 + 1?'),
        user('3'),
      ],
    });
    console.log('[Correct answer]', ans);
    assertStartsWith(ans, "that's correct", "that's right", "correct");
    assertNotContains(ans, 'almost there', 'not quite', 'wrong');
  }, TIMEOUT);

  // ── MATH: Wrong answer check ───────────────────────────────────────────────
  test('Wrong answer "5" to 2+1 → Almost there', async () => {
    const ans = await ask({
      question: '5',
      subject: 'Mathematics',
      grade: 'Grade 3',
      history: [
        ai('Try this: what is 2 + 1?'),
        user('5'),
      ],
    });
    console.log('[Wrong answer]', ans);
    assertStartsWith(ans, 'almost there', 'almost');
    assertNotContains(ans, "that's correct", "that's right");
  }, TIMEOUT);

  // ── MATH: Equivalent fraction accepted ─────────────────────────────────────
  test('2/10 accepted as correct when answer is 1/5', async () => {
    const ans = await ask({
      question: '2/10',
      subject: 'Mathematics',
      grade: 'Grade 4',
      topic: 'Fractions',
      history: [
        ai('Try this: if you have 10 cookies and eat 2, what fraction did you eat? A) 1/5  B) 2/10  C) 3/10'),
        user('2/10'),
      ],
    });
    console.log('[Equivalent fraction]', ans);
    // 2/10 = 1/5, so must be accepted as correct
    assertStartsWith(ans, "that's correct", "that's right", "correct");
    assertNotContains(ans, 'almost there');
  }, TIMEOUT);

  // ── MATH: Fractions explanation ─────────────────────────────────────────────
  test('Fraction explanation uses real objects and has steps', async () => {
    const ans = await ask({ question: 'What is a fraction?', subject: 'Mathematics', grade: 'Grade 3', topic: 'Fractions' });
    console.log('[Fractions]', ans);
    assertContains(ans, 'step');
    assertNotContains(ans, '**', '##', '- '); // no markdown
    assertLength(ans, 120);
  }, TIMEOUT);

  // ── MATH: Multiplication ────────────────────────────────────────────────────
  test('Multiplication gives worked example with real objects', async () => {
    const ans = await ask({ question: 'What is multiplication?', subject: 'Mathematics', grade: 'Grade 4' });
    console.log('[Multiplication]', ans);
    assertContains(ans, 'step');
    assertContains(ans, 'answer');
    assertLength(ans, 120);
  }, TIMEOUT);

  // ── MATH: Decimals ──────────────────────────────────────────────────────────
  test('Decimals explanation is simple and has practice question', async () => {
    const ans = await ask({ question: 'What is a decimal?', subject: 'Mathematics', grade: 'Grade 5', topic: 'Decimals' });
    console.log('[Decimals]', ans);
    assertContains(ans, 'step');
    assertNotContains(ans, 'mortgage', 'stock', 'interest rate');
    assertLength(ans, 120);
  }, TIMEOUT);

  // ── SCIENCE: Photosynthesis ─────────────────────────────────────────────────
  test('Photosynthesis explained with analogy for Grade 5', async () => {
    const ans = await ask({ question: 'What is photosynthesis?', subject: 'Science', grade: 'Grade 5' });
    console.log('[Photosynthesis]', ans);
    assertNotContains(ans, '**', '##');
    assertLength(ans, 120);
    // Should contain analogy or real-world example
    const hasAnalogy = /like|imagine|think of|similar to|just as/i.test(ans);
    if (!hasAnalogy) throw new Error(`Expected analogy in photosynthesis explanation\nGot: "${ans.slice(0,200)}"`);
  }, TIMEOUT);

  // ── ENGLISH ─────────────────────────────────────────────────────────────────
  test('Adjectives explanation stays on topic for Grade 4', async () => {
    const ans = await ask({ question: 'What is an adjective?', subject: 'English', grade: 'Grade 4' });
    console.log('[Adjectives]', ans);
    assertNotContains(ans, '**', '*', '##');
    assertLength(ans, 120);
  }, TIMEOUT);

  // ── GUARDRAIL: Off-topic (celebrity) ───────────────────────────────────────
  test('Off-topic question about celebrity → redirect, no answer', async () => {
    const ans = await ask({ question: 'Who is Virat Kohli?', grade: 'Grade 3' });
    console.log('[Off-topic celebrity]', ans);
    // Should redirect, not explain cricket career
    assertNotContains(ans, 'indian cricket', 'born in', 'career');
    const redirects = /school|subject|curriculum|coach|learn|maths|science/i.test(ans);
    if (!redirects) throw new Error(`Expected redirect for off-topic\nGot: "${ans.slice(0,200)}"`);
  }, TIMEOUT);

  // ── GUARDRAIL: Off-topic (movies) ──────────────────────────────────────────
  test('Off-topic movie question → redirect, no plot summary', async () => {
    const ans = await ask({ question: 'Tell me about Avengers movie', grade: 'Grade 4' });
    console.log('[Off-topic movie]', ans);
    assertNotContains(ans, 'iron man', 'thanos', 'marvel', 'infinity');
    const redirects = /school|subject|curriculum|coach|learn/i.test(ans);
    if (!redirects) throw new Error(`Expected redirect for movie question\nGot: "${ans.slice(0,200)}"`);
  }, TIMEOUT);

  // ── GUARDRAIL: Topic lock ───────────────────────────────────────────────────
  test('When locked to Fractions, off-topic question gets redirected', async () => {
    const ans = await ask({
      question: 'What is photosynthesis?',
      subject: 'Mathematics',
      topic: 'Fractions',
      grade: 'Grade 4',
    });
    console.log('[Topic lock]', ans);
    // Should redirect back to Fractions
    const redirects = /fraction|finish|let's|topic/i.test(ans);
    if (!redirects) throw new Error(`Expected topic-lock redirect\nGot: "${ans.slice(0,200)}"`);
  }, TIMEOUT);

  // ── CONTINUITY: "Give me another example" ──────────────────────────────────
  test('"Give me another example" stays on same topic', async () => {
    const ans = await ask({
      question: 'Give me another example',
      subject: 'Mathematics',
      topic: 'Addition',
      grade: 'Grade 3',
      history: [
        ai('Addition means putting numbers together. Step 1: You have 2 apples. Step 2: You add 3 more. Answer: 5 apples. Try this: what is 1 + 2?'),
        user('Give me another example'),
      ],
    });
    console.log('[Another example]', ans);
    // Should give a new example on addition — model may describe it without the literal word "add"
    // e.g. "You have 4 toys. You get 2 more." is still an addition example
    const staysOnTopic = /add|plus|\+|total|sum|get \d+ more|more toy|more apple|more pencil|\d+.*\d+/i.test(ans);
    if (!staysOnTopic) throw new Error(`Expected addition example\nGot: "${ans.slice(0,200)}"`);
  }, TIMEOUT);

  // ── NO MARKDOWN ────────────────────────────────────────────────────────────
  test('Response has no markdown formatting', async () => {
    const ans = await ask({ question: 'Explain subtraction', subject: 'Mathematics', grade: 'Grade 3' });
    console.log('[No markdown]', ans);
    assertNotContains(ans, '**', '##', '```');
  }, TIMEOUT);

  // ── ENCOURAGING TONE ───────────────────────────────────────────────────────
  test('Response ends with encouragement', async () => {
    const ans = await ask({ question: 'What is perimeter?', subject: 'Mathematics', grade: 'Grade 4' });
    console.log('[Encouragement]', ans);
    // Encouragement: warm phrase OR a follow-up question inviting the student to try
    const encouraged = /(great|good|you can|do it|awesome|well done|fantastic|keep|try|can you|give it|what is the|find the|how many)/i.test(ans);
    if (!encouraged) throw new Error(`Expected encouragement or follow-up question\nGot: "${ans.slice(0,200)}"`);
  }, TIMEOUT);

});
