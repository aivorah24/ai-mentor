const Groq = require('groq-sdk');
const { logLLMCall } = require('./tokenLogger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// NVIDIA NIM — OpenAI-compatible endpoint, used as fallback when Groq hits rate limits
const NVIDIA_NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL   = 'mistralai/mistral-small-4-119b-2603';

// Model routing: fast model for simple verdicts, powerful for explanations
const MODEL_FAST  = 'llama-3.1-8b-instant';       // ~300-500ms TTFT
const MODEL_POWER = 'llama-3.3-70b-versatile';     // best reasoning

async function callNvidiaNim(messages, maxTokens = 1024) {
  const res = await fetch(NVIDIA_NIM_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify({
      model:       NVIDIA_MODEL,
      messages,
      max_tokens:  maxTokens,
      temperature: 0.2,
      top_p:       1.0,
      stream:      false,
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA NIM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// The numeric grade, or null when it cannot be read. "Grade 11", "Class XI"
// and "11" all appear in the data, so match digits and Roman numerals both.
function gradeNumber(grade) {
  const s = String(grade || '').trim();
  const d = s.match(/\b(\d{1,2})\b/);
  if (d) { const n = +d[1]; if (n >= 1 && n <= 12) return n; }
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  const r = s.toLowerCase().match(/\b(x?i{0,3}v?i{0,3}|ix|iv|xi{0,2})\b/g) || [];
  for (const t of r) if (roman[t]) return roman[t];
  return null;
}

// Senior students are NOT small children. This tutor was written for IB PYP
// primary and applied its persona to every grade, so a 17-year-old revising for
// boards was told about lemonade stands and "You're doing amazing! 🌟". QA found
// that register on ~21 of 22 sampled Grade 11-12 lessons; it reads as
// condescending and costs the product credibility with exactly the students and
// teachers who judge it most harshly. Grades 1-5 keep the warm playful voice —
// that is deliberate and must not regress.
const isSenior = (grade) => (gradeNumber(grade) || 0) >= 9;
const isMiddle = (grade) => { const n = gradeNumber(grade) || 0; return n >= 6 && n <= 8; };

function getAgeGuardrails(grade) {
  const n = gradeNumber(grade);
  if (n === 1 || n === 2) return 'Grades 1-2 (age 6-8): very simple words, max 8-word sentences, one idea at a time, playful comparisons.';
  if (n === 3) return 'Grade 3 (age 8-9): very simple words, max 8-word sentences, one idea at a time, fun daily-life comparisons.';
  if (n === 4) return 'Grade 4 (age 9-10): simple clear language, short sentences, everyday examples.';
  if (n === 5) return 'Grade 5 (age 10-11): clear language, slightly more detail, real-world examples.';
  if (n >= 6 && n <= 8) return 'Grades 6-8 (age 11-14): precise subject vocabulary with brief definitions, multi-step explanations, examples drawn from science and everyday technology rather than toys.';
  if (n >= 9 && n <= 10) return 'Grades 9-10 (age 14-16): full academic terminology, formal definitions, exam-style rigour, worked derivations. No childish analogies.';
  if (n >= 11) return 'Grades 11-12 (age 16-18, board-exam year): university-preparatory register. Exact terminology, correct notation and units, complete derivations, and where relevant the standard exam-marking conventions. No childish analogies.';
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
      teachingRule = isSenior(grade) ? `Mathematics teaching format (${gradeLabel}, board-exam level):
1. State what the concept is and where it is used, in one or two precise sentences. No childish hook.
2. Give the formal definition and the general formula with correct notation, naming every symbol.
3. Work a complete example line by line, showing the algebra — not just the result — and stating the reason for each step.
4. Work a second example that differs in kind (a case with a sign change, a boundary case, or a common exam variant).
5. Name the mistake students most often make here and how to avoid it.
6. End with one exam-style problem for the student to attempt.
Use exact terminology, correct units, and standard notation throughout. Never invent a method: use the one the syllabus expects for this grade.`
      : `Math teaching format:
1. Start with a warm, curious hook that makes the student WANT to learn this ("Have you ever wondered how to share a chocolate bar equally? That's exactly what fractions are!").
2. Explain the concept clearly in simple words — what it IS, why it matters in real life. Use 2-3 sentences. Make it feel like a story, not a textbook.
3. Give a vivid real-life analogy the student can picture (using pizza, chocolate, money, toys, sports — things a ${gradeLabel} student loves). Paint the scene.
4. Show a worked example step by step: Step 1, Step 2, Step 3... Answer. Use actual numbers. Explain WHY each step works, not just what to do.
5. Give a second, slightly different example to build confidence.
6. End with ONE fun practice question for the student to try — make it feel like a game, not a test.
7. If the student asked for multiple steps/concepts "one by one", teach the FIRST one only, then ask if they are ready for the next.
Never rush. Stay on one idea at a time. Be encouraging after every step. Explain the "why" behind each rule — don't just give procedures.`;
    }
  } else {
    teachingRule = studentAnsweringPractice
      ? `Student answered your question. Evaluate first. Correct: praise warmly with "That's right!" and briefly explain why. Wrong: say "Almost! Let me help." then explain gently and give another chance. Do NOT move to a new topic.`
      : isSenior(grade)
      ? `1. Open by stating what this topic is and why it matters in the subject — one or two precise sentences, no childish hook.
2. Explain the concept properly, using correct terminology and defining each term as it appears. Build the explanation in logical order rather than in "fun facts".
3. Give a real example with specifics — actual figures, named cases, dates, or a short derivation as the subject requires.
4. Where the syllabus expects a particular framework, method or terminology, use exactly that one and name it.
5. Point out the distinction or exception most often confused here.
6. End by checking understanding with a question at exam standard.
Be accurate before being friendly. If a claim is contested or simplified, say so rather than stating it flatly.`
      : `1. Start with a fun, relatable hook that sparks curiosity — connect the topic to something the student already knows and loves (food, games, weather, animals, their daily life). Make them think "Wow, I never noticed that!"
2. Explain the concept clearly in 3-4 sentences. Break it into small, digestible pieces. Use comparisons: "Think of it like..." or "Imagine if...". Make abstract ideas concrete.
3. Give a vivid real-world example with specific details — not just "plants need sunlight" but "Think about a sunflower in your garden. It turns its face to follow the sun all day long! That's because it needs sunlight to make its own food through photosynthesis."
4. Add a fun fact or "Did you know?" moment to make it memorable.
5. If the student asked for multiple things "one by one", explain the FIRST item only, then ask "Ready for the next one?"
6. End with an encouraging question to check understanding — make it feel like a conversation, not a quiz.`;
  }

  // Persona/register split by grade band — see isSenior() above for why.
  const senior = isSenior(grade), middle = isMiddle(grade);
  const personaLine = senior
    ? `You are Ms. Zara — a knowledgeable, respectful subject tutor for ${gradeLabel} students on Aivorah. Treat the student as a serious young adult preparing for board examinations.`
    : middle
      ? `You are Ms. Zara — a clear, encouraging subject tutor for ${gradeLabel} students on Aivorah.`
      : `You are Ms. Zara — warm, enthusiastic, patient AI tutor for ${gradeLabel} students on Aivorah.`;

  const languageLine = senior
    ? `Precise academic language appropriate to ${gradeLabel}. Use correct subject terminology, notation, units and formulas — define a term the first time it appears, then use it properly. Analogies are allowed ONLY when they clarify a genuinely difficult abstraction, and must be drawn from the adult/scientific world — never toys, sweets, lemonade stands, playgrounds or pets. Do not use emoji.`
    : middle
      ? `Clear language a ${gradeLabel} student understands, using proper subject terms with short definitions. Relate ideas to science, technology and everyday life rather than toys.`
      : `Simple words a ${gradeLabel} student understands. Short sentences. Relate to toys, food, animals, games, everyday life. No jargon. Always end with warmth and encouragement.`;

  const styleLine = senior
    ? `Be respectful, focused and precise — the tone of a good sixth-form or junior-college teacher. Encouragement is brief and earned ("Good question — this one catches people out"). Never use cheerleader phrases such as "You're doing amazing!", exclamation-heavy praise, or emoji. Accuracy matters more than warmth: if something is a common exam trap, say so plainly. If the student asks for step-by-step, number the steps. Never give a one-line answer — give enough depth to genuinely understand.`
    : `Be warm and friendly like a favourite teacher. Use "Great question!", "You're doing amazing!", "Let's find out together!" naturally. If the student asks to explain "one by one" or "step by step", explain each part separately in order, numbered like Step 1, Step 2, etc. Never give a one-line answer — always give enough detail for the student to truly understand.`;

  const systemPrompt = `${personaLine}

SCOPE: ${scopeRule}

AUDIENCE: ${getAgeGuardrails(grade)}
LANGUAGE: ${languageLine}
FORMAT: Structure your responses clearly. Use **bold** for key terms and important words. Use bullet points (- ) for lists. Use numbered steps (1. 2. 3.) when explaining processes. Break your answer into short paragraphs. Never give a wall of text — make it easy to read and scan.
WORD RULES: Never say "mice" when referring to a computer mouse — always say "a mouse" or "the mouse". Never use confusing animal words for tech terms. Say "press Enter" not "hit Enter". Say "computer mouse" on first mention so it's clear.

KNOWLEDGE: ${knowledgeRule}
${indianNumberRule ? `\nINDIAN NUMBERS: ${indianNumberRule}` : ''}
TEACHING: ${teachingRule}

STYLE: ${styleLine}

CONVERSATION: Read the chat history before replying. Never repeat the same example. If student says "more"/"again"/"example" — give a NEW example on the SAME concept.`;

  const contextBlock = hasContext ? `\nCurriculum Content for "${topic || subjectLabel}":\n${context}\n` : '';
  const userPrompt   = `${contextBlock}${historyBlock ? `\nConversation so far:\n${historyBlock}\n` : ''}\nStudent: ${question}`;

  // Always use powerful 70b model for quality responses
  const model = MODEL_POWER;
  // Give enough tokens for rich, detailed explanations (ChatGPT/Claude quality)
  const maxTokens = studentAnsweringPractice ? 350 : 900;

  return { hasContext, mathMode, systemPrompt, userPrompt, model, maxTokens };
}

async function generateAnswer({ question, context, grade, subject, topic, history, _meta = {} }) {
  const { systemPrompt, userPrompt, model, maxTokens } = buildPrompts({ question, context, grade, subject, topic, history });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  // Primary: Groq
  try {
    const t0 = Date.now();
    const response = await groq.chat.completions.create({
      model, messages, temperature: 0.2, max_tokens: maxTokens,
    });
    const responseTimeMs = Date.now() - t0;
    const usage = response.usage || {};
    logLLMCall({
      provider: 'groq', model,
      route: _meta.route, studentEmail: _meta.studentEmail,
      grade, subject, topic,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      responseTimeMs, streamed: false,
    });
    return response.choices?.[0]?.message?.content || '';
  } catch (err) {
    const is429 = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('rate_limit');
    if (!is429) throw err;
    console.warn('[LLM] Groq rate limit — falling back to NVIDIA NIM');
  }

  // Fallback: NVIDIA NIM
  const t0 = Date.now();
  const text = await callNvidiaNim(messages, maxTokens);
  logLLMCall({
    provider: 'nvidia', model: NVIDIA_MODEL,
    route: _meta.route, studentEmail: _meta.studentEmail,
    grade, subject, topic,
    promptTokens: 0, completionTokens: 0, // NVIDIA doesn't return usage
    responseTimeMs: Date.now() - t0, streamed: false,
  });
  return text;
}

/**
 * Stream answer token-by-token via callback.
 * Returns the full assembled text when done.
 */
async function generateAnswerStream({ question, context, grade, subject, topic, history, onToken, _meta = {} }) {
  const { systemPrompt, userPrompt, model, maxTokens } = buildPrompts({ question, context, grade, subject, topic, history });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  // Primary: Groq streaming
  try {
    const t0 = Date.now();
    const stream = await groq.chat.completions.create({
      model, messages, temperature: 0.2, max_tokens: maxTokens, stream: true,
    });
    let full = '';
    let usage = {};
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) { full += delta; onToken(delta); }
      // Groq sends usage in the last chunk
      if (chunk.x_groq?.usage) usage = chunk.x_groq.usage;
    }
    logLLMCall({
      provider: 'groq', model,
      route: _meta.route, studentEmail: _meta.studentEmail,
      grade, subject, topic,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      responseTimeMs: Date.now() - t0, streamed: true,
    });
    return full;
  } catch (err) {
    const is429 = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('rate_limit');
    if (!is429) throw err;
    console.warn('[LLM] Groq rate limit (stream) — falling back to NVIDIA NIM');
  }

  // Fallback: NVIDIA NIM (non-streaming, emit full response as one chunk)
  const t0 = Date.now();
  const full = await callNvidiaNim(messages, maxTokens);
  onToken(full);
  logLLMCall({
    provider: 'nvidia', model: NVIDIA_MODEL,
    route: _meta.route, studentEmail: _meta.studentEmail,
    grade, subject, topic,
    promptTokens: 0, completionTokens: 0,
    responseTimeMs: Date.now() - t0, streamed: false,
  });
  return full;
}

/**
 * Generic JSON-mode generation — used by content pipelines (e.g. the Math
 * Learning Engine) that need structured output rather than a conversational
 * reply. Reuses the same Groq→NVIDIA fallback as generateAnswer instead of
 * standing up a separate LLM client.
 */
async function generateJSON({ systemPrompt, userPrompt, model = MODEL_POWER, maxTokens = 1500, _meta = {} }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  const parse = (raw) => {
    const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return JSON.parse(cleaned);
  };

  try {
    const t0 = Date.now();
    const response = await groq.chat.completions.create({
      model, messages, temperature: 0.2, max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });
    const usage = response.usage || {};
    logLLMCall({
      provider: 'groq', model, route: _meta.route,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      responseTimeMs: Date.now() - t0, streamed: false,
    });
    return parse(response.choices?.[0]?.message?.content);
  } catch (err) {
    const is429 = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('rate_limit');
    if (!is429) throw err;
    console.warn('[LLM] Groq rate limit (JSON) — falling back to NVIDIA NIM');
  }

  const t0 = Date.now();
  const text = await callNvidiaNim(messages, maxTokens);
  logLLMCall({
    provider: 'nvidia', model: NVIDIA_MODEL, route: _meta.route,
    promptTokens: 0, completionTokens: 0,
    responseTimeMs: Date.now() - t0, streamed: false,
  });
  return parse(text);
}

module.exports = {
  generateAnswer,
  generateAnswerStream,
  generateJSON,
  getAgeGuardrails,
  buildPrompts,
  buildNoContextFallback,
};
