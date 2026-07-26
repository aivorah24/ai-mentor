// Gemini caller for the quality-critical pipeline agents (Lesson Generator,
// Teacher Review). Gemini 2.5 Flash produces correct, standard-method pedagogy
// (verified: proper column borrowing) that the free open models don't — while
// staying very cheap (~₹1–2 per run). Only the agents that need this reasoning
// are routed here; everything else uses the free chain to keep spend minimal.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../server/.env') });

const GEMINI_MODEL = 'gemini-2.5-flash';

function collectGeminiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  return [...new Set(keys.map(k => k.trim()).filter(Boolean).filter(k => !k.startsWith('your')))];
}

const GEMINI_KEYS = collectGeminiKeys();

export function hasGemini(): boolean {
  return GEMINI_KEYS.length > 0;
}

/**
 * Call Gemini and return parsed JSON. Rotates across keys on rate-limit (429).
 */
export async function callGemini(system: string, user: string): Promise<any> {
  if (GEMINI_KEYS.length === 0) throw new Error('No GEMINI_API_KEY configured.');
  let lastErr: any = null;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.2,
      response_mime_type: 'application/json', // force valid JSON
      maxOutputTokens: 8192,
    },
  });

  // Try each key; on 429 (free-tier per-minute limit) back off and retry the
  // SAME key a few times before moving on — the limit resets on a ~minute clock,
  // so waiting is what actually clears it (rotating a single key does nothing).
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEYS[i]}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 120000);
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal });
        clearTimeout(to);
        if (res.status === 429) {
          const wait = 15000 * (attempt + 1); // 15s, 30s, 45s, 60s…
          console.log(`   [gemini] 429 rate-limit — waiting ${wait / 1000}s (attempt ${attempt + 1})`);
          lastErr = new Error('gemini 429');
          await sleep(wait);
          continue;
        }
        if (!res.ok) { lastErr = new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160)}`); break; }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
        if (!text) { lastErr = new Error('gemini empty'); break; }
        try { return JSON.parse(text); } catch {
          const m = text.match(/\{[\s\S]*\}/);
          if (m) { try { return JSON.parse(m[0]); } catch {} }
          lastErr = new Error('gemini non-JSON'); break;
        }
      } catch (e: any) { lastErr = e; break; }
    }
  }
  throw lastErr || new Error('all Gemini keys failed');
}
