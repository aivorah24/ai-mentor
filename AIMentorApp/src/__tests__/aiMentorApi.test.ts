/**
 * Unit Tests — aiMentorApi.ts
 * Tests the /ask endpoint integration and response handling.
 */

import { askAIMentor } from '../services/aiMentorApi';

const SERVER_URL = 'http://localhost:3001';

// Mock global fetch
global.fetch = jest.fn();

function mockFetch(data: object, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: async () => data,
  });
}

describe('askAIMentor()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns answer and sources on success', async () => {
    mockFetch({
      answer: 'Addition is combining two numbers.',
      sources: [{ subject: 'Mathematics', unit: 'Number', topic: 'Addition', score: 0.92 }],
    });

    const result = await askAIMentor('What is addition?', 'Grade 3', 'Mathematics');

    expect(result.answer).toBe('Addition is combining two numbers.');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].topic).toBe('Addition');
    expect(result.error).toBeUndefined();
  });

  it('calls the correct endpoint with right payload', async () => {
    mockFetch({ answer: 'Test', sources: [] });

    await askAIMentor('What is subtraction?', 'Grade 3', 'Mathematics', 'NCERT');

    expect(global.fetch).toHaveBeenCalledWith(
      `${SERVER_URL}/ask`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'What is subtraction?',
          curriculum: 'NCERT',
          grade: 'Grade 3',
          subject: 'Mathematics',
        }),
      })
    );
  });

  it('returns error message when server returns non-ok status', async () => {
    mockFetch({ error: 'Internal server error' }, false, 500);

    const result = await askAIMentor('What is fractions?');

    expect(result.answer).toBe('');
    expect(result.sources).toHaveLength(0);
    expect(result.error).toBe('Could not connect to Aivorah. Make sure the server is running.');
  });

  it('returns error message when fetch throws (network failure)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await askAIMentor('What is geometry?');

    expect(result.error).toBe('Could not connect to Aivorah. Make sure the server is running.');
  });

  it('uses IB_PYP as default curriculum', async () => {
    mockFetch({ answer: 'Test', sources: [] });

    await askAIMentor('What is place value?', 'Grade 3');

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.curriculum).toBe('IB_PYP');
  });
});
