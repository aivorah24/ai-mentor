/**
 * Module 10 — regenerationAgent
 * Regenerates ONLY the failed sections named in the validation defects (not the
 * whole lesson), then merges them back in. The orchestrator loops
 * validate -> regenerate until PASS or the retry cap (default 3).
 */
const { callLLM } = require('./callLLM');
const { targetLanguage } = require('./lessonGenerationAgent');

// Group defects by the top-level lesson field that owns them.
function sectionsToFix(defects) {
  return [...new Set(defects.map((d) => d.section))];
}

async function regenerate({ lesson, understanding, strategy, cleanText, defects }) {
  const sections = sectionsToFix(defects).filter((s) => s !== 'audioNarrationScript'); // audio is rebuilt deterministically by the orchestrator, not the LLM
  if (!sections.length) return lesson;

  const reasons = defects.map((d) => `- ${d.section}: ${d.reason}`).join('\n');
  const system = `You fix specific weak sections of a Grade ${lesson.grade} CBSE lesson. You NEVER invent facts — ground ONLY in the real textbook text. Return strict JSON only, containing ONLY the requested fields.`;
  const schemaLines = [];
  if (sections.includes('simplifiedExplanation')) schemaLines.push('"simplifiedExplanation": ["3-4 short simplified paragraphs for the grade"]');
  if (sections.includes('whatYoullLearn')) schemaLines.push('"whatYoullLearn": ["3-5 you-will-learn-to bullets"]');
  if (sections.includes('learningObjectives')) schemaLines.push('"learningObjectives": ["2-4 measurable objectives"]');
  if (sections.includes('vocabulary')) schemaLines.push('"vocabulary": [{"word":"...","definition":"simple, grade-appropriate"}]');
  if (sections.includes('keyTakeaways')) schemaLines.push('"keyTakeaways": ["3-5 takeaways"]');
  if (sections.includes('workedExamples')) schemaLines.push('"workedExamples": [{"problem":"...","steps":["Step 1: ...","Step 2: ..."],"answer":"..."}]');
  if (sections.includes('originalLesson')) schemaLines.push('"originalLesson": ["the real verbatim content, line/part per item"]');
  if (sections.includes('quiz')) schemaLines.push('"quiz": [{"type":"MCQ","question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"..."}]');
  if (sections.includes('thinkAndReflect')) schemaLines.push('"thinkAndReflect": ["1-2 reflective questions"]');
  if (sections.includes('interactiveActivities')) schemaLines.push('"interactiveActivities": ["1-3 activities"]');

  if (!schemaLines.length) return lesson;

  const user = `Topic "${lesson.title}" (Grade ${lesson.grade} ${lesson.subject}, ${lesson.instructionalType}).
The following sections failed QA and must be regenerated correctly:
${reasons}

Real textbook text (ground everything here):
"""${cleanText.slice(0, 5000)}"""

Return JSON with ONLY these fields:
{ ${schemaLines.join(',\n  ')} }

Rules:
- Fix exactly the listed problems; keep grade-appropriate language.
- Ground everything in the text above; no invented facts.
- No markdown, no text outside the JSON.${targetLanguage(lesson.subject) === 'English' ? '' : `\n- Write all learner-facing text in ${targetLanguage(lesson.subject)} (this is a ${targetLanguage(lesson.subject)} lesson).`}`;

  const out = await callLLM(system, user);
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : null);
  if (out.simplifiedExplanation) lesson.simplifiedExplanation = arr(out.simplifiedExplanation).filter((p) => typeof p === 'string' && p.trim());
  if (out.whatYoullLearn) lesson.whatYoullLearn = arr(out.whatYoullLearn);
  if (out.learningObjectives) lesson.learningObjectives = arr(out.learningObjectives);
  if (out.vocabulary) lesson.vocabulary = arr(out.vocabulary).filter((v) => v && v.word);
  if (out.keyTakeaways) lesson.keyTakeaways = arr(out.keyTakeaways);
  if (out.workedExamples) lesson.workedExamples = arr(out.workedExamples).filter((e) => e && e.problem);
  if (out.originalLesson) lesson.originalLesson = arr(out.originalLesson);
  if (out.quiz) lesson.quiz = arr(out.quiz).filter((q) => q && q.question);
  if (out.thinkAndReflect) lesson.thinkAndReflect = arr(out.thinkAndReflect);
  if (out.interactiveActivities) lesson.interactiveActivities = arr(out.interactiveActivities);
  return lesson;
}

module.exports = { regenerate, sectionsToFix };
