import SERVER_URL from '../config/serverUrl';

export interface AskResponse {
  answer: string;
  sources: { subject: string; unit: string; topic: string; score: number }[];
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant' | 'ai';
  text: string;
}

export async function askAIMentor(
  question: string,
  grade?: string,
  subject?: string,
  curriculum = 'IB_PYP',
  topic?: string,
  userEmail?: string,
  role?: string,
  history?: ChatHistoryTurn[],
): Promise<{ answer: string; sources: AskResponse['sources']; error?: string }> {
  try {
    const payload: any = { question, curriculum, grade, subject, topic, userEmail, role };
    if (history && history.length > 0) payload.history = history;

    const response = await fetch(`${SERVER_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const data: AskResponse = await response.json();
    return { answer: data.answer, sources: data.sources };
  } catch (err: any) {
    return {
      answer: '',
      sources: [],
      error: 'Could not connect to Aivorah. Make sure the server is running.',
    };
  }
}

/**
 * Stream AI response token-by-token via SSE.
 * Calls onToken for each chunk so the UI updates in real-time.
 */
export async function askAIMentorStream(
  question: string,
  grade?: string,
  subject?: string,
  curriculum?: string,
  topic?: string,
  userEmail?: string,
  role?: string,
  history?: ChatHistoryTurn[],
  onToken?: (token: string) => void,
): Promise<{ answer: string; sources: AskResponse['sources']; error?: string }> {
  try {
    const payload: any = {
      question,
      curriculum: curriculum || 'IB_PYP',
      grade,
      subject,
      topic,
      userEmail,
      role,
    };
    if (history && history.length > 0) payload.history = history;

    const response = await fetch(`${SERVER_URL}/ask/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Streaming not supported');

    const decoder = new TextDecoder();
    let fullAnswer = '';
    let sources: AskResponse['sources'] = [];
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'token') {
            fullAnswer += data.token;
            onToken?.(data.token);
          } else if (data.type === 'sources') {
            sources = data.sources || [];
          } else if (data.type === 'error') {
            return { answer: '', sources: [], error: data.error };
          }
        } catch {}
      }
    }

    return { answer: fullAnswer, sources };
  } catch (err: any) {
    return {
      answer: '',
      sources: [],
      error: 'Could not connect to Aivorah. Make sure the server is running.',
    };
  }
}
