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

async function generateAnswer({ question, context, grade, subject, topic }) {
  const gradeLabel = grade || 'primary school';
  const subjectLabel = subject || 'this subject';
  const topicScope = topic
    ? `You are scoped ONLY to the topic: "${topic}". Only answer questions about "${topic}". If the student asks about something unrelated, gently redirect them back to "${topic}".`
    : '';
  const ageGuardrails = getAgeGuardrails(grade);

  const hasContext = context && context.trim().length > 0;

  const systemPrompt = `You are a friendly Aivorah AI Coach helping IB PYP ${gradeLabel} students learn ${subjectLabel}.
${topicScope}
${ageGuardrails}
${hasContext
    ? 'Use the curriculum content below to answer the student\'s question.'
    : 'Answer from your knowledge as a patient, encouraging tutor. Be accurate and age-appropriate.'}
Keep your answers:
- Clear and simple (age-appropriate for ${gradeLabel})
- Encouraging and positive
- Focused on understanding, not just facts
- Concise (3-5 sentences max)`;

  const userPrompt = hasContext
    ? `Curriculum Content:\n${context}\n\nStudent's Question: ${question}`
    : `Student's Question: ${question}`;

  const response = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 512,
  });

  return response.choices[0].message.content;
}

/**
 * Stream answer token-by-token via callback.
 * Returns the full assembled text when done.
 */
async function generateAnswerStream({ question, context, grade, subject, topic, onToken }) {
  const gradeLabel = grade || 'primary school';
  const subjectLabel = subject || 'this subject';
  const topicScope = topic
    ? `You are scoped ONLY to the topic: "${topic}". Only answer questions about "${topic}". If the student asks about something unrelated, gently redirect them back to "${topic}".`
    : '';
  const ageGuardrails = getAgeGuardrails(grade);

  const hasContext = context && context.trim().length > 0;

  const systemPrompt = `You are a friendly Aivorah AI Coach helping IB PYP ${gradeLabel} students learn ${subjectLabel}.
${topicScope}
${ageGuardrails}
${hasContext
    ? 'Use the curriculum content below to answer the student\'s question.'
    : 'Answer from your knowledge as a patient, encouraging tutor. Be accurate and age-appropriate.'}
Keep your answers:
- Clear and simple (age-appropriate for ${gradeLabel})
- Encouraging and positive
- Focused on understanding, not just facts
- Concise (3-5 sentences max)`;

  const userPrompt = hasContext
    ? `Curriculum Content:\n${context}\n\nStudent's Question: ${question}`
    : `Student's Question: ${question}`;

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

module.exports = { generateAnswer, generateAnswerStream };
