/**
 * Generic Curriculum Ingestion API — ICSE/Cambridge (and future curricula).
 * Platform-admin only (requireAdminScope + scopeType==='global'). CBSE is
 * NOT reachable through this router — routes/syllabusImport.js (teacher,
 * school-scoped, CBSE) is untouched and remains its own separate flow.
 *
 * Four stages, matching the pipeline: register -> extract -> preview -> approve.
 *
 * PRIMARY SOURCES — where the real documents for these curricula come from
 * (reference for whoever performs registration/extraction; these are named
 * categories, not URLs this codebase fetches automatically — no source is
 * ever scraped or guessed):
 *   ICSE (CISCE):
 *     - Official syllabus/regulations: the CISCE Publications Library
 *       (Curriculum Pre-School–Class VIII, Regulations & Syllabuses,
 *       subject-wise syllabus PDFs) — register as sourceType OFFICIAL_SYLLABUS.
 *     - Prescribed textbook list: CISCE's published Prescribed Textbooks
 *       appendix — these are REFERENCES to which books schools use, not the
 *       textbooks themselves. Register as sourceType LICENSED_TEXTBOOK by
 *       title/publisher (status stays REGISTERED, not INGESTED, until the
 *       actual licensed book text is uploaded and extracted through /extract).
 *   Cambridge:
 *     - Official framework: Cambridge Lower Secondary Curriculum Framework +
 *       Resource List — register as sourceType OFFICIAL_SYLLABUS.
 *     - Endorsed resources: Cambridge's list of endorsed publishers (e.g.
 *       Cambridge University Press, Collins, Hodder Education, Oxford
 *       University Press) — register as sourceType LICENSED_TEXTBOOK by
 *       publisher/title, same REGISTERED-until-actually-extracted rule.
 *
 * The official syllabus/framework alone is enough to build the curriculum
 * hierarchy (subjects -> units -> topics -> learning objectives) via
 * /extract. It does NOT contain full textbook content (paragraphs,
 * explanations, exercises, images) — that requires an actually-licensed
 * textbook file run through /extract with sourceType LICENSED_TEXTBOOK.
 * Until that happens, contentMapper.js will not treat a merely-registered
 * textbook reference as a usable match (see contentMapper.js's
 * findMatchedSource — INGESTED only) — the pipeline falls through to AI
 * enrichment instead, exactly as intended.
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAdminScope } = require('../services/adminScope');
const { extractOfficialSyllabus, previewTopicResources, approveAndPublish } = require('../services/curriculum/ingestionService');
const { registerSource } = require('../services/curriculum/contentMapper');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function requireGlobalAdmin(req, res, next) {
  if (req.adminScope?.scopeType !== 'global') {
    return res.status(403).json({ error: 'Curriculum ingestion is a platform-admin action.' });
  }
  next();
}

async function extractRawText(file) {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    const pdfParse = require('pdf-parse');
    return (await pdfParse(file.buffer)).text;
  }
  if (name.endsWith('.docx')) {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = require('xlsx');
    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
  }
  throw new Error('Unsupported file type — upload a PDF, DOCX, or XLSX.');
}

// ── POST /curriculum/ingest/register-source ─────────────────────────────────
// Registers a KNOWN source by reference — no file, no extraction. This is
// how a prescribed-textbook-appendix entry (e.g. "ICSE Class 6 Science —
// Selina Publishers") or a Cambridge endorsed-resource-list entry (e.g.
// "Cambridge University Press — Lower Secondary Science") gets recorded as
// "we know this book/resource is the right one for this scope," WITHOUT
// pretending its content has been ingested. contentMapper.js's
// findMatchedSource only treats a source as a usable match once its status
// is INGESTED (set automatically once someone actually runs /extract on the
// real file and it gets approved) — a bare registration here stays
// REGISTERED and never causes a resource to be marked READY.
// Body: { curriculum, grade, subject?, sourceType, title, url?, license?, fileHash? }
router.post('/register-source', requireAdminScope, requireGlobalAdmin, async (req, res) => {
  try {
    const { curriculum, grade, subject, sourceType, title, url, license, fileHash } = req.body || {};
    if (!curriculum || !grade || !sourceType || !title) {
      return res.status(400).json({ error: 'curriculum, grade, sourceType, and title are required.' });
    }
    if (!['OFFICIAL_SYLLABUS', 'LICENSED_TEXTBOOK', 'OER', 'AI_GENERATED'].includes(sourceType)) {
      return res.status(400).json({ error: 'sourceType must be one of OFFICIAL_SYLLABUS, LICENSED_TEXTBOOK, OER, AI_GENERATED.' });
    }
    if (sourceType === 'OER' && !license) {
      return res.status(400).json({ error: 'OER sources require a license (e.g. "CC BY 4.0") for attribution.' });
    }

    const sourceId = await registerSource({ curriculum, grade, subject, sourceType, title, url, license, fileHash, registeredBy: req.adminEmail });
    res.json({ ok: true, sourceId, status: 'REGISTERED' });
  } catch (err) {
    console.error('[curriculum-ingest/register-source] error:', err.message);
    res.status(500).json({ error: 'Failed to register source.' });
  }
});

// ── POST /curriculum/ingest/extract ─────────────────────────────────────────
// Stage 1-2: extract a REAL uploaded document (official syllabus/framework,
// or an actual licensed textbook file) into canonical JSON and register it
// as a known source. Body (multipart): doc file + grade, subject, curriculum
// (must NOT be CBSE/NCERT — that's routes/syllabusImport.js's job), optional
// sourceType ('OFFICIAL_SYLLABUS' default, or 'LICENSED_TEXTBOOK'/'OER' when
// the uploaded file is itself a licensed book/approved resource rather than
// the syllabus).
// multer must run BEFORE requireAdminScope: adminEmail arrives as a
// multipart form field, which only req.body has once multer has parsed it —
// requireAdminScope reads req.body.adminEmail, so it must come after upload.single().
router.post('/extract', upload.single('doc'), requireAdminScope, requireGlobalAdmin, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const { grade, subject, curriculum, sourceType, forceProceed } = req.body || {};
    if (!grade || !subject || !curriculum) return res.status(400).json({ error: 'grade, subject, and curriculum are required.' });
    if (/^(cbse|ncert)$/i.test(curriculum)) {
      return res.status(400).json({ error: 'CBSE ingestion goes through the existing teacher syllabus-import flow, not this endpoint.' });
    }

    const result = await extractOfficialSyllabus(
      req.file.buffer,
      (buf) => extractRawText({ ...req.file, buffer: buf }),
      { grade, subject, curriculum, registeredBy: req.adminEmail, sourceType: sourceType || 'OFFICIAL_SYLLABUS', forceProceed: forceProceed === 'true' || forceProceed === true }
    );
    if (!result.ok) return res.status(422).json(result);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[curriculum-ingest/extract] error:', err.message);
    res.status(500).json({ error: 'Could not extract syllabus from this file.' });
  }
});

// ── POST /curriculum/ingest/preview ─────────────────────────────────────────
// Stage 3-6 (Content Mapping -> AI Enrichment -> Validation -> Teacher
// Preview): given the canonical units from /extract, resolves every
// resource for every topic — matched source if one is registered, else
// AI-generated — and returns them for review WITHOUT writing anything.
// Body: { grade, subject, curriculum, units: canonical.units }
router.post('/preview', requireAdminScope, requireGlobalAdmin, async (req, res) => {
  try {
    const { grade, subject, curriculum, units } = req.body || {};
    if (!grade || !subject || !curriculum || !Array.isArray(units)) {
      return res.status(400).json({ error: 'grade, subject, curriculum, and units[] are required.' });
    }

    const topicPreviews = {};
    for (const unit of units) {
      for (const topic of unit.topics || []) {
        const learningObjectives = (topic.learningObjectives || []).map((o) => (typeof o === 'string' ? o : o.text)).filter(Boolean);
        topicPreviews[topic.name] = await previewTopicResources({
          curriculum, grade, subject, topicName: topic.name, learningObjectives,
        });
      }
    }

    res.json({ ok: true, grade, subject, curriculum, topicPreviews });
  } catch (err) {
    console.error('[curriculum-ingest/preview] error:', err.message);
    res.status(500).json({ error: 'Failed to build content preview.' });
  }
});

// ── POST /curriculum/ingest/approve ──────────────────────────────────────────
// Stage 7-9 (Approval -> Supabase -> Qdrant): publishes the (possibly
// teacher/admin-edited) units + topicPreviews. Body: { grade, subject,
// curriculum, units, topicPreviews, sourceId? }
router.post('/approve', requireAdminScope, requireGlobalAdmin, async (req, res) => {
  try {
    const { grade, subject, curriculum, units, topicPreviews, sourceId } = req.body || {};
    if (!grade || !subject || !curriculum || !Array.isArray(units) || !topicPreviews) {
      return res.status(400).json({ error: 'grade, subject, curriculum, units[], and topicPreviews are required.' });
    }

    const result = await approveAndPublish({ grade, subject, curriculum, units, topicPreviews, sourceId });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[curriculum-ingest/approve] error:', err.message);
    res.status(500).json({ error: 'Failed to publish curriculum content.' });
  }
});

module.exports = router;
