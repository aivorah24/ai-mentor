const supabase = require('./supabase');

// ── Cost per million tokens (USD) ──────────────────────────────────────────
const PRICING = {
  // Groq models
  'llama-3.3-70b-versatile':  { input: 0.59, output: 0.79 },
  'llama-3.1-70b-versatile':  { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant':     { input: 0.05, output: 0.08 },
  'llama-3.2-3b-preview':     { input: 0.06, output: 0.06 },
  'mixtral-8x7b-32768':       { input: 0.24, output: 0.24 },
  // NVIDIA NIM
  'mistralai/mistral-small-4-119b-2603': { input: 0.10, output: 0.10 },
  'mistralai/mistral-7b-instruct-v0.3':  { input: 0.08, output: 0.08 },
};

function estimateCost(model, promptTokens, completionTokens) {
  const price = PRICING[model];
  if (!price) return 0;
  const inputCost  = (promptTokens  / 1_000_000) * price.input;
  const outputCost = (completionTokens / 1_000_000) * price.output;
  return parseFloat((inputCost + outputCost).toFixed(6));
}

/**
 * Log a single LLM call to Supabase.
 * Non-blocking — fires and forgets, never throws.
 */
async function logLLMCall({
  provider,
  model,
  route,
  studentEmail,
  grade,
  subject,
  topic,
  promptTokens,
  completionTokens,
  responseTimeMs,
  streamed = false,
}) {
  try {
    const totalTokens = (promptTokens || 0) + (completionTokens || 0);
    const estimatedCost = estimateCost(model, promptTokens || 0, completionTokens || 0);

    await supabase.from('llm_logs').insert({
      provider,
      model,
      route:              route || null,
      student_email:      studentEmail || null,
      grade:              grade || null,
      subject:            subject || null,
      topic:              topic || null,
      prompt_tokens:      promptTokens || 0,
      completion_tokens:  completionTokens || 0,
      total_tokens:       totalTokens,
      estimated_cost_usd: estimatedCost,
      response_time_ms:   responseTimeMs || 0,
      streamed,
    });
  } catch (err) {
    // Silent — never break the main request flow
    console.warn('[TokenLogger] Failed to log:', err.message);
  }
}

/**
 * Save student feedback (1/2/3) to an existing log row.
 * Called when student rates a session.
 */
async function saveFeedback(logId, rating) {
  try {
    await supabase.from('llm_logs').update({ feedback: rating }).eq('id', logId);
  } catch (err) {
    console.warn('[TokenLogger] Failed to save feedback:', err.message);
  }
}

/**
 * Get aggregated stats for admin dashboard.
 */
async function getStats({ days = 7 } = {}) {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase
      .from('llm_logs')
      .select('model, provider, route, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, response_time_ms, feedback, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[TokenLogger] Failed to get stats:', err.message);
    return [];
  }
}

module.exports = { logLLMCall, saveFeedback, getStats, estimateCost };
