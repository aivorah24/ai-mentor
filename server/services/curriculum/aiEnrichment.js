/**
 * AI Enrichment stage — generates learning resources for a syllabus topic
 * when no matched learning source (licensed textbook / OER) was found by
 * contentMapper.js. Deliberately kept separate from
 * services/syllabusExtraction.js (the CBSE-adjacent canonical-extraction
 * pipeline) rather than extending it, so that file — and CBSE's behavior —
 * is never touched by this work.
 *
 * Generates: explanation, key concepts, vocabulary, activities, summary,
 * reflection question — from the syllabus topic name + learning objectives
 * ONLY (never from a textbook, since by definition this stage only runs
 * when no textbook/licensed source was found). Every result is tagged
 * contentOrigin: 'ai_generated' and the prompt explicitly forbids claiming
 * official-textbook provenance.
 *
 * Uses Groq (not Gemini) — per explicit instruction (2026-07-21): Gemini
 * quota is limited, so this runs on Groq like routes/ncert.js's other
 * AI-generation calls (llama-3.3-70b-versatile, same model/pattern).
 */
const Groq = require('groq-sdk');

// See canonicalExtraction.js for why this isn't llama-3.3-70b-versatile —
// that model's daily quota was exhausted mid-session (2026-07-21).
const GROQ_MODEL = 'llama-3.1-8b-instant';

// Lazy-instantiated — see canonicalExtraction.js's getGroqClient() for why
// (constructor throws synchronously if GROQ_API_KEY is unset, which would
// crash this module at require() time under jest).
let _groq = null;
function getGroqClient() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

async function callGroqJSON(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');
  const response = await getGroqClient().chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 4096,
  });
  const choice = response.choices[0];
  if (choice.finish_reason === 'length') {
    throw new Error('AI enrichment response was truncated (MAX_TOKENS) even at the raised token budget.');
  }
  return choice.message.content || '{}';
}

const ENRICHMENT_PROMPT = ({ curriculum, grade, subject, topicName, learningObjectives = [] }) => `You are an experienced ${subject} teacher writing original learning material for a ${grade} student following the ${curriculum} curriculum.

Topic: "${topicName}"
${learningObjectives.length ? `Official syllabus learning objectives for this topic:\n${learningObjectives.map((o) => `- ${o}`).join('\n')}` : 'No official learning objectives text was available — infer reasonable ones from the topic name and subject.'}

IMPORTANT: You do NOT have access to any official textbook for this topic. Write entirely original explanatory content based on general subject knowledge — do NOT imply, reference, or claim this came from an official ${curriculum} textbook. If asked, this is AI-generated supplementary material only.

Produce:
- "explanation": 3-5 original paragraphs teaching the topic clearly, age-appropriate for ${grade}
- "keyConcepts": 3-6 short bullet phrases, the core ideas a student must remember
- "vocabulary": 3-8 items as {"word":"","meaning":""} — key new terms with simple original definitions
- "activities": 1-3 items as {"text":""} — a "try this yourself" style original exercise
- "summary": 2-3 sentence original wrap-up
- "reflectionQuestion": one open-ended original question to check understanding

Return ONLY valid JSON, no markdown, in this exact shape:
{"explanation":"","keyConcepts":[],"vocabulary":[],"activities":[],"summary":"","reflectionQuestion":""}`;

/**
 * @param {{ curriculum:string, grade:string, subject:string, topicName:string, learningObjectives?: string[] }} args
 * @returns {Promise<{explanation:string, keyConcepts:string[], vocabulary:{word:string,meaning:string}[], activities:{text:string}[], summary:string, reflectionQuestion:string, contentOrigin:'ai_generated'}>}
 */
async function generateTopicContent(args) {
  const rawText = (await callGroqJSON(ENRICHMENT_PROMPT(args))).replace(/```json|```/g, '');
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON object found in Groq response.');
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    explanation: parsed.explanation || '',
    keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
    vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [],
    activities: Array.isArray(parsed.activities) ? parsed.activities : [],
    summary: parsed.summary || '',
    reflectionQuestion: parsed.reflectionQuestion || '',
    contentOrigin: 'ai_generated',
  };
}

module.exports = { generateTopicContent };
