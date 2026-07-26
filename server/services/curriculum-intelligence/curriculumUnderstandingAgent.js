/**
 * Module 2 — curriculumUnderstandingAgent
 * Understand-first: BEFORE any lesson is generated, infer what this topic is
 * really about from the retrieved textbook text. Returns subject, learning
 * objective, core concept, likely misconceptions, prerequisites, Bloom level,
 * grade-appropriate cognitive load, and the instructional TYPE that drives the
 * teaching strategy.
 */
const { callLLM } = require('./callLLM');

const INSTRUCTIONAL_TYPES = [
  'Poem', 'Story', 'Concept Explanation', 'Conversation', 'Reading Passage', 'Grammar',
  'Vocabulary', 'Writing', 'Mathematics', 'Experiment', 'Observation', 'Diagram', 'Map',
  'Timeline', 'Case Study', 'Problem Solving', 'Activity', 'Project', 'Revision',
];

async function understand({ title, subject, grade, cleanText }) {
  const system = `You are a CBSE/NCERT curriculum analyst. You NEVER invent content — you only analyse the real textbook text given. Return strict JSON only.`;
  const user = `Analyse this Grade ${grade} ${subject} topic BEFORE any lesson is written.

Topic title: "${title}"
Real textbook text (verbatim, may be truncated):
"""${cleanText.slice(0, 5000)}"""

Choose instructionalType from this list (or infer a new short label ONLY if none fit):
${INSTRUCTIONAL_TYPES.join(', ')}

Return JSON exactly:
{
  "subject": "${subject}",
  "instructionalType": "one of the list above (or a new short label)",
  "learningObjective": "one clear sentence: what the learner should be able to do after this",
  "coreConcept": "the single central idea/skill of this topic",
  "keyPoints": ["3-5 short factual points actually present in the text"],
  "likelyMisconceptions": ["1-3 common mistakes a Grade ${grade} learner makes here"],
  "prerequisites": ["1-3 things the learner should already know"],
  "bloomLevel": "Remember|Understand|Apply|Analyse|Evaluate|Create",
  "cognitiveLoad": "low|medium|high (for the grade)",
  "vocabularyLevel": "one phrase describing appropriate word difficulty for the grade"
}

Rules:
- Ground every field ONLY in the text above. If the text is thin, say so honestly in keyPoints.
- No markdown, no text outside the JSON.`;
  const out = await callLLM(system, user);
  // Normalise + guard.
  out.instructionalType = String(out.instructionalType || 'Concept Explanation').trim();
  out.subject = out.subject || subject;
  for (const k of ['keyPoints', 'likelyMisconceptions', 'prerequisites']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  return out;
}

module.exports = { understand, INSTRUCTIONAL_TYPES };
