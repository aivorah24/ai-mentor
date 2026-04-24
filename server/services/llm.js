const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Age-based guardrails by grade
function getAgeGuardrails(grade) {
  const g = (grade || '').toLowerCase();
  if (g.includes('3')) {
    return `The student is in Grade 3 (age 8-9). RULES: Use very simple words (no big vocabulary). Short sentences only (max 10 words each). Give one idea at a time. Use fun comparisons from daily life (food, toys, animals). Never use technical jargon. Always end with an encouraging sentence.`;
  }
  if (g.includes('4')) {
    return `The student is in Grade 4 (age 9-10). RULES: Use simple, clear language. Short sentences. Relate ideas to everyday things. Avoid complex terminology. Always be encouraging.`;
  }
  if (g.includes('5')) {
    return `The student is in Grade 5 (age 10-11). RULES: Use clear language. Can handle slightly more detail but keep it concise. Relate to real-world examples. Always be positive and encouraging.`;
  }
  return `Use age-appropriate simple language. Be encouraging and positive.`;
}

function buildNoContextFallback({ topic, grade }) {
  const gradeLabel = grade || 'your grade';
  return `I want to help, but I cannot find the lesson content for "${topic}" right now. Please try again in a moment or ask your teacher to refresh this ${gradeLabel} lesson, then ask me again.`;
}

function isMathMode({ question, subject, topic, history = [] }) {
  const s = `${subject || ''} ${topic || ''} ${question || ''}`.toLowerCase();
  const mathSignals = [
    /\bmath\b/,
    /\bmathematics\b/,
    /\bfraction\b/,
    /\bdecimal\b/,
    /\bpercent\b/,
    /\baddition\b/,
    /\bsubtraction\b/,
    /\bmultiplication\b/,
    /\bdivision\b/,
    /\bnumber\b/,
    /\bequation\b/,
    /\balgebra\b/,
    /\bgeometry\b/,
    /\bperimeter\b/,
    /\barea\b/,
    /\bvolume\b/,
    /\bmean\b/,
    /\bmedian\b/,
    /\bratio\b/,
    /\bsolve\b/,
    /[0-9]\s*[\+\-\*\/x]\s*[0-9]/,
  ];
  if (mathSignals.some((re) => re.test(s))) return true;

  return Array.isArray(history) && history.some((h) => {
    const text = String(h?.text || '').toLowerCase();
    return mathSignals.some((re) => re.test(text));
  });
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
    .slice(-8);
}

function buildPrompts({ question, context, grade, subject, topic, history = [] }) {
  const gradeLabel = grade || 'primary school';
  const subjectLabel = subject || 'this subject';
  const topicScope = topic
    ? `You are scoped ONLY to the topic: "${topic}". Only answer questions about "${topic}". If the student asks about something unrelated, gently redirect them back to "${topic}".`
    : '';
  const ageGuardrails = getAgeGuardrails(grade);
  const hasContext = context && context.trim().length > 0;
  const recentHistory = normalizeHistory(history);
  const mathMode = isMathMode({ question, subject, topic, history: recentHistory });
  const historyBlock = recentHistory.length
    ? recentHistory
      .map((m) => `${m.role === 'user' ? 'Student' : 'Coach'}: ${m.text}`)
      .join('\n')
    : '';

  const noContextRules = topic
    ? `Curriculum content is not available right now.
- You may still help using simple, child-safe explanations ONLY about "${topic}".
- Do not switch to a different concept.
- If uncertain, say "Let's stay with ${topic} and solve it step by step."`
    : `Curriculum content is not available right now.
- Use safe, age-appropriate tutoring.
- Keep to the student's latest concept from the conversation.`;

  const sourceRules = hasContext
    ? `Use ONLY the reference content below as your factual source.
- If the answer is missing from the reference content, say: "I don't know from this lesson yet."
- Ask the student to check with their teacher or ask a question from this lesson.
- Never invent facts, names, dates, formulas, or examples not in the reference content.`
    : noContextRules;

  const pedagogyRules = mathMode
    ? `Math teaching format (mandatory):
- Use child-friendly math language.
- Give 1-line meaning first.
- Then give exactly one worked example using clear steps:
  Step 1:
  Step 2:
  Answer:
- Then give one tiny practice question in the same concept.
- Stay in the same math concept as the student's question/follow-up.
- Do NOT switch to another concept unless student clearly asks for it.`
    : `Follow conversation continuity rules:
- If the student asks a short follow-up (for example "more examples"), continue the same concept from recent conversation.
- Do not switch to a new concept unless the student clearly asks for a new topic.`;

  const systemPrompt = `You are a friendly Aivorah AI Coach helping IB PYP ${gradeLabel} students learn ${subjectLabel}.
${topicScope}
${ageGuardrails}
${sourceRules}
${pedagogyRules}
Keep your answers:
- Clear and simple (age-appropriate for ${gradeLabel})
- Encouraging and positive
- Focused on understanding, not just facts
- Concise
- Plain text only (no markdown, no **, no bullet symbols, no headings)`;

  const contextBlock = hasContext ? `Curriculum Content:\n${context}\n\n` : '';
  const userPrompt = `${contextBlock}${historyBlock ? `Recent Conversation:\n${historyBlock}\n\n` : ''}Student's Question: ${question}`;

  return { hasContext, mathMode, systemPrompt, userPrompt };
}

async function generateAnswer({ question, context, grade, subject, topic, history }) {
  const { hasContext, systemPrompt, userPrompt } = buildPrompts({ question, context, grade, subject, topic, history });

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 512,
  });

  return response.choices?.[0]?.message?.content || '';
}

/**
 * Stream answer token-by-token via callback.
 * Returns the full assembled text when done.
 */
async function generateAnswerStream({ question, context, grade, subject, topic, history, onToken }) {
  const { hasContext, systemPrompt, userPrompt } = buildPrompts({ question, context, grade, subject, topic, history });

  const stream = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 512,
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
