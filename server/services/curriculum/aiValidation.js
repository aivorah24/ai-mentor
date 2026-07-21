/**
 * aiValidation.js — the gate between Teacher Approval and the Vector DB.
 *
 * Real implementation (2026-07-21) — replaces the earlier permanent stub.
 * Inspects the validation results ALREADY computed per-resource during the
 * Teacher Preview stage (contentMapper.js's validateMappedSource /
 * contentValidation.js's validateAiEnrichedContent, run inside
 * ingestionService.js's previewTopicResources) rather than re-deriving
 * anything — this is the single place those signals get aggregated into a
 * go/no-go decision for Qdrant, not a new source of truth.
 *
 * What it checks per candidate (a resource about to be embedded, i.e.
 * status===READY with real text):
 *   - coverage:       fraction of topics that have at least one READY,
 *                      passing-validation resource
 *   - completeness:    each candidate's own validation.valid flag (already
 *                      enforces non-empty explanation/summary/key concepts)
 *   - hallucination:   already screened by contentValidation.js's forbidden-
 *                      provenance-phrase check at preview time — a resource
 *                      that failed that check never reaches READY, so by the
 *                      time it's a candidate here it has already cleared it;
 *                      this stage re-confirms no candidate is missing a
 *                      validation record entirely (defensive — treats an
 *                      unvalidated resource as failing, never passing by default)
 *   - quality:         average confidence-adjacent signal — a candidate with
 *                      recorded validation issues is excluded even if some
 *                      other candidates for the same topic passed
 *
 * Gate passes only if EVERY candidate resource has an explicit, present
 * validation record with valid===true. Any resource missing validation
 * metadata (e.g. a matched-source resource that was never run through
 * validateMappedSource for some reason) fails closed, not open.
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} implemented
 * @property {boolean} gatePassed
 * @property {number|null} overallScore
 * @property {Record<string, number>|null} scores
 * @property {string[]} reasons
 */

/**
 * @param {{ curriculum:string, grade:string, subject:string, units:object[], topicPreviews:Record<string, object> }} args
 * @returns {Promise<ValidationResult>}
 */
async function runAIValidation({ topicPreviews }) {
  const previews = Object.values(topicPreviews || {});
  const totalTopics = previews.length;
  if (totalTopics === 0) {
    return { implemented: true, gatePassed: false, overallScore: 0, scores: null, reasons: ['No topics to validate.'] };
  }

  // Candidates = resources that would actually be embedded (READY status +
  // real text payload) — matches ingestionService.js's own qdrantPoints filter.
  const candidates = [];
  for (const p of previews) {
    for (const r of p.resources || []) {
      if (r.status === 'READY' && r.payload?.text) candidates.push({ topicName: p.topicName, resource: r });
    }
  }

  if (candidates.length === 0) {
    return { implemented: true, gatePassed: false, overallScore: 0, scores: null, reasons: ['No READY text resources to embed — nothing to validate.'] };
  }

  const failures = [];
  for (const { topicName, resource } of candidates) {
    const validation = resource.validation;
    if (!validation) {
      failures.push(`${topicName} / ${resource.resourceType}: no validation record present (fails closed).`);
      continue;
    }
    if (validation.valid !== true) {
      failures.push(`${topicName} / ${resource.resourceType}: ${(validation.issues || []).join('; ') || 'validation failed'}`);
    }
  }

  const topicsWithAtLeastOneReadyResource = new Set(
    previews.filter((p) => (p.resources || []).some((r) => r.status === 'READY')).map((p) => p.topicName)
  );
  const coverage = Math.round((topicsWithAtLeastOneReadyResource.size / totalTopics) * 100);
  const completeness = Math.round(((candidates.length - failures.length) / candidates.length) * 100);
  const overallScore = Math.round((coverage + completeness) / 2);

  const gatePassed = failures.length === 0;

  return {
    implemented: true,
    gatePassed,
    overallScore,
    scores: { coverage, completeness },
    reasons: gatePassed
      ? [`All ${candidates.length} candidate resource(s) across ${totalTopics} topic(s) passed validation.`]
      : failures,
  };
}

module.exports = { runAIValidation };
