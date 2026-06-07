// Vosk (offline, on-device) speech recognition for the web — the same approach
// Google Read Along uses: an on-device recognizer constrained to the KNOWN
// passage words, so it can't drift to out-of-passage words like Web Speech does.
//
// We dynamically import `vosk-browser` so the package (WASM + worker) is only
// pulled in on the web bundle. The model (~40MB) is loaded once and cached.

export type VoskWordsHandler = (spokenWords: string[]) => void;

// Where the model tar.gz is served from. Place the file at
//   AIMentorApp/public/models/vosk-model-small-en-us-0.15.tar.gz
// (Expo copies /public to the web root, so it is served at this URL.)
const DEFAULT_MODEL_URL = '/models/vosk-model-small-en-us-0.15.tar.gz';

let modelPromise: Promise<any> | null = null;
let model: any = null;

let recognizer: any = null;
let audioContext: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;

export function isVoskSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).WebAssembly !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

export function isVoskModelReady(): boolean {
  return model !== null;
}

// Load (and cache) the Vosk model. Safe to call repeatedly — only loads once.
export async function loadVoskModel(modelUrl: string = DEFAULT_MODEL_URL): Promise<boolean> {
  if (model) return true;
  if (!isVoskSupported()) return false;
  if (!modelPromise) {
    modelPromise = (async () => {
      const vosk = await import('vosk-browser');
      console.log('[Vosk] loading model:', modelUrl);
      const m = await vosk.createModel(modelUrl);
      console.log('[Vosk] model ready');
      return m;
    })();
  }
  try {
    model = await modelPromise;
    return true;
  } catch (err) {
    console.warn('[Vosk] model load failed:', err);
    modelPromise = null;
    return false;
  }
}

// Build a Vosk grammar from the passage so recognition is constrained to the
// words that actually appear in it (plus [unk] to absorb everything else).
function buildGrammar(grammarWords: string[]): string {
  const unique = Array.from(
    new Set(
      grammarWords
        .map((w) => w.toLowerCase().replace(/[^a-z']/g, ''))
        .filter((w) => w.length > 0)
    )
  );
  // "[unk]" lets the recognizer emit an unknown token for anything off-script
  // instead of forcing a wrong in-grammar match.
  return JSON.stringify([...unique, '[unk]']);
}

export async function startVoskRecognition(opts: {
  stream: MediaStream;
  grammarWords: string[];
  onWords: VoskWordsHandler;
}): Promise<boolean> {
  const { stream, grammarWords, onWords } = opts;
  if (!isVoskSupported()) return false;

  const ok = await loadVoskModel();
  if (!ok || !model) return false;

  try {
    stopVoskRecognition(); // ensure clean slate

    audioContext = new AudioContext();
    const grammar = buildGrammar(grammarWords);
    // Recognizer is told the INPUT sample rate (the AudioContext rate); it
    // resamples to the model rate internally.
    recognizer = new model.KaldiRecognizer(audioContext.sampleRate, grammar);
    recognizer.setWords(true);

    const emit = (text: string) => {
      // Preserve Vosk's [unk] token (off-script speech = likely mispronunciation)
      // as a sentinel (⍰) so the matcher can flag it; strip other punctuation.
      const cleaned = text.toLowerCase()
        .replace(/\[unk\]/g, ' ⍰ ')
        .replace(/[^a-z'\s⍰]/g, ' ');
      const words = cleaned.trim().split(/\s+/).filter(Boolean);
      if (words.length) onWords(words);
    };

    // Partial results fire continuously as the child speaks — this drives the
    // live highlight. Final results refine but we treat them the same.
    recognizer.on('partialresult', (message: any) => {
      const partial = message?.result?.partial;
      if (partial) emit(partial);
    });
    recognizer.on('result', (message: any) => {
      const text = message?.result?.text;
      if (text) emit(text);
    });

    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!recognizer) return;
      try {
        recognizer.acceptWaveform(event.inputBuffer);
      } catch (err) {
        // transient — ignore individual frame failures
      }
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    console.log('[Vosk] recognition started (grammar-constrained to passage)');
    return true;
  } catch (err) {
    console.warn('[Vosk] start failed:', err);
    stopVoskRecognition();
    return false;
  }
}

export function stopVoskRecognition(): void {
  if (processor) {
    try { processor.disconnect(); } catch {}
    processor.onaudioprocess = null as any;
    processor = null;
  }
  if (source) {
    try { source.disconnect(); } catch {}
    source = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch {}
    audioContext = null;
  }
  if (recognizer) {
    try { recognizer.remove(); } catch {}
    recognizer = null;
  }
}
