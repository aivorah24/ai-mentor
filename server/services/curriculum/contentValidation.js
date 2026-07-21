/**
 * Validation stage — sanity-checks AI-enriched (or mapped) content before it
 * reaches Teacher Preview. Catches empty/malformed generations and enforces
 * the "never claim official textbook provenance" rule on AI-generated text,
 * rather than trusting the model's output blindly.
 */
const FORBIDDEN_PROVENANCE_PATTERNS = [
  /according to (the|your) (official )?textbook/i,
  /as (stated|written) in the (official )?(textbook|book)/i,
  /this (chapter|page) (of|from) the textbook/i,
];

/**
 * @param {{ explanation:string, keyConcepts:string[], vocabulary:object[], activities:object[], summary:string, reflectionQuestion:string, contentOrigin:string }} content
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateAiEnrichedContent(content) {
  const issues = [];

  if (!content || typeof content !== 'object') {
    return { valid: false, issues: ['Content is missing or malformed.'] };
  }
  if (!content.explanation || content.explanation.trim().length < 40) {
    issues.push('Explanation is missing or too short.');
  }
  if (!Array.isArray(content.keyConcepts) || content.keyConcepts.length === 0) {
    issues.push('No key concepts generated.');
  }
  if (!content.summary || content.summary.trim().length < 10) {
    issues.push('Summary is missing or too short.');
  }
  if (content.contentOrigin === 'ai_generated') {
    const fullText = [content.explanation, content.summary, ...(content.vocabulary || []).map((v) => v.meaning || '')].join(' ');
    for (const pattern of FORBIDDEN_PROVENANCE_PATTERNS) {
      if (pattern.test(fullText)) {
        issues.push('AI-generated content incorrectly claims official textbook provenance — must be regenerated.');
        break;
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Validates a mapped (licensed/OER) source has the minimum metadata required
 * before it's trusted as READY — an unlicensed OER entry must never be
 * treated as approved content.
 * @param {{sourceType:string, license:string|null, url:string|null}} source
 */
function validateMappedSource(source) {
  const issues = [];
  if (source.sourceType === 'OER' && !source.license) {
    issues.push('OER source is missing a license — cannot mark READY without attribution.');
  }
  if (!source.url && !source.id) {
    issues.push('Mapped source has no URL or reference id.');
  }
  return { valid: issues.length === 0, issues };
}

module.exports = { validateAiEnrichedContent, validateMappedSource };
