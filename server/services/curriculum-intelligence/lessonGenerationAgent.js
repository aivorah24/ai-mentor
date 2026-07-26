/**
 * Module 4 — lessonGenerationAgent
 * Generates the structured lesson JSON (production-ready, never markdown) AFTER
 * the understanding + strategy steps. The prompt is driven by the chosen
 * strategy so a poem is generated poem-style, maths maths-style, etc. Grounds
 * everything ONLY in the retrieved textbook text.
 *
 * Output schema (superset — sections not relevant to the strategy come back
 * empty and are simply not rendered):
 *   learningObjectives, whatYoullLearn, originalLesson, simplifiedExplanation,
 *   vocabulary, illustrationPrompts (filled by illustrationAgent), audioNarrationScript
 *   (filled by audioAgent), interactiveActivities, workedExamples, keyTakeaways,
 *   thinkAndReflect, quiz (filled by quizAgent), accessibilityMetadata,
 *   estReadingTime, estListeningTime, difficultyScore, bloomLevel, learningOutcomeMapping
 */
const { callLLM } = require('./callLLM');

function estReadingTime(words) { return Math.max(1, Math.round(words / 120)); } // ~120 wpm for young readers

// Language subjects must be taught IN their own language/script. Maths + English
// stay in English; Hindi/Urdu/Sanskrit/etc. generate learner-facing text in the
// target language so a Hindi lesson isn't half English.
const LANGUAGE_OF_SUBJECT = {
  hindi: 'Hindi (Devanagari script)',
  urdu: 'Urdu (Nastaliq script)',
  sanskrit: 'Sanskrit (Devanagari script)',
  telugu: 'Telugu script', tamil: 'Tamil script', bengali: 'Bengali script',
};
function targetLanguage(subject) {
  return LANGUAGE_OF_SUBJECT[String(subject || '').toLowerCase().trim()] || 'English';
}

async function generate({ title, subject, grade, cleanText, understanding, strategy }) {
  const isMath = strategy.layoutType === 'math';
  const lang = targetLanguage(subject);
  const langRule = lang === 'English' ? ''
    : `\n- CRITICAL: write ALL learner-facing text (whatYoullLearn, simplifiedExplanation, originalLesson, vocabulary words+definitions, keyTakeaways, thinkAndReflect, interactiveActivities) in ${lang}. This is a ${lang} lesson — do NOT write it in English. Learning objectives/mapping may stay in English.`;
  const system = `You write production-ready, grade-appropriate CBSE/NCERT lesson content as STRICT JSON (never markdown). You NEVER invent facts — ground everything ONLY in the real textbook text provided. Warm, simple, encouraging teacher voice.${lang === 'English' ? '' : ` This is a ${lang} lesson: teach it in ${lang}.`} Return strict JSON only.`;

  const user = `Generate a Grade ${grade} ${subject} lesson for "${title}".
Instructional type: ${strategy.type}. Teaching approach: ${strategy.guidance}
Core concept: ${understanding.coreConcept}
Learning objective: ${understanding.learningObjective}
Known likely misconceptions: ${(understanding.likelyMisconceptions || []).join('; ') || 'none noted'}

Real textbook text (verbatim, may be truncated) — ground EVERYTHING here:
"""${cleanText.slice(0, 5500)}"""

Return JSON exactly:
{
  "learningObjectives": ["2-4 measurable objectives"],
  "whatYoullLearn": ["3-5 short 'you will learn to...' Coursera-style preview bullets"],
  "originalLesson": ["the real content ${strategy.type === 'Poem' ? 'FULL poem verbatim, one array item per line/stanza' : 'key verbatim excerpts, split into readable parts'}"],
  "simplifiedExplanation": ["3-4 short simplified paragraphs for a Grade ${grade} learner"],
  "vocabulary": [{"word":"...","definition":"very simple, grade-appropriate"}],
  "interactiveActivities": ["1-3 hands-on activities grounded in this topic"],
  ${isMath ? `"workedExamples": [{"problem":"one worked problem from this chapter","steps":["Step 1: ...","Step 2: ...","Step 3: ..."],"answer":"final answer as a short sentence"}],
  "formula": "the main rule/formula in words or symbols, else empty string",
  "keyIdeas": ["2-3 key maths ideas/rules from this chapter"],
  "commonMistakes": ["1-3 common mistakes learners make here"],` : `"workedExamples": [],`}
  "keyTakeaways": ["3-5 key takeaways"],
  "thinkAndReflect": ["1-2 reflective questions grounded in the content"],
  "difficultyScore": 1-5,
  "learningOutcomeMapping": "one sentence mapping this lesson to a CBSE learning outcome"
}

Rules:
- Grade ${grade} language: ${understanding.vocabularyLevel || 'simple, short sentences'}.
- vocabulary: 4-6 REAL words that appear in the text above only.
${strategy.type === 'Poem' ? '- originalLesson MUST contain the full poem exactly as in the text, line by line.\n' : ''}${isMath ? '- Numbers small and grade-appropriate; show EVERY step, solve line by line.\n' : ''}- No markdown, no text outside the JSON object.${langRule}`;

  const out = await callLLM(system, user);

  // Normalise arrays + guards.
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const lesson = {
    title, subject, grade,
    instructionalType: strategy.type,
    layout_type: strategy.layoutType,
    learningObjectives: arr(out.learningObjectives),
    whatYoullLearn: arr(out.whatYoullLearn),
    originalLesson: arr(out.originalLesson),
    simplifiedExplanation: arr(out.simplifiedExplanation).filter((p) => typeof p === 'string' && p.trim()),
    vocabulary: arr(out.vocabulary).filter((v) => v && v.word),
    interactiveActivities: arr(out.interactiveActivities),
    workedExamples: arr(out.workedExamples).filter((e) => e && e.problem),
    keyTakeaways: arr(out.keyTakeaways),
    thinkAndReflect: arr(out.thinkAndReflect),
    difficultyScore: Number(out.difficultyScore) || understanding.cognitiveLoad === 'high' ? 4 : 2,
    bloomLevel: understanding.bloomLevel || 'Understand',
    learningOutcomeMapping: out.learningOutcomeMapping || understanding.learningObjective || '',
    // Filled by later agents:
    illustrationPrompts: [],
    audioNarrationScript: null,
    quiz: [],
    accessibilityMetadata: {},
    estReadingTime: 0,
    estListeningTime: 0,
  };
  if (isMath) {
    lesson.formula = out.formula || '';
    lesson.keyIdeas = arr(out.keyIdeas);
    lesson.commonMistakes = arr(out.commonMistakes);
  }
  const words = lesson.simplifiedExplanation.join(' ').split(/\s+/).length;
  lesson.estReadingTime = estReadingTime(words);
  return lesson;
}

module.exports = { generate, targetLanguage };
