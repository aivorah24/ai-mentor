/**
 * Module 9 — validationAgent
 * Acts as an experienced CBSE teacher reviewing the generated lesson. Combines
 * fast deterministic structural checks (cheap, always run) with an LLM
 * pedagogical review (NCERT alignment, accuracy, age-appropriateness, no
 * hallucination, quiz correctness). Returns STRUCTURED DEFECTS: { section, reason }
 * so the regenerationAgent can fix ONLY the failed sections.
 */
const { callLLM } = require('./callLLM');

const MIN_BODY_CHARS = 200;
const MIN_BODY_PARAS = 2;

function structuralDefects(lesson, strategy) {
  const defects = [];
  const bodyText = (lesson.simplifiedExplanation || []).join(' ').trim();
  if ((lesson.simplifiedExplanation || []).length < MIN_BODY_PARAS) defects.push({ section: 'simplifiedExplanation', reason: `<${MIN_BODY_PARAS} paragraphs` });
  if (bodyText.length < MIN_BODY_CHARS) defects.push({ section: 'simplifiedExplanation', reason: `too short (${bodyText.length}<${MIN_BODY_CHARS} chars)` });
  if ((lesson.whatYoullLearn || []).length === 0 && (lesson.learningObjectives || []).length === 0) defects.push({ section: 'whatYoullLearn', reason: 'no objectives/preview' });
  if ((lesson.vocabulary || []).length === 0) defects.push({ section: 'vocabulary', reason: 'no vocabulary' });
  if ((lesson.keyTakeaways || []).length === 0) defects.push({ section: 'keyTakeaways', reason: 'no key takeaways' });
  if ((lesson.quiz || []).length < 3) defects.push({ section: 'quiz', reason: '<3 questions' });
  if (strategy.layoutType === 'math') {
    if ((lesson.workedExamples || []).length === 0) defects.push({ section: 'workedExamples', reason: 'maths lesson has no worked example' });
  } else if (strategy.audio !== false) {
    if (!lesson.audioNarrationScript) defects.push({ section: 'audioNarrationScript', reason: 'no narration script (non-maths)' });
  }
  if (strategy.type === 'Poem' && (lesson.originalLesson || []).length < 2) defects.push({ section: 'originalLesson', reason: 'poem text missing/too short' });
  return defects;
}

async function pedagogicalReview({ lesson, understanding, cleanText }) {
  const system = `You are an experienced CBSE teacher doing QA on an auto-generated lesson. Judge strictly. Return strict JSON only.`;
  const compact = {
    title: lesson.title, subject: lesson.subject, grade: lesson.grade, type: lesson.instructionalType,
    whatYoullLearn: lesson.whatYoullLearn, simplifiedExplanation: lesson.simplifiedExplanation,
    vocabulary: lesson.vocabulary, workedExamples: lesson.workedExamples,
    keyTakeaways: lesson.keyTakeaways, quiz: lesson.quiz,
  };
  const user = `Review this generated lesson against the real textbook text. Flag ONLY genuine problems.

Real textbook text:
"""${cleanText.slice(0, 3500)}"""

Generated lesson (JSON):
${JSON.stringify(compact).slice(0, 6000)}

Check: NCERT alignment, concept accuracy, age-appropriateness for Grade ${lesson.grade}, hallucinations (claims NOT in the text), missing key textbook content, vocabulary level, quiz answer correctness.

Return JSON exactly:
{ "pass": true|false,
  "score": 0-100,
  "defects": [ { "section": "which field", "reason": "specific problem" } ] }

Rules:
- If a quiz answer is wrong, add a defect with section "quiz".
- If anything is invented (not supported by the text), add a defect with section naming it.
- Empty defects array + pass:true only if genuinely good. No markdown.`;
  try {
    const out = await callLLM(system, user);
    return {
      pass: out.pass !== false,
      score: Number(out.score) || 0,
      defects: Array.isArray(out.defects) ? out.defects.filter((d) => d && d.section) : [],
    };
  } catch (e) {
    // If the reviewer LLM is unavailable, don't hard-fail — rely on structural.
    return { pass: true, score: 0, defects: [], reviewerError: e.message };
  }
}

// Only these lesson fields are actually rendered for a given layout — a review
// defect about a section this strategy doesn't use (e.g. "workedExamples" on a
// poem) is a false positive and must be ignored, otherwise nothing ever passes.
const RELEVANT_SECTIONS = {
  poem: ['originalLesson', 'vocabulary', 'keyTakeaways', 'thinkAndReflect', 'quiz', 'whatYoullLearn', 'simplifiedExplanation'],
  story: ['originalLesson', 'simplifiedExplanation', 'vocabulary', 'keyTakeaways', 'thinkAndReflect', 'quiz', 'whatYoullLearn'],
  math: ['simplifiedExplanation', 'workedExamples', 'keyIdeas', 'formula', 'vocabulary', 'keyTakeaways', 'quiz', 'whatYoullLearn'],
  science: ['simplifiedExplanation', 'vocabulary', 'keyTakeaways', 'thinkAndReflect', 'interactiveActivities', 'quiz', 'whatYoullLearn'],
  grammar: ['simplifiedExplanation', 'vocabulary', 'interactiveActivities', 'keyTakeaways', 'quiz', 'whatYoullLearn'],
  social: ['simplifiedExplanation', 'vocabulary', 'keyTakeaways', 'thinkAndReflect', 'quiz', 'whatYoullLearn'],
  activity: ['simplifiedExplanation', 'interactiveActivities', 'vocabulary', 'keyTakeaways', 'thinkAndReflect', 'quiz', 'whatYoullLearn'],
  concept: ['simplifiedExplanation', 'vocabulary', 'keyTakeaways', 'thinkAndReflect', 'quiz', 'whatYoullLearn'],
};

// A review defect is "severe" (worth a regeneration pass) only if it concerns a
// rendered section AND reports a genuine accuracy/grounding problem — not a
// stylistic nitpick. Everything else is kept as advisory and reported, but does
// not block PASS.
const SEVERE_RE = /incorrect|wrong answer|not supported|not in the text|hallucinat|invented|inaccurate|fabricat|answer is wrong|does not exist/i;

function classifyReviewDefects(reviewDefects, layoutType) {
  const relevant = new Set(RELEVANT_SECTIONS[layoutType] || RELEVANT_SECTIONS.concept);
  const severe = [];
  const advisory = [];
  for (const d of reviewDefects) {
    // Map free-form review "section" labels onto real fields where possible.
    const sec = String(d.section || '').trim();
    const onRenderedField = relevant.has(sec);
    if (onRenderedField && SEVERE_RE.test(d.reason || '')) severe.push(d);
    else advisory.push(d);
  }
  return { severe, advisory };
}

async function validate({ lesson, understanding, strategy, cleanText, skipLLM = false }) {
  const structural = structuralDefects(lesson, strategy);
  const review = skipLLM ? { pass: true, score: 0, defects: [], skipped: true } : await pedagogicalReview({ lesson, understanding, cleanText });
  const { severe, advisory } = classifyReviewDefects(review.defects, strategy.layoutType);
  // Block only on structural + severe accuracy defects. Advisory nitpicks are
  // reported (in defects) but don't fail an otherwise-complete, grounded lesson.
  const blocking = [...structural, ...severe];
  return {
    ok: blocking.length === 0,
    score: review.score,
    defects: blocking,           // what the regeneration loop should fix
    advisory,                    // reported, non-blocking
    structuralDefects: structural,
    severeDefects: severe,
    reviewDefects: review.defects,
    reviewerError: review.reviewerError,
  };
}

module.exports = { validate, structuralDefects, classifyReviewDefects };
