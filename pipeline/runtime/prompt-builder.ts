import * as fs from 'fs';
import * as path from 'path';

export class PromptBuilder {
  build(agentConfigPath: string, inputPackage: any): { systemPrompt: string, userPrompt: string } {
    // Agents live at <repoRoot>/.claude/agents — the repo root is three levels
    // up from pipeline/runtime/ (../../.. = Aivorah/), not two.
    const CLAUDE_DIR = path.resolve(__dirname, '../../../.claude');
    const agentMarkdown = fs.readFileSync(path.resolve(CLAUDE_DIR, agentConfigPath), 'utf-8');

    // Only include Base Envelope and PASS/FAIL enums to save tokens.
    // Downstream agents will rely on the payload structure explicitly defined in their markdown.
    const contracts = fs.readFileSync(path.resolve(CLAUDE_DIR, 'agents/shared/contracts.md'), 'utf-8');
    
    // Extract base envelope schema (Section 1) and Common Enums to reduce prompt size
    const baseEnvelopeMatch = contracts.match(/## 1\. Base Package Schema \(Envelope\)[\s\S]*?(?=## 2\.)/);
    const baseEnvelope = baseEnvelopeMatch ? baseEnvelopeMatch[0] : '';
    
    const systemPrompt = `
You are an Aivorah Pipeline Agent.
Follow your specific instructions below.

<AGENT_INSTRUCTIONS>
${agentMarkdown}
</AGENT_INSTRUCTIONS>

<REQUIRED_ENVELOPE>
${baseEnvelope}
</REQUIRED_ENVELOPE>

CRITICAL INSTRUCTIONS:
1. You MUST output ONLY a valid JSON package wrapped in the Base Package Schema.
2. DO NOT output any conversational text, markdown formatting like \`\`\`json, or explanations. 
3. Your entire response MUST parse via JSON.parse().
    `.trim();

    const userPrompt = `
Here is your input package:
<INPUT_PACKAGE>
${JSON.stringify(inputPackage, null, 2)}
</INPUT_PACKAGE>

Generate your output package now.
    `.trim();

    return { systemPrompt, userPrompt };
  }
}
