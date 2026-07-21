// Mode B — Smart AI Syllabus Import: teacher uploads PDF/DOCX/XLSX, AI drafts
// the unit→topic structure, teacher reviews/edits, then publishes. Publishing
// diffs against whatever is currently live for that grade/subject/curriculum
// so a re-upload next year shows Added/Removed/Renamed instead of a blind wipe.
const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const supabase = require('../services/supabase');
const { runExtraction, getExtractionJob } = require('../services/syllabusExtraction');
const { publishJob, getJob } = require('../services/jobQueue');
require('../services/jobHandlers'); // registers 'syllabus_extract' handler at load time

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Uploaded files are kept just long enough for the teacher's own review
// (Preview Changes → "View in Book"), so they can see the real page
// side-by-side, exactly like the student LessonScreen — auto-cleared after
// an hour so this never becomes a permanent copy of someone's textbook.
const fs = require('fs');
const path = require('path');
const PREVIEW_DIR = path.join(__dirname, '../data/syllabus_preview_uploads');
try { fs.mkdirSync(PREVIEW_DIR, { recursive: true }); } catch (_) {}
function cleanupOldPreviews() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  try {
    for (const f of fs.readdirSync(PREVIEW_DIR)) {
      const p = path.join(PREVIEW_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch (_) {}
}

// Compares a draft units[] against whatever is currently live for a scope,
// without writing anything — used both for the pre-publish preview and to
// compute the final diff at publish time.
async function computeDiff({ grade, subject, curriculum, schoolId, units }) {
  const scopeMatch = { grade, subject, curriculum, ...(schoolId ? { school_id: schoolId } : {}) };
  const { data: oldChapters } = await supabase.from('syllabus_chapters').select('id, title').match(scopeMatch);
  const oldChapterIds = (oldChapters || []).map(c => c.id);
  const { data: oldTopics } = oldChapterIds.length
    ? await supabase.from('syllabus_topics').select('name').in('chapter_id', oldChapterIds)
    : { data: [] };
  const oldTopicNames = new Set((oldTopics || []).map(t => t.name));
  const oldTitles = new Set((oldChapters || []).map(c => c.title));

  const newTopicNames = new Set();
  for (const u of units) for (const t of (u.topics || [])) newTopicNames.add(t.name);
  const newTitles = new Set(units.map(u => u.title));

  return {
    addedTopics:   [...newTopicNames].filter(n => !oldTopicNames.has(n)),
    removedTopics: [...oldTopicNames].filter(n => !newTopicNames.has(n)),
    addedUnits:    [...newTitles].filter(t => !oldTitles.has(t)),
    removedUnits:  [...oldTitles].filter(t => !newTitles.has(t)),
    unitCountBefore: oldChapters?.length || 0,
    topicCountBefore: oldTopicNames.size,
  };
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
    return wb.SheetNames.map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
  }
  throw new Error('Unsupported file type — upload a PDF, DOCX, or XLSX.');
}

// ── POST /teacher/syllabus/extract-batch ──────────────────────────────────
// Multi-PDF upload — e.g. a book split across several files ("Unit 1-5.pdf",
// "Unit 6-10.pdf"). Each file is queued as its own `syllabus_extract` job on
// the existing Kafka-backed job queue (services/jobQueue.js — QUEUE_DRIVER is
// already 'kafka' in this environment) rather than processed inline, so N
// large files never block one HTTP request or serialize behind each other.
// Body (multipart): docs[] (multiple files) + grade, subject, curriculum.
router.post('/extract-batch', upload.array('docs', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded.' });
    const { grade, subject, curriculum = 'CBSE' } = req.body || {};
    if (!grade || !subject) return res.status(400).json({ error: 'grade and subject are required.' });

    const jobs = await Promise.all(req.files.map((file) =>
      publishJob('syllabus_extract', {
        fileBase64: file.buffer.toString('base64'),
        filename: file.originalname,
        grade, subject, curriculum,
      })
    ));

    res.json({ ok: true, jobIds: jobs.map((j) => j.jobId), fileCount: req.files.length });
  } catch (err) {
    console.error('[syllabus/extract-batch] error:', err.message);
    res.status(500).json({ error: 'Could not queue files for extraction.' });
  }
});

// ── GET /teacher/syllabus/extract-batch/status ────────────────────────────
// Poll multiple job ids at once; once ALL are done, merges their canonical
// units into one combined syllabus (unit numbers renumbered sequentially in
// upload order) — same shape /extract returns, so the frontend's Preview
// Generator needs no special-casing for "came from a batch."
router.get('/extract-batch/status', async (req, res) => {
  try {
    const ids = String(req.query.jobIds || '').split(',').filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'jobIds query param required.' });

    const jobs = await Promise.all(ids.map((id) => getJob(id)));
    const notFound = jobs.some((j) => !j);
    if (notFound) return res.status(404).json({ error: 'One or more job ids not found.' });

    const pending = jobs.filter((j) => j.status === 'pending' || j.status === 'processing');
    const failed = jobs.filter((j) => j.status === 'failed');
    if (pending.length > 0) {
      return res.json({ ok: true, done: false, pending: pending.length, total: jobs.length });
    }
    if (failed.length === jobs.length) {
      return res.status(422).json({ error: 'All files failed to extract.', failures: failed.map((j) => j.error) });
    }

    // Merge — in original upload order, renumbering units 1..N across files
    // and gating on the SAME 95% confidence threshold as the single-file path,
    // per-file, so one bad file doesn't silently corrupt the combined result.
    const succeeded = jobs.filter((j) => j.status === 'done');
    let unitCounter = 0;
    const mergedUnits = [];
    const perFile = [];
    let combinedWarnings = [];
    let minConfidence = 100;

    for (const job of succeeded) {
      const canonical = job.result?.canonical;
      perFile.push({ filename: job.result?.filename, overallConfidence: canonical?.overallConfidence ?? 0, jobId: job.result?.extractionJobId });
      if (!canonical || canonical.overallConfidence < 95) {
        combinedWarnings.push(`"${job.result?.filename}" scored ${canonical?.overallConfidence ?? 0}/100 and was excluded from the merge.`);
        continue;
      }
      minConfidence = Math.min(minConfidence, canonical.overallConfidence);
      combinedWarnings = combinedWarnings.concat((canonical.warnings || []).map((w) => `[${job.result.filename}] ${w}`));
      for (const unit of canonical.units || []) {
        unitCounter += 1;
        mergedUnits.push({ ...unit, unitNo: unitCounter });
      }
    }

    if (mergedUnits.length === 0) {
      return res.status(422).json({ error: 'No file in this batch met the confidence threshold — nothing to merge.', perFile });
    }

    res.json({
      ok: true, done: true,
      canonical: { units: mergedUnits, overallConfidence: minConfidence, warnings: combinedWarnings, extractedAt: new Date().toISOString() },
      perFile,
    });
  } catch (err) {
    console.error('[syllabus/extract-batch/status] error:', err.message);
    res.status(500).json({ error: 'Could not check batch status.' });
  }
});

// ── POST /teacher/syllabus/extract ────────────────────────────────────────
// Stage 1 of the ingestion pipeline: produces the canonical, confidence-scored
// extraction (see services/syllabusExtraction.js) and stores it — nothing is
// written to the live syllabus tables here. Idempotent: re-uploading the same
// file+grade+subject+curriculum returns the cached canonical result instead
// of re-running the model.
router.post('/extract', upload.single('doc'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const { grade, subject, curriculum = 'CBSE', schoolId } = req.body || {};

    const { jobId, canonical, cached } = await runExtraction(
      req.file.buffer,
      (buf) => extractRawText({ ...req.file, buffer: buf }),
      { grade, subject, curriculum },
    );

    if (canonical.overallConfidence < 95) {
      // Stage gate: an unreliable extraction must not silently flow downstream
      // into diffing/preview/publish — surface it and stop here.
      return res.status(422).json({
        error: `Extraction confidence too low (${canonical.overallConfidence}/100) to proceed safely. Review the warnings and try a clearer file, or use the Excel template instead.`,
        jobId, overallConfidence: canonical.overallConfidence, warnings: canonical.warnings,
      });
    }

    const diff = await computeDiff({ grade, subject, curriculum, schoolId, units: canonical.units || [] });

    // Save the upload briefly so the teacher can preview the REAL book page
    // (View in Book tab) side-by-side with the Learn content, same dual-pane
    // layout students see — auto-purged after an hour, never published/stored.
    cleanupOldPreviews();
    const isPdf = /\.pdf$/i.test(req.file.originalname || '');
    let previewFile = null;
    if (isPdf) {
      previewFile = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
      fs.writeFileSync(path.join(PREVIEW_DIR, previewFile), req.file.buffer);
    }

    // "draft" keeps the existing frontend contract (book as a string, topics
    // with name/kind/page/summary/practice) — the full canonical object with
    // confidences/images/activities/vocabulary/objectives rides alongside it
    // so the Preview Generator can migrate to reading it exclusively.
    res.json({
      ok: true,
      jobId,
      cached,
      draft: { book: canonical.book?.title || '', units: canonical.units || [] },
      canonical,
      overallConfidence: canonical.overallConfidence,
      warnings: canonical.warnings,
      diff,
      previewFile,
    });
  } catch (err) {
    console.error('[syllabus/extract] error:', err.message);
    if (err.status === 429) {
      return res.status(429).json({ error: 'Aivorah is briefly rate-limited processing another upload — please wait about 20 seconds and try again.' });
    }
    res.status(500).json({ error: 'Could not extract syllabus from this file. Try a clearer PDF, or use the Excel template instead.' });
  }
});

// ── GET /teacher/syllabus/extraction/:jobId ───────────────────────────────
// Independently rerunnable inspection: re-fetch a past canonical extraction
// without re-uploading the file (e.g. to resume a pipeline after a downstream
// stage failed).
router.get('/extraction/:jobId', async (req, res) => {
  const job = await getExtractionJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Extraction job not found.' });
  res.json({ ok: true, jobId: job.id, status: job.status, overallConfidence: job.overall_confidence, canonical: job.canonical });
});

// ── GET /teacher/syllabus/current ─────────────────────────────────────────
router.get('/current', async (req, res) => {
  const { grade, subject, curriculum = 'CBSE', schoolId } = req.query;
  const { data: chapters } = await supabase
    .from('syllabus_chapters').select('id, unit_no, title')
    .match({ grade, subject, curriculum, ...(schoolId ? { school_id: schoolId } : {}) })
    .order('unit_no');
  const chapterIds = (chapters || []).map(c => c.id);
  // Include `id` (topic_resources joins on this) so the student app can
  // fetch resolved Read/Listen/Practice content for a specific topic without
  // a second round-trip to figure out which row it means.
  const { data: topics } = chapterIds.length
    ? await supabase.from('syllabus_topics').select('id, chapter_id, topic_order, name, kind, page').in('chapter_id', chapterIds).order('topic_order')
    : { data: [] };
  const byChapter = {};
  for (const t of topics || []) (byChapter[t.chapter_id] ||= []).push(t);
  res.json({
    units: (chapters || []).map(c => ({ unitNo: c.unit_no, title: c.title, topics: (byChapter[c.id] || []).map(t => ({ id: t.id, name: t.name, kind: t.kind, page: t.page })) })),
  });
});

// ── GET /teacher/syllabus/topic/:topicId/resources ────────────────────────
// Resolves all 8 resource types for one DB-backed topic — reuses the same
// resourceResolver.js the CurriculumProvider layer already uses, so this is
// exactly what a student would see, not a separate parallel read path.
router.get('/topic/:topicId/resources', async (req, res) => {
  try {
    const { resolveAllResources } = require('../services/curriculum/resourceResolver');
    const resources = await resolveAllResources({ topicId: req.params.topicId });
    res.json({ ok: true, topicId: req.params.topicId, resources });
  } catch (err) {
    console.error('[syllabus/topic/resources] error:', err.message);
    res.status(500).json({ error: 'Could not resolve topic resources.' });
  }
});

// ── POST /teacher/syllabus/publish ────────────────────────────────────────
// Body: { grade, subject, curriculum, schoolId?, units:[{unitNo,title,topics:[{name,kind,page,intro?,body?,activity?}]}] }
// Replaces the live syllabus for this grade+subject+curriculum(+school) and
// returns a diff summary (added / removed / renamed) vs. what was live before.
router.post('/publish', async (req, res) => {
  try {
    const { grade, subject, curriculum = 'CBSE', schoolId, units } = req.body || {};
    if (!grade || !subject || !Array.isArray(units)) return res.status(400).json({ error: 'grade, subject, and units[] are required.' });

    // Same primitive the admin ICSE/Cambridge ingestion pipeline uses — no
    // separate duplicate insert logic here anymore.
    const { diff, topicIdsByName } = await publishUnits({ grade, subject, curriculum, schoolId, units });

    // Close the teacher→student loop: write topic_resources rows straight
    // from whatever the canonical extraction actually produced for each
    // topic, so the student app (which reads via resourceResolver.js /
    // GET /teacher/syllabus/topic/:id/resources) sees real content, not a
    // permanent "Coming Soon". Nothing fabricated — a resource is READY only
    // if the canonical topic actually carries it.
    const resourceRows = [];
    for (const u of units) {
      for (const t of (u.topics || [])) {
        const topicId = topicIdsByName[t.name];
        if (!topicId) continue;
        resourceRows.push(
          { topic_id: topicId, resource_type: 'AI_EXPLANATION', status: t.summary ? 'READY' : 'COMING_SOON', source_tier: t.summary ? 'ORIGINAL_AI' : null, source: t.summary ? 'Aivorah-drafted explanation' : null, static_payload: t.summary ? { text: t.summary } : null },
          { topic_id: topicId, resource_type: 'IMAGES', status: (t.images?.length) ? 'READY' : 'COMING_SOON', source_tier: (t.images?.length) ? 'OFFICIAL_BOOK' : null, source: (t.images?.length) ? 'Extracted from uploaded textbook' : null, static_payload: (t.images?.length) ? { items: t.images } : null },
          { topic_id: topicId, resource_type: 'PRACTICE', status: t.practice ? 'READY' : 'COMING_SOON', source_tier: t.practice ? 'ORIGINAL_AI' : null, source: t.practice ? 'Aivorah-drafted question' : null, static_payload: t.practice || null },
          { topic_id: topicId, resource_type: 'BOOK_REFERENCE', status: t.page ? 'READY' : 'NOT_AVAILABLE', source_tier: t.page ? 'OFFICIAL_BOOK' : null, source: t.page ? 'Uploaded textbook' : null, static_payload: t.page ? { pageRef: Number(t.page) || undefined } : null },
          { topic_id: topicId, resource_type: 'FLASHCARDS', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
          { topic_id: topicId, resource_type: 'WORKSHEETS', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
          { topic_id: topicId, resource_type: 'OER_MAPPING', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
          { topic_id: topicId, resource_type: 'AUDIO', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
        );
      }
    }
    if (resourceRows.length) {
      const { error: rErr } = await supabase.from('topic_resources').insert(resourceRows);
      if (rErr) console.error('[syllabus/publish] topic_resources insert failed (structure was still published):', rErr.message);
    }

    res.json({ ok: true, diff, unitsPublished: units.length, resourcesWritten: resourceRows.length });
  } catch (err) {
    console.error('[syllabus/publish] error:', err.message);
    res.status(500).json({ error: 'Failed to publish syllabus.' });
  }
});

// Serves the temporarily-saved uploaded PDF for the teacher's own preview
// (View in Book tab) — never linked anywhere public, purged hourly.
router.use('/preview-upload', express.static(PREVIEW_DIR));

module.exports = router;
