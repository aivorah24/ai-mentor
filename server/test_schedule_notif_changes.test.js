// Integration tests for the schedule + notification changes.
// Run with:  node --test test_schedule_notif_changes.test.js
// Requires the local server running on :3006 and Supabase env in .env.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const { createClient } = require('@supabase/supabase-js');
const { sendPush } = require('./services/push');

const BASE = 'http://localhost:3006';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Known test fixtures (seeded demo data)
const STUDENT_ID = 'aaaa0000-0000-0000-0000-000000000001'; // arjun@test.ai (Grade 3, NCERT)
const STUDENT_EMAIL = 'arjun@test.ai';
const TEACHER_ID = '79b35f00-0786-4291-9602-7faab2300fb6';
const CHALLENGE_ID = 'cbse_g3_evs_the_plant_fairy'; // Grade 3 challenge
const PUSH_TEST_EMAIL = 'zz_test_pushpref@aivorah.test';

const createdAssignmentIds = [];
const createdChallengeStudentIds = []; // to clean challenge_assignments

async function postAssignment(body) {
  const res = await fetch(`${BASE}/assignments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data && data.id) createdAssignmentIds.push(data.id);
  return { status: res.status, data };
}

async function schedEventsFor(assignmentId) {
  const { data } = await supabase.from('schedule_events').select('*').eq('assignment_id', assignmentId);
  return data || [];
}

test.after(async () => {
  // Clean up everything this suite created.
  for (const id of createdAssignmentIds) {
    await supabase.from('schedule_events').delete().eq('assignment_id', id);
    await supabase.from('assignments').delete().eq('id', id);
  }
  await supabase.from('challenge_assignments').delete().eq('challenge_id', CHALLENGE_ID).eq('student_id', STUDENT_ID);
  await supabase.from('schedule_events').delete().eq('type', 'challenge').eq('student_id', STUDENT_ID).ilike('title', 'The Plant Fairy%');
  await supabase.from('user_preferences').delete().eq('user_email', PUSH_TEST_EMAIL);
});

// ── Issue 1 & 2: assignment creates a schedule_event (the id bug) ──────────────
test('assignment WITH dueDate creates a schedule_event with a valid id', async () => {
  const { data } = await postAssignment({
    title: 'UT Assignment A', subject: 'Mathematics', studentId: STUDENT_ID,
    dueDate: '2026-07-25', createdById: TEACHER_ID, createdByRole: 'teacher',
    type: 'assignment', grade: 'Grade 3',
  });
  assert.ok(data.id, 'assignment created');
  const evs = await schedEventsFor(data.id);
  assert.strictEqual(evs.length, 1, 'exactly one schedule_event created');
  assert.ok(evs[0].id, 'schedule_event has a non-null id');
  assert.strictEqual(evs[0].event_date, '2026-07-25', 'event date matches due date');
  assert.strictEqual(evs[0].type, 'deadline', 'type is deadline');
});

test('schedule_event is scoped to the student AND the teacher (both calendars)', async () => {
  const { data } = await postAssignment({
    title: 'UT Assignment B', subject: 'Science', studentId: STUDENT_ID,
    dueDate: '2026-07-26', createdById: TEACHER_ID, createdByRole: 'teacher',
    type: 'assignment', grade: 'Grade 3',
  });
  const evs = await schedEventsFor(data.id);
  assert.strictEqual(evs[0].student_id, STUDENT_ID, 'student_id set → shows in student calendar');
  assert.strictEqual(evs[0].created_by, 'teacher', 'created_by teacher → shows in teacher schedule');
  assert.strictEqual(evs[0].created_by_id, TEACHER_ID, 'created_by_id set for teacher scoping');
});

// ── Issue 3: label reflects assignment vs quiz vs challenge ────────────────────
test('assignment title is labeled "Assignment due"', async () => {
  const { data } = await postAssignment({
    title: 'UT Label Assignment', subject: 'Mathematics', studentId: STUDENT_ID,
    dueDate: '2026-07-27', createdById: TEACHER_ID, createdByRole: 'teacher',
    type: 'assignment', grade: 'Grade 3',
  });
  const evs = await schedEventsFor(data.id);
  assert.match(evs[0].title, /— Assignment due$/, 'title ends with "— Assignment due"');
});

test('quiz title is labeled "Quiz due"', async () => {
  const { data } = await postAssignment({
    title: 'UT Label Quiz', subject: 'Mathematics', studentId: STUDENT_ID,
    dueDate: '2026-07-28', createdById: TEACHER_ID, createdByRole: 'teacher',
    type: 'quiz', grade: 'Grade 3',
    quizQuestions: [{ question: 'What is 2+2?', options: ['1', '2', '3', '4'], correct: '4' }],
  });
  assert.ok(data.id, 'quiz assignment created');
  const evs = await schedEventsFor(data.id);
  assert.strictEqual(evs.length, 1, 'quiz has a schedule_event');
  assert.match(evs[0].title, /— Quiz due$/, 'title ends with "— Quiz due"');
});

// ── Edge case: dueDate is REQUIRED by the endpoint (defense in depth) ──────────
// The POST rejects a missing dueDate outright (400), so no bogus assignment or
// event is ever created — and the schedule-insert guard is a second safety net.
test('assignment WITHOUT dueDate is rejected (400), no event created', async () => {
  const res = await fetch(`${BASE}/assignments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'UT No Due', subject: 'Mathematics', studentId: STUDENT_ID,
      createdById: TEACHER_ID, createdByRole: 'teacher', type: 'assignment', grade: 'Grade 3',
    }),
  });
  assert.strictEqual(res.status, 400, 'missing dueDate is rejected');
  const data = await res.json();
  assert.ok(!data.id, 'no assignment created');
});

// ── Issue 3: challenge labeled "Challenge due" ────────────────────────────────
test('challenge assign creates a schedule_event labeled "Challenge due"', async () => {
  const res = await fetch(`${BASE}/challenges/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId: CHALLENGE_ID, studentId: STUDENT_ID, assignedById: TEACHER_ID,
      assignedByRole: 'teacher', dueDate: '2026-07-29',
    }),
  });
  const data = await res.json();
  assert.ok(data.id || data.assignmentId, 'challenge assigned');
  const { data: evs } = await supabase.from('schedule_events')
    .select('title,type').eq('type', 'challenge').eq('student_id', STUDENT_ID).ilike('title', 'The Plant Fairy%');
  assert.ok(evs.length >= 1, 'challenge schedule_event exists');
  assert.match(evs[0].title, /— Challenge due$/, 'title ends with "— Challenge due"');
});

// ── Issue 5: parent daily task surfaces in the student bell ───────────────────
test('parent daily task appears as a "task" item in notifications-summary', async () => {
  const label = 'UT Read 10 pages ' + Date.now();
  const res = await fetch(`${BASE}/habits/parent-tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentEmail: 'ut-parent@test.ai', childId: STUDENT_ID, label }),
  });
  const task = await res.json();
  assert.ok(task.id, 'daily task created');

  try {
    const summ = await fetch(`${BASE}/messages/notifications-summary?userEmail=${encodeURIComponent(STUDENT_EMAIL)}&studentId=${STUDENT_ID}&since=2020-01-01`);
    const body = await summ.json();
    const taskItems = (body.notificationItems || []).filter(i => i.type === 'task');
    assert.ok(taskItems.length >= 1, 'a task item is returned');
    assert.ok(taskItems.some(i => i.subtitle && i.subtitle.includes(label)), 'task item carries the label');
    assert.match(taskItems[0].title, /daily task/i, 'task item titled as a daily task');
  } finally {
    await supabase.from('parent_daily_tasks').delete().eq('id', task.id);
  }
});

// ── Issue 5 (push): daily-task push delivery + preference gating ──────────────
// The daily-task push uses prefKey 'assignmentAlerts'. Expo push only reaches a
// registered device token, so we seed one and assert delivery is attempted, and
// that an opted-out recipient is skipped. (On web there is no token, so no OS
// push appears anywhere — the bell/banner is the web equivalent.)
test('daily-task push delivers to a registered token and respects assignmentAlerts', async () => {
  await supabase.from('user_preferences').upsert({
    user_email: PUSH_TEST_EMAIL,
    data: { assignmentAlerts: true, expoPushTokens: ['ExponentPushToken[ut-task]'] },
  });
  const on = await sendPush(PUSH_TEST_EMAIL, {
    title: 'New daily task', body: 'Your parent added: Read', data: { type: 'task' }, prefKey: 'assignmentAlerts',
  });
  assert.strictEqual(on.sent, 1, 'daily-task push is attempted when Assignment Alerts is on');

  await supabase.from('user_preferences').update({
    data: { assignmentAlerts: false, expoPushTokens: ['ExponentPushToken[ut-task]'] },
  }).eq('user_email', PUSH_TEST_EMAIL);
  const off = await sendPush(PUSH_TEST_EMAIL, {
    title: 'New daily task', body: 'Your parent added: Read', data: { type: 'task' }, prefKey: 'assignmentAlerts',
  });
  assert.strictEqual(off.sent, 0, 'daily-task push is suppressed when Assignment Alerts is off');
});

test('daily-task push to a recipient with NO registered token sends nothing (e.g. web-only user)', async () => {
  await supabase.from('user_preferences').upsert({
    user_email: PUSH_TEST_EMAIL,
    data: { assignmentAlerts: true }, // no expoPushTokens
  });
  const res = await sendPush(PUSH_TEST_EMAIL, { title: 'New daily task', body: 'x', prefKey: 'assignmentAlerts' });
  assert.strictEqual(res.sent, 0, 'no device token → no OS push (bell/banner covers web)');
});

// ── A parent creating an assignment must NOT be notified of their own action ──
test('parent-created assignment does not notify the creating parent', async () => {
  // Ensure a parent link exists for the test student → the creating parent.
  const PARENT_EMAIL = 'ut-selfnotify-parent@test.ai';
  await supabase.from('parent_children').upsert(
    { parent_email: PARENT_EMAIL, child_id: STUDENT_ID, child_email: STUDENT_EMAIL },
    { onConflict: 'parent_email,child_id' }
  ).select();

  const title = 'UT SelfNotify ' + Date.now();
  const { data } = await postAssignment({
    title, subject: 'Mathematics', studentId: STUDENT_ID, dueDate: '2026-07-30',
    createdById: PARENT_EMAIL, createdByRole: 'parent', grade: 'Grade 3',
  });
  assert.ok(data.id, 'assignment created');

  // Give the fire-and-forget notify block a moment to run.
  await new Promise(r => setTimeout(r, 1200));
  const { data: msgs } = await supabase.from('messages')
    .select('id').eq('recipient_email', PARENT_EMAIL).ilike('content', `%${title}%`);
  assert.strictEqual((msgs || []).length, 0, 'creating parent received NO self-notification');

  // cleanup
  await supabase.from('messages').delete().ilike('content', `%${title}%`);
  await supabase.from('parent_children').delete().eq('parent_email', PARENT_EMAIL).eq('child_id', STUDENT_ID);
});

// ── Regression: creator sends their USER ID (UUID), not email — still no self-alert
test('parent-created assignment (createdById = parent UUID) does not self-notify', async () => {
  const PARENT_EMAIL = 'ut-uuid-parent@test.ai';
  const PARENT_UUID = '11111111-2222-3333-4444-555555550001';
  // Seed a parent user with a real id + link to the test student.
  await supabase.from('users').upsert({ id: PARENT_UUID, email: PARENT_EMAIL, name: 'UT UUID Parent', role: 'parent' });
  await supabase.from('parent_children').upsert(
    { parent_email: PARENT_EMAIL, child_id: STUDENT_ID, child_email: STUDENT_EMAIL },
    { onConflict: 'parent_email,child_id' }
  ).select();

  const title = 'UT UUIDNotify ' + Date.now();
  const { data } = await postAssignment({
    title, subject: 'Mathematics', studentId: STUDENT_ID, dueDate: '2026-07-30',
    createdById: PARENT_UUID, createdByRole: 'parent', grade: 'Grade 3', // <-- UUID, the real client shape
  });
  assert.ok(data.id, 'assignment created');
  await new Promise(r => setTimeout(r, 1200));
  const { data: msgs } = await supabase.from('messages')
    .select('id').eq('recipient_email', PARENT_EMAIL).ilike('content', `%${title}%`);
  assert.strictEqual((msgs || []).length, 0, 'creating parent (by UUID) received NO self-notification');

  // cleanup
  await supabase.from('messages').delete().ilike('content', `%${title}%`);
  await supabase.from('parent_children').delete().eq('parent_email', PARENT_EMAIL).eq('child_id', STUDENT_ID);
  await supabase.from('users').delete().eq('id', PARENT_UUID);
});

// ── Parent MCQ quiz generation returns real options (not A/B/C/D placeholders) ─
test('parent ai-generate quiz returns MCQ questions with 4 REAL options + valid correct', async () => {
  const res = await fetch(`${BASE}/assignments/ai-generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '3 multiplication word problems', subject: 'Mathematics', grade: 'Grade 3', curriculum: 'IB PYP', count: 3, type: 'quiz' }),
  });
  const data = await res.json();
  assert.strictEqual(data.type, 'quiz', 'type is quiz');
  assert.ok(Array.isArray(data.quizQuestions) && data.quizQuestions.length >= 1, 'quizQuestions returned');
  for (const q of data.quizQuestions) {
    assert.strictEqual(q.options.length, 4, 'exactly 4 options');
    assert.ok(q.options.includes(q.correct), 'correct answer is one of the options');
    // Options must be real values, not literal single-letter A/B/C/D placeholders.
    const allPlaceholders = q.options.every((o, i) => String(o).trim() === ['A', 'B', 'C', 'D'][i]);
    assert.ok(!allPlaceholders, 'options are real answers, not A/B/C/D placeholders');
  }
});

test('parent ai-generate assignment (non-quiz) returns plain-text questions', async () => {
  const res = await fetch(`${BASE}/assignments/ai-generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Practice writing about community helpers', subject: 'English', grade: 'Grade 3', curriculum: 'IB PYP', count: 3, type: 'assignment' }),
  });
  const data = await res.json();
  assert.strictEqual(data.type, 'assignment', 'type is assignment');
  assert.ok(Array.isArray(data.questions) && data.questions.length >= 1, 'plain questions returned');
  assert.ok(data.questions.every(q => typeof q === 'string'), 'questions are plain strings');
  assert.strictEqual(data.quizQuestions.length, 0, 'no MCQ questions for an assignment');
});

// ── push.js preference gating (blank-push / opt-out) ──────────────────────────
test('sendPush respects prefKey opt-out; ignores it when no prefKey given', async () => {
  await supabase.from('user_preferences').upsert({
    user_email: PUSH_TEST_EMAIL,
    data: { challengeUpdates: false, expoPushTokens: ['ExponentPushToken[ut-fake]'] },
  });

  const off = await sendPush(PUSH_TEST_EMAIL, { title: 't', body: 'b', prefKey: 'challengeUpdates' });
  assert.strictEqual(off.sent, 0, 'opted-out recipient is skipped');

  await supabase.from('user_preferences').update({
    data: { challengeUpdates: true, expoPushTokens: ['ExponentPushToken[ut-fake]'] },
  }).eq('user_email', PUSH_TEST_EMAIL);
  const on = await sendPush(PUSH_TEST_EMAIL, { title: 't', body: 'b', prefKey: 'challengeUpdates' });
  assert.strictEqual(on.sent, 1, 'opted-in recipient receives the push attempt');

  await supabase.from('user_preferences').update({
    data: { challengeUpdates: false, expoPushTokens: ['ExponentPushToken[ut-fake]'] },
  }).eq('user_email', PUSH_TEST_EMAIL);
  const noKey = await sendPush(PUSH_TEST_EMAIL, { title: 't', body: 'b' });
  assert.strictEqual(noKey.sent, 1, 'no prefKey → preference is ignored (backward compatible)');
});
