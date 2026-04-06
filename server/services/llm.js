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

  const systemPrompt = `You are a friendly Aivorah AI Coach helping IB PYP ${gradeLabel} students learn ${subjectLabel}.
${topicScope}
${ageGuardrails}
Answer questions using ONLY the provided curriculum content below.
Keep your answers:
- Clear and simple (age-appropriate for ${gradeLabel})
- Encouraging and positive
- Focused on understanding, not just facts
- Concise (3-5 sentences max)
If you don't have enough context to answer, say so honestly and suggest asking a teacher.`;

  const userPrompt = `Curriculum Content:\n${context}\n\nStudent's Question: ${question}`;

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

module.exports = { generateAnswer };
