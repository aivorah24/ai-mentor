// NVIDIA NIM API — OpenAI-compatible
// Free tier: https://build.nvidia.com/
// Models: meta/llama-3.1-8b-instruct, meta/llama-3.1-70b-instruct, nvidia/llama-3.1-nemotron-70b-instruct

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = 'meta/llama-3.1-8b-instruct'; // Free tier model

const SYSTEM_PROMPT = `You are Aivorah — a friendly, encouraging, and knowledgeable learning assistant for students.
Your role is to:
- Explain academic concepts clearly with examples
- Help students understand difficult topics in Mathematics, Science, English, and History
- Create personalized study plans
- Give motivational support and boost confidence
- Answer homework questions with step-by-step guidance
- Suggest practice problems and quizzes

Keep your responses concise (2-4 short paragraphs max), student-friendly, and encouraging.
Use numbered steps when explaining processes. Avoid overly technical jargon unless necessary.
If a student is struggling, acknowledge their effort first before explaining.`;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface NvidiaResponse {
  text: string;
  error?: string;
}

export async function sendMessageToNvidia(
  messages: ChatMessage[],
  apiKey: string
): Promise<NvidiaResponse> {
  if (!apiKey || apiKey.includes('PASTE_YOUR_KEY')) {
    return { text: '', error: 'API key not configured. Please add your NVIDIA API key to the .env file.' };
  }

  const payload = {
    model: NVIDIA_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ],
    temperature: 0.6,
    top_p: 0.95,
    max_tokens: 512,
    stream: false,
  };

  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      if (response.status === 401) return { text: '', error: 'Invalid API key. Check your NVIDIA API key.' };
      if (response.status === 429) return { text: '', error: 'Rate limit reached. Please wait a moment and try again.' };
      return { text: '', error: `API error ${response.status}: ${errorBody.slice(0, 100)}` };
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (!text) return { text: '', error: 'Empty response from AI. Please try again.' };
    return { text };
  } catch (err: any) {
    if (err?.message?.includes('Network')) {
      return { text: '', error: 'Network error. Check your internet connection.' };
    }
    return { text: '', error: 'Failed to reach AI service. Please try again.' };
  }
}
