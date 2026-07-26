export class OutputValidator {
  parseAndValidate(rawResponse: string, agentConfigPath: string): any {
    let parsed: any;
    try {
      // Basic JSON extraction (in case LLM wraps in markdown ```json)
      const jsonMatch = rawResponse.match(/```(?:json)?\n([\s\S]*?)\n```/);
      const jsonString = jsonMatch ? jsonMatch[1] : rawResponse;
      
      parsed = JSON.parse(jsonString.trim());
    } catch (e: any) {
      throw new Error(`Output is not valid JSON: ${e.message}`);
    }

    // 1. Schema Validation (Base Package Envelope)
    if (!parsed.package || !parsed.package.package_id || !parsed.package.package_type) {
      throw new Error("Missing Base Package Schema envelope (package_id, package_type)");
    }
    
    if (!parsed.payload) {
      throw new Error("Missing payload object");
    }

    // 2. Agent-Specific Validation could be injected here based on agentConfigPath
    // e.g. Zod schema validation matching the expected package_type
    
    return parsed;
  }
}
