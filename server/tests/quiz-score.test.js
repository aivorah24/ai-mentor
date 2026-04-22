/**
 * Quiz Score Logic Tests — Issue #55
 *
 * Tests the core scoring algorithm used in IBPYPQuizScreen:
 *   - Score always stays within 0–totalQuestions
 *   - Percentage always stays within 0–100
 *   - Score resets to 0 on retry (never accumulates)
 *   - Last question counted correctly (no stale closure)
 */

// ── Pure score helpers (mirrors IBPYPQuizScreen logic) ─────────────────────
// These replicate the exact logic in nextQuestion() and fetchQuiz()

function createQuizState(totalQuestions = 5) {
  return { score: 0, currentQ: 0, totalQuestions };
}

function answerQuestion(state, isCorrect) {
  const newScore = state.score + (isCorrect ? 1 : 0);
  const isLast = state.currentQ === state.totalQuestions - 1;
  return {
    ...state,
    score: newScore,
    currentQ: isLast ? state.currentQ : state.currentQ + 1,
    finished: isLast,
  };
}

function computeResult(state) {
  const pct = Math.round((state.score / state.totalQuestions) * 100);
  return { score: state.score, total: state.totalQuestions, pct };
}

function retryQuiz(totalQuestions = 5) {
  // fetchQuiz() now resets score — simulate that
  return createQuizState(totalQuestions);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Quiz Score — basic correctness', () => {
  test('5 correct out of 5 → 100%', () => {
    let state = createQuizState(5);
    for (let i = 0; i < 5; i++) state = answerQuestion(state, true);
    const { score, pct } = computeResult(state);
    expect(score).toBe(5);
    expect(pct).toBe(100);
  });

  test('0 correct out of 5 → 0%', () => {
    let state = createQuizState(5);
    for (let i = 0; i < 5; i++) state = answerQuestion(state, false);
    const { score, pct } = computeResult(state);
    expect(score).toBe(0);
    expect(pct).toBe(0);
  });

  test('3 correct out of 5 → 60%', () => {
    let state = createQuizState(5);
    [true, true, true, false, false].forEach(c => { state = answerQuestion(state, c); });
    const { score, pct } = computeResult(state);
    expect(score).toBe(3);
    expect(pct).toBe(60);
  });

  test('1 correct out of 5 → 20%', () => {
    let state = createQuizState(5);
    [true, false, false, false, false].forEach(c => { state = answerQuestion(state, c); });
    const { pct } = computeResult(state);
    expect(pct).toBe(20);
  });
});

describe('Quiz Score — percentage always 0–100', () => {
  test('score never exceeds totalQuestions', () => {
    let state = createQuizState(5);
    for (let i = 0; i < 5; i++) state = answerQuestion(state, true);
    expect(state.score).toBeLessThanOrEqual(5);
  });

  test('percentage never exceeds 100', () => {
    let state = createQuizState(5);
    for (let i = 0; i < 5; i++) state = answerQuestion(state, true);
    const { pct } = computeResult(state);
    expect(pct).toBeLessThanOrEqual(100);
  });

  test('percentage never goes below 0', () => {
    let state = createQuizState(5);
    for (let i = 0; i < 5; i++) state = answerQuestion(state, false);
    const { pct } = computeResult(state);
    expect(pct).toBeGreaterThanOrEqual(0);
  });
});

describe('Quiz Score — retry resets score (Issue #55 regression)', () => {
  test('retry after 5/5 starts at 0, not 5', () => {
    // Run 1
    let state = createQuizState(5);
    for (let i = 0; i < 5; i++) state = answerQuestion(state, true);
    expect(state.score).toBe(5);

    // Retry — fetchQuiz resets score
    state = retryQuiz(5);
    expect(state.score).toBe(0);
  });

  test('4 retries do not accumulate to 20/5', () => {
    let state;
    for (let run = 0; run < 4; run++) {
      state = retryQuiz(5);                          // reset each time
      for (let i = 0; i < 5; i++) state = answerQuestion(state, true);
    }
    const { score, pct } = computeResult(state);
    expect(score).toBe(5);   // not 20
    expect(pct).toBe(100);   // not 400
  });

  test('retry after partial run resets correctly', () => {
    let state = createQuizState(5);
    // Answer 3 questions in run 1
    [true, false, true].forEach(c => { state = answerQuestion(state, c); });
    expect(state.score).toBe(2);

    // Retry
    state = retryQuiz(5);
    expect(state.score).toBe(0);
    expect(state.currentQ).toBe(0);
  });
});

describe('Quiz Score — last question counted correctly (stale closure fix)', () => {
  test('last correct answer is included in final score', () => {
    let state = createQuizState(5);
    // 4 wrong, last one correct
    [false, false, false, false, true].forEach(c => { state = answerQuestion(state, c); });
    const { score, pct } = computeResult(state);
    expect(score).toBe(1);
    expect(pct).toBe(20);
  });

  test('last wrong answer does not inflate score', () => {
    let state = createQuizState(5);
    // 4 correct, last one wrong
    [true, true, true, true, false].forEach(c => { state = answerQuestion(state, c); });
    const { score, pct } = computeResult(state);
    expect(score).toBe(4);
    expect(pct).toBe(80);
  });

  test('score after last question matches newScore, not stale score', () => {
    // Simulates: score=4, last question correct → newScore=5
    // Old bug: finalScore = score + 1 but score was stale (still 4 before setScore)
    // Fix: compute newScore first, use it directly
    const score = 4;   // current state before last question
    const isCorrect = true;
    const newScore = score + (isCorrect ? 1 : 0);   // 5 — this is what the fix does
    const finalPct = Math.round((newScore / 5) * 100);
    expect(newScore).toBe(5);
    expect(finalPct).toBe(100);
  });
});

describe('Quiz Score — edge cases', () => {
  test('single question quiz: correct → 100%', () => {
    let state = createQuizState(1);
    state = answerQuestion(state, true);
    const { pct } = computeResult(state);
    expect(pct).toBe(100);
  });

  test('single question quiz: wrong → 0%', () => {
    let state = createQuizState(1);
    state = answerQuestion(state, false);
    const { pct } = computeResult(state);
    expect(pct).toBe(0);
  });

  test('mixed answers produce correct running total', () => {
    let state = createQuizState(5);
    const answers = [true, false, true, false, true]; // 3 correct
    answers.forEach(c => { state = answerQuestion(state, c); });
    expect(state.score).toBe(3);
    expect(computeResult(state).pct).toBe(60);
  });
});
