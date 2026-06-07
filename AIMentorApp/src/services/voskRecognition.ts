// Native stub. The real implementation lives in voskRecognition.web.ts and is
// resolved by Metro/Expo only for the web platform. On native we never use
// Vosk (Read Aloud is web-only), so these are inert no-ops.

export type VoskWordsHandler = (spokenWords: string[]) => void;

export function isVoskSupported(): boolean {
  return false;
}

export async function loadVoskModel(_modelUrl?: string): Promise<boolean> {
  return false;
}

export function isVoskModelReady(): boolean {
  return false;
}

export async function startVoskRecognition(_opts: {
  stream: MediaStream;
  grammarWords: string[];
  onWords: VoskWordsHandler;
}): Promise<boolean> {
  return false;
}

export function stopVoskRecognition(): void {
  /* no-op */
}
