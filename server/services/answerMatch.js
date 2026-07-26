/**
 * Shared numeric/fraction-aware answer comparison — used by the Math Learning
 * Engine's generation-time correctness gate (pipelines/math/generate.js) and
 * its runtime answer-checking endpoint (routes/mathEngine.js), so both use
 * the exact same notion of "equivalent answer" instead of two copies drifting
 * apart. v1 scope: numeric/fraction string matching only — no symbolic
 * algebra equivalence (e.g. won't recognize "2x" == "x*2").
 */
function normalizeAnswer(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^(the answer is|answer:|=)/, '');
}

function toFraction(str) {
  const s = String(str).trim();
  // Explicit "n/d" form.
  const slash = s.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (slash) return parseInt(slash[1], 10) / parseInt(slash[2], 10);
  // This codebase's OCR'd answers often render a stacked fraction as a bare
  // numerator then denominator on their own line, with no "/" at all (e.g.
  // "3\n4" meaning 3/4) — normalizeAnswer's whitespace-stripping would
  // otherwise concatenate this into the wrong literal number "34". Two bare
  // integers with nothing else present is unambiguous enough to treat as a
  // fraction rather than risk misreading it as a plain number.
  const stacked = s.match(/^(-?\d+)\s*\n\s*(\d+)$/);
  if (stacked) return parseInt(stacked[1], 10) / parseInt(stacked[2], 10);
  return null;
}

// Handles mixed numbers like "3 3/4" or "3\n4" (the latter is how this app's
// OCR'd officialAnswer strings sometimes render a mixed number across lines).
function toMixedNumber(str) {
  const m = String(str).trim().match(/^(-?\d+)[\s\n]+(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const whole = parseInt(m[1], 10);
  const sign = whole < 0 ? -1 : 1;
  return whole + sign * (parseInt(m[2], 10) / parseInt(m[3], 10));
}

function toNumber(str) {
  const n = toFraction(str) ?? toMixedNumber(str);
  if (n !== null) return n;
  const asNum = Number(normalizeAnswer(str));
  return isNaN(asNum) ? null : asNum;
}

function answersMatch(a, b) {
  const na = normalizeAnswer(a);
  const nb = normalizeAnswer(b);
  if (na === nb) return true;

  const numA = toNumber(a);
  const numB = toNumber(b);
  if (numA !== null && numB !== null) return Math.abs(numA - numB) < 1e-6;

  return false;
}

module.exports = { normalizeAnswer, toFraction, toMixedNumber, toNumber, answersMatch };
