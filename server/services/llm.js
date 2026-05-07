const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Model routing: fast model for simple verdicts, powerful for explanations
const MODEL_FAST  = 'llama-3.1-8b-instant';       // ~300-500ms TTFT
const MODEL_POWER = 'llama-3.3-70b-versatile';     // best reasoning

function getAgeGuardrails(grade) {
  const g = (grade || '').toLowerCase();
  if (g.includes('3')) return 'Grade 3 (age 8-9): very simple words, max 8-word sentences, one idea at a time, fun daily-life comparisons.';
  if (g.includes('4')) return 'Grade 4 (age 9-10): simple clear language, short sentences, everyday examples.';
  if (g.includes('5')) return 'Grade 5 (age 10-11): clear language, slightly more detail, real-world examples.';
  return 'Age-appropriate simple language. Be encouraging.';
}

function buildNoContextFallback({ topic, grade }) {
  const gradeLabel = grade || 'your grade';
  return `I want to help, but I cannot find the lesson content for "${topic}" right now. Please try again in a moment or ask your teacher to refresh this ${gradeLabel} lesson, then ask me again.`;
}

function isMathMode({ question, subject, topic, history = [] }) {
  const s = `${subject || ''} ${topic || ''} ${question || ''}`.toLowerCase();
  const mathSignals = [
    /\bmath(s|ematics)?\b/, /\bfractions?\b/, /\bdecimals?\b/,
    /\bpercents?\b/, /\baddition\b/, /\bsubtraction\b/, /\bmultiplications?\b/,
    /\bdivision\b/, /\bnumbers?\b/, /\bequations?\b/, /\balgebra\b/,
    /\bgeometry\b/, /\bperimeters?\b/, /\bareas?\b/, /\bvolumes?\b/,
    /\bmean\b/, /\bmedian\b/, /\bratios?\b/, /\bsolves?\b/,
    /[0-9]\s*[\+\-\*\/x]\s*[0-9]/,
  ];
  if (mathSignals.some((re) => re.test(s))) return true;
  return Array.isArray(history) && history.some((h) =>
    mathSignals.some((re) => re.test(String(h?.text || '').toLowerCase()))
  );
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((h) => {
      const role = String(h?.role || '').toLowerCase();
      const text = String(h?.text || '').trim();
      if (!text) return null;
      if (role === 'user' || role === 'human' || role === 'student') return { role: 'user', text };
      if (role === 'assistant' || role === 'ai' || role === 'bot') return { role: 'assistant', text };
      return null;
    })
    .filter(Boolean)
    .slice(-6); // keep last 6 turns (was 8) — fewer tokens, same context quality
}

function buildPrompts({ question, context, grade, subject, topic, history = [] }) {
  const gradeLabel   = grade || 'primary school';
  const subjectLabel = subject || 'this subject';
  const hasContext   = !!(context && context.trim().length > 0);
  const recentHistory = normalizeHistory(history);
  const mathMode     = isMathMode({ question, subject, topic, history: recentHistory });

  const historyBlock = recentHistory.length
    ? recentHistory.map((m) => `${m.role === 'user' ? 'Student' : 'Ms. Zara'}: ${m.text}`).join('\n')
    : '';

  // Detect if student is answering a practice question Ms. Zara asked
  const lastAIMsg = recentHistory.filter(h => h.role === 'assistant').slice(-1)[0]?.text || '';
  const lastAskedPractice = /try this|how many|what is|can you (find|solve|tell)|your turn/i.test(lastAIMsg);
  const isShortReply = question.trim().split(/\s+/).length <= 6;
  const studentAnsweringPractice = lastAskedPractice && isShortReply;

  const IB_SUBJECTS = 'Mathematics, Science, English, Arts, Social Studies, ICT, Physical Education';

  // Detect if question involves Indian large numbers (crores/lakhs format)
  const indianNumberQ = /crore|lakh|place.?value|indian.?number|number.?system|\d,\d{2},\d{2}|\d,\d{2},\d{3}/i.test(
    `${question} ${topic || ''}`
  );
  const indianNumberRule = indianNumberQ
    ? `INDIAN NUMBER SYSTEM: This student uses the Indian number system. Place values are: Ones, Tens, Hundreds, Thousands (Th), Ten Thousands (TTh), Lakhs (L), Ten Lakhs (TL), Crores (C), Ten Crores (TC). Commas group as: first 3 digits from right, then pairs of 2. Example: 5,23,45,678 → 5 Crores 23 Lakhs 45 Thousands 6 Hundreds 78. 1 Lakh = 1,00,000. 1 Crore = 1,00,00,000. NEVER use millions/billions — always use lakhs/crores for this student.`
    : '';

  // --- COMPACT SYSTEM PROMPT (fewer tokens = faster TTFT) ---
  const scopeRule = topic
    ? `Topic lock: only answer about "${topic}" in ${subjectLabel}. Off-topic? Say: "Great curiosity! Let's finish ${topic} first."`
    : `Only help with IB PYP ${gradeLabel} subjects: ${IB_SUBJECTS}. Off-topic (movies, sports, celebrities, news)? Say: "I'm your school AI Coach — I help with ${gradeLabel} school subjects. What would you like to learn?"`;

  const knowledgeRule = hasContext
    ? `Curriculum content is provided below. Use it as your primary factual source. If the answer is not in it, use your general knowledge about IB PYP ${gradeLabel} curriculum to answer. Never invent facts.`
    : `No curriculum content snippet available. Answer from your general knowledge about IB PYP ${gradeLabel} curriculum topics. Always answer curriculum questions — never say you cannot help with a valid school subject. Only refuse truly off-topic requests (movies, sports, celebrities).`;

  let teachingRule = '';
  if (mathMode) {
    if (studentAnsweringPractice) {
      teachingRule = `STUDENT ANSWERED YOUR PRACTICE QUESTION. Student's answer: "${question.trim()}"

Step 1 — Look at the practice question you just asked in the conversation above.
Step 2 — Compute the correct answer yourself (e.g. 2+1=3, so correct=3).
Step 3 — If the question had A/B/C options: map the student's answer to the option value (e.g. student says "B" → check what B's value is; student says "2" → check if 2 is the correct VALUE, NOT just a number that appears in the question).
Step 4 — Compare: does the student's answer equal the correct answer?
  IMPORTANT — Accept mathematically equivalent answers as CORRECT:
  - Fractions: 2/10 = 1/5 = correct. 4/8 = 1/2 = correct. Do NOT penalise unsimplified fractions.
  - Numbers: "3.0" = "3" = correct. "1 + 2" = "3" = correct.
  - MCQ: if student says "B" and B's value equals the correct answer → correct.
  - If student says a value that matches ANY correct form of the answer → correct.
Step 5 — If correct (including equivalent forms): start DIRECTLY with "That's correct!" then show the solution.
         If wrong: start DIRECTLY with "Almost there!" then show the correct steps clearly.

CRITICAL RULES:
- Do NOT write "Let me check", "Let me verify", "Let me think", or any reasoning out loud.
- Your very first word MUST be either "That's" (correct) or "Almost" (wrong). Nothing before it.
- NEVER mark a mathematically equivalent answer as wrong.
- After feedback, ask if they want another question or a new topic.`;
    } else {
      teachingRule = `Math teaching format:
1. Start with one warm sentence explaining what this concept means in plain English.
2. Give a real-life analogy (using food, toys, money, sports — something a ${gradeLabel} student loves).
3. Show a worked example step by step: Step 1 → Step 2 → Answer. Use actual numbers.
4. End with ONE simple practice question for the student to try.
5. If the student asked for multiple steps/concepts "one by one", teach the FIRST one only, then ask if they are ready for the next.
Never rush. Stay on one idea at a time. Be encouraging after every step.`;
    }
  } else {
    teachingRule = studentAnsweringPractice
      ? `Student answered your question. Evaluate first. Correct: praise warmly with "That's right!" and briefly explain why. Wrong: say "Almost! Let me help." then explain gently and give another chance. Do NOT move to a new topic.`
      : `1. Start with a fun, relatable hook — connect the topic to something the student knows (food, games, weather, animals).
2. Explain the concept in 2-3 short sentences.
3. Give one clear real-world example with specifics.
4. If the student asked for multiple things "one by one", explain the FIRST item only, then ask "Ready for the next one?"
5. End with an encouraging question to check understanding.`;
  }

  const systemPrompt = `You are Ms. Zara — warm, enthusiastic, patient AI tutor for IB PYP ${gradeLabel} students on Aivorah.

SCOPE: ${scopeRule}

LANGUAGE: Simple words a ${gradeLabel} student understands. Short sentences. Relate to toys, food, animals, games, everyday life. No jargon. Always end with warmth and encouragement. Plain text only — no markdown asterisks, no bullet dashes, no hash symbols.

KNOWLEDGE: ${knowledgeRule}
${indianNumberRule ? `\nINDIAN NUMBERS: ${indianNumberRule}` : ''}
TEACHING: ${teachingRule}

STYLE: Be warm and friendly like a favourite teacher. Use "Great question!", "You're doing amazing!", "Let's find out together!" naturally. If the student asks to explain "one by one" or "step by step", explain each part separately in order, numbered like Step 1, Step 2, etc. Never give a one-line answer — always give enough detail for the student to truly understand.

CONVERSATION: Read the chat history before replying. Never repeat the same example. If student says "more"/"again"/"example" — give a NEW example on the SAME concept.`;

  const contextBlock = hasContext ? `\nCurriculum Content for "${topic || subjectLabel}":\n${context}\n` : '';
  const userPrompt   = `${contextBlock}${historyBlock ? `\nConversation so far:\n${historyBlock}\n` : ''}\nStudent: ${question}`;

  // Always use powerful 70b model for quality responses
  const model = MODEL_POWER;
  // Give enough tokens for quality explanations
  const maxTokens = studentAnsweringPractice ? 250 : 520;

  return { hasContext, mathMode, systemPrompt, userPrompt, model, maxTokens };
}

async function generateAnswer({ question, context, grade, subject, topic, history }) {
  const { systemPrompt, userPrompt, model, maxTokens } = buildPrompts({ question, context, grade, subject, topic, history });

  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
  });

  return response.choices?.[0]?.message?.content || '';
}

/**
 * Stream answer token-by-token via callback.
 * Returns the full assembled text when done.
 */
async function generateAnswerStream({ question, context, grade, subject, topic, history, onToken }) {
  const { systemPrompt, userPrompt, model, maxTokens } = buildPrompts({ question, context, grade, subject, topic, history });

  const stream = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
    stream: true,
  });

  let full = '';
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      onToken(delta);
    }
  }
  return full;
}

module.exports = {
  generateAnswer,
  generateAnswerStream,
  getAgeGuardrails,
  buildPrompts,
  buildNoContextFallback,
};
