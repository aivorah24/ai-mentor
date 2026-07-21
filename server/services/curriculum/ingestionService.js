/**
 * Generic Curriculum Ingestion Service — ICSE/Cambridge (and any future
 * curriculum), NOT CBSE. CBSE keeps its existing dedicated pipelines
 * (routes/syllabusImport.js for teachers, the legacy Qdrant path for bulk
 * NCERT content) completely untouched.
 *
 * Pipeline (matches the stages the founder specified):
 *   Official Syllabus -> Content Mapping -> Canonical JSON -> AI Enrichment
 *   -> Validation -> Teacher Preview -> Approval -> Supabase -> Qdrant
 *     -> Student Learning Experience (served via the existing
 *        CurriculumProvider interface — icseProvider.js / cambridgeProvider.js
 *        already read from syllabus_chapters/syllabus_topics/topic_resources,
 *        so nothing there needs to change once this writes real rows).
 *
 * Principle: never assume a textbook exists. For every topic, try a matched
 * source (licensed textbook / OER) first; if none is registered, generate
 * AI content from the syllabus text alone; every resource is tagged with
 * its true source and status — nothing is fabricated as "official."
 */
const { runCanonicalExtraction } = require('./canonicalExtraction'); // dedicated extraction path — see canonicalExtraction.js header for why this isn't services/syllabusExtraction.js
const { computeDiff, publishUnits } = require('./syllabusPublisher');
const { findMatchedSource, listPendingSources, registerSource, markSourceIngested } = require('./contentMapper');
const { generateTopicContent } = require('./aiEnrichment');
const { validateAiEnrichedContent, validateMappedSource } = require('./contentValidation');
const { runAIValidation } = require('./aiValidation');
const supabase = require('../supabase');
const { client: qdrantClient, resolveCollection } = require('../qdrant');
const { embed } = require('../embeddings');

const CONFIDENCE_GATE = 95; // same threshold routes/syllabusImport.js already uses for CBSE

/**
 * Stage 1-2: extract a real document into canonical JSON (reusing the
 * existing extraction pipeline verbatim) and register it as a known source.
 * Does not write to syllabus_chapters/syllabus_topics/topic_resources yet.
 * Works for either an official syllabus/framework (the usual case — builds
 * curriculum hierarchy) or an actual licensed textbook file (sourceType
 * LICENSED_TEXTBOOK — a *real uploaded book*, not just a publisher name from
 * a prescribed-textbook list; a name alone belongs in /register-source, not
 * here, since there's no file to extract text from).
 *
 * @param {Buffer} fileBuffer
 * @param {(buf:Buffer)=>Promise<string>} extractRawText - same signature routes/syllabusImport.js already uses
 * @param {{ grade:string, subject:string, curriculum:string, registeredBy?:string, sourceType?: 'OFFICIAL_SYLLABUS'|'LICENSED_TEXTBOOK'|'OER', forceProceed?: boolean }} params
 *   forceProceed: explicit, informed override of the confidence gate — used
 *   when an admin has already reviewed the extraction's warnings and decided
 *   a partial/lower-confidence document (e.g. a public curriculum "outline"
 *   whose full framework is access-gated elsewhere) is still worth ingesting
 *   as-is. Defaults to false so the gate stays strict for every normal call;
 *   this must be an explicit per-request choice, never a lowered default.
 */
async function extractOfficialSyllabus(fileBuffer, extractRawText, { grade, subject, curriculum, registeredBy, sourceType = 'OFFICIAL_SYLLABUS', forceProceed = false }) {
  const { jobId, canonical, cached } = await runCanonicalExtraction(fileBuffer, extractRawText, { grade, subject, curriculum });

  if (canonical.overallConfidence < CONFIDENCE_GATE && !forceProceed) {
    return {
      ok: false,
      reason: `Extraction confidence too low (${canonical.overallConfidence}/${CONFIDENCE_GATE}) to proceed safely. Pass forceProceed:true if you've reviewed the warnings and want to ingest this partial extraction anyway.`,
      jobId, overallConfidence: canonical.overallConfidence, warnings: canonical.warnings,
    };
  }
  const forcedBelowGate = canonical.overallConfidence < CONFIDENCE_GATE && forceProceed;

  const sourceId = await registerSource({
    curriculum, grade, subject, sourceType,
    title: canonical.book?.title || `${curriculum} ${grade} ${subject} ${sourceType === 'OFFICIAL_SYLLABUS' ? 'syllabus' : 'textbook'}`,
    fileHash: canonical.fileHash, registeredBy,
  });

  return { ok: true, jobId, sourceId, canonical, cached, forcedBelowGate };
}

/**
 * Stage 3-6: for ONE topic, try a matched learning source; if none, generate
 * AI content; validate; return a Teacher Preview record — the exact
 * resource/source/status shape the founder specified, per topic. Writes
 * nothing to the database.
 *
 * @param {{ curriculum:string, grade:string, subject:string, topicName:string, learningObjectives?: string[] }} args
 * @returns {Promise<{ topicName: string, matchedSource: object|null, resources: Array<{resourceType:string, source:string, status:string, sourceTier:string|null, payload:object|null, validation?:object}> }>}
 */
async function previewTopicResources({ curriculum, grade, subject, topicName, learningObjectives = [] }) {
  const matched = await findMatchedSource({ curriculum, grade, subject });
  // Known publishers/resources registered for this scope but not yet
  // ingested (e.g. an ICSE Prescribed Textbooks appendix entry, or a
  // Cambridge endorsed-resource list entry) — surfaced as context for
  // whoever reviews this preview, never used to mark anything READY.
  const pendingSources = matched ? [] : await listPendingSources({ curriculum, grade, subject });

  if (matched) {
    const validation = validateMappedSource(matched);
    const status = validation.valid ? 'READY' : 'UNDER_REVIEW';
    const sourceTier = matched.sourceType === 'LICENSED_TEXTBOOK' ? 'LICENSED_CONTENT' : 'MAPPED_OER';
    const source = matched.title + (matched.license ? ` (${matched.license})` : '');

    // A matched source covers Book Reference + Explanation directly; other
    // resource types (Vocabulary/Activities/Illustrations) still need their
    // own resolution below since a syllabus/textbook match doesn't
    // automatically imply flashcards or images exist for it.
    return {
      topicName,
      matchedSource: matched,
      pendingSources: [],
      resources: [
        { resourceType: 'BOOK_REFERENCE', source, status, sourceTier, payload: { attribution: matched.license || null }, validation },
        { resourceType: 'AI_EXPLANATION', source, status, sourceTier, payload: null, validation },
        { resourceType: 'OER_MAPPING', source, status, sourceTier, payload: { attribution: matched.license || null }, validation },
        { resourceType: 'IMAGES', source: null, status: 'COMING_SOON', sourceTier: 'PLACEHOLDER', payload: null },
        { resourceType: 'PRACTICE', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
        { resourceType: 'FLASHCARDS', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
        { resourceType: 'WORKSHEETS', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
        { resourceType: 'AUDIO', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
      ],
    };
  }

  // No matched source registered — generate AI content from the syllabus
  // topic alone. Never claims official-textbook provenance (enforced by
  // aiEnrichment.js's prompt AND validateAiEnrichedContent's forbidden-phrase check).
  let content;
  let validation;
  try {
    content = await generateTopicContent({ curriculum, grade, subject, topicName, learningObjectives });
    validation = validateAiEnrichedContent(content);
  } catch (err) {
    // Generation failed (rate limit, API down, etc.) — report honestly as
    // UNDER_REVIEW rather than silently fabricating placeholder text.
    return {
      topicName,
      matchedSource: null,
      pendingSources,
      resources: [
        { resourceType: 'AI_EXPLANATION', source: null, status: 'UNDER_REVIEW', sourceTier: null, payload: null, validation: { valid: false, issues: [err.message] } },
        { resourceType: 'BOOK_REFERENCE', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
        { resourceType: 'IMAGES', source: null, status: 'COMING_SOON', sourceTier: 'PLACEHOLDER', payload: null },
        { resourceType: 'PRACTICE', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
        { resourceType: 'FLASHCARDS', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
        { resourceType: 'WORKSHEETS', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
        { resourceType: 'OER_MAPPING', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
        { resourceType: 'AUDIO', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
      ],
    };
  }

  const aiStatus = validation.valid ? 'READY' : 'UNDER_REVIEW';
  // Vocabulary/key concepts/summary/reflection question ride inside the
  // AI_EXPLANATION resource's payload rather than as separate resourceType
  // enum values — the resource_type enum (types.js / topic_resources
  // migration) is a fixed set already shipped for CBSE; splitting these out
  // further would mean a schema change beyond this pass's additive scope.
  return {
    topicName,
    matchedSource: null,
    pendingSources,
    resources: [
      {
        resourceType: 'AI_EXPLANATION', source: 'AI Generated', status: aiStatus, sourceTier: 'ORIGINAL_AI',
        payload: {
          text: content.explanation, keyConcepts: content.keyConcepts, vocabulary: content.vocabulary,
          summary: content.summary, reflectionQuestion: content.reflectionQuestion, attribution: 'AI Generated — Aivorah',
        },
        validation,
      },
      {
        resourceType: 'PRACTICE', source: 'AI Generated', status: content.activities.length ? aiStatus : 'NOT_AVAILABLE',
        sourceTier: content.activities.length ? 'ORIGINAL_AI' : null,
        payload: content.activities.length ? { items: content.activities, attribution: 'AI Generated — Aivorah' } : null,
      },
      { resourceType: 'BOOK_REFERENCE', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
      // AI illustration generation is a future extension point, not built
      // this pass — honestly COMING_SOON rather than fabricated.
      { resourceType: 'IMAGES', source: null, status: 'COMING_SOON', sourceTier: 'PLACEHOLDER', payload: null },
      { resourceType: 'FLASHCARDS', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
      { resourceType: 'WORKSHEETS', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
      { resourceType: 'OER_MAPPING', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
      { resourceType: 'AUDIO', source: null, status: 'NOT_AVAILABLE', sourceTier: null, payload: null },
    ],
  };
}

/**
 * Stage 7-9 (Approval -> Supabase -> Qdrant): publishes canonical units into
 * syllabus_chapters/syllabus_topics (via syllabusPublisher, same primitive
 * the CBSE teacher flow uses but invoked here independently — CBSE's route
 * never calls this), writes one topic_resources row per previewed resource,
 * and upserts Qdrant points for READY text-bearing resources so search()
 * becomes real for this curriculum.
 *
 * @param {{ grade:string, subject:string, curriculum:string, units: object[], topicPreviews: Record<string, ReturnType<typeof previewTopicResources>>, sourceId?: string }} args
 */
async function approveAndPublish({ grade, subject, curriculum, units, topicPreviews, sourceId }) {
  // Stage 7: Persist metadata to Supabase — always allowed on approve, per
  // the agreed pipeline (structure + topic_resources are not the Vector DB).
  const { diff, topicIdsByName } = await publishUnits({ grade, subject, curriculum, units });

  const qdrantPoints = [];
  for (const [topicName, preview] of Object.entries(topicPreviews)) {
    const topicId = topicIdsByName[topicName];
    if (!topicId) continue; // topic wasn't in the published units — skip rather than write orphaned resources

    for (const r of preview.resources) {
      const { error } = await supabase.from('topic_resources').upsert({
        topic_id: topicId,
        resource_type: r.resourceType,
        status: r.status,
        source_tier: r.sourceTier,
        source: r.source,
        static_payload: r.payload,
        attribution: r.payload?.attribution || null,
      }, { onConflict: 'topic_id,resource_type' });
      if (error) throw new Error(`topic_resources upsert failed for ${topicName}/${r.resourceType}: ${error.message}`);

      if (r.status === 'READY' && r.payload?.text) {
        qdrantPoints.push({ topicName, topicId, resourceType: r.resourceType, sourceTier: r.sourceTier, source: r.source, text: r.payload.text });
      }
    }
  }

  // Stage 8 gate: AI Validation Engine must pass BEFORE embeddings are ever
  // generated or written to Qdrant. Until aiValidation.js has a real
  // implementation, this always holds the gate closed — approve() persists
  // structure/resources to Supabase (above) but never publishes to the
  // Vector DB. Swapping in the real validator later requires no change here.
  const validation = await runAIValidation({ curriculum, grade, subject, units, topicPreviews });
  const qdrantResult = validation.gatePassed
    ? await upsertResourcesToQdrant({ curriculum, grade, subject, points: qdrantPoints })
    : { upserted: 0, held: true, reasons: validation.reasons };

  if (sourceId) await markSourceIngested(sourceId);

  return {
    diff, topicsPublished: Object.keys(topicIdsByName).length,
    resourcesWritten: qdrantPoints.length, qdrant: qdrantResult, validation,
  };
}

/**
 * Embeds and upserts READY text resources into the same Qdrant collection
 * CBSE's ai_mentor_content path already uses, tagged with the new
 * status/resourceType/sourceTier fields so provider.search() can find them
 * and so legacy CBSE points (which lack these fields) are unambiguously
 * distinguishable from newly-ingested ones.
 */
async function upsertResourcesToQdrant({ curriculum, grade, subject, points }) {
  if (points.length === 0) return { upserted: 0 };
  const { collection, qdrantCurriculum, qdrantGrade } = resolveCollection(curriculum, grade);

  const qdrantPayloadPoints = [];
  for (const p of points) {
    const vector = await embed(p.text.slice(0, 2000));
    qdrantPayloadPoints.push({
      id: require('crypto').randomUUID(),
      vector,
      payload: {
        curriculum: qdrantCurriculum,
        grade: qdrantGrade,
        subject,
        topic: p.topicName,
        resourceType: p.resourceType,
        status: 'READY',
        sourceTier: p.sourceTier,
        source: p.source,
        text: p.text,
        content_type: 'text',
        seeder: 'curriculum-ingestion-service',
        type: 'curriculum',
      },
    });
  }
  await qdrantClient.upsert(collection, { points: qdrantPayloadPoints, wait: true });
  return { upserted: qdrantPayloadPoints.length };
}

module.exports = { extractOfficialSyllabus, previewTopicResources, approveAndPublish, computeDiff };
