// ── Job handlers ────────────────────────────────────────────────────────────
// Register one async handler per job type: (payload, job) => result.
// Required in index.js at startup so POST /jobs/process (db mode) and worker.js
// (kafka mode) both have the handlers available.
//
// Golden rule: the heavy file lives in storage (Cloudinary/GCS); the payload
// carries its URL + metadata, never raw bytes.

const { registerHandler } = require('./jobQueue');

// Demo handler — proves the queue end-to-end (enqueue → drain → status). Safe to remove.
registerHandler('demo', async (payload) => {
  return { echoed: payload, processedAt: new Date().toISOString() };
});

// ── Templates for the real heavy jobs — wire these incrementally ──────────────
//
// registerHandler('content_ingest', async (payload) => {
//   // payload: { fileUrl, grade, subject, ... }
//   // 1. download fileUrl from Cloudinary/GCS
//   // 2. parse (pdf-parse) → chunk → embed → upsert to Qdrant
//   // 3. return a small summary, e.g. { chunks: 232 }
// });
//
// registerHandler('worksheet_quiz', async (payload) => {
//   // payload: { fileUrl, grade, subject, ... }
//   // OCR + layout + LLM → store quiz → return { quizId }
// });

module.exports = {};
