/**
 * Module 7 — quizAgent
 * Generates ONLY grounded questions that reference the retrieved concepts.
 * Age-appropriate distractors. Mixed types: MCQ, True/False, Match,
 * Fill-blanks, Short answer, Application, Observation. Grounded in the lesson's
 * understanding + real text (never generic trivia).
 */
const { callLLM } = require('./callLLM');
const { targetLanguage } = require('./lessonGenerationAgent');

async function buildQuiz({ lesson, understanding, cleanText }) {
  const lang = targetLanguage(lesson.subject);
  const langRule = lang === 'English' ? '' : `\n- Write every question, option and answer in ${lang} (this is a ${lang} lesson).`;
  const system = `You write grounded, age-appropriate CBSE quiz questions. Every question must be answerable from the given content.${lang === 'English' ? '' : ` Write the quiz in ${lang}.`} Return strict JSON only.`;
  const typeHint = /math/i.test(lesson.subject)
    ? 'Include at least one Application (word problem) and one Fill-blanks; keep numbers small.'
    : 'Mix MCQ, True/False and one Short answer; for stories add one comprehension MCQ.';
  const user = `Create a short quiz for Grade ${lesson.grade} ${lesson.subject} topic "${lesson.title}".
Core concept: ${understanding.coreConcept}
Key points: ${(understanding.keyPoints || []).join('; ')}
Grounding text (verbatim):
"""${cleanText.slice(0, 3500)}"""

Allowed types: MCQ, TrueFalse, Match, FillBlank, ShortAnswer, Application, Observation.
${typeHint}

Return JSON exactly:
{ "quiz": [
  { "type": "MCQ", "question": "...", "options": ["...","...","...","..."], "correctIndex": 0, "explanation": "why, one sentence" },
  { "type": "TrueFalse", "question": "...", "answer": true, "explanation": "..." },
  { "type": "FillBlank", "question": "sentence with ____", "answer": "word", "explanation": "..." },
  { "type": "ShortAnswer", "question": "...", "answer": "model answer", "explanation": "..." }
] }

Rules:
- 4-6 questions, grade-appropriate, grounded ONLY in the content above.
- Distractors must be plausible but clearly wrong for the grade.
- No markdown, no text outside the JSON.${langRule}`;
  const out = await callLLM(system, user);
  const quiz = Array.isArray(out.quiz) ? out.quiz.filter((q) => q && q.question && q.type) : [];
  lesson.quiz = quiz;
  return quiz;
}

module.exports = { buildQuiz };
