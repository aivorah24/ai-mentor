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

type Phase = 'pick' | 'idle' | 'countdown' | 'reading' | 'preview' | 'analysing' | 'reviewing';
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
  if (expected.length <= 3) return spoken === expected;
  return levenshtein(spoken, expected) <= (expected.length > 6 ? 2 : 1);
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
  const { stats } = useStudentData();
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [liveSpeechStatus, setLiveSpeechStatus] = useState<'idle' | 'listening' | 'unavailable' | 'error'>('idle');
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
  const rafRef = useRef<number>(0);

  // Keep refs in sync
  useEffect(() => { sourcePosRef.current = sourcePos; }, [sourcePos]);
  useEffect(() => { wordStatusesRef.current = wordStatuses; }, [wordStatuses]);

  // ── Fetch passage list on mount ─────────────────────────────────────
  useEffect(() => {
    fetch(`${SERVER_URL}/read-aloud/passages?grade=${encodeURIComponent(userGrade)}`)
      .then(r => r.json())
      .then(data => setPassageList(data.passages || []))
      .catch(() => {});
  }, [userGrade]);

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
        setWordStatuses(new Array(w.length).fill('pending'));
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

      const audioUrl = `${SERVER_URL}${data.audioUrl}`;
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
  const startCountdown = useCallback(() => {
    stopListening();
    setPhase('countdown');
    setCountdownNum(3);
    let count = 3;
    countdownTimer.current = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(countdownTimer.current);
        setCountdownNum(0);
        beginReading();
      } else {
        setCountdownNum(count);
      }
    }, 800);
  }, []);

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

  const updateLiveWordHighlight = useCallback((spokenWords: string[]) => {
    const passageWords = wordsRef.current;
    if (!passageWords.length || !spokenWords.length) return;

    const liveStatuses: WordStatus[] = new Array(passageWords.length).fill('pending');
    let pos = 0;

    for (const spokenRaw of spokenWords) {
      if (pos >= passageWords.length) break;
      const spoken = normalize(spokenRaw);
      if (!spoken) continue;

      if (fuzzyMatch(spoken, normalize(passageWords[pos]))) {
        liveStatuses[pos] = 'correct';
        pos++;
        continue;
      }

      let foundAhead = false;
      for (let ahead = 1; ahead <= 3 && pos + ahead < passageWords.length; ahead++) {
        if (fuzzyMatch(spoken, normalize(passageWords[pos + ahead]))) {
          for (let k = pos; k < pos + ahead; k++) liveStatuses[k] = 'skipped';
          liveStatuses[pos + ahead] = 'correct';
          pos = pos + ahead + 1;
          foundAhead = true;
          break;
        }
      }

      if (!foundAhead) {
        liveStatuses[pos] = 'misread';
        pos++;
      }
    }

    for (let i = 0; i < liveStatuses.length; i++) {
      if (liveStatuses[i] === 'current') liveStatuses[i] = 'pending';
    }

    if (pos < liveStatuses.length && liveStatuses[pos] === 'pending') {
      liveStatuses[pos] = 'current';
    }

    setSourcePos(pos);
    sourcePosRef.current = pos;
    setWordStatuses(liveStatuses);
    wordStatusesRef.current = liveStatuses;
  }, []);

  const stopLiveRecognition = useCallback(() => {
    liveRecognitionActiveRef.current = false;
    setLiveSpeechStatus('idle');
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.stop(); } catch {}
    recognitionRef.current = null;
  }, []);

  const startLiveRecognition = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setLiveSpeechStatus('unavailable');
      return;
    }

    stopLiveRecognition();
    liveRecognitionActiveRef.current = true;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const spoken = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) {
          liveFinalTranscriptRef.current = `${liveFinalTranscriptRef.current} ${spoken}`.trim();
        } else {
          interimTranscript += ` ${spoken}`;
        }
      }
      const transcript = `${liveFinalTranscriptRef.current} ${interimTranscript}`.trim();
      updateLiveWordHighlight(transcript.match(/\S+/g) || []);
    };
    recognition.onerror = (event: any) => {
      console.warn('[ReadAloud] Live recognition error:', event?.error);
      setLiveSpeechStatus('error');
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!liveRecognitionActiveRef.current) return;
      setTimeout(() => {
        if (liveRecognitionActiveRef.current) startLiveRecognition();
      }, 150);
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch (e) {
      console.warn('[ReadAloud] Live recognition start failed:', e);
      liveRecognitionActiveRef.current = false;
      setLiveSpeechStatus('error');
      recognitionRef.current = null;
      return;
    }
    setLiveSpeechStatus('listening');
  }, [stopLiveRecognition, updateLiveWordHighlight]);

  // ── Begin Recording ───────────────────────────────────────────────
  const beginReading = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Alert.alert('Not Supported', 'Read Aloud works in your web browser.');
      setPhase('idle');
      return;
    }

    // Request microphone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('[ReadAloud] Mic denied:', err);
      Alert.alert('Microphone Access', 'Please allow microphone access in your browser settings.');
      setPhase('idle');
      return;
    }
    mediaStreamRef.current = stream;

    // Reset state
    const initialStatuses: WordStatus[] = new Array(words.length).fill('pending');
    if (initialStatuses.length > 0) initialStatuses[0] = 'current';
    setWordStatuses(initialStatuses);
    wordStatusesRef.current = initialStatuses;
    setSourcePos(0);
    sourcePosRef.current = 0;
    liveFinalTranscriptRef.current = '';
    liveRecognitionActiveRef.current = false;
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
    console.log(`[ReadAloud] Recording started (${recorder.mimeType})`);

    // Start waveform visualizer
    startWaveform(stream);
    startLiveRecognition();

    // Timer only. Word highlighting is driven by live speech recognition.
    recordingTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setRecordingTime(Math.floor(elapsed));
    }, 200);
  }, [words, startWaveform, startLiveRecognition]);

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
      setResult(data);
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
  }, [user, userGrade]);

  const tryAgain = useCallback(() => {
    if (!passage) return;
    const w = splitWords(passage.text);
    setWords(w);
    setWordStatuses(new Array(w.length).fill('pending'));
    setSourcePos(0);
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

  // ── Render: Pick Phase ─────────────────────────────────────────────
  const renderPickPhase = () => (
    <View style={s.pickContainer}>
      {/* Hero */}
      <LinearGradient colors={['#93B0AC18', '#C3DCD810']} style={s.heroCard}>
        <View style={s.heroIconCircle}>
          <Feather name="mic" size={28} color={colors.primary} />
        </View>
        <Text style={[s.heroTitle, { color: colors.textMain }]}>Read Aloud</Text>
        <Text style={[s.heroSub, { color: colors.textMuted }]}>
          Pick a story, listen or read it aloud, and see how you do!
        </Text>
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
                active && { backgroundColor: lm?.bg || colors.primary + '18', borderColor: lm?.border || colors.primary + '40' },
              ]}
              onPress={() => setDiffFilter(f)}
              activeOpacity={0.7}
            >
              <Text style={[
                s.filterTabText,
                { color: active ? (lm?.text || colors.primary) : colors.textDim },
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
        style={[s.surpriseBtn, { borderColor: colors.primary + '40' }]}
        onPress={() => loadPassage()}
        disabled={loadingPassage}
        activeOpacity={0.7}
      >
        {loadingPassage
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <>
              <Feather name="shuffle" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }}>Surprise Me!</Text>
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
            style={[s.actionBtn, s.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={startCountdown}
            activeOpacity={0.7}
          >
            <Feather name="mic" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Start Reading</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ── Render: Countdown ──────────────────────────────────────────────
  const renderCountdown = () => (
    <View style={[s.countdownOverlay, { backgroundColor: colors.bgDark }]}>
      <View style={s.countdownCircle}>
        <Text style={[s.countdownNum, { color: colors.primary }]}>{countdownNum > 0 ? countdownNum : 'Go!'}</Text>
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
                <View key={`${w}-${i}`} style={s.liveWordSlot}>
                  {isCurrent ? <View style={[s.liveCaret, { backgroundColor: colors.primary }]} /> : null}
                  <Text
                    style={[
                      s.liveWord,
                      {
                        color: status === 'correct' ? '#93B0AC'
                             : status === 'misread' ? '#EFD1D4'
                             : status === 'skipped' ? '#C5BD96'
                             : isCurrent ? colors.textMain
                             : colors.textMain + 'CC',
                        backgroundColor: isCurrent ? colors.primary + '18'
                             : status === 'correct' ? '#93B0AC10'
                             : status === 'misread' ? '#EFD1D414'
                             : status === 'skipped' ? '#C5BD9614'
                             : 'transparent',
                        borderColor: isCurrent ? colors.primary + '70' : 'transparent',
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
                  backgroundColor: isPaused ? colors.textDim : colors.primary,
                  opacity: isPaused ? 0.4 : 0.7 + (h / 40) * 0.3,
                }}
              />
            ))}
          </View>

          {/* Timer */}
          <Text style={{
            color: isPaused ? colors.textDim : colors.primary,
            fontWeight: '700', fontSize: 22,
            fontVariant: ['tabular-nums'],
            marginVertical: 8,
          }}>
            {timeStr}
          </Text>
          <Text style={{ color: colors.textDim, fontSize: 12, marginBottom: 14 }}>
            {isPaused ? 'Paused'
              : liveSpeechStatus === 'listening' ? 'Listening... read the highlighted word aloud'
              : liveSpeechStatus === 'unavailable' ? 'Live highlight is not supported in this browser'
              : liveSpeechStatus === 'error' ? 'Live highlight needs microphone/speech permission'
              : 'Recording... read the passage aloud'}
          </Text>

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
              style={[s.recordingDoneBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
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
            <Feather name="check-circle" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 15 }}>Recording Complete</Text>
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
              style={[s.previewSubmitBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
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
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 18 }}>Analysing your reading...</Text>
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
        </LinearGradient>

        {/* AI Feedback */}
        {result?.feedback ? (
          <View style={[s.feedbackCard, { borderColor: colors.borderColor + '30' }]}>
            <View style={[s.feedbackIconCircle, { backgroundColor: colors.primary + '15' }]}>
              <Feather name="message-circle" size={14} color={colors.primary} />
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
            <Feather name="rotate-ccw" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, s.primaryBtn, { backgroundColor: colors.primary }]}
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
        {phase === 'pick' && (
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
      backgroundColor: c.primary + '18',
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
      backgroundColor: c.primary + '08',
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
      backgroundColor: c.primary + '15',
      borderWidth: 3, borderColor: c.primary + '40',
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
