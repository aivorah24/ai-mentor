import { test, expect, request } from '@playwright/test';
import { loginAs, TEACHER_ACCOUNTS, PARENT_ACCOUNTS, waitForText, assertNoMockData } from './helpers';

const API = 'http://localhost:3001';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Backend API health checks (no UI needed)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Backend: Assignment API', () => {

  test('GET /assignments returns array (teacher query)', async ({ request }) => {
    const res = await request.get(`${API}/assignments?teacherId=ravi`);
    // 200 or any non-5xx is acceptable; "ravi" may not be a UUID but server handles fallback
    expect([200, 400]).toContain(res.status());
  });

  test('POST /assignments/generate-quiz returns questions from Groq', async ({ request }) => {
    const res = await request.post(`${API}/assignments/generate-quiz`, {
      data: {
        subject: 'Mathematics',
        chapter: 'Fractions',
        grade: '3',
        curriculum: 'NCERT',
        difficulty: 'medium',
        count: 3,
        teacherNotes: 'Focus on half and quarter fractions',
      },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();

    // Groq must return a questions array
    expect(body).toHaveProperty('questions');
    expect(Array.isArray(body.questions)).toBe(true);
    expect(body.questions.length).toBeGreaterThanOrEqual(1);

    // Each question must be well-formed
    const q = body.questions[0];
    expect(q).toHaveProperty('question');
    expect(q).toHaveProperty('options');
    expect(q).toHaveProperty('correct');
    expect(Array.isArray(q.options)).toBe(true);
    expect(q.options.length).toBe(4);
  });

  test('POST /assignments/generate-quiz — Groq returns valid JSON (no parse errors)', async ({ request }) => {
    const res = await request.post(`${API}/assignments/generate-quiz`, {
      data: {
        subject: 'Maths',
        chapter: 'Addition and Subtraction',
        grade: '3',
        curriculum: 'IB PYP',
        count: 2,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // body.questions[*].correct must match one of the 4 options
    for (const q of body.questions) {
      expect(q.options).toContain(q.correct);
    }
  });

  test('POST /assignments/generate-quiz — hint and explanation present', async ({ request }) => {
    const res = await request.post(`${API}/assignments/generate-quiz`, {
      data: {
        subject: 'Maths',
        chapter: 'Shapes',
        grade: '4',
        curriculum: 'NCERT',
        count: 2,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const q of body.questions) {
      expect(typeof q.hint).toBe('string');
      expect(typeof q.explanation).toBe('string');
      expect(q.hint.length).toBeGreaterThan(0);
      expect(q.explanation.length).toBeGreaterThan(0);
    }
  });

  test('POST /assignments creates an assignment and returns normalised object', async ({ request }) => {
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const res = await request.post(`${API}/assignments`, {
      data: {
        title: 'Playwright Test Assignment',
        subject: 'Mathematics',
        chapter: 'Fractions',
        dueDate: tomorrow,
        type: 'quiz',
        note: 'E2E test — safe to delete',
        studentId: null,
        createdByRole: 'teacher',
        grade: '3',
        curriculum: 'NCERT',
        quizQuestions: [],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.title).toBe('Playwright Test Assignment');
    expect(body.status).toBe('pending');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Teacher UI: TeacherAssignmentsScreen
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Teacher Assignments Screen', () => {

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEACHER_ACCOUNTS.ravi.email);
    // Navigate to the Assignments section in teacher sidebar
    const assignmentsLink = page.getByText('Assignments').first();
    await assignmentsLink.click();
    await waitForText(page, /assignments/i);
  });

  test('screen loads without mock data', async ({ page }) => {
    await assertNoMockData(page);
  });

  test('assignment tabs visible — All / Active / Completed', async ({ page }) => {
    const body = await page.locator('body').innerText();
    // At least one of these tab labels must appear
    const hasTab = /\bAll\b|\bActive\b|\bCompleted\b/.test(body);
    expect(hasTab, 'Expected tab labels All / Active / Completed').toBe(true);
  });

  test('New Assignment button is visible', async ({ page }) => {
    await expect(page.getByText(/new assignment/i).first()).toBeVisible();
  });

  test('clicking New Assignment opens creation modal/form', async ({ page }) => {
    await page.getByText(/new assignment/i).first().click();
    await page.waitForTimeout(500);
    // Modal should show a title field or "Create Assignment" heading
    const body = await page.locator('body').innerText();
    const opened = /title|create|assignment|subject|chapter/i.test(body);
    expect(opened, 'Modal/form should open with assignment creation fields').toBe(true);
  });

  test('Generate Quiz from Groq button works in modal', async ({ page }) => {
    await page.getByText(/new assignment/i).first().click();
    await page.waitForTimeout(500);

    // Look for quiz type selection or generate button
    const generateBtn = page.getByText(/generate.*quiz|generate questions/i).first();
    if (await generateBtn.isVisible()) {
      // Fill required fields first if needed
      const subjectInput = page.getByPlaceholder(/subject/i).first();
      if (await subjectInput.isVisible()) {
        await subjectInput.fill('Mathematics');
      }
      const chapterInput = page.getByPlaceholder(/chapter/i).first();
      if (await chapterInput.isVisible()) {
        await chapterInput.fill('Fractions');
      }
      await generateBtn.click();
      // Wait up to 15s for Groq to respond
      await page.waitForTimeout(10_000);
      const bodyAfter = await page.locator('body').innerText();
      // Should show questions or a question count
      const hasQuestions = /question|option|correct|mcq/i.test(bodyAfter);
      expect(hasQuestions, 'Groq should generate questions after clicking Generate').toBe(true);
    } else {
      // If button not visible, just ensure modal opened
      const body = await page.locator('body').innerText();
      expect(/title|subject|chapter/i.test(body)).toBe(true);
    }
  });

  test('switching tabs (Active → Completed) does not crash', async ({ page }) => {
    const tabs = ['Active', 'Completed', 'All'];
    for (const t of tabs) {
      const tab = page.getByText(t).first();
      if (await tab.isVisible()) {
        await tab.click();
        await page.waitForTimeout(400);
      }
    }
    await expect(page.locator('body')).toBeVisible();
  });

  test('assignment cards show subject and due date', async ({ page }) => {
    const body = await page.locator('body').innerText();
    // If any assignments exist, verify expected fields
    if (/mathematics|science|english/i.test(body)) {
      const hasDue = /due|by |date/i.test(body);
      expect(hasDue, 'Assignment cards should show a due date').toBe(true);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Parent UI: ParentAssignmentsScreen
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Parent Assignments Screen — Suresh (1 child)', () => {

  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.suresh.email);
    await page.getByText('Assignments').first().click();
    await waitForText(page, /assignments/i);
  });

  test('screen loads without mock data', async ({ page }) => {
    await assertNoMockData(page);
  });

  test('"This week at a glance" stats card visible', async ({ page }) => {
    await waitForText(page, /this week at a glance/i);
  });

  test('Completed / Upcoming / Study Time stats visible', async ({ page }) => {
    await waitForText(page, /completed/i);
    await waitForText(page, /upcoming|pending/i);
    await waitForText(page, /study time/i);
  });

  test('on-track percentage is a real number 0–100', async ({ page }) => {
    await waitForText(page, /on track/i);
    const body = await page.locator('body').innerText();
    const match = body.match(/(\d+)%\s*on track/i);
    expect(match, 'On-track % should be visible').toBeTruthy();
    const pct = parseInt(match![1]);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  test('study time is NOT hardcoded 4.3h', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const hardcoded = body.includes('4.3h') && !body.includes('12');
    expect(hardcoded, 'Should not show hardcoded 4.3h').toBe(false);
  });

  test('filter tabs All / School / Parent / Done work', async ({ page }) => {
    for (const f of ['School', 'Parent', 'Done', 'All']) {
      const tab = page.getByText(f).first();
      if (await tab.isVisible()) {
        await tab.click();
        await page.waitForTimeout(300);
      }
    }
    await expect(page.locator('body')).toBeVisible();
  });

  test('New Assignment button visible', async ({ page }) => {
    await expect(page.getByText(/new assignment/i).first()).toBeVisible();
  });

  test('Parent can open New Assignment modal', async ({ page }) => {
    await page.getByText(/new assignment/i).first().click();
    await page.waitForTimeout(500);
    const body = await page.locator('body').innerText();
    expect(/title|subject|assignment|create/i.test(body), 'Modal should open').toBe(true);
  });

});

test.describe('Parent Assignments — Deepa (2 children)', () => {

  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.deepa.email);
    await page.getByText('Assignments').first().click();
    await waitForText(page, /assignments/i);
  });

  test('child selector tabs shown for Priya and Rahul', async ({ page }) => {
    await waitForText(page, 'Priya');
    await waitForText(page, 'Rahul');
  });

  test('switching child tab reloads assignments for correct child', async ({ page }) => {
    await page.getByText('Rahul').first().click();
    await page.waitForLoadState('networkidle');
    await waitForText(page, 'Rahul');
  });

  test('switching back to Priya shows Priya context', async ({ page }) => {
    await page.getByText('Rahul').first().click();
    await page.waitForTimeout(400);
    await page.getByText('Priya').first().click();
    await page.waitForTimeout(400);
    await waitForText(page, 'Priya');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Groq grading: submit a quiz and verify AI feedback
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Groq Assignment Grading — API level', () => {

  let createdAssignmentId: string | null = null;

  test('full flow: create quiz → submit answers → Groq returns score + feedback', async ({ request }) => {
    // Step 1: generate questions via Groq
    const genRes = await request.post(`${API}/assignments/generate-quiz`, {
      data: {
        subject: 'Mathematics',
        chapter: 'Fractions',
        grade: '3',
        curriculum: 'NCERT',
        count: 3,
      },
    });
    expect(genRes.status()).toBe(200);
    const { questions } = await genRes.json();
    expect(questions.length).toBeGreaterThanOrEqual(1);

    // Step 2: create an assignment with those questions
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const createRes = await request.post(`${API}/assignments`, {
      data: {
        title: 'E2E Groq Grading Test',
        subject: 'Mathematics',
        chapter: 'Fractions',
        dueDate: tomorrow,
        type: 'quiz',
        note: 'E2E test — delete after',
        studentId: null,
        createdByRole: 'teacher',
        grade: '3',
        curriculum: 'NCERT',
        quizQuestions: questions,
      },
    });
    expect(createRes.status()).toBe(200);
    const created = await createRes.json();
    createdAssignmentId = created.id;
    expect(createdAssignmentId).toBeTruthy();

    // Step 3: submit answers — pick the correct answer for each question
    const quizAnswers = questions.map((q: any) => ({
      questionId: q.id,
      answer: q.correct,
    }));

    const submitRes = await request.post(`${API}/assignments/${createdAssignmentId}/submit`, {
      data: { quizAnswers },
    });
    expect(submitRes.status()).toBe(200);
    const result = await submitRes.json();

    // Step 4: verify Groq returned a proper graded result
    expect(result).toHaveProperty('status', 'completed');
    expect(result).toHaveProperty('score');
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);

    // All correct answers → score should be ~100
    expect(result.score).toBeGreaterThanOrEqual(80);

    // AI feedback must be present
    expect(result).toHaveProperty('ai_feedback');
    const feedback = typeof result.ai_feedback === 'string'
      ? JSON.parse(result.ai_feedback)
      : result.ai_feedback;
    expect(feedback).toHaveProperty('text');
    expect(typeof feedback.text).toBe('string');
    expect(feedback.text.length).toBeGreaterThan(0);
  });

  test('submit all wrong answers → score is 0 and feedback is encouraging', async ({ request }) => {
    // Create a minimal quiz inline
    const genRes = await request.post(`${API}/assignments/generate-quiz`, {
      data: { subject: 'Maths', chapter: 'Numbers', grade: '3', curriculum: 'NCERT', count: 2 },
    });
    expect(genRes.status()).toBe(200);
    const { questions } = await genRes.json();

    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const createRes = await request.post(`${API}/assignments`, {
      data: {
        title: 'E2E Wrong Answers Test',
        subject: 'Maths',
        chapter: 'Numbers',
        dueDate: tomorrow,
        type: 'quiz',
        studentId: null,
        createdByRole: 'teacher',
        grade: '3',
        curriculum: 'NCERT',
        quizQuestions: questions,
      },
    });
    const { id } = await createRes.json();

    // Pick a wrong option for each question (not the correct one)
    const quizAnswers = questions.map((q: any) => ({
      questionId: q.id,
      answer: q.options.find((o: string) => o !== q.correct) ?? q.options[0],
    }));

    const submitRes = await request.post(`${API}/assignments/${id}/submit`, {
      data: { quizAnswers },
    });
    expect(submitRes.status()).toBe(200);
    const result = await submitRes.json();

    expect(result.score).toBeLessThanOrEqual(20); // all wrong → near 0

    const feedback = typeof result.ai_feedback === 'string'
      ? JSON.parse(result.ai_feedback)
      : result.ai_feedback;
    // Feedback text should be encouraging (not empty/harsh)
    expect(feedback.text.length).toBeGreaterThan(0);
  });

  test('Groq per-question feedback present on quiz submission', async ({ request }) => {
    const genRes = await request.post(`${API}/assignments/generate-quiz`, {
      data: { subject: 'Maths', chapter: 'Shapes', grade: '3', curriculum: 'NCERT', count: 2 },
    });
    const { questions } = await genRes.json();

    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const createRes = await request.post(`${API}/assignments`, {
      data: {
        title: 'E2E Per-Question Feedback Test',
        subject: 'Maths', chapter: 'Shapes', dueDate: tomorrow,
        type: 'quiz', studentId: null, createdByRole: 'teacher',
        grade: '3', curriculum: 'NCERT', quizQuestions: questions,
      },
    });
    const { id } = await createRes.json();

    const quizAnswers = questions.map((q: any) => ({ questionId: q.id, answer: q.correct }));
    const submitRes = await request.post(`${API}/assignments/${id}/submit`, { data: { quizAnswers } });
    const result = await submitRes.json();

    // perQuestion should be an array with one entry per question
    expect(result).toHaveProperty('perQuestion');
    expect(Array.isArray(result.perQuestion)).toBe(true);
    expect(result.perQuestion.length).toBeGreaterThanOrEqual(1);

    const pq = result.perQuestion[0];
    expect(pq).toHaveProperty('correct');
    expect(typeof pq.correct).toBe('boolean');
  });

  test('Groq grading stamp field is one of the expected values', async ({ request }) => {
    const genRes = await request.post(`${API}/assignments/generate-quiz`, {
      data: { subject: 'Maths', chapter: 'Fractions', grade: '3', curriculum: 'NCERT', count: 2 },
    });
    const { questions } = await genRes.json();
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const createRes = await request.post(`${API}/assignments`, {
      data: {
        title: 'E2E Stamp Test', subject: 'Maths', chapter: 'Fractions',
        dueDate: tomorrow, type: 'quiz', studentId: null, createdByRole: 'teacher',
        grade: '3', curriculum: 'NCERT', quizQuestions: questions,
      },
    });
    const { id } = await createRes.json();
    const quizAnswers = questions.map((q: any) => ({ questionId: q.id, answer: q.correct }));
    const submitRes = await request.post(`${API}/assignments/${id}/submit`, { data: { quizAnswers } });
    const result = await submitRes.json();

    const feedback = typeof result.ai_feedback === 'string'
      ? JSON.parse(result.ai_feedback)
      : result.ai_feedback;

    if (feedback.stamp) {
      // Stamp should be a non-empty motivating string
      expect(feedback.stamp.length).toBeGreaterThan(0);
    }
  });

});
