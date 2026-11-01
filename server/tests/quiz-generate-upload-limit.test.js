// Regression test for a real bug found during manual QA (2026-09-11):
// POST /quiz/generate used the shared 10MB multer instance, but the handler
// itself rejected any file > 4MB AFTER it was fully buffered (and, for
// .docx, after a mammoth+puppeteer conversion attempt) — see routes/quiz.js
// "Guard: reject PDFs > 4MB to prevent OOM on Cloud Run". A 4-10MB worksheet
// looked accepted by the upload, then failed late with a confusing delay.
// Fixed with a dedicated 4MB multer instance (handleQuizGenerateUpload) so
// oversized files are rejected immediately, before any processing.
//
// Only exercises the upload-layer rejection — does not mock the AI
// generation chain, so the "file within limits" case is checked against a
// lightweight stand-in route, not the real (heavy, external-API-dependent)
// generateQuizHandler.

jest.mock('../services/qdrant', () => ({ initCollection: jest.fn(), getCollectionInfo: jest.fn() }));
jest.mock('../services/supabase', () => ({ from: jest.fn() }));

const express = require('express');
const http = require('http');
const FormData = require('form-data');
const quizRouter = require('../routes/quiz');

function buildApp() {
  // Real generateQuizHandler needs live AI/DB services — replace the final
  // handler with a stub that just confirms the request reached it, so this
  // test only exercises the upload-layer (multer) rejection under test.
  const generateLayer = quizRouter.stack.find(
    (l) => l.route && l.route.path === '/generate' && l.route.methods.post
  );
  generateLayer.route.stack[generateLayer.route.stack.length - 1].handle = (req, res) => {
    res.status(200).json({ ok: true, receivedBytes: req.file ? req.file.buffer.length : 0 });
  };

  const app = express();
  app.use('/quiz', quizRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message, stack: err.stack });
  });
  return app;
}

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe('POST /quiz/generate — upload size limit', () => {
  let server, baseUrl;
  beforeEach(async () => {
    ({ server, baseUrl } = await startServer(buildApp()));
  });
  afterEach(() => new Promise((resolve) => server.close(resolve)));

  test('a file just over 4MB is rejected immediately with a clear error, not buffered', async () => {
    const form = new FormData();
    form.append('pdf', Buffer.alloc(4 * 1024 * 1024 + 1024, 1), { filename: 'worksheet.pdf', contentType: 'application/pdf' });
    // form.getBuffer() (not the FormData instance itself) — passing a
    // `form-data` stream directly as fetch's body doesn't reliably signal
    // end-of-stream to undici in this Node version ("Unexpected end of form").
    const buf = form.getBuffer();
    const res = await fetch(`${baseUrl}/quiz/generate`, {
      method: 'POST',
      body: buf,
      headers: { ...form.getHeaders(), 'Content-Length': String(buf.length) },
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/File too large \(max 4MB\)/);
  });

  test('a file within the 4MB limit reaches the handler', async () => {
    const form = new FormData();
    form.append('pdf', Buffer.alloc(1024 * 1024, 1), { filename: 'worksheet.pdf', contentType: 'application/pdf' });
    // form.getBuffer() (not the FormData instance itself) — passing a
    // `form-data` stream directly as fetch's body doesn't reliably signal
    // end-of-stream to undici in this Node version ("Unexpected end of form").
    const buf = form.getBuffer();
    const res = await fetch(`${baseUrl}/quiz/generate`, {
      method: 'POST',
      body: buf,
      headers: { ...form.getHeaders(), 'Content-Length': String(buf.length) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receivedBytes).toBe(1024 * 1024);
  });
});
