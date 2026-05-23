import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Platform, Image, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface Page { pageNumber: number; text: string; sceneIcon: string; sceneColor: string; sceneLabel: string; imageUrl: string | null; }
interface Story { id: string; title: string; subtitle: string; coverColor: string; collection: string; pages: Page[]; }
type VoiceOption = 'grandmother' | 'grandfather';

const VOICE_CONFIG: Record<VoiceOption, { label: string; icon: string; color: string }> = {
  grandmother: { label: 'Grandmother', icon: 'heart',  color: '#ec4899' },
  grandfather: { label: 'Grandfather', icon: 'anchor', color: '#0891b2' },
};

// Story-specific ambient music profiles
const STORY_AMBIENT: Record<string, { root: number; style: 'tanpura' | 'flute' | 'tabla' | 'veena' }> = {
  prahlada:             { root: 220,  style: 'tanpura' }, // devotional drone
  hanuman:              { root: 196,  style: 'tabla'   }, // energetic rhythm
  ramayana_rama_sita:   { root: 264,  style: 'flute'   }, // peaceful bansuri
  bhagavad_gita_arjuna: { root: 220,  style: 'veena'   }, // wisdom, meditative
  dhruva:               { root: 247,  style: 'tanpura' }, // determination drone
  ambarisha:            { root: 220,  style: 'veena'   }, // devotion, calm
  bharat:               { root: 264,  style: 'flute'   }, // gentle, lyrical
};

function getPastelGradient(c: string): [string, string] {
  const map: Record<string, [string, string]> = {
    '#7c3aed': ['#9B8FC0', '#7BA8A4'], '#4f46e5': ['#8FA0C0', '#7BA8A4'],
    '#0ea5e9': ['#7EA8C0', '#82A896'], '#6366f1': ['#9B8FC0', '#7EA8C0'],
    '#ea580c': ['#C0A07E', '#7BA8A4'], '#dc2626': ['#C08898', '#9B8FC0'],
    '#16a34a': ['#82A896', '#7BA8A4'], '#0891b2': ['#7EA8C0', '#82A896'],
    '#10b981': ['#82A896', '#7EA8C0'], '#f59e0b': ['#C0A07E', '#82A896'],
  };
  return map[c] ?? ['#7BA8A4', '#82A896'];
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+[\s]*/g);
  return parts && parts.length > 1 ? parts : [text];
}

// Split text into words, preserving trailing spaces so joined text is identical
function splitWords(text: string): string[] {
  return text.match(/\S+\s*/g) || [text];
}

// Common short function words that TTS speaks faster than syllable count suggests
const FUNCTION_WORDS = new Set([
  'a','an','the','of','in','on','at','to','is','was','he','she','it','we',
  'and','but','or','not','no','do','so','be','by','up','as','if','my','me',
  'us','his','her','its','our','had','has','for','are','were','did','can',
  'may','all','one','two','any','out','with','than','that','this','from',
  'into','onto','upon','over','just','even','much','very','also','then',
  'when','what','who','how','why','where','which','they','them','their',
  'would','could','should','have','been','will','more','most','some','such',
  'each','many','only','other','these','those','both','after','about',
  'there','here','now','still','too','yet','ever','once','back','well',
  'got','get','let','put','came','come','went','go','him','did','its',
]);

// Estimate spoken duration weight for a token (word + trailing spaces/punctuation).
// Returns a float: 1.0 ≈ average content word, lower = shorter, higher = longer + pause.
function wordWeight(token: string): number {
  const clean = token.toLowerCase().replace(/[^a-z]/g, '');
  // Count vowel groups as syllable estimate, with silent-e correction
  const vowelGroups = clean.match(/[aeiou]+/g);
  const raw = vowelGroups ? vowelGroups.length : 1;
  const silentE = clean.length > 2 && clean.endsWith('e') && !/[aeiou]/.test(clean[clean.length - 2]) ? 1 : 0;
  let syllables = Math.max(1, raw - silentE);
  // Function words are spoken ~30% faster (but never below 0.4 units)
  if (FUNCTION_WORDS.has(clean)) syllables = Math.max(0.4, syllables * 0.7);
  // Punctuation pauses: sentence-end adds ~1.5 units, comma/dash adds ~0.5
  if (/[.!?]/.test(token)) syllables += 1.5;
  else if (/[,;:\u2014\u2013]/.test(token)) syllables += 0.5;
  return syllables;
}

// Build time-proportion boundaries using the spoken-duration weight model.
// Much more accurate than raw character count for TTS highlight sync.
function buildBoundaries(tokens: string[]): number[] {
  const weights = tokens.map(t => wordWeight(t));
  const total   = weights.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  return weights.map(w => { cum += w; return cum / total; });
}

// Page flip sound — served from Express so it works in web builds
let _flipAudio: HTMLAudioElement | null = null;

function playPageFlip() {
  if (Platform.OS !== 'web') return;
  try {
    if (!_flipAudio) {
      _flipAudio = new Audio(`${SERVER_URL}/sounds/page-flip.mp3`);
      _flipAudio.volume = 0.6;
    }
    _flipAudio.currentTime = 0;
    _flipAudio.play().catch(() => {});
  } catch {}
}

// Indian ambient music via Web Audio API — story-specific instrument styles
function createAmbientMusic(storyId: string) {
  if (Platform.OS !== 'web') return null;
  try {
    const profile = STORY_AMBIENT[storyId] ?? { root: 220, style: 'tanpura' };
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    // Resume in case browser auto-suspended the context
    if (ctx.state === 'suspended') ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Reverb convolver for warmth
    function makeReverb(duration: number, decay: number) {
      const len = ctx.sampleRate * duration;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      const conv = ctx.createConvolver();
      conv.buffer = buf;
      return conv;
    }
    const reverb = makeReverb(2.5, 3);
    reverb.connect(master);

    const root = profile.root; // e.g. 220 Hz = A3
    const nodes: any[] = [];

    if (profile.style === 'tanpura') {
      // Tanpura: 4 strings — Pa, Sa (low), Sa (high), Ma plucked in slow cycle
      const strings = [root * 0.75, root, root * 2, root * 4/3];
      strings.forEach((freq, si) => {
        function pluck() {
          try {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            const filt = ctx.createBiquadFilter();
            filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = 12;
            osc.type = 'sawtooth'; osc.frequency.value = freq;
            osc.connect(filt); filt.connect(env); env.connect(reverb); env.connect(master);
            env.gain.setValueAtTime(0, ctx.currentTime);
            env.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 0.04);
            env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3.5);
            osc.start(); osc.stop(ctx.currentTime + 3.6);
            const tid = setTimeout(pluck, (si * 1800 + 7200));
            nodes.push(tid);
          } catch {}
        }
        const initDelay = si * 1800;
        const t = setTimeout(pluck, initDelay);
        nodes.push(t);
      });

    } else if (profile.style === 'flute') {
      // Bansuri flute: breathy sine + noise, melodic Sa-Re-Ga phrases
      const scale = [root, root*9/8, root*5/4, root*4/3, root*3/2, root*5/3, root*15/8, root*2];
      const phrases = [[0,2,4,2,0], [4,5,4,2,0], [0,4,7,4,0], [2,4,5,4,2]];
      let phraseIdx = 0;
      function playPhrase() {
        try {
          const phrase = phrases[phraseIdx % phrases.length];
          phraseIdx++;
          phrase.forEach((deg, ni) => {
            const freq = scale[deg % scale.length];
            const t0 = ctx.currentTime + ni * 0.9;
            // Breath noise
            const noiseLen = ctx.sampleRate * 0.7;
            const nbuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
            const nd = nbuf.getChannelData(0);
            for (let i = 0; i < noiseLen; i++) nd[i] = (Math.random() * 2 - 1) * 0.015;
            const nsrc = ctx.createBufferSource(); nsrc.buffer = nbuf;
            const nbpf = ctx.createBiquadFilter(); nbpf.type = 'bandpass'; nbpf.frequency.value = freq * 1.1; nbpf.Q.value = 8;
            const nenv = ctx.createGain(); nenv.gain.value = 0;
            nsrc.connect(nbpf); nbpf.connect(nenv); nenv.connect(master);
            nenv.gain.setValueAtTime(0, t0); nenv.gain.linearRampToValueAtTime(0.04, t0 + 0.08); nenv.gain.linearRampToValueAtTime(0, t0 + 0.65);
            nsrc.start(t0); nsrc.stop(t0 + 0.7);
            // Tone
            const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
            const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.5;
            const vibG = ctx.createGain(); vibG.gain.value = freq * 0.012;
            vib.connect(vibG); vibG.connect(osc.frequency);
            const env = ctx.createGain(); env.gain.value = 0;
            osc.connect(env); env.connect(reverb); env.connect(master);
            env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.06, t0 + 0.12); env.gain.setValueAtTime(0.055, t0 + 0.5); env.gain.linearRampToValueAtTime(0, t0 + 0.75);
            osc.start(t0); vib.start(t0); osc.stop(t0 + 0.8); vib.stop(t0 + 0.8);
          });
          const nextIn = phrase.length * 900 + 1800;
          const t = setTimeout(playPhrase, nextIn);
          nodes.push(t);
        } catch {}
      }
      playPhrase();

    } else if (profile.style === 'tabla') {
      // Tabla: bol pattern — dha dhin dhin dha (16-beat teentaal feel, slow)
      const bpm = 52;
      const beat = 60000 / bpm;
      const pattern = [1,0,0.6,0,1,0,0.6,0.4,1,0,0.6,0,1,0,0.6,0];
      let step = 0;
      function tick() {
        try {
          const vel = pattern[step % pattern.length];
          if (vel > 0) {
            const freq = step % 4 === 0 ? root * 0.5 : root * 0.67;
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = freq * 2; filt.Q.value = 6;
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq * 3, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(freq, ctx.currentTime + 0.06);
            osc.connect(filt); filt.connect(env); env.connect(reverb); env.connect(master);
            env.gain.setValueAtTime(vel * 0.07, ctx.currentTime);
            env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.start(); osc.stop(ctx.currentTime + 0.28);
          }
          step++;
          const t = setTimeout(tick, beat / 2);
          nodes.push(t);
        } catch {}
      }
      tick();

    } else if (profile.style === 'veena') {
      // Veena: plucked string — arpeggiated Sa-Ma-Pa-Sa chord, slow and meditative
      const chord = [root, root*5/4, root*3/2, root*2];
      function arpeggio() {
        try {
          chord.forEach((freq, fi) => {
            const t0 = ctx.currentTime + fi * 0.22;
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            const filt = ctx.createBiquadFilter(); filt.type = 'peaking'; filt.frequency.value = freq; filt.gain.value = 6; filt.Q.value = 2;
            // Pluck: triangle wave (warmer than sawtooth)
            osc.type = 'triangle'; osc.frequency.value = freq;
            // Add slight 2nd harmonic
            const osc2 = ctx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = freq * 2;
            const g2 = ctx.createGain(); g2.gain.value = 0.18;
            osc2.connect(g2); g2.connect(env);
            osc.connect(filt); filt.connect(env); env.connect(reverb); env.connect(master);
            env.gain.setValueAtTime(0, t0);
            env.gain.linearRampToValueAtTime(0.06, t0 + 0.02);
            env.gain.exponentialRampToValueAtTime(0.001, t0 + 4.0);
            osc.start(t0); osc2.start(t0); osc.stop(t0 + 4.1); osc2.stop(t0 + 4.1);
          });
          const t = setTimeout(arpeggio, 6000);
          nodes.push(t);
        } catch {}
      }
      arpeggio();
    }

    // Sa drone (root + octave) — very soft undertone for all styles
    [root, root * 2].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain(); g.gain.value = [0.018, 0.009][i];
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 600;
      osc.type = 'sine'; osc.frequency.value = freq;
      osc.connect(filt); filt.connect(g); g.connect(master);
      osc.start();
      nodes.push(osc);
    });

    // Fade in gently — keep gain low so it doesn't compete with narration
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 3);

    return {
      ctx,
      master,
      pause() {
        try {
          master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
          master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
        } catch {}
      },
      resume() {
        try {
          master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
          master.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 1);
        } catch {}
      },
      stop() {
        try {
          master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
          master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
          nodes.forEach(n => { try { if (typeof n === 'number') clearTimeout(n); else n.stop?.(); } catch {} });
          setTimeout(() => { try { ctx.close(); } catch {} }, 1600);
        } catch {}
      }
    };
  } catch { return null; }
}

export default function StoryReaderScreen({ route, navigation }: any) {
  const { storyId } = route.params ?? {};
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [story,        setStory]        = useState<Story | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [currentPage,  setCurrentPage]  = useState(0);
  const [voice,        setVoice]        = useState<VoiceOption>('grandmother');
  const [isLoading,    setIsLoading]    = useState(false);
  const [playing,      setPlaying]      = useState(false);
  const [autoPlay,     setAutoPlay]     = useState(false);
  const [wordIndex,    setWordIndex]    = useState(0);
  const [donePages,    setDonePages]    = useState<Set<number>>(new Set());
  const [playbackRate, setPlaybackRate] = useState(1);

  const audioRef   = useRef<any>(null);
  const ambientRef = useRef<any>(null);
  const playGenRef = useRef(0);
  const fadeAnim   = useRef(new Animated.Value(1)).current;
  const slideAnim  = useRef(new Animated.Value(0)).current;
  const rafRef     = useRef<number>(0);
  const audioMeta  = useRef<{ words: string[]; timings: { startTime: number; endTime: number }[] | null; wordBounds: number[] | null; timingProvider: string } | null>(null);

  // Load completed pages from storage
  useEffect(() => {
    AsyncStorage.getItem(`story_done_${storyId}`).then(v => {
      if (v) setDonePages(new Set(JSON.parse(v)));
    }).catch(() => {});
  }, [storyId]);

  useEffect(() => {
    fetch(`${SERVER_URL}/stories/${storyId}`)
      .then(r => r.json())
      .then((data: Story) => {
        setStory(data);
        setLoading(false);
        // Auto-start ambient music when story opens (soft background)
        if (Platform.OS === 'web') {
          setTimeout(() => {
            if (!ambientRef.current) {
              ambientRef.current = createAmbientMusic(data.id);
            }
          }, 500);
        }
      })
      .catch(() => setLoading(false));
    return () => { stopAudio(); ambientRef.current?.stop(); ambientRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  useEffect(() => { setWordIndex(0); }, [currentPage]);

  // Apply playback rate change to audio that's already playing
  useEffect(() => {
    if (audioRef.current) {
      try { audioRef.current.playbackRate = playbackRate; } catch {}
    }
  }, [playbackRate]);

  useEffect(() => {
    if (autoPlay && story) {
      const page = story.pages[currentPage];
      if (page) speakPage(page.pageNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, autoPlay]);

  // ── rAF-based highlight loop (60 fps) — speed-aware word sync ──────────────
  function cancelHighlightLoop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
  }

  function startHighlightLoop(
    audio: any,
    words: string[],
    timings: { startTime: number; endTime: number }[] | null,
    wordBounds: number[] | null,
    timingProvider: string = 'none',
  ) {
    cancelHighlightLoop();
    let lastRendered = -1;
    function tick() {
      if (!audio || audio.paused || audio.ended) return;
      let idx: number;
      if (timings) {
        // ElevenLabs & Whisper = exact timestamps from actual audio → no offset.
        const t = audio.currentTime;
        idx = 0;
        for (let i = 0; i < timings.length; i++) {
          const wordEnd = timings[i + 1]?.startTime ?? (audio.duration + 1);
          if (t >= timings[i].startTime && t < wordEnd) { idx = i; break; }
          if (t >= timings[i].startTime) idx = i;
        }
      } else {
        // Pure proportion fallback (no silence data at all).
        // Apply a small lag so highlight trails audio instead of jumping ahead.
        if (!audio.duration) { rafRef.current = requestAnimationFrame(tick); return; }
        const LAG = 0.18 / (audio.playbackRate || 1);
        const t = Math.max(0, audio.currentTime - LAG);
        const ratio = t / audio.duration;
        const found = wordBounds!.findIndex(b => ratio < b);
        idx = found === -1 ? words.length - 1 : found;
      }
      if (idx !== lastRendered) { lastRendered = idx; setWordIndex(idx); }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function markPageDone(pageNum: number) {
    setDonePages(prev => {
      const next = new Set(prev).add(pageNum);
      AsyncStorage.setItem(`story_done_${storyId}`, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }

  function pauseAudio() {
    cancelHighlightLoop();
    if (audioRef.current) try { audioRef.current.pause(); } catch {}
    // Fade out ambient music
    try { ambientRef.current?.pause(); } catch {}
    setPlaying(false);
  }

  function stopAudio() {
    cancelHighlightLoop();
    audioMeta.current = null;
    playGenRef.current++;
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {}
      audioRef.current = null;
    }
    ambientRef.current?.stop(); ambientRef.current = null;
    setIsLoading(false); setPlaying(false);
  }

  function resumeAudio() {
    if (!audioRef.current) return;
    try {
      audioRef.current.play();
      // Restart highlight loop from current position
      if (audioMeta.current) {
        const { words, timings, wordBounds, timingProvider } = audioMeta.current;
        startHighlightLoop(audioRef.current, words, timings, wordBounds, timingProvider);
      }
      // Fade ambient back in
      try { ambientRef.current?.resume(); } catch {}
      setPlaying(true);
    } catch {}
  }

  async function speakPage(pageNum: number) {
    if (!story) return;
    // If audio loaded and paused mid-way, resume from same position
    if (audioRef.current && audioRef.current.paused && audioRef.current.currentTime > 0) {
      resumeAudio(); return;
    }
    stopAudio();
    const gen = ++playGenRef.current;
    setIsLoading(true);
    try {
      const res  = await fetch(`${SERVER_URL}/stories/${story.id}/audio/${pageNum}?narrator=${voice}`);
      const data = await res.json();
      if (playGenRef.current !== gen) return;
      if (!data.audioUrl) { setIsLoading(false); return; }

      if (Platform.OS === 'web') {
        const audio = new (window as any).Audio(`${SERVER_URL}${data.audioUrl}`);
        if (playGenRef.current !== gen) return;
        audio.playbackRate = playbackRate;
        audioRef.current = audio;
        setIsLoading(false); setPlaying(true);

        const pageText      = story.pages.find(p => p.pageNumber === pageNum)?.text ?? '';
        const words         = splitWords(pageText);
        const timings: { startTime: number; endTime: number }[] | null = data.wordTimings || null;
        const wordBounds    = timings ? null : buildBoundaries(words);
        const timingProvider: string = data.timingProvider || 'none';

        // Store metadata so resume can restart the loop
        audioMeta.current = { words, timings, wordBounds, timingProvider };

        // Start story-specific ambient music
        ambientRef.current = createAmbientMusic(story.id);

        audio.onended = () => {
          cancelHighlightLoop();
          setWordIndex(words.length); // past all words → nothing highlighted
          setPlaying(false);
          markPageDone(pageNum);
          ambientRef.current?.stop(); ambientRef.current = null;
          if (autoPlay && story && currentPage < story.pages.length - 1) goToPage(currentPage + 1);
        };
        audio.onerror = () => { cancelHighlightLoop(); setIsLoading(false); setPlaying(false); ambientRef.current?.stop(); ambientRef.current = null; };
        audio.play();
        startHighlightLoop(audio, words, timings, wordBounds, timingProvider);
      } else { setIsLoading(false); }
    } catch { if (playGenRef.current === gen) { setIsLoading(false); setPlaying(false); } }
  }

  function animateTurn(cb: () => void) {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 0,   duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -16, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      cb(); slideAnim.setValue(16);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    });
  }

  function goToPage(idx: number) {
    if (!story) return;
    playPageFlip();
    stopAudio();
    animateTurn(() => setCurrentPage(idx));
  }

  if (loading || !story) return (
    <ScreenLayout>
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#7BA8A4" />
        <Text style={[styles.hint, { color: colors.textMuted }]}>Opening story…</Text>
      </View>
    </ScreenLayout>
  );

  const page        = story.pages[currentPage];
  const isFirst     = currentPage === 0;
  const isLast      = currentPage === story.pages.length - 1;
  const progress    = (currentPage + 1) / story.pages.length;
  const pastelGrad  = getPastelGradient(story.coverColor);
  const pastelAccent= pastelGrad[0];
  const words       = splitWords(page.text);
  const isBusy      = isLoading || playing;
  const isPaused    = !playing && !isLoading && audioRef.current && audioRef.current.currentTime > 0;
  const totalDone   = donePages.size;

  return (
    <ScreenLayout>
      <View style={styles.screen}>

        <LinearGradient colors={pastelGrad} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.topBar}>
          <TouchableOpacity onPress={() => { stopAudio(); if (navigation.canGoBack()) { navigation.goBack(); } else { navigation.navigate('BhagavathaStories'); } }} style={styles.backBtn} activeOpacity={0.7}>
            <Feather name="arrow-left" size={16} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.topTitle} numberOfLines={1}>{story.title}</Text>
            <Text style={styles.topSub}>{story.collection}</Text>
          </View>
          {/* Progress dots — green=done, white=current, dim=unread */}
          <View style={styles.dotRow}>
            {story.pages.map((p, i) => {
              const done    = donePages.has(p.pageNumber);
              const current = i === currentPage;
              return (
                <TouchableOpacity key={i} onPress={() => goToPage(i)}>
                  <View style={[
                    styles.dot,
                    current ? styles.dotActive :
                    done    ? styles.dotDone   : styles.dotEmpty,
                  ]} />
                </TouchableOpacity>
              );
            })}
          </View>
        </LinearGradient>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any, backgroundColor: pastelAccent }]} />
        </View>

        {/* Completion badge */}
        {totalDone > 0 && (
          <View style={[styles.completionBar, { backgroundColor: colors.cardDark }]}>
            <Feather name="check-circle" size={12} color="#16a34a" />
            <Text style={[styles.completionText, { color: '#16a34a' }]}>
              {totalDone} of {story.pages.length} pages completed
            </Text>
          </View>
        )}

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

            {page.imageUrl ? (
              <View style={styles.imageContainer}>
                <Image source={{ uri: page.imageUrl }} style={styles.imageBg} resizeMode="cover" blurRadius={18} />
                <View style={styles.imageBgTint} />
                <Image source={{ uri: page.imageUrl }} style={styles.storyImage} resizeMode="contain" />
                <LinearGradient colors={['transparent','rgba(0,0,0,0.70)']} style={styles.imageOverlay}>
                  <View style={styles.sceneLabelRow}>
                    <Feather name={page.sceneIcon as any} size={13} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.sceneLabelText}>{page.sceneLabel}</Text>
                    {donePages.has(page.pageNumber) && (
                      <View style={styles.doneBadge}>
                        <Feather name="check" size={10} color="#fff" />
                        <Text style={styles.doneBadgeText}>Done</Text>
                      </View>
                    )}
                    <View style={[styles.pageChip, { backgroundColor: pastelAccent + 'AA' }]}>
                      <Text style={styles.pageChipText}>{currentPage + 1} / {story.pages.length}</Text>
                    </View>
                  </View>
                </LinearGradient>
              </View>
            ) : (
              <LinearGradient colors={[pastelGrad[0]+'E0', pastelGrad[1]+'B0']} style={styles.sceneBanner}>
                <View style={styles.sceneIconOuter}>
                  <View style={styles.sceneIconInner}>
                    <Feather name={page.sceneIcon as any} size={36} color="#fff" />
                  </View>
                </View>
                <Text style={styles.sceneLabelFallback}>{page.sceneLabel}</Text>
              </LinearGradient>
            )}

            <View style={[styles.textCard, { backgroundColor: colors.cardDark }]}>
              <View style={[styles.cardAccentBar, { backgroundColor: pastelAccent }]} />

              {/* Story text — word-by-word highlight (like Raz-Kids)
                  - Current word  → accent color + bold + soft glow
                  - Past words    → grey (shows reading progress even when paused)
                  - Future words  → normal white */}
              <Text style={styles.storyText}>
                {words.map((w, i) => {
                  const isCurrent = (playing || isPaused) && i === wordIndex;
                  const isPast    = i < wordIndex;
                  return (
                    <Text
                      key={i}
                      style={{
                        color:           isCurrent ? pastelAccent : isPast ? colors.textMuted : colors.textMain,
                        fontWeight:      isCurrent ? '700' : '400',
                        backgroundColor: isCurrent ? pastelAccent + '30' : 'transparent',
                      }}
                    >
                      {w}
                    </Text>
                  );
                })}
              </Text>

              <View style={styles.listenRow}>
                <TouchableOpacity
                  style={[styles.listenBtn, { backgroundColor: playing ? '#e11d48' : isPaused ? '#f59e0b' : pastelAccent }]}
                  onPress={() => playing ? pauseAudio() : speakPage(page.pageNumber)}
                  activeOpacity={0.85}
                >
                  {isLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name={playing ? 'pause' : isPaused ? 'play' : 'headphones'} size={14} color="#fff" />
                  }
                  <Text style={styles.listenBtnText}>{isLoading ? 'Loading…' : playing ? 'Pause' : isPaused ? 'Resume' : 'Listen'}</Text>
                </TouchableOpacity>

                {(Object.keys(VOICE_CONFIG) as VoiceOption[]).map(v => {
                  const cfg = VOICE_CONFIG[v]; const active = voice === v;
                  return (
                    <TouchableOpacity key={v}
                      style={[styles.voiceChip, active ? { backgroundColor: cfg.color+'20', borderColor: cfg.color } : { backgroundColor: 'transparent', borderColor: colors.borderColor }]}
                      onPress={() => { stopAudio(); setVoice(v); }} activeOpacity={0.8}
                    >
                      <Feather name={cfg.icon as any} size={11} color={active ? cfg.color : colors.textDim} />
                      <Text style={[styles.voiceChipText, { color: active ? cfg.color : colors.textDim }]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  style={[styles.voiceChip, autoPlay ? { backgroundColor: '#16a34a20', borderColor: '#16a34a' } : { backgroundColor: 'transparent', borderColor: colors.borderColor }]}
                  onPress={() => { stopAudio(); setAutoPlay(p => !p); }} activeOpacity={0.8}
                >
                  <Feather name={autoPlay ? 'pause-circle' : 'play-circle'} size={11} color={autoPlay ? '#16a34a' : colors.textDim} />
                  <Text style={[styles.voiceChipText, { color: autoPlay ? '#16a34a' : colors.textDim }]}>Auto</Text>
                </TouchableOpacity>

                {/* Playback speed control */}
                {([0.5, 1, 1.5, 2] as const).map(rate => (
                  <TouchableOpacity
                    key={rate}
                    style={[styles.voiceChip, playbackRate === rate
                      ? { backgroundColor: pastelAccent + '25', borderColor: pastelAccent }
                      : { backgroundColor: 'transparent', borderColor: colors.borderColor }
                    ]}
                    onPress={() => setPlaybackRate(rate)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.voiceChipText, { color: playbackRate === rate ? pastelAccent : colors.textDim }]}>
                      {rate}x
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </Animated.View>
        </ScrollView>

        <View style={[styles.bottomNav, { backgroundColor: colors.bgDark, borderTopColor: colors.borderColor }]}>
          <TouchableOpacity
            style={[styles.navArrow, { borderColor: colors.borderColor, backgroundColor: colors.cardDark, opacity: isFirst ? 0.3 : 1 }]}
            onPress={() => !isFirst && goToPage(currentPage - 1)} disabled={isFirst} activeOpacity={0.8}
          >
            <Feather name="chevron-left" size={22} color={colors.textMain} />
          </TouchableOpacity>

          <View style={styles.navCenter}>
            <Text style={[styles.navPageNum, { color: pastelAccent }]}>
              {currentPage + 1} <Text style={[styles.navPageOf, { color: colors.textDim }]}>of {story.pages.length}</Text>
            </Text>
            <Text style={[styles.navSceneLabel, { color: colors.textMuted }]} numberOfLines={1}>{page.sceneLabel}</Text>
          </View>

          {isLast ? (
            <TouchableOpacity
              style={[styles.navFinish, { backgroundColor: pastelAccent }]}
              onPress={() => { stopAudio(); navigation.goBack(); }} activeOpacity={0.85}
            >
              <Feather name="check-circle" size={16} color="#fff" />
              <Text style={styles.navFinishText}>Finished</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.navArrow, { backgroundColor: pastelAccent, borderColor: 'transparent' }]}
              onPress={() => goToPage(currentPage + 1)} activeOpacity={0.85}
            >
              <Feather name="chevron-right" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: any, isDark: boolean) => StyleSheet.create({
  screen:        { flex: 1, backgroundColor: c.bgDark },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  hint:          { fontSize: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10, paddingTop: 14 },
  backBtn:   { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  topTitle:  { fontSize: 14, fontWeight: '800', color: '#fff' },
  topSub:    { fontSize: 10, color: 'rgba(255,255,255,0.70)', marginTop: 1 },
  dotRow:    { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot:       { width: 6, height: 6, borderRadius: 3 },
  dotActive: { backgroundColor: '#fff', width: 16, borderRadius: 3 },
  dotDone:   { backgroundColor: '#4ade80', width: 8, height: 8, borderRadius: 4 },
  dotEmpty:  { backgroundColor: 'rgba(255,255,255,0.22)' },
  progressTrack:  { height: 2, backgroundColor: c.borderColor },
  progressFill:   { height: '100%' },
  completionBar:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingVertical: 6 },
  completionText: { fontSize: 11, fontWeight: '600' },
  imageContainer: { width: '100%', height: 420, position: 'relative', backgroundColor: '#0a0a0a' },
  imageBg:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  imageBgTint:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  storyImage:     { width: '100%', height: '100%' },
  imageOverlay:   { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, justifyContent: 'flex-end', paddingHorizontal: spacing.lg, paddingBottom: 12 },
  sceneLabelRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sceneLabelText: { fontSize: 13, fontWeight: '700', color: '#fff', flex: 1 },
  pageChip:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  pageChipText:   { fontSize: 11, fontWeight: '700', color: '#fff' },
  doneBadge:      { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#16a34a', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  doneBadgeText:  { fontSize: 10, fontWeight: '700', color: '#fff' },
  sceneBanner:    { height: 220, alignItems: 'center', justifyContent: 'center', gap: 16 },
  sceneIconOuter: { width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  sceneIconInner: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' },
  sceneLabelFallback: { fontSize: 15, fontWeight: '700', color: '#fff' },
  textCard: { margin: spacing.md, borderRadius: radius.xl, overflow: 'hidden', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  cardAccentBar:  { height: 3, borderRadius: 2, marginBottom: 4 },
  storyText:      { fontSize: 16, lineHeight: 30, fontWeight: '400', letterSpacing: 0.2 },
  listenRow:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  listenBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  listenBtnText:  { fontSize: 13, fontWeight: '700', color: '#fff' },
  voiceChip:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  voiceChipText:  { fontSize: 11, fontWeight: '600' },
  bottomNav:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 12, borderTopWidth: 1, gap: spacing.md },
  navArrow:       { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  navCenter:      { flex: 1, alignItems: 'center', gap: 2 },
  navPageNum:     { fontSize: 18, fontWeight: '800' },
  navPageOf:      { fontSize: 13, fontWeight: '400' },
  navSceneLabel:  { fontSize: 11, textAlign: 'center' },
  navFinish:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24 },
  navFinishText:  { fontSize: 13, fontWeight: '700', color: '#fff' },
});
