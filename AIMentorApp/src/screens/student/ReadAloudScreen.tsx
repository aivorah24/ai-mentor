import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';

import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Animated,
  Easing,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useStudentData } from '../../context/StudentDataContext';
import SERVER_URL from '../../config/serverUrl';
import {
  isVoskSupported,
  loadVoskModel,
  isVoskModelReady,
  startVoskRecognition,
  stopVoskRecognition,
} from '../../services/voskRecognition';

type Phase = 'pick' | 'calibration' | 'idle' | 'countdown' | 'reading' | 'preview' | 'analysing' | 'reviewing';
type WordStatus = 'pending' | 'current' | 'correct' | 'misread' | 'skipped';
type DifficultyFilter = 'all' | 'easy' | 'medium' | 'hard';

interface Passage {
  title: string;
  text: string;
  topic: string;
  level: string;
  wordCount: number;
  icon?: string;
  gradient?: [string, string];
}

interface PassageListItem {
  title: string;
  topic: string;
  level: string;
  wordCount: number;
  icon?: string;
  gradient?: [string, string];
}

interface AssessResult {
  accuracy: number;
  wcpm: number;
  wpm: number;
  totalWords: number;
  correct: number;
  misread: number;
  skipped: number;
  duration: number;
  errors: { word: string; position: number; type: string }[];
  feedback: string;
  level: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────
function splitWords(text: string): string[] {
  return text.match(/\S+/g) || [];
}

function normalize(w: string): string {
  return w.toLowerCase().replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[m][n];
}

function fuzzyMatch(spoken: string, expected: string): boolean {
  if (spoken === expected) return true;
  // Short words must match exactly — too many false positives otherwise
  // e.g., "mood"→"food" (lev=2), "from"→"food" (lev=2)
  if (expected.length <= 4) return spoken === expected;
  // Longer words allow 1 edit (typo/accent), very long allow 2
  const maxDist = expected.length >= 8 ? 2 : 1;
  return levenshtein(spoken, expected) <= maxDist;
}

// ── Word-weight model for TTS highlight sync ────────────────────────────
const FUNCTION_WORDS = new Set([
  'a','an','the','of','in','on','at','to','is','was','he','she','it','we',
  'and','but','or','not','no','do','so','be','by','up','as','if','my','me',
  'us','his','her','its','our','had','has','for','are','were','did','can',
  'may','all','one','two','any','out','with','than','that','this','from',
]);

function wordWeight(token: string): number {
  const clean = token.toLowerCase().replace(/[^a-z]/g, '');
  const vowelGroups = clean.match(/[aeiou]+/g);
  const raw = vowelGroups ? vowelGroups.length : 1;
  const silentE = clean.length > 2 && clean.endsWith('e') && !/[aeiou]/.test(clean[clean.length - 2]) ? 1 : 0;
  let syllables = Math.max(1, raw - silentE);
  if (FUNCTION_WORDS.has(clean)) syllables = Math.max(0.4, syllables * 0.7);
  if (/[.!?]/.test(token)) syllables += 1.5;
  else if (/[,;:\u2014\u2013]/.test(token)) syllables += 0.5;
  return syllables;
}

function buildWordBoundaries(words: string[]): number[] {
  const weights = words.map(w => wordWeight(w));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  return weights.map(w => { cum += w; return cum / total; });
}

// ── Level + topic colors ────────────────────────────────────────────────
const LEVEL_META: Record<string, { bg: string; text: string; label: string; border: string }> = {
  easy:   { bg: '#93B0AC20', text: '#93B0AC', label: 'Easy',   border: '#93B0AC40' },
  medium: { bg: '#C5BD9620', text: '#C5BD96', label: 'Medium', border: '#C5BD9640' },
  hard:   { bg: '#EFD1D420', text: '#EFD1D4', label: 'Hard',   border: '#EFD1D440' },
};

const RESULT_META: Record<string, { ring: string; label: string; icon: string }> = {
  excellent:        { ring: '#93B0AC', label: 'Excellent!',       icon: 'star' },
  good:             { ring: '#C3DCD8', label: 'Good Job!',        icon: 'thumbs-up' },
  developing:       { ring: '#C5BD96', label: 'Keep Going!',      icon: 'trending-up' },
  'needs-practice': { ring: '#EFD1D4', label: 'Keep Practising!', icon: 'heart' },
};

const DEFAULT_GRADIENT: [string, string] = ['#93B0AC', '#C3DCD8'];

// ═══════════════════════════════════════════════════════════════════════
export default function ReadAloudScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { stats, addXP } = useStudentData();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const screenW = Dimensions.get('window').width;
  const isWide = screenW > 700;

  const userGrade = user?.grade || (stats as any)?.grade || 'Grade 3';

  // ── State ───────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('pick');
  const [passageList, setPassageList] = useState<PassageListItem[]>([]);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [wordStatuses, setWordStatuses] = useState<WordStatus[]>([]);
  const [sourcePos, setSourcePos] = useState(0);
  const [countdownNum, setCountdownNum] = useState(3);
  const [startTime, setStartTime] = useState(0);
  const [result, setResult] = useState<AssessResult | null>(null);
  const [isListeningModel, setIsListeningModel] = useState(false);
  const [isListenPaused, setIsListenPaused] = useState(false);
  const [loadingPassage, setLoadingPassage] = useState(false);
  const [diffFilter, setDiffFilter] = useState<DifficultyFilter>('all');
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [studentLexile, setStudentLexile] = useState<number | null>(null);
  const [needsCalibration, setNeedsCalibration] = useState(false);
  const [starsEarned, setStarsEarned] = useState(0);
  const isCalibrationRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [liveSpeechStatus, setLiveSpeechStatus] = useState<'idle' | 'listening' | 'unavailable' | 'error'>('idle');
  // Vosk (on-device, passage-constrained) is the ONLY engine that gives the
  // Google-Read-Along feel — instant, accurate, no cloud round-trip. We track
  // its load state so "Start Reading" waits for it instead of silently
  // falling through to the laggy Web Speech API.
  const [voskStatus, setVoskStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [activeEngine, setActiveEngine] = useState<'vosk' | 'webspeech' | 'whisper' | null>(null);
  const [waveformBars, setWaveformBars] = useState<number[]>(new Array(24).fill(3));
  const recordingTimerRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const waveformRafRef = useRef<number>(0);
  const playbackAudioRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);
  const liveFinalTranscriptRef = useRef('');
  const liveRecognitionActiveRef = useRef(false);
  const recordedBlobRef = useRef<Blob | null>(null);
  const sourcePosRef = useRef(0);
  const wordStatusesRef = useRef<WordStatus[]>([]);
  const countdownTimer = useRef<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<ScrollView>(null);
  const wordYRef = useRef<number[]>([]); // vertical offset of each word, for auto-scroll
  const rafRef = useRef<number>(0);

  // Keep refs in sync — sourcePos only.
  // NOTE: wordStatusesRef is set explicitly wherever wordStatuses is updated
  // (loadPassage, beginRecording, sendAudioForLiveASR, tryAgain).
  // A useEffect sync would cause a race condition where the effect fires with
  // the PREVIOUS render's state, overwriting the ref with stale data.
  useEffect(() => { sourcePosRef.current = sourcePos; }, [sourcePos]);

  // ── Fetch Lexile level + passage list on mount ─────────────────────
  useEffect(() => {
    const email = user?.email;
    if (email) {
      fetch(`${SERVER_URL}/read-aloud/lexile?email=${encodeURIComponent(email)}`)
        .then(r => r.json())
        .then(data => {
          if (data.needsCalibration) {
            setNeedsCalibration(true);
            setStudentLexile(null);
          } else {
            setStudentLexile(data.lexile);
            setNeedsCalibration(false);
          }
        })
        .catch(() => {});
    }
  }, [user?.email]);

  useEffect(() => {
    const lexileParam = studentLexile != null ? `&lexile=${studentLexile}` : '';
    fetch(`${SERVER_URL}/read-aloud/passages?grade=${encodeURIComponent(userGrade)}${lexileParam}`)
      .then(r => r.json())
      .then(data => setPassageList(data.passages || []))
      .catch(() => {});
  }, [userGrade, studentLexile]);

  // ── Pulse animation while recording ────────────────────────────────
  useEffect(() => {
    if (phase !== 'reading') return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [phase]);

  // ── Cleanup mic + audio on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (waveformRafRef.current) cancelAnimationFrame(waveformRafRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
      }
      if (playbackAudioRef.current) {
        try { playbackAudioRef.current.pause(); } catch {}
      }
      if (recognitionRef.current) {
        liveRecognitionActiveRef.current = false;
        try { recognitionRef.current.stop(); } catch {}
      }
      if (liveASRTimerRef.current) clearInterval(liveASRTimerRef.current);
    };
  }, []);

  // ── Pick a passage ─────────────────────────────────────────────────
  const loadPassage = useCallback(async (title?: string) => {
    setLoadingPassage(true);
    try {
      const body: any = { grade: userGrade };
      if (title) body.topic = title;
      const res = await fetch(`${SERVER_URL}/read-aloud/passage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.text) {
        setPassage(data);
        const w = splitWords(data.text);
        setWords(w);
        const initialStatuses: WordStatus[] = new Array(w.length).fill('pending');
        setWordStatuses(initialStatuses);
        wordStatusesRef.current = initialStatuses;
        setSourcePos(0);
        setResult(null);
        setHighlightIdx(-1);
        setPhase('idle');
      }
    } catch {
      Alert.alert('Error', 'Could not load passage. Please try again.');
    }
    setLoadingPassage(false);
  }, [userGrade]);

  // ── "Listen First" — ElevenLabs audio with word-by-word highlighting ──
  const audioRef = useRef<any>(null);
  const audioTimingsRef = useRef<{ startTime: number; endTime: number }[] | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);

  const cancelHighlightLoop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
  }, []);

  const startHighlightLoop = useCallback((audio: any, timings: { startTime: number; endTime: number }[] | null, wordCount: number) => {
    cancelHighlightLoop();
    const wordBounds = timings ? null : buildWordBoundaries(splitWords(passage?.text || ''));
    let lastRendered = -1;
    function tick() {
      if (!audio || audio.paused || audio.ended) return;
      let idx: number;
      if (timings) {
        const t = audio.currentTime;
        idx = 0;
        for (let i = 0; i < timings.length; i++) {
          const wordEnd = timings[i + 1]?.startTime ?? (audio.duration + 1);
          if (t >= timings[i].startTime && t < wordEnd) { idx = i; break; }
          if (t >= timings[i].startTime) idx = i;
        }
      } else {
        if (!audio.duration) { rafRef.current = requestAnimationFrame(tick); return; }
        const LAG = 0.18;
        const t = Math.max(0, audio.currentTime - LAG);
        const ratio = t / audio.duration;
        const found = wordBounds!.findIndex(b => ratio < b);
        idx = found === -1 ? wordCount - 1 : found;
      }
      if (idx !== lastRendered) { lastRendered = idx; setHighlightIdx(idx); }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [passage, cancelHighlightLoop]);

  const listenFirst = useCallback(async () => {
    if (Platform.OS !== 'web' || !passage) return;

    // If audio is loaded and paused, just resume
    if (audioRef.current && audioRef.current.paused && audioRef.current.currentTime > 0) {
      audioRef.current.play();
      setIsListeningModel(true);
      setIsListenPaused(false);
      startHighlightLoop(audioRef.current, audioTimingsRef.current, words.length);
      return;
    }

    // Fetch audio from server (ElevenLabs)
    setAudioLoading(true);
    setIsListeningModel(true);
    setIsListenPaused(false);
    setHighlightIdx(0);

    try {
      const res = await fetch(`${SERVER_URL}/read-aloud/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: passage.text }),
      });
      const data = await res.json();
      if (!data.audioUrl) {
        setAudioLoading(false);
        setIsListeningModel(false);
        return;
      }

      const audioUrl = /^https?:\/\//i.test(data.audioUrl) ? data.audioUrl : `${SERVER_URL}${data.audioUrl}`;
      console.log('[ReadAloud] Loading audio:', audioUrl);
      const audio = new (window as any).Audio(audioUrl);
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audioRef.current = audio;
      audioTimingsRef.current = data.wordTimings || null;

      // Use loadeddata (more reliable than canplaythrough across browsers)
      const onReady = () => {
        console.log('[ReadAloud] Audio ready, duration:', audio.duration);
        setAudioLoading(false);
        audio.play().then(() => {
          startHighlightLoop(audio, data.wordTimings, words.length);
        }).catch((e: any) => {
          console.warn('[ReadAloud] Play failed:', e);
          setIsListeningModel(false);
        });
      };
      audio.addEventListener('loadeddata', onReady, { once: true });
      audio.addEventListener('ended', () => {
        cancelHighlightLoop();
        setIsListeningModel(false);
        setIsListenPaused(false);
        setHighlightIdx(-1);
      }, { once: true });
      audio.addEventListener('error', (e: any) => {
        console.error('[ReadAloud] Audio error:', e);
        cancelHighlightLoop();
        setAudioLoading(false);
        setIsListeningModel(false);
        setHighlightIdx(-1);
      }, { once: true });
      audio.load();
    } catch {
      setAudioLoading(false);
      setIsListeningModel(false);
      setHighlightIdx(-1);
    }
  }, [passage, words, startHighlightLoop, cancelHighlightLoop]);

  const pauseListening = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      cancelHighlightLoop();
      setIsListenPaused(true);
      setIsListeningModel(false);
    }
  }, [cancelHighlightLoop]);

  const resumeListening = useCallback(() => {
    if (audioRef.current && audioRef.current.paused && audioRef.current.currentTime > 0) {
      audioRef.current.play();
      setIsListenPaused(false);
      setIsListeningModel(true);
      startHighlightLoop(audioRef.current, audioTimingsRef.current, words.length);
    }
  }, [words, startHighlightLoop]);

  const stopListening = useCallback(() => {
    cancelHighlightLoop();
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {}
      audioRef.current = null;
    }
    audioTimingsRef.current = null;
    setIsListeningModel(false);
    setIsListenPaused(false);
    setHighlightIdx(-1);
    setAudioLoading(false);
  }, [cancelHighlightLoop]);

  // ── Countdown → Start Reading ──────────────────────────────────────
  const beginReadingRef = useRef<() => void>(() => {});
  const startLiveRecognitionRef = useRef<() => void>(() => {});
  const startCountdown = useCallback(() => {
    stopListening();
    setPhase('countdown');
    setCountdownNum(3);

    // Warm up the mic + recognizer DURING the countdown (not at "Go!"). Vosk's
    // VAD/recognizer needs ~200-300ms to lock onto the audio stream — starting
    // it only when reading begins clips the very first word the child says,
    // which then gets wrongly marked "skipped". Acquiring the stream ~2.4s
    // early (the 3-2-1 countdown) means it's already warm by the time they
    // speak — this is how Google Read Along avoids losing the opening word.
    if (Platform.OS === 'web' && !mediaStreamRef.current) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          mediaStreamRef.current = stream;
          // Spin up the recognizer now too — any speech caught during the
          // countdown gets wiped by beginReading()'s state reset, so starting
          // early is risk-free and guarantees the engine is hot for word one.
          startLiveRecognitionRef.current?.();
        })
        .catch((err) => console.warn('[ReadAloud] Mic warm-up failed (will retry at start):', err?.message));
    }

    let count = 3;
    countdownTimer.current = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(countdownTimer.current);
        setCountdownNum(0);
        beginReadingRef.current();
      } else {
        setCountdownNum(count);
      }
    }, 800);
  }, [stopListening]);

  // ── Refs to avoid stale closures in recorder callbacks ─────────────
  const passageRef = useRef(passage);
  useEffect(() => { passageRef.current = passage; }, [passage]);
  const wordsRef = useRef(words);
  useEffect(() => { wordsRef.current = words; }, [words]);
  const startTimeRef = useRef(startTime);
  useEffect(() => { startTimeRef.current = startTime; }, [startTime]);

  // ── Waveform visualizer loop ────────────────────────────────────────
  const startWaveform = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const BAR_COUNT = 24;

      function tick() {
        analyser.getByteFrequencyData(dataArray);
        const bars: number[] = [];
        const step = Math.floor(dataArray.length / BAR_COUNT);
        for (let i = 0; i < BAR_COUNT; i++) {
          const val = dataArray[i * step] || 0;
          bars.push(Math.max(3, (val / 255) * 40));
        }
        setWaveformBars(bars);
        waveformRafRef.current = requestAnimationFrame(tick);
      }
      waveformRafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.warn('[ReadAloud] Waveform init failed:', e);
    }
  }, []);

  const stopWaveform = useCallback(() => {
    if (waveformRafRef.current) { cancelAnimationFrame(waveformRafRef.current); waveformRafRef.current = 0; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    analyserRef.current = null;
    setWaveformBars(new Array(24).fill(3));
  }, []);

  // ── Server-side ASR: send audio snapshots to Whisper every ~3.5s ────
  const liveASRTimerRef = useRef<any>(null);
  const liveASRBusyRef = useRef(false);
  const liveASRMatchedRef = useRef(0); // highest confirmed word position
  const liveASRChunkStartRef = useRef(0); // index into audioChunksRef where current window starts
  const recordingStartTimeRef = useRef(0); // when recording started (for time-based cap)

  // Animate highlight from current pos to target pos, one word at a time.
  // Speed adapts to the gap: small gap = slow (reader is slow),
  // large gap = fast catch-up (reader is fast and highlight is behind).
  // serverStatuses: if provided, uses the server's per-word status
  // (correct/misread/skipped) so errors show live during reading.
  const serverStatusesRef = useRef<string[]>([]);
  const animTimerRef = useRef<any>(null);
  const animateToPos = useCallback((targetPos: number, serverStatuses?: string[]) => {
    if (animTimerRef.current) { clearInterval(animTimerRef.current); animTimerRef.current = null; }
    if (serverStatuses) serverStatusesRef.current = serverStatuses;
    const passageText = passageRef.current?.text;
    if (!passageText) return;
    const passageWords = passageText.match(/\S+/g) || [];
    const totalWords = passageWords.length;

    // Time-based cap: max ~3 words/second from recording start.
    // Prevents Whisper from jumping ahead when it hallucinates matches.
    const MAX_WORDS_PER_SEC = 2;
    if (recordingStartTimeRef.current > 0) {
      const elapsedSec = (Date.now() - recordingStartTimeRef.current) / 1000;
      const maxAllowed = Math.ceil(elapsedSec * MAX_WORDS_PER_SEC);
      if (targetPos > maxAllowed) {
        console.log(`[Highlight] capped ${targetPos} → ${maxAllowed} (${elapsedSec.toFixed(1)}s elapsed)`);
        targetPos = maxAllowed;
      }
    }

    const gap = targetPos - liveASRMatchedRef.current;
    if (gap <= 0) return;
    // Smooth animation speed based on gap size:
    // Small gap (1-3): reader is slow, animate at reading pace (200ms/word)
    // Medium gap (4-8): normal catch-up (120ms/word)
    // Large gap (9+): reader is fast, quick catch-up (60ms/word)
    const interval = gap <= 3 ? 200 : gap <= 8 ? 120 : 60;

    animTimerRef.current = setInterval(() => {
      const curPos = liveASRMatchedRef.current;
      if (curPos >= targetPos || curPos >= totalWords) {
        clearInterval(animTimerRef.current);
        animTimerRef.current = null;
        return;
      }
      const newPos = curPos + 1;
      liveASRMatchedRef.current = newPos;
      console.log(`[Highlight] word=${curPos} t=${Date.now()}`);

      const fullStatuses: WordStatus[] = wordStatusesRef.current.length === totalWords
        ? wordStatusesRef.current.slice()
        : new Array(totalWords).fill('pending') as WordStatus[];

      const srvStatus = serverStatusesRef.current[curPos];
      if (srvStatus === 'misread' || srvStatus === 'skipped') {
        fullStatuses[curPos] = srvStatus as WordStatus;
      } else {
        fullStatuses[curPos] = 'correct';
      }
      if (newPos < totalWords) fullStatuses[newPos] = 'current';
      setWordStatuses(fullStatuses);
      wordStatusesRef.current = fullStatuses;
      webSpeechPosRef.current = newPos;
      setSourcePos(newPos);
      sourcePosRef.current = newPos;
    }, interval);
  }, []);

  const sendAudioForLiveASR = useCallback(async () => {
    if (liveASRBusyRef.current) return;
    const chunks = audioChunksRef.current;
    if (!chunks.length) return;
    const passageText = passageRef.current?.text;
    if (!passageText) return;

    liveASRBusyRef.current = true;
    try {
      const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < 25000) { liveASRBusyRef.current = false; return; } // 25KB min to avoid noise-only clips
      if (blob.size > 1500000) {
        console.log(`[ReadAloud] Skipping: too large (${(blob.size/1024).toFixed(0)}KB)`);
        liveASRBusyRef.current = false;
        return;
      }

      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `live.${ext}`, { type: mimeType });
      const form = new FormData();
      form.append('audio', file);
      form.append('passage', passageText);
      form.append('offset', '0');

      const resp = await fetch(`${SERVER_URL}/read-aloud/transcribe-live`, {
        method: 'POST',
        body: form,
      });
      if (!resp.ok) {
        liveASRBusyRef.current = false;
        return; // silently skip — next cycle will retry
      }

      const data = await resp.json();
      const serverPos = data.matchedUpTo || 0;
      console.log(`[ReadAloud] ASR: server=${serverPos}, current=${liveASRMatchedRef.current}`);

      // Whisper is the primary accuracy driver — let it advance freely
      // as long as the server matched words. Server-side Whisper matching
      // is more accurate than Deepgram streaming for children's reading.
      if (serverPos > liveASRMatchedRef.current) {
        animateToPos(serverPos, data.wordStatuses);
      }
    } catch (err: any) {
      console.warn('[ReadAloud] ASR error:', err?.message || err);
    }
    liveASRBusyRef.current = false;
  }, [animateToPos]);

  // ── Web Speech API for INSTANT word highlighting ────────────────────
  // Uses browser's built-in speech recognition (webkitSpeechRecognition).
  // KEY ADVANTAGE: Has built-in VAD — won't fire on silence/fan noise.
  // Unlike Whisper, it never hallucinates words from background noise.
  const speechRecogRef = useRef<any>(null);
  const voskActiveRef = useRef(false); // true while Vosk (on-device) is driving the highlight
  const misreadCandidateRef = useRef<Set<number>>(new Set()); // words with off-script speech ([unk])
  const displayPosRef = useRef(0); // smoothly-animated visible cursor (lags target)
  const targetStatusesRef = useRef<WordStatus[]>([]); // authoritative statuses (for scoring)
  const stepTimerRef = useRef<any>(null); // reveal / catch-up animation timer
  const webSpeechPosRef = useRef(0); // authoritative passage cursor (shared by all engines)
  const webSpeechAccumulatedRef = useRef<string[]>([]); // words accumulated across Web Speech sessions
  // Both engines re-deliver their FULL transcript-so-far on every event (Vosk's
  // growing partial, Web Speech's all-results loop) — occasionally as single
  // fresh words instead. Re-walking the same words each time is what produced
  // the big "catch-up" jumps (e.g. 33→42 in one step): a stale cursor would
  // match late words like a 3rd "water" against an early "water" occurrence.
  // We diff against the last-seen transcript by longest-common-prefix and feed
  // only the new tail — works whether delivery is cumulative or incremental —
  // keeping each step small: the smooth, word-at-a-time Read Along feel.
  const lastSpokenRef = useRef<string[]>([]);
  // Vosk's grammar is constrained to passage words, so on a long/uncommon word
  // it sometimes "snaps" its partial guess to the FULL word the instant it
  // hears just the first syllable (e.g. hearing "appr…" already outputs
  // "appreciation") — the matcher would then mark it correct/advance before
  // the child finishes saying it.
  //
  // Fix: keep two positions. `scanPosRef` is where the alignment SCAN believes
  // the reader is (always advances — so words after a long one still align
  // correctly). `webSpeechPosRef` (displayed/authoritative) freezes just
  // BEFORE an unconfirmed long word — so it isn't painted "correct" early —
  // and catches up in one jump once confirmed (by surviving a repeat emission
  // unchanged, or by the scan clearly moving past it).
  const scanPosRef = useRef(0);
  const pendingLongMatchRef = useRef<{ pos: number; skipped: number[]; misread: number[] } | null>(null);
  const LONG_WORD_LEN = 7;

  // ── Smooth reveal (catch-up animation) ───────────────────────────────
  // ASR delivers words in bursts, which makes the highlight leap several words
  // at once. We keep the AUTHORITATIVE position (webSpeechPosRef + target
  // statuses) and glide the VISIBLE cursor toward it one step per tick — the
  // smooth karaoke sweep Google Read Along has.
  const revealStep = useCallback(() => {
    const total = targetStatusesRef.current.length;
    const stop = () => { if (stepTimerRef.current) { clearInterval(stepTimerRef.current); stepTimerRef.current = null; } };
    if (!total) { stop(); return; }
    const target = webSpeechPosRef.current;
    let display = displayPosRef.current;
    if (display >= target) { stop(); return; }
    const gap = target - display;
    display = Math.min(target, display + Math.max(1, Math.round(gap / 3))); // glide, catch up if far behind
    displayPosRef.current = display;
    const vis = targetStatusesRef.current.slice();
    for (let i = display + 1; i < total; i++) vis[i] = 'pending'; // hide words not yet reached
    if (display < total) vis[display] = 'current';
    setWordStatuses(vis);
    wordStatusesRef.current = vis;
    setSourcePos(display);
    sourcePosRef.current = display;
  }, []);

  const ensureStepper = useCallback(() => {
    if (stepTimerRef.current) return;
    stepTimerRef.current = setInterval(() => revealStep(), 55);
  }, [revealStep]);

  const advanceHighlightTo = useCallback((newPos: number, marks?: { skipped?: number[]; misread?: number[] }) => {
    const passageText = passageRef.current?.text;
    if (!passageText) return;
    const passageWords = passageText.match(/\S+/g) || [];
    const totalWords = passageWords.length;
    if (newPos <= webSpeechPosRef.current) return; // never go backwards
    if (newPos > totalWords) newPos = totalWords;
    // Glide past punctuation-only tokens (e.g. "—") — the cursor must never
    // rest on something nobody can pronounce.
    while (newPos < totalWords && !/[a-z]/i.test(passageWords[newPos])) newPos++;

    // Authoritative target statuses (used for scoring); revealed gradually above.
    const target: WordStatus[] = targetStatusesRef.current.length === totalWords
      ? targetStatusesRef.current.slice()
      : new Array(totalWords).fill('pending') as WordStatus[];
    for (let i = 0; i < newPos; i++) {
      if (target[i] === 'pending' || target[i] === 'current') {
        target[i] = marks?.misread?.includes(i) ? 'misread'
                  : marks?.skipped?.includes(i) ? 'skipped'
                  : 'correct';
      }
    }
    if (newPos < totalWords) target[newPos] = 'current';
    targetStatusesRef.current = target;

    webSpeechPosRef.current = newPos;
    if (newPos > liveASRMatchedRef.current) liveASRMatchedRef.current = newPos;
    ensureStepper();
  }, [ensureStepper]);

  // ── Read-Along follow algorithm (shared by Vosk + Web Speech) ─────────
  // Because the passage is KNOWN, we only ask: did the child just say the NEXT
  // expected word? Match → advance; word-after-next (content word) → they
  // skipped one, advance two; no confident match → WAIT (do nothing). Noise/
  // mis-hears can't match the specific next word, so the highlight never races
  // ahead; an unclear word just pauses in place instead of sticking then jumping.
  const followAlong = useCallback((spoken: string[]) => {
    if (!liveRecognitionActiveRef.current) return;
    if (spoken.length === 0) return;
    const pText = passageRef.current?.text || '';
    const pWords = pText.match(/\S+/g) || [];
    if (pWords.length === 0) return;

    const cursor = webSpeechPosRef.current;
    if (cursor >= pWords.length) return;

    // Feed only the words spoken since the last call: find how much of the
    // previous transcript this one still starts with (longest common prefix)
    // and take the tail beyond that. Handles cumulative-growing transcripts
    // (Vosk partials, Web Speech's all-results) AND single-fresh-word delivery
    // alike, without ever re-walking words already aligned.
    const prevSpoken = lastSpokenRef.current;
    const maxLcp = Math.min(prevSpoken.length, spoken.length);
    let lcp = 0;
    while (lcp < maxLcp && prevSpoken[lcp] === spoken[lcp]) lcp++;
    const newWords = spoken.slice(lcp);
    lastSpokenRef.current = spoken;
    const pending = pendingLongMatchRef.current;
    if (newWords.length === 0) {
      // Transcript unchanged since last call (Vosk emits partials periodically
      // even when the text hasn't moved). If we're holding a long-word match
      // for confirmation, its surviving a repeat emission unchanged IS the
      // confirmation — a premature "snap-ahead" guess would instead have been
      // extended/replaced as more audio came in. Flush it (and everything the
      // scan already moved past while it was held) now.
      if (pending !== null) {
        pendingLongMatchRef.current = null;
        advanceHighlightTo(scanPosRef.current, { skipped: pending.skipped, misread: pending.misread });
      }
      return;
    }

    const isCommon = (w: string) => FUNCTION_WORDS.has(w) || w.length <= 3;
    // `newWords` is already exactly the new speech since last event — never
    // stale — so process all of it. A fast reader simply produces a longer
    // batch here; truncating it would leave the tail unprocessed and the
    // highlight stuck (it can never "go back" for dropped words).
    const recent = newWords;

    // Resume scanning from wherever the internal scan position got to —
    // `scanPosRef` always advances with true alignment, even while the
    // AUTHORITATIVE cursor (`webSpeechPosRef`/`cursor`) stays frozen on a
    // long word pending confirmation. This prevents the desync that broke
    // alignment for words that came after a held long word.
    const skipped: number[] = pending ? pending.skipped.slice() : [];
    const misread: number[] = pending ? pending.misread.slice() : [];
    let pi = pending ? scanPosRef.current : cursor;
    let pendingNow = pending;
    for (const word of recent) {
      if (word === '⍰') {
        // Vosk [unk]: the child spoke something off-script — a likely
        // mispronunciation of whatever word the matcher is CURRENTLY sitting
        // on (pi), not the stale cursor from the start of this batch — by the
        // time ⍰ appears mid-sequence, pi may have already advanced past it.
        misreadCandidateRef.current.add(pi);
        continue;
      }
      if (pi >= pWords.length) break;
      // No advance cap: `recent` is exactly the new speech in order, so there
      // is no "stale batch" to bound — a fast reader's longer burst must all
      // be consumed or the highlight stalls (it never revisits dropped words).

      // A content word may bridge a skip: search a couple words ahead to find
      // where the reader actually is. Common words (to/of/and…) must be the
      // immediate next word, so they can never cause a big jump (no racing).
      // Window stays narrow (3) — `recent` words are genuinely sequential and
      // fresh, so a wider search would only risk matching a LATER repeat of
      // the same word (e.g. "water" appears 5x) instead of the true next one.
      const window = isCommon(word) ? 1 : 3;
      let found = -1;
      for (let d = 0; d <= window && pi + d < pWords.length; d++) {
        if (fuzzyMatch(word, normalize(pWords[pi + d]))) { found = d; break; }
      }
      if (found >= 0) {
        const matchedPos = pi + found;
        const expectedWord = normalize(pWords[matchedPos]);

        // Immediate-next match on a long word: start (or keep) holding it for
        // confirmation — guards against Vosk's grammar "snapping" a partial
        // guess to the full word the instant it hears the first syllable
        // (e.g. "appr…" → "appreciation"). Keep scanning forward (don't
        // freeze the scan) so later words still align; only the AUTHORITATIVE
        // cursor stays frozen at this position until confirmed.
        if (found === 0 && expectedWord.length >= LONG_WORD_LEN && (pendingNow === null || pendingNow.pos !== matchedPos)) {
          pendingNow = { pos: matchedPos, skipped: skipped.slice(), misread: misread.slice() };
          pi = matchedPos + 1;
          continue;
        }
        if (pendingNow !== null && pendingNow.pos === matchedPos) {
          // Repeat match on the held word (e.g. re-emitted in a later batch) — keep holding.
          pi = matchedPos + 1;
          continue;
        }

        // Words pi..pi+found-1 were jumped over: misread if the reader
        // attempted them (heard [unk]), otherwise skipped entirely.
        for (let k = pi; k < pi + found; k++) {
          if (!/[a-z]/i.test(pWords[k])) continue; // punctuation (e.g. "—") isn't a skip
          if (pendingNow !== null && k === pendingNow.pos) continue; // confirmed via "moved on" below
          if (misreadCandidateRef.current.has(k)) misread.push(k);
          else skipped.push(k);
        }
        // Reaching past a held long word proves it was actually spoken —
        // confirm it as correct (drop the hold) rather than leaving it pending.
        if (pendingNow !== null && matchedPos > pendingNow.pos) {
          pendingNow = null;
        }
        pi = matchedPos + 1;
      }
      // else: not found nearby — noise/mispronunciation → wait, ignore it
    }

    scanPosRef.current = pi;
    pendingLongMatchRef.current = pendingNow;

    // Authoritative cursor: if a long word is still pending confirmation,
    // freeze the DISPLAY at it (don't paint it correct yet) while the scan
    // keeps tracking true progress underneath. Otherwise commit everything
    // the scan reached.
    const commitTo = pendingNow !== null ? pendingNow.pos : pi;
    const commitSkipped = pendingNow !== null ? skipped.filter((k) => k < pendingNow!.pos) : skipped;
    const commitMisread = pendingNow !== null ? misread.filter((k) => k < pendingNow!.pos) : misread;
    if (commitTo > cursor) {
      console.log(`[ReadAlong] ${cursor} → ${commitTo}/${pWords.length} (heard: "${recent.join(' ')}"${pendingNow ? ` [holding @${pendingNow.pos}]` : ''}${commitMisread.length ? ' misread:' + commitMisread.join(',') : ''}${commitSkipped.length ? ' skipped:' + commitSkipped.join(',') : ''})`);
      advanceHighlightTo(commitTo, { skipped: commitSkipped, misread: commitMisread });
    }
  }, [advanceHighlightTo]);

  // Preload the Vosk model in the background so it's ready when reading starts.
  // "Start Reading" is gated on this (see renderIdle) so the session ALWAYS
  // runs the on-device, passage-constrained engine — the Google Read Along feel.
  useEffect(() => {
    if (Platform.OS === 'web' && isVoskSupported()) {
      loadVoskModel().then((ok) => {
        if (ok) {
          console.log('[ReadAloud] Vosk model preloaded — Read Along engine ready');
          setVoskStatus('ready');
        } else {
          console.log('[ReadAloud] Vosk unavailable — will use Web Speech fallback');
          setVoskStatus('unavailable');
        }
      });
    } else {
      setVoskStatus('unavailable');
    }
  }, []);

  // Clear the reveal animation timer on unmount.
  useEffect(() => () => { if (stepTimerRef.current) clearInterval(stepTimerRef.current); }, []);

  // Auto-scroll the passage so the word being read stays in view (Read Along
  // keeps the current word near the top third, like Google Read Along / karaoke).
  useEffect(() => {
    if (phase !== 'reading') return;
    const y = wordYRef.current[sourcePos];
    if (y == null) return;
    const target = Math.max(0, y - 130); // keep current line ~1/3 down the viewport
    scrollRef.current?.scrollTo({ y: target, animated: true });
  }, [sourcePos, phase]);

  // ── Deepgram Streaming ASR for instant word highlighting ────────────
  const deepgramWsRef = useRef<WebSocket | null>(null);
  const deepgramAudioCtxRef = useRef<any>(null);
  const deepgramProcessorRef = useRef<any>(null);
  const deepgramSourceRef = useRef<any>(null);
  const dgLastAdvanceTimeRef = useRef(0); // rate limiter: last time Deepgram advanced

  const startDeepgramStreaming = useCallback(async (stream: MediaStream) => {
    if (Platform.OS !== 'web') return false;

    try {
      // Fetch Deepgram API key from server
      const keyResp = await fetch(`${SERVER_URL}/read-aloud/deepgram-key`);
      if (!keyResp.ok) {
        console.warn('[Deepgram] Failed to get API key');
        return false;
      }
      const { key } = await keyResp.json();

      // Build keywords from passage for better accuracy
      const passageText = passageRef.current?.text || '';
      const uniqueWords = [...new Set(passageText.match(/\S+/g)?.map((w: string) => w.replace(/[^a-zA-Z']/g, '').toLowerCase()).filter((w: string) => w.length > 3) || [])];
      const keywords = uniqueWords.slice(0, 20).map((w: string) => `${w}:2`).join('&keywords=');

      // Open WebSocket to Deepgram streaming API
      const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=false&interim_results=true&punctuate=false&encoding=linear16&sample_rate=16000&endpointing=300&vad_events=true${keywords ? '&keywords=' + keywords : ''}`;
      const ws = new WebSocket(dgUrl, ['token', key]);
      deepgramWsRef.current = ws;

      ws.onopen = () => {
        console.log('[Deepgram] WebSocket connected');

        // Set up AudioContext to convert mic audio to 16kHz linear16 PCM
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        deepgramAudioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        deepgramSourceRef.current = source;

        // Use ScriptProcessorNode (widely supported) to get raw PCM
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        deepgramProcessorRef.current = processor;

        processor.onaudioprocess = (e: any) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          // Convert float32 to int16
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          ws.send(int16.buffer);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
      };

      ws.onmessage = (event) => {
        if (!liveRecognitionActiveRef.current) return;
        try {
          const data = JSON.parse(event.data);
          if (!data.channel?.alternatives?.[0]) return;

          const alt = data.channel.alternatives[0];
          const transcript = alt.transcript || '';
          const isFinal = data.is_final;
          const words = alt.words || [];

          if (!transcript.trim()) return;

          const passageText = passageRef.current?.text;
          if (!passageText) return;
          const passageWords = passageText.match(/\S+/g) || [];
          const pos = webSpeechPosRef.current;
          if (pos >= passageWords.length) return;

          // Extract spoken words from Deepgram with confidence
          const dgWords: { word: string; confidence: number }[] = words.map((w: any) => ({
            word: (w.word || '').toLowerCase().replace(/[^a-z']/g, ''),
            confidence: w.confidence || 0,
          })).filter((w: any) => w.word);

          // Fallback to transcript if no word-level data
          const spokenWords = dgWords.length > 0
            ? dgWords
            : transcript.trim().toLowerCase().replace(/[^a-z'\s]/g, '').split(/\s+/).filter(Boolean).map((w: string) => ({ word: w, confidence: 0.5 }));

          if (spokenWords.length > 0) {
            const expected = pos < passageWords.length ? normalize(passageWords[pos]) : '(end)';
            console.log(`[Deepgram] "${spokenWords.map((w: any) => w.word).join(' ')}" (final=${isFinal}, pos=${pos}, expect="${expected}")`);
          }

          // ── Sliding Window Alignment (MonkeyType approach) ──
          // Only compare against a small window around current position.
          // Rate-limited: max 3 words/second to match natural reading speed.
          const WINDOW = 5;
          const MAX_ADVANCE = 2;
          const MIN_CONFIDENCE = 0.65;
          const MIN_INTERVAL_MS = 350; // min time between advances (~3 words/sec max)

          // Rate limit: skip if we advanced too recently
          const now = Date.now();
          if (now - dgLastAdvanceTimeRef.current < MIN_INTERVAL_MS) {
            return; // too soon since last advance
          }

          // Build the window of expected words
          const windowEnd = Math.min(pos + WINDOW, passageWords.length);
          const windowWords = passageWords.slice(pos, windowEnd).map((w: string) => normalize(w));

          // Extract spoken words (only sufficient confidence)
          const validSpoken = spokenWords
            .filter((w: { confidence: number }) => w.confidence >= MIN_CONFIDENCE)
            .map((w: { word: string }) => w.word.toLowerCase());

          if (validSpoken.length === 0) {
            // No confident words — skip
          } else {
            // Sequential alignment: match spoken words against window in order
            let windowIdx = 0;
            let matched = 0;

            for (const spoken of validSpoken) {
              if (windowIdx >= windowWords.length) break;
              if (matched >= MAX_ADVANCE) break;

              // Try match at current window position
              if (fuzzyMatch(spoken, windowWords[windowIdx])) {
                windowIdx++;
                matched++;
                continue;
              }

              // Try next position (student may have skipped 1 word)
              if (windowIdx + 1 < windowWords.length && fuzzyMatch(spoken, windowWords[windowIdx + 1])) {
                windowIdx += 2;
                matched++;
                continue;
              }
              // No match — noise or mispronunciation, ignore
            }

            if (matched >= 1) {
              const newPos = pos + windowIdx;
              dgLastAdvanceTimeRef.current = now;
              console.log(`[Deepgram] ${pos} → ${newPos} (+${windowIdx}, ${matched}match, spoken="${validSpoken.join(' ')}")`);
              advanceHighlightTo(newPos);
            }
          }
        } catch (err) {
          // ignore parse errors
        }
      };

      ws.onerror = (err) => {
        console.warn('[Deepgram] WebSocket error:', err);
      };

      ws.onclose = (event) => {
        console.log(`[Deepgram] WebSocket closed (code=${event.code})`);
      };

      console.log('[Deepgram] Streaming started');
      return true;
    } catch (err: any) {
      console.warn('[Deepgram] Start failed:', err?.message || err);
      return false;
    }
  }, [advanceHighlightTo]);

  const stopDeepgramStreaming = useCallback(() => {
    if (deepgramProcessorRef.current) {
      try { deepgramProcessorRef.current.disconnect(); } catch {}
      deepgramProcessorRef.current = null;
    }
    if (deepgramSourceRef.current) {
      try { deepgramSourceRef.current.disconnect(); } catch {}
      deepgramSourceRef.current = null;
    }
    if (deepgramAudioCtxRef.current) {
      try { deepgramAudioCtxRef.current.close(); } catch {}
      deepgramAudioCtxRef.current = null;
    }
    if (deepgramWsRef.current) {
      try {
        // Send CloseStream message before closing
        if (deepgramWsRef.current.readyState === WebSocket.OPEN) {
          deepgramWsRef.current.send(JSON.stringify({ type: 'CloseStream' }));
        }
        deepgramWsRef.current.close();
      } catch {}
      deepgramWsRef.current = null;
    }
  }, []);

  // Keep old ref name for backward compat in stopWebSpeech calls
  const stopWebSpeech = stopDeepgramStreaming;

  const stopLiveRecognition = useCallback(() => {
    liveRecognitionActiveRef.current = false;
    setLiveSpeechStatus('idle');
    if (liveASRTimerRef.current) { clearInterval(liveASRTimerRef.current); liveASRTimerRef.current = null; }
    if (animTimerRef.current) { clearInterval(animTimerRef.current); animTimerRef.current = null; }
    // Stop Vosk (on-device) recognition
    if (voskActiveRef.current) {
      stopVoskRecognition();
      voskActiveRef.current = false;
    }
    // Stop Web Speech recognition
    if (speechRecogRef.current) {
      try { speechRecogRef.current.stop(); } catch {}
      speechRecogRef.current = null;
    }
    stopWebSpeech();
    // Snap the smooth reveal to the true final position (so scoring/review sees
    // the complete, accurate statuses immediately).
    if (stepTimerRef.current) { clearInterval(stepTimerRef.current); stepTimerRef.current = null; }
    if (targetStatusesRef.current.length) {
      displayPosRef.current = webSpeechPosRef.current;
      const finalStatuses = targetStatusesRef.current.slice();
      setWordStatuses(finalStatuses);
      wordStatusesRef.current = finalStatuses;
      setSourcePos(webSpeechPosRef.current);
      sourcePosRef.current = webSpeechPosRef.current;
    }
  }, [stopWebSpeech]);

  const startLiveRecognition = useCallback(async () => {
    if (Platform.OS !== 'web') return;
    liveRecognitionActiveRef.current = true;
    setLiveSpeechStatus('listening');
    // DO NOT reset webSpeechPosRef here — it must persist across pause/resume
    // It is only reset in beginReading() when a fresh recording starts
    webSpeechAccumulatedRef.current = [];

    // ── PRIMARY: Vosk on-device, constrained to the known passage ──
    // This is the Google Read Along approach: the recognizer can only output
    // words from THIS passage, so it can't drift to off-script words. If the
    // model isn't ready (still downloading) or fails, we fall through to the
    // open Web Speech engine below.
    if (isVoskSupported() && isVoskModelReady() && mediaStreamRef.current) {
      const grammarWords = passageRef.current?.text?.match(/\S+/g) || [];
      const started = await startVoskRecognition({
        stream: mediaStreamRef.current,
        grammarWords,
        onWords: followAlong,
      });
      if (started && liveRecognitionActiveRef.current) {
        voskActiveRef.current = true;
        setActiveEngine('vosk');
        console.log('[ReadAloud] Vosk mode (on-device, passage-constrained — Read Along)');
        return;
      }
    }

    // ── PRIMARY: Browser Web Speech API ──
    // Works on: Chrome (Win/Mac/Android), Edge (Win/Mac), Safari (Mac/iOS), Opera
    // Built-in VAD: will NOT fire on silence, fan noise, or background sounds.
    // This is how Raz-Plus and production read-aloud systems work.
    // Fallback: Whisper polling for Firefox or unsupported browsers.
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;
      speechRecogRef.current = recognition;

      recognition.onaudiostart = () => {
        console.log('[WebSpeech] Audio capture started — mic is active');
      };
      recognition.onspeechstart = () => {
        console.log('[WebSpeech] Speech detected — VAD triggered');
      };
      recognition.onspeechend = () => {
        console.log('[WebSpeech] Speech ended — VAD silence');
      };

      recognition.onresult = (event: any) => {
        if (!liveRecognitionActiveRef.current) return;
        // Gather the full session transcript (finals + interim); followAlong
        // looks only at the most recent words and matches the known passage.
        const spoken: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const words = event.results[i][0].transcript
            .toLowerCase().replace(/[^a-z'\s]/g, '').trim().split(/\s+/).filter(Boolean);
          spoken.push(...words);
        }
        followAlong(spoken);
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return; // VAD detected silence — normal
        if (event.error === 'aborted') return;
        console.warn('[WebSpeech] error:', event.error);
        // If not-allowed, the mic is blocked — fall back to Whisper
        if (event.error === 'not-allowed') {
          console.warn('[WebSpeech] Mic not allowed — falling back to Whisper polling');
          speechRecogRef.current = null;
          setTimeout(() => {
            if (liveRecognitionActiveRef.current) sendAudioForLiveASR();
          }, 3000);
          liveASRTimerRef.current = setInterval(() => {
            if (liveRecognitionActiveRef.current) sendAudioForLiveASR();
          }, 3000);
        }
      };

      recognition.onend = () => {
        console.log(`[WebSpeech] Session ended at passage position ${webSpeechPosRef.current}`);
        // Auto-restart if still recording (Web Speech stops after pauses)
        if (liveRecognitionActiveRef.current) {
          try { recognition.start(); } catch {}
        }
      };

      try {
        recognition.start();
        setActiveEngine('webspeech');
        console.log('[ReadAloud] Web Speech API mode (Chrome/Edge/Safari — built-in VAD)');
      } catch (err: any) {
        console.warn('[WebSpeech] start failed:', err?.message);
      }
    } else {
      // Fallback for Firefox / unsupported browsers: Whisper polling
      setActiveEngine('whisper');
      console.log('[ReadAloud] Whisper fallback mode (Web Speech not available)');
      setTimeout(() => {
        if (liveRecognitionActiveRef.current) sendAudioForLiveASR();
      }, 3000);
      liveASRTimerRef.current = setInterval(() => {
        if (liveRecognitionActiveRef.current) sendAudioForLiveASR();
      }, 3000);
    }
  }, [sendAudioForLiveASR, advanceHighlightTo, followAlong]);
  useEffect(() => { startLiveRecognitionRef.current = startLiveRecognition; }, [startLiveRecognition]);

  // ── Begin Recording ───────────────────────────────────────────────
  const beginReading = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Alert.alert('Not Supported', 'Read Aloud works in your web browser.');
      setPhase('idle');
      return;
    }

    // Reuse the stream acquired during the countdown warm-up if we have one —
    // re-requesting would tear down the already-warm recognizer and reintroduce
    // the startup-clipping gap we're trying to avoid.
    let stream: MediaStream;
    if (mediaStreamRef.current) {
      stream = mediaStreamRef.current;
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error('[ReadAloud] Mic denied:', err);
        Alert.alert('Microphone Access', 'Please allow microphone access in your browser settings.');
        setPhase('idle');
        return;
      }
      mediaStreamRef.current = stream;
    }

    // Reset state
    const initialStatuses: WordStatus[] = new Array(words.length).fill('pending');
    if (initialStatuses.length > 0) initialStatuses[0] = 'current';
    setWordStatuses(initialStatuses);
    wordStatusesRef.current = initialStatuses;
    setSourcePos(0);
    sourcePosRef.current = 0;
    liveRecognitionActiveRef.current = false;
    liveASRBusyRef.current = false;
    liveASRMatchedRef.current = 0;
    liveASRChunkStartRef.current = 0;
    webSpeechPosRef.current = 0;
    lastSpokenRef.current = []; pendingLongMatchRef.current = null; scanPosRef.current = 0;
    misreadCandidateRef.current.clear();
    displayPosRef.current = 0;
    targetStatusesRef.current = initialStatuses.slice();
    if (stepTimerRef.current) { clearInterval(stepTimerRef.current); stepTimerRef.current = null; }
    setStartTime(Date.now());
    setRecordingTime(0);
    setIsPaused(false);
    setRecordedBlobUrl(null);
    recordedBlobRef.current = null;
    setPhase('reading');

    // Best MIME type
    const mimeOptions = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    let mimeType = '';
    for (const mt of mimeOptions) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break; }
    }

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    audioChunksRef.current = [];
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.start(250);
    recordingStartTimeRef.current = Date.now();
    console.log(`[Recording] started t=${recordingStartTimeRef.current}`);
    console.log(`[ReadAloud] Recording started (${recorder.mimeType})`);

    // Start waveform visualizer
    startWaveform(stream);
    // If the recognizer is already warm from the countdown, leave it running
    // (restarting it would tear down the engine and reopen the clipping gap).
    // Its `onWords` already routes into followAlong, which is gated on
    // liveRecognitionActiveRef — flip that on and it picks up immediately.
    if (voskActiveRef.current || speechRecogRef.current) {
      liveRecognitionActiveRef.current = true;
      setLiveSpeechStatus('listening');
      console.log('[ReadAloud] Reusing pre-warmed recognizer — no clipping gap');
    } else {
      startLiveRecognition();
    }

    // Timer only. Word highlighting is driven by live speech recognition.
    recordingTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setRecordingTime(Math.floor(elapsed));
    }, 200);
  }, [words, startWaveform, startLiveRecognition]);
  useEffect(() => { beginReadingRef.current = beginReading; }, [beginReading]);

  // ── Pause / Resume Recording ──────────────────────────────────────
  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.pause();
      setIsPaused(true);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      stopWaveform();
      stopLiveRecognition();
    }
  }, [stopWaveform, stopLiveRecognition]);

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'paused') {
      recorder.resume();
      setIsPaused(false);
      // Restart waveform
      if (mediaStreamRef.current) startWaveform(mediaStreamRef.current);
      startLiveRecognition();
      // Restart timer only. Word highlighting is driven by live speech recognition.
      recordingTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setRecordingTime(Math.floor(elapsed));
      }, 200);
    }
  }, [startWaveform, startLiveRecognition]);

  // ── Stop Recording → go to Preview ────────────────────────────────
  const stopReading = useCallback(async () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    stopWaveform();
    stopLiveRecognition();

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    // Wait for recorder to stop and flush data
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    // Release mic
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;

    const mType = recorder.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunksRef.current, { type: mType });
    console.log(`[ReadAloud] Recorded ${(audioBlob.size / 1024).toFixed(0)}KB (${mType})`);

    recordedBlobRef.current = audioBlob;
    const blobUrl = URL.createObjectURL(audioBlob);
    setRecordedBlobUrl(blobUrl);
    setIsPlayingBack(false);
    setPhase('preview');
  }, [stopWaveform]);

  // ── Retry Recording (go back to countdown) ────────────────────────
  const retryRecording = useCallback(() => {
    // Clean up old blob URL
    if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
    setRecordedBlobUrl(null);
    recordedBlobRef.current = null;
    if (playbackAudioRef.current) { try { playbackAudioRef.current.pause(); } catch {} playbackAudioRef.current = null; }
    setIsPlayingBack(false);
    setRecordingTime(0);
    // Go straight to countdown
    startCountdown();
  }, [recordedBlobUrl, startCountdown]);

  // ── Play back recording ───────────────────────────────────────────
  const togglePlayback = useCallback(() => {
    if (Platform.OS !== 'web' || !recordedBlobUrl) return;

    if (playbackAudioRef.current && !playbackAudioRef.current.paused) {
      playbackAudioRef.current.pause();
      setIsPlayingBack(false);
      return;
    }

    if (playbackAudioRef.current) {
      playbackAudioRef.current.currentTime = 0;
    } else {
      const audio = new (window as any).Audio(recordedBlobUrl);
      audio.addEventListener('ended', () => setIsPlayingBack(false), { once: true });
      playbackAudioRef.current = audio;
    }
    playbackAudioRef.current.play();
    setIsPlayingBack(true);
  }, [recordedBlobUrl]);

  // ── Submit recording for analysis ─────────────────────────────────
  const submitRecording = useCallback(async () => {
    if (playbackAudioRef.current) { try { playbackAudioRef.current.pause(); } catch {} playbackAudioRef.current = null; }
    setIsPlayingBack(false);

    const blob = recordedBlobRef.current;
    if (!blob || blob.size < 500) {
      finishReading(wordStatusesRef.current);
      return;
    }

    setPhase('analysing');

    try {
      const mType = blob.type || 'audio/webm';
      const ext = mType.includes('mp4') ? 'mp4' : mType.includes('ogg') ? 'ogg' : 'webm';
      const formData = new FormData();
      formData.append('audio', new File([blob], `recording.${ext}`, { type: mType }));
      formData.append('passage', passageRef.current?.text || '');

      const res = await fetch(`${SERVER_URL}/read-aloud/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Server ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      console.log(`[ReadAloud] Whisper: "${(data.transcript || '').slice(0, 100)}"`);
      console.log(`[ReadAloud] matched=${data.matchedUpTo}/${data.totalWords}`);

      const currentWords = wordsRef.current;
      const serverStatuses: WordStatus[] = (data.wordStatuses || []).map((s: string) =>
        (s === 'correct' || s === 'misread' || s === 'skipped') ? s as WordStatus : 'pending' as WordStatus
      );
      while (serverStatuses.length < currentWords.length) serverStatuses.push('pending');
      if (serverStatuses.length > currentWords.length) serverStatuses.length = currentWords.length;

      setWordStatuses(serverStatuses);
      wordStatusesRef.current = serverStatuses;
      finishReading(serverStatuses);
    } catch (err: any) {
      console.error('[ReadAloud] Transcription error:', err.message);
      finishReading(wordStatusesRef.current);
    }
  }, []);

  // Handle calibration result after assess
  const handleCalibrationResult = useCallback(async (accuracy: number, wcpm: number) => {
    const gradeBase = { 'Grade 1': 200, 'Grade 2': 300, 'Grade 3': 400, 'Grade 4': 500, 'Grade 5': 600 }[userGrade] || 400;
    let lexile: number;
    if (accuracy >= 95 && wcpm >= 80) lexile = gradeBase + 100;
    else if (accuracy >= 80 && wcpm >= 50) lexile = gradeBase;
    else lexile = gradeBase - 100;
    try {
      await fetch(`${SERVER_URL}/read-aloud/lexile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, lexile, source: 'calibration' }),
      });
    } catch {}

    setStudentLexile(lexile);
    setNeedsCalibration(false);
  }, [userGrade, user?.email]);

  // ── Finish and assess ──────────────────────────────────────────────
  const finishReading = useCallback(async (statuses: WordStatus[]) => {
    const dur = (Date.now() - startTimeRef.current) / 1000;
    const p = passageRef.current;
    const finalStatuses = statuses.map(s => (s === 'pending' || s === 'current') ? 'skipped' : s);
    setWordStatuses(finalStatuses);
    wordStatusesRef.current = finalStatuses;
    setPhase('reviewing');

    try {
      const res = await fetch(`${SERVER_URL}/read-aloud/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passage: p?.text || '',
          wordStatuses: finalStatuses,
          duration: dur,
          studentEmail: user?.email || '',
          grade: userGrade,
          topic: p?.topic || '',
        }),
      });
      const data = await res.json();

      // If calibration mode, compute Lexile and go back to pick
      if (isCalibrationRef.current) {
        isCalibrationRef.current = false;
        await handleCalibrationResult(data.accuracy || 0, data.wcpm || 0);
        setPhase('pick');
        setResult(null);
        return;
      }

      setResult(data);
      // Award stars as XP
      if (data.starsEarned) {
        setStarsEarned(data.starsEarned);
        try { addXP(data.starsEarned); } catch {}
      }
      // Update Lexile
      if (data.lexile != null) setStudentLexile(data.lexile);
    } catch {
      const correct = finalStatuses.filter(s => s === 'correct').length;
      const total = finalStatuses.length;
      const dMin = dur / 60;
      setResult({
        accuracy: Math.round((correct / total) * 100),
        wcpm: dMin > 0 ? Math.round(correct / dMin) : 0,
        wpm: dMin > 0 ? Math.round(total / dMin) : 0,
        totalWords: total,
        correct,
        misread: finalStatuses.filter(s => s === 'misread').length,
        skipped: finalStatuses.filter(s => s === 'skipped').length,
        duration: Math.round(dur),
        errors: [],
        feedback: correct / total >= 0.8 ? 'Good reading! Keep practising!' : 'Nice try! Practice makes perfect!',
        level: correct / total >= 0.95 ? 'excellent' : correct / total >= 0.8 ? 'good' : correct / total >= 0.6 ? 'developing' : 'needs-practice',
      });
    }
  }, [user, userGrade, handleCalibrationResult, addXP]);

  const tryAgain = useCallback(() => {
    if (!passage) return;
    const w = splitWords(passage.text);
    setWords(w);
    const initialStatuses: WordStatus[] = new Array(w.length).fill('pending');
    setWordStatuses(initialStatuses);
    wordStatusesRef.current = initialStatuses;
    setSourcePos(0);
    webSpeechPosRef.current = 0;
    lastSpokenRef.current = []; pendingLongMatchRef.current = null; scanPosRef.current = 0;
    setResult(null);
    setHighlightIdx(-1);
    setRecordingTime(0);
    if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
    setRecordedBlobUrl(null);
    recordedBlobRef.current = null;
    setIsPlayingBack(false);
    setPhase('idle');
  }, [passage, recordedBlobUrl]);

  const handleHeaderBack = useCallback(() => {
    stopListening();
    stopLiveRecognition();
    stopWaveform();
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (phase !== 'pick') {
      setPhase('pick');
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Dashboard');
  }, [navigation, phase, stopListening, stopLiveRecognition, stopWaveform]);

  // ── Filtered passages ──────────────────────────────────────────────
  const filteredPassages = useMemo(() => {
    if (diffFilter === 'all') return passageList;
    return passageList.filter(p => p.level === diffFilter);
  }, [passageList, diffFilter]);

  // ── Render: Calibration Prompt ──────────────────────────────────────
  const startCalibration = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/read-aloud/calibration?grade=${encodeURIComponent(userGrade)}`);
      const data = await res.json();
      isCalibrationRef.current = true;
      setPassage({ title: data.title, text: data.text, topic: 'Calibration', level: 'medium' });
      const w = (data.text || '').match(/\S+/g) || [];
      setWords(w);
      const initStatuses: WordStatus[] = new Array(w.length).fill('pending');
      if (initStatuses.length > 0) initStatuses[0] = 'current';
      setWordStatuses(initStatuses);
      wordStatusesRef.current = initStatuses;
      startCountdown();
    } catch {
      // Skip calibration on error
      setNeedsCalibration(false);
    }
  }, [userGrade, startCountdown]);

  const renderCalibrationPrompt = () => (
    <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 20 }}>
      <LinearGradient colors={['#93B0AC28', '#C3DCD818']} style={{ borderRadius: 20, padding: 32, alignItems: 'center', width: '100%', maxWidth: 500 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accentYellow + '20', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Feather name="bar-chart-2" size={32} color={colors.accentYellow} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 8 }}>Reading Level Check</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
          Let's find the right reading level for you! Read a short passage aloud and we'll set your Lexile level.
        </Text>
        {studentLexile != null && (
          <View style={{ backgroundColor: colors.accentYellow + '18', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 16 }}>
            <Text style={{ fontSize: 13, color: colors.accentYellow, fontWeight: '700' }}>Current Lexile: {studentLexile}L</Text>
          </View>
        )}
        <TouchableOpacity onPress={startCalibration} style={{ backgroundColor: colors.accentYellow, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginBottom: 12 }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Start Reading Test</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setNeedsCalibration(false); setStudentLexile(400); }} style={{ paddingVertical: 8 }}>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>Skip for now</Text>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );

  // ── Render: Pick Phase ─────────────────────────────────────────────
  const renderPickPhase = () => (
    <View style={s.pickContainer}>
      {/* Hero */}
      <LinearGradient colors={['#93B0AC18', '#C3DCD810']} style={s.heroCard}>
        <View style={s.heroIconCircle}>
          <Feather name="mic" size={28} color={colors.accentYellow} />
        </View>
        <Text style={[s.heroTitle, { color: colors.textMain }]}>Read Aloud</Text>
        <Text style={[s.heroSub, { color: colors.textMuted }]}>
          Pick a story, listen or read it aloud, and see how you do!
        </Text>
        {studentLexile != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: colors.accentYellow + '18', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 }}>
            <Feather name="bar-chart-2" size={14} color={colors.accentYellow} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.accentYellow, marginLeft: 6 }}>Lexile {studentLexile}L</Text>
          </View>
        )}
      </LinearGradient>

      {/* Difficulty filter tabs */}
      <View style={s.filterRow}>
        {(['all', 'easy', 'medium', 'hard'] as DifficultyFilter[]).map(f => {
          const active = diffFilter === f;
          const lm = f === 'all' ? null : LEVEL_META[f];
          return (
            <TouchableOpacity
              key={f}
              style={[
                s.filterTab,
                active && { backgroundColor: lm?.bg || colors.accentYellow + '18', borderColor: lm?.border || colors.accentYellow + '40' },
              ]}
              onPress={() => setDiffFilter(f)}
              activeOpacity={0.7}
            >
              <Text style={[
                s.filterTabText,
                { color: active ? (lm?.text || colors.accentYellow) : colors.textDim },
              ]}>
                {f === 'all' ? 'All' : LEVEL_META[f].label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 2-column grid */}
      <View style={s.grid}>
        {filteredPassages.map((p, i) => {
          const lm = LEVEL_META[p.level] || LEVEL_META.easy;
          const grad = (p.gradient || DEFAULT_GRADIENT) as [string, string];
          return (
            <TouchableOpacity
              key={i}
              style={[s.gridCard, { borderColor: colors.borderColor }]}
              onPress={() => loadPassage(p.title)}
              activeOpacity={0.7}
              disabled={loadingPassage}
            >
              <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gridCardGradient}>
                <View style={s.gridCardIconCircle}>
                  <Feather name={(p.icon || 'book-open') as any} size={22} color="#fff" />
                </View>
              </LinearGradient>
              <View style={s.gridCardBody}>
                <Text style={[s.gridCardTitle, { color: colors.textMain }]} numberOfLines={2}>{p.title}</Text>
                <View style={s.gridCardMeta}>
                  <View style={[s.levelPill, { backgroundColor: lm.bg, borderColor: lm.border }]}>
                    <Text style={[s.levelPillText, { color: lm.text }]}>{lm.label}</Text>
                  </View>
                  <Text style={[s.gridCardTopic, { color: colors.textDim }]}>{p.topic}</Text>
                </View>
                <Text style={[s.gridCardWords, { color: colors.textDim }]}>{p.wordCount} words</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Surprise Me */}
      <TouchableOpacity
        style={[s.surpriseBtn, { borderColor: colors.accentYellow + '40' }]}
        onPress={() => loadPassage()}
        disabled={loadingPassage}
        activeOpacity={0.7}
      >
        {loadingPassage
          ? <ActivityIndicator size="small" color={colors.accentYellow} />
          : <>
              <Feather name="shuffle" size={16} color={colors.accentYellow} />
              <Text style={{ color: colors.accentYellow, fontWeight: '600', fontSize: 14 }}>Surprise Me!</Text>
            </>
        }
      </TouchableOpacity>
    </View>
  );

  // ── Render: Idle Phase (passage preview + listen/start) ────────────
  const renderIdlePhase = () => {
    const grad = (passage?.gradient || DEFAULT_GRADIENT) as [string, string];
    return (
      <View style={s.idleContainer}>
        {/* Header bar */}
        <View style={s.passageHeader}>
          <TouchableOpacity onPress={() => { stopListening(); setPhase('pick'); }} style={[s.backBtn, { backgroundColor: colors.cardDark }]}>
            <Feather name="arrow-left" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[s.passageTitleLarge, { color: colors.textMain }]}>{passage?.title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <View style={[s.levelPill, { backgroundColor: LEVEL_META[passage?.level || 'easy'].bg, borderColor: LEVEL_META[passage?.level || 'easy'].border }]}>
                <Text style={[s.levelPillText, { color: LEVEL_META[passage?.level || 'easy'].text }]}>{LEVEL_META[passage?.level || 'easy'].label}</Text>
              </View>
              <Text style={{ fontSize: 12, color: colors.textDim }}>{passage?.topic}</Text>
              <Text style={{ fontSize: 12, color: colors.textDim }}>{passage?.wordCount} words</Text>
            </View>
          </View>
        </View>

        {/* Passage text with word-by-word highlighting during listen */}
        <View style={[s.textCard, { borderColor: colors.borderColor + '30' }]}>
          <LinearGradient colors={[grad[0] + '15', grad[1] + '08']} style={s.textCardGradientBar} />
          <Text style={s.passageTextWrap}>
            {words.map((w, i) => {
              const isCurrent = isListeningModel && i === highlightIdx;
              const isPast = isListeningModel && highlightIdx >= 0 && i < highlightIdx;
              return (
                <Text
                  key={i}
                  style={{
                    color: isCurrent ? grad[0] : isPast ? colors.textMuted : colors.textMain,
                    fontWeight: '400',
                    backgroundColor: isCurrent ? grad[0] + '25' : 'transparent',
                    textDecorationLine: isCurrent ? 'underline' : 'none',
                    textDecorationColor: grad[0],
                    fontSize: 19,
                    lineHeight: 36,
                  }}
                >
                  {w}{' '}
                </Text>
              );
            })}
          </Text>
        </View>

        {/* Action buttons */}
        <View style={s.actionRow}>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.cardDark, borderColor: colors.borderColor + '40' }]}
            onPress={isListeningModel ? pauseListening : isListenPaused ? resumeListening : listenFirst}
            activeOpacity={0.7}
            disabled={audioLoading}
          >
            {audioLoading
              ? <ActivityIndicator size="small" color={grad[0]} />
              : <Feather name={isListeningModel ? 'pause' : isListenPaused ? 'play' : 'headphones'} size={18} color={grad[0]} />
            }
            <Text style={{ color: grad[0], fontWeight: '600', fontSize: 14 }}>
              {audioLoading ? 'Loading...' : isListeningModel ? 'Pause' : isListenPaused ? 'Resume' : 'Listen First'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.actionBtn, s.primaryBtn, { backgroundColor: colors.accentYellow, opacity: voskStatus === 'loading' ? 0.6 : 1 }]}
            onPress={startCountdown}
            activeOpacity={0.7}
            disabled={voskStatus === 'loading'}
          >
            {voskStatus === 'loading'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Feather name="mic" size={18} color="#fff" />
            }
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
              {voskStatus === 'loading' ? 'Preparing voice engine…' : 'Start Reading'}
            </Text>
          </TouchableOpacity>
        </View>
        {voskStatus === 'loading' && (
          <Text style={{ color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 8 }}>
            Loading the on-device Read Along engine (one-time, ~40MB) — this gives the smooth, accurate
            word-tracking like Google Read Along. Please wait a moment before starting.
          </Text>
        )}
      </View>
    );
  };

  // ── Render: Countdown ──────────────────────────────────────────────
  const renderCountdown = () => (
    <View style={[s.countdownOverlay, { backgroundColor: colors.bgDark }]}>
      <View style={s.countdownCircle}>
        <Text style={[s.countdownNum, { color: colors.accentYellow }]}>{countdownNum > 0 ? countdownNum : 'Go!'}</Text>
      </View>
      <Text style={[s.countdownHint, { color: colors.textMuted }]}>Get ready to read...</Text>
    </View>
  );

  // ── Render: Reading Phase (recording with waveform) ─────────────────
  const renderReadingPhase = () => {
    const grad = (passage?.gradient || DEFAULT_GRADIENT) as [string, string];
    const mins = Math.floor(recordingTime / 60);
    const secs = recordingTime % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    return (
      <View style={s.readingContainer}>
        {/* Passage text — clean, no highlighting during recording */}
        <ScrollView ref={scrollRef} style={s.readingScroll} contentContainerStyle={{ padding: 24, paddingBottom: 160 }}>
          <View style={s.liveWordsWrap}>
            {words.map((w, i) => {
              const status = wordStatuses[i];
              const isCurrent = status === 'current';
              return (
                <View
                  key={`${w}-${i}`}
                  style={s.liveWordSlot}
                  onLayout={(e) => { wordYRef.current[i] = e.nativeEvent.layout.y; }}
                >
                  {isCurrent ? <View style={[s.liveCaret, { backgroundColor: colors.accentYellow }]} /> : null}
                  <Text
                    style={[
                      s.liveWord,
                      {
                        color: status === 'correct' ? '#93B0AC'
                             : status === 'misread' ? '#EFD1D4'
                             : status === 'skipped' ? '#C5BD96'
                             : isCurrent ? colors.textMain
                             : colors.textMain + 'CC',
                        backgroundColor: isCurrent ? colors.accentYellow + '18'
                             : status === 'correct' ? '#93B0AC10'
                             : status === 'misread' ? '#EFD1D414'
                             : status === 'skipped' ? '#C5BD9614'
                             : 'transparent',
                        borderColor: isCurrent ? colors.accentYellow + '70' : 'transparent',
                        fontWeight: isCurrent || status === 'correct' ? '800' : '500',
                        textDecorationLine: status === 'misread' ? 'underline' : 'none',
                      },
                    ]}
                  >
                    {w}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Recording controls bar at bottom */}
        <View style={[s.recordingBar, { backgroundColor: colors.cardDark, borderTopColor: colors.borderColor + '30' }]}>
          {/* Waveform visualizer */}
          <View style={s.waveformRow}>
            {waveformBars.map((h, i) => (
              <View
                key={i}
                style={{
                  width: 3,
                  height: isPaused ? 3 : h,
                  borderRadius: 2,
                  backgroundColor: isPaused ? colors.textDim : colors.accentYellow,
                  opacity: isPaused ? 0.4 : 0.7 + (h / 40) * 0.3,
                }}
              />
            ))}
          </View>

          {/* Timer */}
          <Text style={{
            color: isPaused ? colors.textDim : colors.accentYellow,
            fontWeight: '700', fontSize: 22,
            fontVariant: ['tabular-nums'],
            marginVertical: 8,
          }}>
            {timeStr}
          </Text>
          <Text style={{ color: colors.textDim, fontSize: 12, marginBottom: 4 }}>
            {isPaused ? 'Paused'
              : liveSpeechStatus === 'listening' ? 'Listening... read the highlighted word aloud'
              : liveSpeechStatus === 'unavailable' ? 'Live highlight is not supported in this browser'
              : liveSpeechStatus === 'error' ? 'Live highlight needs microphone/speech permission'
              : 'Recording... read the passage aloud'}
          </Text>
          {activeEngine && (
            <Text style={{ color: colors.textDim + '99', fontSize: 10, marginBottom: 14 }}>
              Engine: {activeEngine === 'vosk' ? 'On-device (Read Along)' : activeEngine === 'webspeech' ? 'Browser speech' : 'Cloud (fallback)'}
            </Text>
          )}

          {/* Buttons row */}
          <View style={s.recordingActionRow}>
            {/* Pause / Resume */}
            <TouchableOpacity
              onPress={isPaused ? resumeRecording : pauseRecording}
              style={[s.recordingSecondaryBtn, { borderColor: colors.borderColor, backgroundColor: colors.bgDark + '80' }]}
              activeOpacity={0.7}
            >
              <Feather name={isPaused ? 'play' : 'pause'} size={18} color={colors.textMain} />
              <Text style={[s.recordingBtnText, { color: colors.textMain }]}>
                {isPaused ? 'Resume' : 'Pause'}
              </Text>
            </TouchableOpacity>

            {/* Done */}
            <TouchableOpacity
              onPress={stopReading}
              style={[s.recordingDoneBtn, { backgroundColor: colors.accentYellow, borderColor: colors.accentYellow }]}
              activeOpacity={0.7}
            >
              <Feather name="check" size={18} color="#fff" />
              <Text style={[s.recordingBtnText, { color: '#fff', fontWeight: '800' }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // ── Render: Preview Phase (playback, retry, submit) ───────────────
  const renderPreviewPhase = () => {
    const grad = (passage?.gradient || DEFAULT_GRADIENT) as [string, string];
    const mins = Math.floor(recordingTime / 60);
    const secs = recordingTime % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    return (
      <View style={s.readingContainer}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 180 }}>
          {/* Passage text */}
          <Text style={{ fontSize: 22, lineHeight: 40, color: colors.textMain, marginBottom: 24 }}>
            {passage?.text || ''}
          </Text>
        </ScrollView>

        {/* Preview controls bar at bottom */}
        <View style={[s.recordingBar, { backgroundColor: colors.cardDark, borderTopColor: colors.borderColor + '30' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Feather name="check-circle" size={16} color={colors.accentYellow} />
            <Text style={{ color: colors.accentYellow, fontWeight: '700', fontSize: 15 }}>Recording Complete</Text>
          </View>
          <Text style={{ color: colors.textDim, fontSize: 12, marginBottom: 14 }}>
            Duration: {timeStr} — Listen back or submit for analysis
          </Text>

          {/* Play / Retry / Submit */}
          <View style={s.previewActionRow}>
            {/* Play back */}
            <TouchableOpacity
              onPress={togglePlayback}
              style={[s.previewSecondaryBtn, { borderColor: grad[0], backgroundColor: grad[0] + '12' }]}
              activeOpacity={0.7}
            >
              <Feather name={isPlayingBack ? 'pause' : 'play'} size={16} color={grad[0]} />
              <Text style={[s.previewBtnText, { color: grad[0] }]}>
                {isPlayingBack ? 'Pause' : 'Listen'}
              </Text>
            </TouchableOpacity>

            {/* Retry */}
            <TouchableOpacity
              onPress={retryRecording}
              style={[s.previewSecondaryBtn, { borderColor: colors.borderColor, backgroundColor: colors.bgDark + '80' }]}
              activeOpacity={0.7}
            >
              <Feather name="rotate-ccw" size={16} color={colors.textMuted} />
              <Text style={[s.previewBtnText, { color: colors.textMuted }]}>Retry</Text>
            </TouchableOpacity>

            {/* Submit */}
            <TouchableOpacity
              onPress={submitRecording}
              style={[s.previewSubmitBtn, { backgroundColor: colors.accentYellow, borderColor: colors.accentYellow }]}
              activeOpacity={0.7}
            >
              <Feather name="send" size={16} color="#fff" />
              <Text style={[s.previewBtnText, { color: '#fff', fontWeight: '800' }]}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // ── Render: Analysing Phase ───────────────────────────────────────
  const renderAnalysingPhase = () => (
    <View style={[s.readingContainer, { justifyContent: 'center', alignItems: 'center', gap: 20 }]}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.accentYellow + '15', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.accentYellow} />
      </View>
      <Text style={{ color: colors.accentYellow, fontWeight: '700', fontSize: 18 }}>Analysing your reading...</Text>
      <Text style={{ color: colors.textDim, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 }}>
        Our AI is listening to your recording and checking each word
      </Text>
    </View>
  );

  // ── Render: Review Phase ───────────────────────────────────────────
  const renderReviewPhase = () => {
    const rc = RESULT_META[result?.level || 'developing'];
    const grad = (passage?.gradient || DEFAULT_GRADIENT) as [string, string];
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
        {/* Score card */}
        <LinearGradient colors={[rc.ring + '12', 'transparent']} style={[s.scoreCard, { borderColor: rc.ring + '30' }]}>
          <View style={[s.scoreRing, { borderColor: rc.ring }]}>
            <Text style={[s.scoreNum, { color: rc.ring }]}>{result?.accuracy ?? 0}%</Text>
          </View>
          <Text style={[s.scoreLabel, { color: rc.ring }]}>{rc.label}</Text>

          <View style={s.statsRow}>
            <View style={s.statItem}>
              <Feather name="check-circle" size={16} color="#93B0AC" />
              <Text style={[s.statNum, { color: colors.textMain }]}>{result?.correct ?? 0}</Text>
              <Text style={[s.statLabel, { color: colors.textDim }]}>Correct</Text>
            </View>
            <View style={s.statItem}>
              <Feather name="x-circle" size={16} color="#EFD1D4" />
              <Text style={[s.statNum, { color: colors.textMain }]}>{result?.misread ?? 0}</Text>
              <Text style={[s.statLabel, { color: colors.textDim }]}>Misread</Text>
            </View>
            <View style={s.statItem}>
              <Feather name="skip-forward" size={16} color="#C5BD96" />
              <Text style={[s.statNum, { color: colors.textMain }]}>{result?.skipped ?? 0}</Text>
              <Text style={[s.statLabel, { color: colors.textDim }]}>Skipped</Text>
            </View>
            <View style={s.statItem}>
              <Feather name="clock" size={16} color="#C3DCD8" />
              <Text style={[s.statNum, { color: colors.textMain }]}>{result?.wcpm ?? 0}</Text>
              <Text style={[s.statLabel, { color: colors.textDim }]}>WPM</Text>
            </View>
          </View>

          {/* Stars earned + Lexile */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 14, gap: 16 }}>
            {starsEarned > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFD70020', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 }}>
                <Feather name="star" size={18} color="#FFD700" />
                <Text style={{ color: '#FFD700', fontWeight: '800', fontSize: 16, marginLeft: 6 }}>+{starsEarned}</Text>
                <Text style={{ color: colors.textDim, fontSize: 11, marginLeft: 4 }}>stars</Text>
              </View>
            )}
            {(result as any)?.lexile != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.accentYellow + '15', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 }}>
                <Feather name="bar-chart-2" size={14} color={colors.accentYellow} />
                <Text style={{ color: colors.accentYellow, fontWeight: '700', fontSize: 13, marginLeft: 6 }}>Lexile {(result as any).lexile}L</Text>
                {(result as any)?.lexileChange !== 0 && (
                  <Text style={{ color: (result as any).lexileChange > 0 ? '#93B0AC' : '#EFD1D4', fontWeight: '700', fontSize: 12, marginLeft: 4 }}>
                    {(result as any).lexileChange > 0 ? '+' : ''}{(result as any).lexileChange}
                  </Text>
                )}
              </View>
            )}
          </View>
        </LinearGradient>

        {/* AI Feedback */}
        {result?.feedback ? (
          <View style={[s.feedbackCard, { borderColor: colors.borderColor + '30' }]}>
            <View style={[s.feedbackIconCircle, { backgroundColor: colors.accentYellow + '15' }]}>
              <Feather name="message-circle" size={14} color={colors.accentYellow} />
            </View>
            <Text style={[s.feedbackText, { color: colors.textMain }]}>{result.feedback}</Text>
          </View>
        ) : null}

        {/* Words review */}
        <Text style={[s.sectionTitle, { color: colors.textDim, marginTop: 16 }]}>Your Reading</Text>
        <View style={[s.textCard, { borderColor: colors.borderColor + '30' }]}>
          <Text style={s.readingText}>
            {words.map((w, i) => {
              const status = wordStatuses[i];
              return (
                <Text
                  key={i}
                  style={{
                    color: status === 'correct' ? '#93B0AC'
                         : status === 'misread' ? '#EFD1D4'
                         : status === 'skipped' ? '#C5BD96'
                         : colors.textDim,
                    fontWeight: status !== 'pending' ? '600' : '400',
                    textDecorationLine: status === 'misread' ? 'underline' : 'none',
                    fontSize: 18,
                    lineHeight: 32,
                  }}
                >
                  {w}{' '}
                </Text>
              );
            })}
          </Text>
        </View>

        {/* Error details */}
        {result?.errors && result.errors.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <Text style={[s.sectionTitle, { color: colors.textDim }]}>Words to Practice</Text>
            {result.errors.slice(0, 10).map((e, i) => (
              <View key={i} style={[s.errorRow, { borderColor: colors.borderColor + '20' }]}>
                <View style={[s.errorBadge, { backgroundColor: e.type === 'misread' ? '#EFD1D420' : '#C5BD9620' }]}>
                  <Text style={{ fontSize: 10, color: e.type === 'misread' ? '#EFD1D4' : '#C5BD96', fontWeight: '700' }}>
                    {e.type === 'misread' ? 'Misread' : 'Skipped'}
                  </Text>
                </View>
                <Text style={{ color: colors.textMain, fontSize: 15, fontWeight: '600', flex: 1 }}>{e.word}</Text>
                <Text style={{ color: colors.textDim, fontSize: 12 }}>word #{e.position}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Action buttons */}
        <View style={[s.actionRow, { marginTop: 20, marginBottom: 40 }]}>
          <TouchableOpacity
            style={[s.actionBtn, { backgroundColor: colors.cardDark, borderColor: colors.borderColor + '40' }]}
            onPress={tryAgain}
            activeOpacity={0.7}
          >
            <Feather name="rotate-ccw" size={16} color={colors.accentYellow} />
            <Text style={{ color: colors.accentYellow, fontWeight: '600', fontSize: 14 }}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, s.primaryBtn, { backgroundColor: colors.accentYellow }]}
            onPress={() => setPhase('pick')}
            activeOpacity={0.7}
          >
            <Feather name="book-open" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>New Passage</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  return (
    <ScreenLayout>
      <Header
        title="Read Aloud"
        subtitle={`${userGrade} \u00B7 IB PYP Reading Practice`}
        showBack
        onBack={handleHeaderBack}
      />
      <View style={{ flex: 1 }}>
        {phase === 'pick' && needsCalibration && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            {renderCalibrationPrompt()}
          </ScrollView>
        )}
        {phase === 'pick' && !needsCalibration && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
            {renderPickPhase()}
          </ScrollView>
        )}
        {phase === 'idle' && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
            {renderIdlePhase()}
          </ScrollView>
        )}
        {phase === 'countdown' && renderCountdown()}
        {phase === 'reading' && renderReadingPhase()}
        {phase === 'preview' && renderPreviewPhase()}
        {phase === 'analysing' && renderAnalysingPhase()}
        {phase === 'reviewing' && renderReviewPhase()}
      </View>
    </ScreenLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════
function makeStyles(c: AppColors, isDark: boolean) {
  return StyleSheet.create({
    // ── Pick phase ─────────────────────────────────────────────────
    pickContainer: { gap: 16 },
    heroCard: {
      alignItems: 'center', gap: 12, paddingVertical: 32,
      borderRadius: 20,
      borderWidth: 1, borderColor: c.borderColor,
      marginBottom: 4,
    },
    heroIconCircle: {
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: c.accentYellow + '18',
      alignItems: 'center', justifyContent: 'center',
    },
    heroTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
    heroSub: { fontSize: 14, textAlign: 'center', paddingHorizontal: 32, lineHeight: 22 },
    sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: 1.2, marginBottom: 8 },

    // ── Filter tabs ───────────────────────────────────────────────
    filterRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    filterTab: {
      paddingHorizontal: 16, paddingVertical: 8,
      borderRadius: 20, borderWidth: 1,
      borderColor: c.borderColor,
    },
    filterTabText: { fontSize: 13, fontWeight: '600' },

    // ── 2-column grid ─────────────────────────────────────────────
    grid: {
      flexDirection: 'row', flexWrap: 'wrap',
      gap: 14,
    },
    gridCard: {
      width: '48.5%' as any,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: c.cardDark,
      borderWidth: 1,
    },
    gridCardGradient: {
      height: 88,
      alignItems: 'center', justifyContent: 'center',
    },
    gridCardIconCircle: {
      width: 48, height: 48, borderRadius: 24,
      backgroundColor: 'rgba(255,255,255,0.25)',
      alignItems: 'center', justifyContent: 'center',
    },
    gridCardBody: {
      padding: 14, gap: 6,
    },
    gridCardTitle: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
    gridCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    gridCardTopic: { fontSize: 11 },
    gridCardWords: { fontSize: 11, marginTop: 2 },
    levelPill: {
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
      borderWidth: 1,
    },
    levelPillText: { fontSize: 10, fontWeight: '700' },

    surpriseBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, padding: 14, borderRadius: 14, borderWidth: 1,
      backgroundColor: c.accentYellow + '08',
      marginTop: 4,
    },

    // ── Idle phase ─────────────────────────────────────────────────
    idleContainer: { flex: 1, padding: 20 },
    passageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
    backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.borderColor },
    passageTitleLarge: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },

    textCard: {
      padding: 24, borderRadius: 16,
      backgroundColor: c.cardDark, borderWidth: 1,
      marginBottom: 20,
      overflow: 'hidden',
    },
    textCardGradientBar: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 4,
    },
    passageTextWrap: { flexWrap: 'wrap', flexDirection: 'row' },
    passageText: { fontSize: 19, lineHeight: 36, color: c.textMain },

    actionRow: { flexDirection: 'row', gap: 12 },
    actionBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, padding: 16, borderRadius: 14, borderWidth: 1,
    },
    primaryBtn: { borderWidth: 0 },

    // ── Countdown ──────────────────────────────────────────────────
    countdownOverlay: {
      flex: 1, justifyContent: 'center', alignItems: 'center',
    },
    countdownCircle: {
      width: 140, height: 140, borderRadius: 70,
      backgroundColor: c.accentYellow + '15',
      borderWidth: 3, borderColor: c.accentYellow + '40',
      alignItems: 'center', justifyContent: 'center',
    },
    countdownNum: { fontSize: 56, fontWeight: '900' },
    countdownHint: { fontSize: 16, marginTop: 16 },

    // ── Reading phase ──────────────────────────────────────────────
    readingContainer: { flex: 1 },
    micBar: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      padding: 14, paddingHorizontal: 20,
      borderBottomWidth: 1, borderBottomColor: c.borderColor + '20',
    },
    micPulse: { width: 8, height: 8, borderRadius: 4 },
    stopBtn: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: '#991b1b', paddingHorizontal: 14, paddingVertical: 8,
      borderRadius: 10,
    },
    readingScroll: { flex: 1, backgroundColor: c.bgDark },
    liveWordsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      gap: 6,
    },
    liveWordSlot: {
      position: 'relative',
      marginBottom: 8,
      paddingLeft: 2,
    },
    liveCaret: {
      position: 'absolute',
      left: -2,
      top: 5,
      bottom: 5,
      width: 3,
      borderRadius: 2,
    },
    liveWord: {
      fontSize: 24,
      lineHeight: 34,
      paddingHorizontal: 3,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: 1,
    },
    readingText: { flexWrap: 'wrap', flexDirection: 'row' },
    recordingBar: {
      paddingHorizontal: 24, paddingVertical: 18,
      borderTopWidth: 1, alignItems: 'center',
    },
    waveformRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 3, height: 44, marginBottom: 4,
    },
    recCtrlBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 6, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
    },
    recordingActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      flexWrap: 'wrap',
      maxWidth: 320,
      width: '100%',
    },
    recordingSecondaryBtn: {
      height: 48,
      minWidth: 104,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 14,
      borderWidth: 1.5,
    },
    recordingDoneBtn: {
      height: 50,
      minWidth: 116,
      paddingHorizontal: 22,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 14,
      borderWidth: 1.5,
    },
    recordingBtnText: {
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 18,
    },
    previewActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      flexWrap: 'wrap',
      maxWidth: 360,
      width: '100%',
    },
    previewSecondaryBtn: {
      height: 46,
      minWidth: 92,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 14,
      borderWidth: 1.5,
    },
    previewSubmitBtn: {
      height: 48,
      minWidth: 116,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 14,
      borderWidth: 1.5,
    },
    previewBtnText: {
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 18,
    },

    // ── Review phase ───────────────────────────────────────────────
    scoreCard: {
      alignItems: 'center', padding: 28, borderRadius: 20,
      borderWidth: 1, marginBottom: 16,
      overflow: 'hidden',
    },
    scoreRing: {
      width: 110, height: 110, borderRadius: 55, borderWidth: 5,
      alignItems: 'center', justifyContent: 'center', marginBottom: 10,
    },
    scoreNum: { fontSize: 30, fontWeight: '900' },
    scoreLabel: { fontSize: 22, fontWeight: '800', marginBottom: 20 },
    statsRow: { flexDirection: 'row', gap: 24 },
    statItem: { alignItems: 'center', gap: 4 },
    statNum: { fontSize: 20, fontWeight: '700' },
    statLabel: { fontSize: 11 },

    feedbackCard: {
      flexDirection: 'row', gap: 12, padding: 18, borderRadius: 14,
      backgroundColor: c.cardDark, borderWidth: 1, alignItems: 'flex-start',
    },
    feedbackIconCircle: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
      marginTop: 2,
    },
    feedbackText: { flex: 1, fontSize: 14, lineHeight: 22 },

    errorRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      padding: 12, borderBottomWidth: 1,
    },
    errorBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  });
}
