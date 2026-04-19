import SERVER_URL from '../config/serverUrl';

export interface AskResponse {
  answer: string;
  sources: { subject: string; unit: string; topic: string; score: number }[];
}

export async function askAIMentor(
  question: string,
  grade?: string,
  subject?: string,
  curriculum = 'IB_PYP',
  topic?: string,
  userEmail?: string,
  role?: string,
): Promise<{ answer: string; sources: AskResponse['sources']; error?: string }> {
  try {
    const response = await fetch(`${SERVER_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, curriculum, grade, subject, topic, userEmail, role }),
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
