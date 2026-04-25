/**
 * Teacher AI Panel — /ask/teacher endpoint tests
 * Covers: text questions, image (base64 vision), PDF text extraction,
 * input validation, class data injection, no student guardrails.
 */

// ── Mock Groq SDK before requiring the route ──────────────────────────────
const mockCreate = jest.fn();

jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));
});

const express = require('express');
const askRouter = require('../routes/ask');

// Minimal express app for testing
function makeApp() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/ask', askRouter);
  return app;
}

// Simple HTTP test helper (no supertest dependency)
const http = require('http');

function post(app, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        { hostname: '127.0.0.1', port, path, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
        (res) => {
          let raw = '';
          res.on('data', c => raw += c);
          res.on('end', () => {
            server.close();
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          });
        }
      );
      req.on('error', (e) => { server.close(); reject(e); });
      req.write(data);
      req.end();
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function mockGroqResponse(text) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: text } }],
  });
}

// Minimal 1×1 pixel PNG as base64
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('/ask/teacher — text questions', () => {
  beforeEach(() => mockCreate.mockReset());

  test('returns AI answer for a plain text question', async () => {
    mockGroqResponse('Saimohan leads with 35% progress. Jane and Sparkles need attention.');
    const app = makeApp();
    const res = await post(app, '/ask/teacher', {
      question: 'Who is doing best in class?',
      classSummary: 'Saimohan (Grade 3): 35% progress. Jane: 0% progress.',
    });
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('Saimohan');
  });

  test('calls llama-3.3-70b-versatile model for text questions', async () => {
    mockGroqResponse('All students listed.');
    const app = makeApp();
    await post(app, '/ask/teacher', { question: 'List all students', classSummary: '' });
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('llama-3.3-70b-versatile');
  });

  test('injects classSummary into the system prompt', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    await post(app, '/ask/teacher', {
      question: 'Who needs help?',
      classSummary: 'Alex (Grade 4): 10% progress, NEEDS ATTENTION.',
    });
    const systemMsg = mockCreate.mock.calls[0][0].messages[0].content;
    expect(systemMsg).toContain('Alex (Grade 4)');
    expect(systemMsg).toContain('NEEDS ATTENTION');
  });

  test('rejects request with no question, image, or PDF', async () => {
    const app = makeApp();
    const res = await post(app, '/ask/teacher', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('returns 500 with error message when Groq throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Groq rate limit'));
    const app = makeApp();
    const res = await post(app, '/ask/teacher', { question: 'test' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/AI error/i);
  });

  test('no student guardrails in system prompt', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    await post(app, '/ask/teacher', { question: 'anything', classSummary: '' });
    const systemMsg = mockCreate.mock.calls[0][0].messages[0].content;
    // Must NOT contain student-mode phrases
    expect(systemMsg).not.toMatch(/school ai coach/i);
    expect(systemMsg).not.toMatch(/you are a compassionate.*tutor/i);
    // Must contain teacher-mode phrases
    expect(systemMsg).toMatch(/teaching assistant|educator|teacher/i);
  });

  test('uses correct temperature for text (0.4)', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    await post(app, '/ask/teacher', { question: 'test', classSummary: '' });
    expect(mockCreate.mock.calls[0][0].temperature).toBe(0.4);
  });
});

// ── Image (vision) tests ──────────────────────────────────────────────────

describe('/ask/teacher — image attachment (Groq Vision)', () => {
  beforeEach(() => mockCreate.mockReset());

  test('returns image analysis when imageBase64 is provided', async () => {
    mockGroqResponse('The assignment shows 5 multiplication problems. Student got 4/5 correct.');
    const app = makeApp();
    const res = await post(app, '/ask/teacher', {
      question: 'Grade this assignment',
      imageBase64: TINY_PNG_BASE64,
      imageType: 'image/png',
      classSummary: '',
    });
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('assignment');
  });

  test('uses vision model (llama-4-scout) for image requests', async () => {
    mockGroqResponse('Image analysed.');
    const app = makeApp();
    await post(app, '/ask/teacher', {
      question: 'Analyse this',
      imageBase64: TINY_PNG_BASE64,
      imageType: 'image/jpeg',
      classSummary: '',
    });
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('meta-llama/llama-4-scout-17b-16e-instruct');
  });

  test('sends image as image_url content block', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    await post(app, '/ask/teacher', {
      question: 'check this',
      imageBase64: TINY_PNG_BASE64,
      imageType: 'image/png',
      classSummary: '',
    });
    const userContent = mockCreate.mock.calls[0][0].messages[1].content;
    expect(Array.isArray(userContent)).toBe(true);
    const imgBlock = userContent.find(b => b.type === 'image_url');
    expect(imgBlock).toBeDefined();
    expect(imgBlock.image_url.url).toContain('data:image/png;base64,');
    expect(imgBlock.image_url.url).toContain(TINY_PNG_BASE64);
  });

  test('uses default question when none provided with image', async () => {
    mockGroqResponse('Analysed.');
    const app = makeApp();
    await post(app, '/ask/teacher', {
      imageBase64: TINY_PNG_BASE64,
      imageType: 'image/jpeg',
      classSummary: '',
    });
    const userContent = mockCreate.mock.calls[0][0].messages[1].content;
    const textBlock = userContent.find(b => b.type === 'text');
    expect(textBlock.text).toMatch(/analys/i);
  });

  test('uses lower temperature for vision (0.3)', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    await post(app, '/ask/teacher', {
      question: 'grade this',
      imageBase64: TINY_PNG_BASE64,
      imageType: 'image/png',
      classSummary: '',
    });
    expect(mockCreate.mock.calls[0][0].temperature).toBe(0.3);
  });
});

// ── PDF text tests ────────────────────────────────────────────────────────

describe('/ask/teacher — PDF text input', () => {
  beforeEach(() => mockCreate.mockReset());

  test('returns analysis when pdfText is provided', async () => {
    mockGroqResponse('This pricing document shows 3 tiers: Basic, Pro, Enterprise.');
    const app = makeApp();
    const res = await post(app, '/ask/teacher', {
      question: 'Summarise this pricing document',
      pdfText: 'Aivorah Pricing\nBasic: $10/mo\nPro: $25/mo\nEnterprise: $99/mo',
      classSummary: '',
    });
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('pricing');
  });

  test('uses text model (not vision) for PDF input', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    await post(app, '/ask/teacher', {
      question: 'Explain this PDF',
      pdfText: 'Some PDF content here',
      classSummary: '',
    });
    expect(mockCreate.mock.calls[0][0].model).toBe('llama-3.3-70b-versatile');
  });

  test('appends PDF content to user message with [PDF CONTENT] label', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    const pdfText = 'Chapter 1: Introduction to Fractions';
    await post(app, '/ask/teacher', {
      question: 'Grade this',
      pdfText,
      classSummary: '',
    });
    const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
    expect(userMsg).toContain('[PDF CONTENT]');
    expect(userMsg).toContain('Chapter 1: Introduction to Fractions');
  });

  test('truncates very long PDF text to 6000 chars', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    const longPdf = 'x'.repeat(10000);
    await post(app, '/ask/teacher', {
      question: 'Analyse',
      pdfText: longPdf,
      classSummary: '',
    });
    const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
    // The PDF content slice should not exceed 6000 chars
    expect(userMsg.length).toBeLessThan(7000);
  });

  test('accepts pdfText alone (no question) and uses default prompt', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    const res = await post(app, '/ask/teacher', {
      pdfText: 'Worksheet content: 1+1=?',
      classSummary: '',
    });
    expect(res.status).toBe(200);
  });
});

// ── Class data injection ──────────────────────────────────────────────────

describe('/ask/teacher — class summary data', () => {
  beforeEach(() => mockCreate.mockReset());

  test('shows "No class data provided" when classSummary is empty', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    await post(app, '/ask/teacher', { question: 'hello' });
    const systemMsg = mockCreate.mock.calls[0][0].messages[0].content;
    expect(systemMsg).toContain('No class data provided');
  });

  test('includes multiple students in CLASS DATA section', async () => {
    mockGroqResponse('ok');
    const app = makeApp();
    const summary = [
      'Saimohan (Grade 3): 35% progress, 7 topics done',
      'jane (Grade 3): 0% progress, 0 topics done, NEEDS ATTENTION',
      'Aanya (Grade 4): 15% progress, 3 topics done',
    ].join('\n');
    await post(app, '/ask/teacher', { question: 'Who needs help?', classSummary: summary });
    const systemMsg = mockCreate.mock.calls[0][0].messages[0].content;
    expect(systemMsg).toContain('Saimohan');
    expect(systemMsg).toContain('jane');
    expect(systemMsg).toContain('Aanya');
  });
});
