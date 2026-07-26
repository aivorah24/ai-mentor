import { PromptBuilder } from './prompt-builder';
import { OutputValidator } from './output-validator';
import { RetryPolicy } from './retry-policy';
import * as nodePath from 'path';

// Load the server env (OpenRouter / Groq / NVIDIA keys, incl. numbered ones)
// BEFORE requiring callLLM — it collects keys at module-load time. dotenv never
// overrides already-set vars, so this only ADDS keys.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config({ path: nodePath.resolve(__dirname, '../../server/.env') });
// Reuse the server's battle-tested, provider-agnostic caller: it tries the
// strong free models first (Nemotron 120B via OpenRouter), falls back through
// Groq 70B → NVIDIA, rotates across every account key, and NEVER uses paid
// Gemini. This replaces the weak llama-3.1-8b call that produced wrong math.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { callLLM, keyStats } = require(
  nodePath.resolve(__dirname, '../../server/services/curriculum-intelligence/callLLM')
);
import { callGemini, hasGemini } from './gemini';

// The two agents whose output QUALITY decides the lesson (correct pedagogy,
// honest review) are routed to Gemini 2.5 Flash — it does correct standard-method
// maths that the free models don't. Everything else stays on the free chain to
// keep spend minimal (~₹1–2 per run).
// Generation runs on the FREE chain; a Claude corrector subagent fixes quality
// afterward (₹0). Set GEMINI_AGENTS to a non-empty list only if you want to burn
// Gemini budget on a specific agent. Empty = fully free generation.
const GEMINI_AGENTS: string[] = [];

export class AgentRuntime {
  constructor(
    private promptBuilder: PromptBuilder,
    private outputValidator: OutputValidator,
    private retryPolicy: RetryPolicy
  ) {
    try {
      const s = keyStats();
      console.log(`[AgentRuntime] LLM chain ready — OpenRouter:${s.openrouter} Groq:${s.groq} NVIDIA:${s.nvidia} keys (${s.endpoints} endpoints).`);
    } catch { /* noop */ }
  }

  async execute(agentConfigPath: string, inputPackage: any): Promise<any> {
    const { systemPrompt, userPrompt } = this.promptBuilder.build(agentConfigPath, inputPackage);

    const useGemini = hasGemini() && GEMINI_AGENTS.some(a => agentConfigPath.includes(a));

    return await this.retryPolicy.executeWithRetry(async () => {
      let parsed: any;
      if (useGemini) {
        console.log(`[AgentRuntime] Generating ${agentConfigPath} (Gemini 2.5 Flash — quality-critical)...`);
        parsed = await callGemini(systemPrompt, userPrompt);
      } else {
        console.log(`[AgentRuntime] Generating ${agentConfigPath} (free chain)...`);
        parsed = await callLLM(systemPrompt, userPrompt, { json: true, temperature: 0.2 });
      }
      // Both return already-parsed JSON; re-stringify so the validator's envelope
      // checks run unchanged.
      return this.outputValidator.parseAndValidate(JSON.stringify(parsed), agentConfigPath);
    });
  }
}
