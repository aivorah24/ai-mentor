/**
 * callLLM.js — shared, provider-agnostic LLM caller for the Curriculum
 * Intelligence pipeline. Extracted from scripts/generate-chapter-subject-content.js
 * so every agent imports ONE rotation chain instead of re-implementing it.
 *
 * Chain: OpenRouter (free models) -> Groq -> NVIDIA NIM. NEVER Grok/Gemini.
 * Numbered env keys (OPENROUTER_API_KEY_1.., GROQ_API_KEY_1.., NVIDIA_NIM_API_KEY_1..)
 * are all collected + deduped so multiple free Gmail accounts defeat per-key
 * daily caps. For each model we try every account key before dropping to a
 * weaker model. On 429/quota we rotate; on short rate-limits we back off + retry.
 *
 * Exposes callLLM(system, user, { json }) -> parsed JSON (default) or raw string.
 */
require('dotenv').config();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

function collectKeys(prefix) {
  const keys = [];
  if (process.env[prefix]) keys.push(process.env[prefix]);
  for (let i = 1; i <= 30; i++) {
    const v = process.env[`${prefix}_${i}`];
    if (v) keys.push(v);
  }
  return [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
}

const GROQ_KEYS = collectKeys('GROQ_API_KEY');
const OPENROUTER_KEYS = collectKeys('OPENROUTER_API_KEY');
const NVIDIA_KEYS = collectKeys('NVIDIA_NIM_API_KEY');

const OPENROUTER_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
];
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'deepseek-r1-distill-llama-70b',
  'gemma2-9b-it',
  'llama-3.1-8b-instant',
];
const NVIDIA_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'meta/llama-3.3-70b-instruct',
  'nvidia/nvidia-nemotron-nano-9b-v2',
];

function buildEndpoints(provider, models, keys) {
  const eps = [];
  for (const model of models) keys.forEach((key, i) => eps.push({ provider, model, key, keyIndex: i + 1 }));
  return eps;
}

const LLM_ENDPOINTS = [
  ...buildEndpoints('openrouter', OPENROUTER_MODELS, OPENROUTER_KEYS),
  ...buildEndpoints('groq', GROQ_MODELS, GROQ_KEYS),
  ...buildEndpoints('nvidia', NVIDIA_MODELS, NVIDIA_KEYS),
];

function keyStats() {
  return { openrouter: OPENROUTER_KEYS.length, groq: GROQ_KEYS.length, nvidia: NVIDIA_KEYS.length, endpoints: LLM_ENDPOINTS.length };
}

/**
 * @param {string} system
 * @param {string} user
 * @param {{ json?: boolean, temperature?: number }} [opts]
 * @returns {Promise<any>} parsed JSON (json!==false) or raw string
 */
async function callLLM(system, user, opts = {}) {
  const wantJson = opts.json !== false;
  if (LLM_ENDPOINTS.length === 0) throw new Error('No LLM API key set (OPENROUTER_API_KEY / GROQ_API_KEY / NVIDIA_NIM_API_KEY)');
  let lastErr;
  for (const ep of LLM_ENDPOINTS) {
    const url = ep.provider === 'groq' ? GROQ_URL : ep.provider === 'nvidia' ? NVIDIA_URL : OPENROUTER_URL;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key}` };
    if (ep.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://aivorah.app'; headers['X-Title'] = 'Aivorah Curriculum Intelligence'; }
    const payload = {
      model: ep.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: opts.temperature ?? 0.4,
    };
    if (wantJson && ep.provider !== 'nvidia') payload.response_format = { type: 'json_object' };
    if (ep.provider === 'nvidia') payload.max_tokens = 1600;
    const body = JSON.stringify(payload);
    const timeoutMs = ep.provider === 'nvidia' ? 220000 : 60000;
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), timeoutMs);
        res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
        clearTimeout(to);
      } catch (e) { lastErr = e; break; }
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) { lastErr = new Error(`${ep.model} empty content`); break; }
        if (!wantJson) return content;
        try { return JSON.parse(content); } catch (_) {
          const m = content.match(/\{[\s\S]*\}/);
          if (m) { try { return JSON.parse(m[0]); } catch (__) {} }
          lastErr = new Error(`${ep.model} non-JSON`); break;
        }
      }
      const errText = await res.text();
      if (res.status === 429) {
        if (/per day|daily|quota|free-models-per-day/i.test(errText)) { lastErr = new Error('daily quota'); break; }
        const waitMatch = errText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? parseFloat(waitMatch[1]) + 1 : 8 * (attempt + 1);
        console.log(`   [callLLM] rate limited on ${ep.model}, waiting ${waitSec.toFixed(1)}s`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        lastErr = new Error('rate limited'); continue;
      }
      if ([400, 404, 500, 502, 503, 504].includes(res.status)) { lastErr = new Error(`${ep.model} ${res.status}`); break; }
      lastErr = new Error(`${ep.provider} ${res.status}: ${errText.slice(0, 160)}`); break;
    }
  }
  throw lastErr || new Error('all LLM endpoints failed');
}

module.exports = { callLLM, keyStats, LLM_ENDPOINTS };
