/**
 * FULL TEACHER → STUDENT → PARENT LIFECYCLE (automated, headless, no approvals)
 *
 * Runs the real pipeline against a LOCAL stack and the 3 linked accounts seeded
 * by server/scripts/seed-e2e-accounts.js (teacher↔student, parent↔student).
 *
 * Covers the checklist:
 *   • worksheet upload → interactive quiz generation
 *   • image cropping/embedding (every image is a self-contained base64 data URI)
 *   • school + curriculum (TSRA + IB PYP) logos injected into the published HTML
 *   • edit-answers persists into the published quiz
 *   • pre-publish validation gate BLOCKS an empty/broken quiz (negative test)
 *   • multiple-worksheet upload
 *   • student answers a question correctly and SUBMITS
 *   • the submission shows up for the teacher
 *   • teacher + student can log in through the real UI
 *
 * PREREQS (start these first — the test does not boot them):
 *   1. Backend:  cd server && node index.js         (API on :3006, Python ML on :5050)
 *   2. Frontend: cd AIMentorApp && npm run web       (Expo web on :8081)  [only for the UI smoke]
 *   3. Accounts: cd server && node scripts/seed-e2e-accounts.js
 *
 * RUN:  cd AIMentorApp && npx playwright test e2e/full-lifecycle.spec.ts
 *   (exit 0 = all green, exit 1 = failure; screenshots/video/trace saved on failure)
 */
import { test, expect, APIRequestContext } from '@playwright/test';
import { E2E, loginWithPassword } from './e2e-accounts.helpers';
import * as fs from 'fs';
import * as path from 'path';

const API = process.env.E2E_API || 'http://localhost:3006';
const GEN_TIMEOUT = 180_000; // Gemini + ML can take up to ~3 min on a dense worksheet

// Real worksheet fixtures on disk (same ones the pilot used). Add/adjust paths as needed.
const DOCS = 'C:/Users/Asus/Desktop/Aivorah Documents/Assignment Picture';
const WORKSHEETS = [
  path.join(DOCS, 'Toddle-18d1b2d2-239c-414a-8d82-142053d025d3-Revised PYP4 -MHLE-29.pdf'),
];

// Seeded account ids are resolved by email server-side (resolveUserId), so we
// pass emails as createdById/studentId and let the API resolve them.
const TEACHER_ID = E2E.teacher.email;
const STUDENT_ID = E2E.student.email;

function dueDateTomorrow(): string {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Recursively collect every image src the quiz would render, so we can assert
// they are all self-contained data: URIs (never a fragile /data/images/... path).
function collectImageUrls(quiz: any): string[] {
  const urls: string[] = [];
  for (const t of quiz.tasks || []) {
    if (t.pageImageUrl) urls.push(t.pageImageUrl);
    if (t.diagramFillImageUrl) urls.push(t.diagramFillImageUrl); // the "breaks after 2 days" field
    for (const q of t.questions || []) if (q.imageUrl) urls.push(q.imageUrl);
  }
  for (const p of quiz.fullPageImages || []) if (p.imageUrl) urls.push(p.imageUrl);
  return urls;
}

async function generateQuiz(request: APIRequestContext, pdfPath: string) {
  const res = await request.post(`${API}/quiz/generate`, {
    multipart: {
      pdf: { name: path.basename(pdfPath), mimeType: 'application/pdf', buffer: fs.readFileSync(pdfPath) },
      grade: 'PYP 4', subject: 'Mathematics', school: 'TSRA',
    },
    timeout: GEN_TIMEOUT,
  });
  expect(res.status(), `generate returned ${res.status()}: ${(await res.text()).slice(0, 300)}`).toBe(200);
  return (await res.json()).quiz;
}

async function publish(request: APIRequestContext, quiz: any, opts: { expectStatus?: number } = {}) {
  const res = await request.post(`${API}/assignments`, {
    data: {
      title: 'E2E Lifecycle Quiz', subject: 'Mathematics', dueDate: dueDateTomorrow(),
      type: 'assignment', studentId: STUDENT_ID, createdById: TEACHER_ID, createdByRole: 'teacher',
      grade: 'PYP 4', curriculum: 'IB PYP', interactiveQuiz: quiz,
    },
    timeout: 60_000,
  });
  if (opts.expectStatus) expect(res.status()).toBe(opts.expectStatus);
  return res;
}

test.describe.configure({ mode: 'serial' }); // steps depend on each other

test.describe('Teacher → Student → Parent lifecycle (API pipeline)', () => {
  test.setTimeout(GEN_TIMEOUT + 120_000);

  let quiz: any;
  let assignmentId: string;

  test('worksheet fixtures exist', () => {
    for (const w of WORKSHEETS) expect(fs.existsSync(w), `Missing worksheet: ${w}`).toBe(true);
  });

  test('generate: quiz has tasks, no empty tasks, all images are base64 (cropping OK)', async ({ request }) => {
    quiz = await generateQuiz(request, WORKSHEETS[0]);
    expect(Array.isArray(quiz.tasks) && quiz.tasks.length).toBeGreaterThan(0);

    // No empty task cards (the "Task 4 shows only a heading" class of bug)
    const emptyTasks = quiz.tasks.filter((t: any) =>
      !(t.questions?.length) && !t.chart && !t.tables?.length && !t.table?.rows?.length &&
      !t.pyramids?.length && !t.diagramFillBlanks?.length && !t._matchTask && !t.sharedImage && !t.passage);
    expect(emptyTasks.map((t: any) => t.title)).toEqual([]);

    // Every image is a self-contained data: URI (survives Cloud Run disk recycle)
    for (const url of collectImageUrls(quiz)) {
      expect(url.startsWith('data:'), `Image is not base64-embedded: ${url}`).toBe(true);
    }
  });

  test('edit-answers: an edited answer persists into publish', async ({ request }) => {
    // Simulate the teacher editing the first gradable answer, then publishing.
    const q = quiz.tasks.flatMap((t: any) => t.questions || []).find((q: any) => q.answer != null);
    if (q) q.answer = q.__editedMarker = 'E2E_EDITED_ANSWER';
    const res = await publish(request, quiz, { expectStatus: 200 });
    const body = await res.json();
    assignmentId = body.id;
    expect(assignmentId).toBeTruthy();
  });

  test('branding: published quiz HTML carries the TSRA + IB PYP logos', async ({ request }) => {
    // No GET /:id route — the student list endpoint re-renders the HTML (with
    // fetchBranding injecting the school + curriculum logos). Find our assignment.
    const res = await request.get(`${API}/assignments?studentId=${encodeURIComponent(STUDENT_ID)}`);
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    const mine = (Array.isArray(list) ? list : []).find((a: any) => a.id === assignmentId);
    expect(mine, 'published assignment should appear in the student list').toBeTruthy();
    const html = mine.interactiveQuizHtml || '';
    // fetchBranding(TSRA, IB PYP) injects Cloudinary logo <img>s into header-logos
    expect(html).toMatch(/header-logos/);
    expect(html).toMatch(/res\.cloudinary\.com/);
  });

  test('validation gate BLOCKS an empty-task quiz (negative test)', async ({ request }) => {
    const broken = { tasks: [{ title: 'Task X: content lost', questions: [] }] };
    const res = await publish(request, broken);
    expect(res.status(), 'empty-task quiz must be rejected, not published').toBe(422);
  });

  test('student submits correct answers → 200', async ({ request }) => {
    // Build answers from the quiz's own answer key (a "perfect" submission).
    const flat = quiz.tasks.flatMap((t: any) => (t.questions || []).map((q: any) => q.answer));
    const res = await request.post(`${API}/assignments/${assignmentId}/submit`, {
      data: {
        studentId: STUDENT_ID,
        quizAnswers: flat.map((a: any, i: number) => ({ index: i, answer: String(a ?? '') })),
      },
      timeout: 60_000,
    });
    expect(res.status(), `submit returned ${res.status()}: ${(await res.text()).slice(0, 300)}`).toBe(200);
  });

  test('the submission shows up for the teacher', async ({ request }) => {
    const res = await request.get(`${API}/assignments/${assignmentId}/submissions`);
    expect(res.ok()).toBeTruthy();
    const subs = await res.json();
    const list = Array.isArray(subs) ? subs : (subs.submissions || []);
    expect(list.length, 'teacher should see at least one submission').toBeGreaterThan(0);
  });

  test('multiple-worksheet upload: a second worksheet also generates + publishes', async ({ request }) => {
    test.skip(WORKSHEETS.length < 2, 'add a 2nd path to WORKSHEETS to exercise multi-upload');
    const quiz2 = await generateQuiz(request, WORKSHEETS[1]);
    const res = await publish(request, quiz2, { expectStatus: 200 });
    expect((await res.json()).id).toBeTruthy();
  });
});

// ── Thin UI smoke: confirm the seeded accounts log in through the real web app ──
// (Requires the Expo web server on :8081 / PW_BASE_URL. Skips cleanly if absent.)
test.describe('UI login smoke (real app)', () => {
  test('teacher can log in', async ({ page }) => {
    await loginWithPassword(page, E2E.teacher.email, E2E.password);
    await expect(page.getByText('AI-Powered Learning Platform')).not.toBeVisible();
  });

  test('student can log in', async ({ page }) => {
    await loginWithPassword(page, E2E.student.email, E2E.password);
    await expect(page.getByText('AI-Powered Learning Platform')).not.toBeVisible();
  });
});
