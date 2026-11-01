// Regression test for a real bug found during manual-bug-list Bug work
// (2026-09-11): POST /parent/:parentEmail/children ("Link Existing" on the
// parent My Kids screen) looked up childEmail with a plain
// .eq('email', ...).single() and NO role filter — any registered account
// (a teacher's, another parent's) could be linked as if it were a child.
// Fixed in routes/parent.js by requiring role === 'student'.
//
// Mounts only the parent router (not the full app/index.js, which boots
// Qdrant/Groq/etc.) against a minimal Express instance, with supabase mocked.

jest.mock('../services/supabase', () => ({
  from: jest.fn(),
}));
jest.mock('../services/mailer', () => ({
  sendCredentialsEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));
jest.mock('../routes/student', () => ({
  fetchTotalTopicsFromQdrant: jest.fn().mockResolvedValue(0),
}));
jest.mock('groq-sdk', () => jest.fn().mockImplementation(() => ({})));

const express = require('express');
const http = require('http');
const supabase = require('../services/supabase');

// No supertest in this repo (and installing a new dependency into the
// monolith is out of scope for a one-file bug fix) — spin up a real
// listener and hit it with fetch instead.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/parent', require('../routes/parent'));
  return app;
}

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('POST /parent/:parentEmail/children — Link Existing role check', () => {
  let app, server, baseUrl;
  beforeEach(async () => {
    jest.clearAllMocks();
    app = buildApp();
    ({ server, baseUrl } = await startServer(app));
  });
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  async function postChildren(childEmail) {
    const res = await fetch(`${baseUrl}/parent/parent@a.com/children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childEmail }),
    });
    return { status: res.status, body: await res.json() };
  }

  function mockUsersLookup(row) {
    supabase.from.mockImplementation((table) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }) };
      }
      if (table === 'parent_children') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table in test: ${table}`);
    });
  }

  test('a real STUDENT email links successfully', async () => {
    mockUsersLookup({ id: 's1', name: 'Kid', email: 'kid@a.com', grade: 'Grade 3', school: 'X', role: 'student' });
    const res = await postChildren('kid@a.com');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('a real TEACHER email is rejected as "not found", not linked as a child', async () => {
    mockUsersLookup({ id: 't1', name: 'Teacher', email: 'teacher@a.com', grade: null, school: 'X', role: 'teacher' });
    const res = await postChildren('teacher@a.com');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no student found/i);
  });

  test('a real PARENT email is rejected as "not found", not linked as a child', async () => {
    mockUsersLookup({ id: 'p2', name: 'Other Parent', email: 'other-parent@a.com', grade: null, school: 'X', role: 'parent' });
    const res = await postChildren('other-parent@a.com');
    expect(res.status).toBe(404);
  });

  test('a genuinely unregistered email is rejected as "not found"', async () => {
    mockUsersLookup(null);
    const res = await postChildren('nobody@a.com');
    expect(res.status).toBe(404);
  });
});
