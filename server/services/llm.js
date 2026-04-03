const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function generateAnswer({ question, context, grade, subject }) {
  const gradeLabel = grade || 'primary school';
  const subjectLabel = subject || 'this subject';

  const systemPrompt = `You are a friendly Aivorah AI Coach helping IB PYP ${gradeLabel} students learn ${subjectLabel}.
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
