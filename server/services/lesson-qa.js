/**
 * lesson-qa.js — THE single source of truth for "is this lesson good enough?".
 *
 * Every gate uses this module: the generator's pre-publish check, the standalone
 * auditor (scripts/qa-validate.cjs), and the unit-by-unit pipeline. They used to
 * carry separate copies of the rules, which drifted — the generator published
 * lessons its own auditor then failed. One implementation, no drift.
 *
 * Checks: structure, placeholder text, arithmetic, quiz integrity, grade fit,
 * maths presentation, and illustration assets.
 */
const fs = require('fs');
const path = require('path');

const PLACEHOLDER = /^(welcome to the lesson|summary of|practice .* using a variety|watch the video|this lesson (is about|covers))/i;

// ── Arithmetic ───────────────────────────────────────────────────────────────
// Deliberately conservative: a FALSE "wrong answer" is worse than a miss, since
// it sends a correct lesson back through regeneration. Bails out on fractions,
// division, decimals and multi-operator chains, and honours negative signs.
// Quiz options, normalised to an array. Models are asked for a JSON array but
// sometimes emit a lettered OBJECT instead ({"A":"...","B":"..."}) — and plain
// `q.options || []` passes that straight through, so the next `.map()` throws
// "(q.options || []).map is not a function" and the whole lesson is lost to an
// error. Converting salvages those questions; anything else yields [] so the
// normal "<2 options" validation reports it instead of crashing.
function optionList(q) {
  const o = q && q.options;
  if (Array.isArray(o)) return o;
  if (o && typeof o === 'object') return Object.values(o);
  return [];
}

function computeAns(problem) {
  const s = String(problem || '').replace(/(\d),(?=\d{3}\b)/g, '$1'); // 50,000 → 50000
  if (/\d\.\d/.test(s)) return null;
  // This checker only understands ONE bare "a op b". Anything that changes an
  // operand's value before or after that step makes its arithmetic wrong, and a
  // wrong checker FAILS CORRECT LESSONS — the costliest kind of bug here, since
  // the content is fine and gets thrown away. So bail on every notation it
  // cannot evaluate exactly, rather than guessing:
  //   (6+3)^2  → it matched the 6+3 inside the brackets and demanded 9, not 81
  //   3 + 4 squared → demanded 7, not 19 (word-form powers read as plain text)
  //   20% of 50 + 10 → demanded 60, not 20
  //   log 100 + 2, 5 choose 2, 4! + 1 → operands it cannot compute
  // Binomial/index chapters use all of these, which is why they were failing.
  if (/\^|\*\*|[²³⁴⁵√!%]/.test(s)) return null;                        // symbols
  if (/\b(squared|cubed|power|raised|root|factorial|choose|log|ln|sin|cos|tan|percent)\b/i.test(s)) return null;
  if (/\bn\s*[CP]\s*r\b/i.test(s)) return null;                        // nCr / nPr
  const re = /(-?\d+)\s*([+\-×x*÷/])\s*\(\s*(-?\d+)\s*\)|(-?\d+)\s*([+\-×x*÷/])\s*(-?\d+)/;
  const m = s.match(re);
  if (!m) return null;
  const aS = m[1] ?? m[4], op = m[2] ?? m[5], bS = m[3] ?? m[6];
  if (op === '÷' || op === '/') return null;   // "1/2" is a fraction, not division
  const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
  if (/\d\s*[+\-×x*÷/]\s*$/.test(before)) return null;          // mid-chain
  if (/^\s*[+\-×x*÷/]\s*\(?\s*-?\d/.test(after)) return null;   // chain continues
  const a = +aS, b = +bS;
  return op === '+' ? a + b : op === '-' ? a - b : a * b;
}

// Only trust an answer we can read as a bare number. Prose ("Convert 7 + 5 into
// a subtraction problem…") and expressions ("10 + (-3)") are not values.
function numericAnswer(v) {
  const s = String(v == null ? '' : v).replace(/(\d),(?=\d{3}\b)/g, '$1').trim();
  if ((s.match(/[a-zA-Z]/g) || []).length > 6) return NaN;
  if (/\d\s*[+\-×x*÷/=]\s*\(?\s*-?\d/.test(s)) return NaN;
  const m = s.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

// ── Grade fit ────────────────────────────────────────────────────────────────
function gradeFit(L, grade) {
  const g = parseInt(grade, 10) || 6;
  const text = [(L.intro || ''), ...(Array.isArray(L.body) ? L.body : [L.body || ''])].join(' ');
  if (text.length < 40) return [];
  // Calibrated for Latin-script English; Hindi/Urdu/Sanskrit use different
  // delimiters and word metrics, so skip rather than emit false flags.
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  const nonLatin = (text.match(/[ऀ-ॿ؀-ۿ]/g) || []).length;
  if (nonLatin > latin) return [];
  const sentences = text.split(/[.!?।]+/).filter(s => s.trim().length > 3);
  const words = text.split(/\s+/).filter(Boolean);
  const avgSentLen = sentences.length ? words.length / sentences.length : 0;
  const longWords = words.filter(w => w.replace(/[^a-zA-Z]/g, '').length >= 12).length;
  const maxSent = g <= 2 ? 24 : g <= 5 ? 30 : g <= 8 ? 36 : 45;
  const f = [];
  if (avgSentLen > maxSent) f.push(`grade-fit: sentences too long for G${g} (~${Math.round(avgSentLen)} w)`);
  if (g <= 3 && longWords > words.length * 0.06) f.push(`grade-fit: too many complex words for G${g}`);
  return f;
}

// ── Maths presentation ───────────────────────────────────────────────────────
// A computational maths lesson needs worked examples or the AI Tutor's visual
// board renders empty. Constructions/data-handling/definitions teach a procedure
// or an idea rather than a sum, so they are exempt.
const CONCEPTUAL_MATHS = /data handling|data |pattern|shape|geometr|symmetry|graph|chart|table|money|time|calendar|measure|angle|construct|draw|fold|tangram|polygon|definition|classif|organiz|survey|collect|scale|present/i;
function mathStyling(L, subject, topic) {
  if (!/math/i.test(subject || '')) return [];
  if (CONCEPTUAL_MATHS.test(topic || '')) return [];
  if (!Array.isArray(L.workedExamples) || L.workedExamples.length === 0) {
    return ['maths: no worked examples (empty visual tutor)'];
  }
  return [];
}

// ── Illustration assets ──────────────────────────────────────────────────────
// A lesson that renders "Illustration coming soon" is not complete. Maths
// lessons carrying workedExamples are exempt: that pane shows the solved-example
// board by design.
function assetCheck(L, subject, opts = {}) {
  const isMath = /math/i.test(subject || '');
  const hasBoard = Array.isArray(L.workedExamples) && L.workedExamples.length > 0;
  if (isMath && hasBoard) return [];
  const prompts = Array.isArray(L.illustrationPrompts) ? L.illustrationPrompts : [];
  const refs = prompts.map(p => p && (p.image || p.image_ref || p.url)).filter(Boolean);
  if (L.figureUrl) refs.push(L.figureUrl);
  if (refs.length === 0) return ['no illustration asset (renders "Illustration coming soon")'];
  const broken = refs.filter(r => {
    if (/^https?:/i.test(r)) return false;                // remote: trusted
    const f = path.join(opts.serverRoot || path.join(__dirname, '..'), String(r).replace(/^\//, ''));
    try { return fs.statSync(f).size === 0; } catch { return true; }
  });
  return broken.length ? [`broken image ref: ${broken[0]}`] : [];
}

/**
 * Validate one lesson.
 * @param {object}  L         the AI_EXPLANATION payload
 * @param {array}   quiz      the PRACTICE quiz (falls back to L.quiz/L.practiceQuiz)
 * @param {object}  opts      { grade, subject, topic, requireAsset }
 *   requireAsset=false is used at GENERATION time (art is attached after
 *   publishing); the shipping gate always runs with it on.
 * @returns {string[]} human-readable failures, empty === pass
 */
function validateLesson(L, quiz, opts = {}) {
  const { grade, subject, topic, requireAsset = true } = opts;
  const fails = [];
  if (!L) return ['no AI_EXPLANATION payload'];
  const bodyArr = Array.isArray(L.body) ? L.body : (typeof L.body === 'string' ? [L.body] : []);
  const kl = Array.isArray(L.keyLearnings) ? L.keyLearnings : [];

  fails.push(...gradeFit(L, grade));
  fails.push(...mathStyling(L, subject, topic));
  if (requireAsset) fails.push(...assetCheck(L, subject, opts));

  // A lesson TITLE must be a topic, not a caption. Ingestion sometimes turned an
  // image's Vision caption into a topic row.
  const t = String(topic || '').trim();
  if (/^(this|the)\s+(image|picture|photo|figure|comic strip|diagram)\b/i.test(t) || t.length > 80) {
    fails.push('junk topic title (image caption used as lesson name)');
  }

  // Structure
  if (!L.intro || String(L.intro).length < 15) fails.push('intro missing/too short');
  if (kl.length < 2) fails.push('<2 keyLearnings');
  // Depth floor, scaled by grade. This was a flat 60 CHARACTERS, which any
  // lesson clears — a Grade 12 History body reading "The Renaissance was a
  // cultural movement." plus three more generic sentences passed as complete.
  // Half of all G11/G12 humanities bodies were under 90 words on that rule.
  // A senior lesson has to actually teach the chapter, so the floor rises with
  // the grade. Poems/stories carry the text verbatim in `originalLesson` and
  // are legitimately short, so they keep the old minimal check.
  {
    const g = Number(grade) || 0;
    const verbatim = Array.isArray(L.originalLesson) && L.originalLesson.length > 0;
    // For a poem or story the text itself IS the lesson content, so count it —
    // otherwise a correctly-formed reading lesson fails for having a short
    // commentary alongside the full poem.
    const counted = verbatim ? bodyArr.concat(L.originalLesson) : bodyArr;
    const words = counted.join(' ').split(/\s+/).filter(Boolean).length;
    // The floor is a STUB DETECTOR, not a quality target. The defect it exists
    // to catch is the 29-43 word lesson ("The Renaissance was a cultural
    // movement." ×4). 90 words is where thin content measurably starts in this
    // corpus — the survey that found 177 of 357 senior humanities lessons
    // lacking used exactly that line.
    //
    // Set it any higher and the cliff rejects good work: at 150 lessons failed
    // at 149 words, at 110 they failed at 109. Re-rolling a sound 109-word
    // lesson wastes model capacity and changes nothing a student would notice.
    // Depth beyond this floor is driven by the generator prompt (which asks for
    // 150-180 words), not enforced here.
    const floor = verbatim ? 30 : g >= 9 ? 90 : g >= 6 ? 70 : g >= 3 ? 50 : 30;
    if (words < floor) fails.push(`body too thin (${words} words, needs ${floor} for grade ${g || '?'})`);
  }
  if (PLACEHOLDER.test(String(L.intro || '').trim())) fails.push('placeholder intro');
  bodyArr.forEach(b => { if (PLACEHOLDER.test(String(b).trim())) fails.push('placeholder body'); });

  // Worked examples: arithmetic + teachable steps
  if (Array.isArray(L.workedExamples)) {
    for (const ex of L.workedExamples) {
      const want = computeAns(ex.problem);
      const got = numericAnswer(ex.answer);
      const isDiv = /÷|\//.test(String(ex.problem || ''));
      if (want != null && !isNaN(got) && want !== got && !isDiv) {
        fails.push(`bad math: ${ex.problem} → ${ex.answer} (should be ${want})`);
      }
    }
  }
  const isMath = Array.isArray(L.workedExamples) && L.workedExamples.length > 0;
  if (isMath) {
    if (L.workedExamples.some(e => !Array.isArray(e.steps) || e.steps.length < 2)) fails.push('AI-Tutor: example missing steps');
  } else if (bodyArr.length < 2) {
    fails.push('AI-Tutor: too few teaching steps');
  }

  // Listen/audio needs something narratable
  const listen = Array.isArray(L.listenParts) ? L.listenParts : [];
  if (!(listen.length > 0 || bodyArr.join(' ').length > 60 || isMath)) fails.push('Listen: no narratable content');

  // Quiz — accepts new {type:'mcq', correct} and legacy {type:'MCQ', correctIndex}
  const qz = quiz || L.quiz || L.practiceQuiz || [];
  if (!Array.isArray(qz) || qz.length < 2) fails.push('<2 quiz questions');
  (Array.isArray(qz) ? qz : []).forEach((q, i) => {
    const type = String(q.type || '').toLowerCase();
    const isFree = type === 'fill_blank' || type === 'shortanswer' || type === 'short_answer';
    if (isFree) { if (q.correct == null && q.answer == null) fails.push(`q${i + 1} no answer`); return; }
    if (type === 'truefalse' || type === 'true_false') {
      if (q.answer == null && q.correct == null && q.correctIndex == null) fails.push(`q${i + 1} T/F no answer`);
      return;
    }
    const opts2 = optionList(q).map(o => String(o || '').trim());
    const idx = typeof q.correct === 'number' ? q.correct : (typeof q.correctIndex === 'number' ? q.correctIndex : null);
    if (opts2.length < 2) fails.push(`q${i + 1} <2 options`);
    if (opts2.some(o => !o)) fails.push(`q${i + 1} empty option`);
    if (new Set(opts2).size !== opts2.length) fails.push(`q${i + 1} duplicate options`);
    if (idx == null || idx < 0 || idx >= opts2.length) fails.push(`q${i + 1} bad correct index`);
    else {
      const want = computeAns(q.question);
      if (want != null && opts2[idx] != null) {
        const got = numericAnswer(opts2[idx]);
        if (!isNaN(got) && got !== want) fails.push(`q${i + 1} wrong answer (should be ${want})`);
      }
    }
  });
  return fails;
}

module.exports = { validateLesson, computeAns, numericAnswer, gradeFit, mathStyling, assetCheck, optionList, PLACEHOLDER };
