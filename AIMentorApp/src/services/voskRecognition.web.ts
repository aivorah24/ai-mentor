// Vosk (offline, on-device) speech recognition for the web — the same approach
// Google Read Along uses: an on-device recognizer constrained to the KNOWN
// passage words, so it can't drift to out-of-passage words like Web Speech does.
//
// We dynamically import `vosk-browser` so the package (WASM + worker) is only
// pulled in on the web bundle. The model (~40MB) is loaded once and cached.

export type VoskWordsHandler = (spokenWords: string[]) => void;

// Where the model tar.gz is served from. Place the file at
//   AIMentorApp/public/models/vosk-model-small-en-in-0.4.tar.gz
// (Expo copies /public to the web root, so it is served at this URL.)
// Indian-English model (en-in) — the pilot is a Hyderabad school, and the US
// model (en-us) systematically under-scored confidence for Indian-accented
// children, marking correctly-read words (e.g. "very") as mispronounced. The
// accent-matched model calibrates confidence to the actual speakers.
const DEFAULT_MODEL_URL = '/models/vosk-model-small-en-in-0.4.tar.gz';

let modelPromise: Promise<any> | null = null;
let model: any = null;

let recognizer: any = null;
let audioContext: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let workletNode: AudioWorkletNode | null = null;
let workletUrl: string | null = null;
let source: MediaStreamAudioSourceNode | null = null;

// AudioWorklet processor source (runs on the dedicated audio thread, NOT the
// main/UI thread — unlike the deprecated ScriptProcessorNode). It buffers the
// 128-sample render quanta into ~2048-sample chunks and posts them to the main
// thread, where they're fed to Vosk. Capturing off the UI thread is what makes
// the highlight stay smooth while React re-renders on every word — the key
// Google-Read-Along smoothness property.
// 512 samples @ 16kHz ≈ 32ms per chunk — low latency so Vosk emits partials
// promptly and the highlight keeps pace with a fast reader. (At 16kHz a larger
// 2048 chunk would be 128ms of buffering — too laggy.)
const VOSK_WORKLET_SRC = `
class VoskCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(512); this._n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this._buf[this._n++] = ch[i];
        if (this._n >= this._buf.length) { this.port.postMessage(this._buf.slice(0)); this._n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('vosk-capture', VoskCaptureProcessor);
`;

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

// Build a Vosk grammar from the passage plus common English distractors/substitutes
// so recognition is constrained cleanly without forcing substituted words to snap to passage words.
function buildGrammar(grammarWords: string[]): string {
  const COMMON_DISTRACTORS = [
    "sometimes", "something", "someone", "somewhere", "everyday", "everyone", "everything", "everywhere",
    "went", "want", "what", "when", "where", "were", "three", "there", "their", "them", "then", "they",
    "this", "that", "look", "took", "book", "good", "food", "make", "made", "came", "come", "time",
    "some", "same", "read", "red", "said", "see", "saw", "house", "horse", "play", "place", "people",
    "water", "world", "word", "work", "little", "large", "long", "like", "live", "love", "know", "new",
    "now", "own", "one", "two", "too", "for", "from", "first", "find", "give", "get", "go", "going",
    "have", "has", "had", "here", "hear", "how", "just", "much", "many", "most", "more", "may", "my",
    "out", "our", "other", "only", "or", "on", "in", "up", "upon", "over", "under", "around", "about",
    "before", "after", "again", "against", "also", "any", "ask", "away", "because", "between", "both",
    "by", "call", "could", "would", "should", "can", "did", "does", "down", "each", "even", "every",
    "feel", "few", "great", "help", "her", "his", "him", "into", "its", "keep", "kind", "let", "life",
    "man", "men", "might", "never", "next", "night", "old", "part", "put", "right", "say", "she", "he",
    "so", "still", "take", "tell", "than", "think", "thought", "through", "together", "try", "turn",
    "us", "use", "very", "way", "well", "which", "while", "who", "why", "will", "with", "year", "you", "your",
    "morning", "evening", "afternoon", "butterflies", "caterpillar", "sunflower", "beautiful", "different",
    "important", "animal", "animals", "children", "child", "school", "friend", "friends", "family", "story"
  ];
  const unique = Array.from(
    new Set(
      [...grammarWords, ...COMMON_DISTRACTORS]
        .map((w) => w.toLowerCase().replace(/[^a-z']/g, ''))
        .filter((w) => w.length > 0)
    )
  );
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

    // Vosk models are trained at 16kHz. Running the graph at the mic's native
    // 48kHz meant Vosk resampled every frame internally (extra latency) and saw
    // audio that had been down-then-up sampled — worse acoustic match. Ask the
    // AudioContext for 16kHz directly so the mic is resampled ONCE, up front, by
    // the browser's high-quality resampler, and Vosk gets exactly what it expects.
    try {
      audioContext = new AudioContext({ sampleRate: 16000 });
    } catch {
      audioContext = new AudioContext(); // older browsers: fall back to native rate
    }
    const grammar = buildGrammar(grammarWords);
    // Recognizer is told the ACTUAL context rate (16000 when honoured).
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

    // Confidence threshold below which a grammar-forced word is treated as a
    // likely mispronunciation rather than a clean match. Lowered 0.60 → 0.40:
    // at 0.60 many correctly-read words tripped it (false reds); 0.40 only flags
    // words the recognizer is genuinely unsure about, alongside the accent-matched
    // en-in model above which raises baseline confidence for our real speakers.
    const LOW_CONF_THRESHOLD = 0.40;

    // Final results carry per-word confidence (`result.result[].conf`) — swap
    // any low-confidence word for the ⍰ sentinel so the matcher flags it as
    // misread, same as a true [unk]. Partial results don't carry confidence.
    const emitFinal = (message: any) => {
      const r = message?.result;
      const wordList: Array<{ word: string; conf?: number }> | undefined = r?.result;
      if (Array.isArray(wordList) && wordList.length) {
        const words: string[] = [];
        for (const w of wordList) {
          const cleaned = String(w.word || '').toLowerCase().replace(/[^a-z']/g, '');
          if (!cleaned || cleaned === '[unk]') { words.push('⍰'); continue; }
          words.push(typeof w.conf === 'number' && w.conf < LOW_CONF_THRESHOLD ? '⍰' : cleaned);
        }
        if (words.length) onWords(words);
        return;
      }
      if (r?.text) emit(r.text);
    };

    // Partial results fire continuously as the child speaks — this drives the
    // live highlight (no confidence available yet).
    recognizer.on('partialresult', (message: any) => {
      const partial = message?.result?.partial;
      if (partial) emit(partial);
    });
    recognizer.on('result', emitFinal);

    source = audioContext.createMediaStreamSource(stream);
    const ctxRate = audioContext.sampleRate;

    // Feed a chunk of mono PCM to Vosk by wrapping it in an AudioBuffer (what
    // KaldiRecognizer.acceptWaveform expects). Shared by both capture paths.
    const feed = (samples: Float32Array) => {
      if (!recognizer || !audioContext) return;
      try {
        const buf = audioContext.createBuffer(1, samples.length, ctxRate);
        buf.copyToChannel(samples, 0);
        recognizer.acceptWaveform(buf);
      } catch {
        // transient — ignore individual frame failures
      }
    };

    // ── PRIMARY: AudioWorklet (audio-thread capture, no main-thread jank) ──
    let usingWorklet = false;
    if (audioContext.audioWorklet) {
      try {
        const blob = new Blob([VOSK_WORKLET_SRC], { type: 'application/javascript' });
        workletUrl = URL.createObjectURL(blob);
        await audioContext.audioWorklet.addModule(workletUrl);
        workletNode = new AudioWorkletNode(audioContext, 'vosk-capture');
        workletNode.port.onmessage = (e: MessageEvent) => feed(e.data as Float32Array);
        source.connect(workletNode);
        // Silent sink so the graph is pulled without echoing the mic back.
        const sink = audioContext.createGain();
        sink.gain.value = 0;
        workletNode.connect(sink);
        sink.connect(audioContext.destination);
        usingWorklet = true;
        console.log('[Vosk] capture via AudioWorklet (off main thread)');
      } catch (werr) {
        console.warn('[Vosk] AudioWorklet unavailable, falling back to ScriptProcessor:', werr);
        if (workletNode) { try { workletNode.disconnect(); } catch {} workletNode = null; }
      }
    }

    // ── FALLBACK: ScriptProcessorNode (deprecated, main-thread) ──
    if (!usingWorklet) {
      // 1024 @ 16kHz ≈ 64ms (ScriptProcessor min power-of-two that stays stable).
      processor = audioContext.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!recognizer) return;
        try { recognizer.acceptWaveform(event.inputBuffer); } catch {}
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      console.log('[Vosk] capture via ScriptProcessor (fallback)');
    }

    console.log('[Vosk] recognition started (grammar-constrained to passage)');
    return true;
  } catch (err) {
    console.warn('[Vosk] start failed:', err);
    stopVoskRecognition();
    return false;
  }
}

export function stopVoskRecognition(): void {
  if (workletNode) {
    try { workletNode.port.onmessage = null; } catch {}
    try { workletNode.disconnect(); } catch {}
    workletNode = null;
  }
  if (workletUrl) {
    try { URL.revokeObjectURL(workletUrl); } catch {}
    workletUrl = null;
  }
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
