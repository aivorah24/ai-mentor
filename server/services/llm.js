const Groq = require('groq-sdk');

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
      : `1. Start with a fun, relatable hook that sparks curiosity — connect the topic to something the student already knows and loves (food, games, weather, animals, their daily life). Make them think "Wow, I never noticed that!"
2. Explain the concept clearly in 3-4 sentences. Break it into small, digestible pieces. Use comparisons: "Think of it like..." or "Imagine if...". Make abstract ideas concrete.
3. Give a vivid real-world example with specific details — not just "plants need sunlight" but "Think about a sunflower in your garden. It turns its face to follow the sun all day long! That's because it needs sunlight to make its own food through photosynthesis."
4. Add a fun fact or "Did you know?" moment to make it memorable.
5. If the student asked for multiple things "one by one", explain the FIRST item only, then ask "Ready for the next one?"
6. End with an encouraging question to check understanding — make it feel like a conversation, not a quiz.`;
  }

  const systemPrompt = `You are Ms. Zara — warm, enthusiastic, patient AI tutor for IB PYP ${gradeLabel} students on Aivorah.

SCOPE: ${scopeRule}

LANGUAGE: Simple words a ${gradeLabel} student understands. Short sentences. Relate to toys, food, animals, games, everyday life. No jargon. Always end with warmth and encouragement.
FORMAT: Structure your responses clearly. Use **bold** for key terms and important words. Use bullet points (- ) for lists. Use numbered steps (1. 2. 3.) when explaining processes. Break your answer into short paragraphs. Never give a wall of text — make it easy to read and scan.
WORD RULES: Never say "mice" when referring to a computer mouse — always say "a mouse" or "the mouse". Never use confusing animal words for tech terms. Say "press Enter" not "hit Enter". Say "computer mouse" on first mention so it's clear.

KNOWLEDGE: ${knowledgeRule}
${indianNumberRule ? `\nINDIAN NUMBERS: ${indianNumberRule}` : ''}
TEACHING: ${teachingRule}

STYLE: Be warm and friendly like a favourite teacher. Use "Great question!", "You're doing amazing!", "Let's find out together!" naturally. If the student asks to explain "one by one" or "step by step", explain each part separately in order, numbered like Step 1, Step 2, etc. Never give a one-line answer — always give enough detail for the student to truly understand.

CONVERSATION: Read the chat history before replying. Never repeat the same example. If student says "more"/"again"/"example" — give a NEW example on the SAME concept.`;

  const contextBlock = hasContext ? `\nCurriculum Content for "${topic || subjectLabel}":\n${context}\n` : '';
  const userPrompt   = `${contextBlock}${historyBlock ? `\nConversation so far:\n${historyBlock}\n` : ''}\nStudent: ${question}`;

  // Always use powerful 70b model for quality responses
  const model = MODEL_POWER;
  // Give enough tokens for rich, detailed explanations (ChatGPT/Claude quality)
  const maxTokens = studentAnsweringPractice ? 350 : 900;

  return { hasContext, mathMode, systemPrompt, userPrompt, model, maxTokens };
}

async function generateAnswer({ question, context, grade, subject, topic, history }) {
  const { systemPrompt, userPrompt, model, maxTokens } = buildPrompts({ question, context, grade, subject, topic, history });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  // Primary: Groq
  try {
    const response = await groq.chat.completions.create({
      model, messages, temperature: 0.2, max_tokens: maxTokens,
    });
    return response.choices?.[0]?.message?.content || '';
  } catch (err) {
    const is429 = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('rate_limit');
    if (!is429) throw err;
    console.warn('[LLM] Groq rate limit — falling back to NVIDIA NIM');
  }

  // Fallback: NVIDIA NIM
  return await callNvidiaNim(messages, maxTokens);
}

/**
 * Stream answer token-by-token via callback.
 * Returns the full assembled text when done.
 */
async function generateAnswerStream({ question, context, grade, subject, topic, history, onToken }) {
  const { systemPrompt, userPrompt, model, maxTokens } = buildPrompts({ question, context, grade, subject, topic, history });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  // Primary: Groq streaming
  try {
    const stream = await groq.chat.completions.create({
      model, messages, temperature: 0.2, max_tokens: maxTokens, stream: true,
    });
    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) { full += delta; onToken(delta); }
    }
    return full;
  } catch (err) {
    const is429 = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('rate_limit');
    if (!is429) throw err;
    console.warn('[LLM] Groq rate limit (stream) — falling back to NVIDIA NIM');
  }

  // Fallback: NVIDIA NIM (non-streaming, emit full response as one chunk)
  const full = await callNvidiaNim(messages, maxTokens);
  onToken(full);
  return full;
}

module.exports = {
  generateAnswer,
  generateAnswerStream,
  getAgeGuardrails,
  buildPrompts,
  buildNoContextFallback,
};
