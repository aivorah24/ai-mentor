export interface LogEntry {
  pipelineId: string;
  timestamp: string;
  agent: string;
  inputPackageId?: string;
  outputPackageId?: string;
  executionTimeMs: number;
  status: 'PASS' | 'FAIL' | 'ERROR';
  retryCount: number;
  errorCodes?: string[];
}

export class PipelineLogger {
  private logs: LogEntry[] = [];

  log(entry: LogEntry) {
    this.logs.push(entry);
    console.log(`[${entry.timestamp}] [${entry.agent}] Status: ${entry.status} | Execution Time: ${entry.executionTimeMs}ms`);
    if (entry.errorCodes && entry.errorCodes.length > 0) {
      console.warn(`  Errors: ${entry.errorCodes.join(', ')}`);
    }
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }
}
