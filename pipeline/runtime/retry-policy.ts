export class RetryPolicy {
  constructor(private maxRetries: number = 3) {}

  async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.maxRetries) {
      try {
        // If the operation succeeds, return the result immediately
        return await operation();
      } catch (error: any) {
        lastError = error;
        attempt++;
        if (attempt <= this.maxRetries) {
          console.warn(`[RetryPolicy] Attempt ${attempt} failed: ${error.message}. Retrying...`);
          // Exponential backoff logic could be added here
        }
      }
    }

    // If all retries fail, throw the final error
    throw new Error(`Execution failed after ${this.maxRetries} retries. Last error: ${lastError?.message}`);
  }
}
