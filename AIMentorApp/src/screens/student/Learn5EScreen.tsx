/**
 * Learn5EScreen.tsx
 * Grade 3 Chapter Learning Flow (Age 8-9):
 *   WATCH (video) → LEARN (voice + visual scenes) → PRACTICE (adaptive quiz)
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image, Animated,
  BackHandler, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';

import SERVER_URL from '../../config/serverUrl';
import TopicAICoach from '../../components/common/TopicAICoach';

interface TextChunk  { id: string; content: string; }
interface ImageChunk { id: string; caption: string; image_path: string | null; page: number | null; }
interface QuizQ      { question: string; options: string[]; correct: number; explanation: string; }

interface Checkpoint {
  type: 'quick_check' | 'tap_reveal' | 'tap_highlight';
  prompt: string;
  options: string[];
  correct: number;
  explanation?: string;
  reveal?: string;
}

interface Scene {
  text: string; emotion: string; visual: string;
  imageSearch?: string; imageIndex?: number; sceneImage?: string | null;
  checkpoint?: Checkpoint;
}

type Phase = 'select' | 'watch' | 'learn' | 'practice' | 'complete';

// ── Character Config ──────────────────────────────────────────────────────────
const CHARACTER_CONFIG = {
  zara:  {
    name: 'Ms. Zara',
    color: '#8b5cf6',
    desc: 'Warm & patient teacher',
    tag: 'Your Guide',
    available: true,
    avatar: 'https://randomuser.me/api/portraits/women/44.jpg',
  },
  zappy: {
    name: 'Zappy',
    color: '#f59e0b',
    desc: 'Energetic & super fun!',
    tag: 'Coming Soon',
    available: false,
    avatar: 'https://randomuser.me/api/portraits/men/45.jpg',
  },
  luna:  {
    name: 'Luna',
    color: '#06b6d4',
    desc: 'Curious star explorer',
    tag: 'Coming Soon',
    available: false,
    avatar: 'https://randomuser.me/api/portraits/women/26.jpg',
  },
} as const;
type CharacterKey = keyof typeof CHARACTER_CONFIG;

// Chapter videos served from Express /data/videos/
const CHAPTER_VIDEOS: Record<string, string> = {
  'Where to Look for Numbers': 'ch1_where_to_look_for_numbers.mp4',
};

const EMOTION_ICON: Record<string, string> = {
  happy: 'smile', excited: 'star', thinking: 'help-circle',
  celebrating: 'award', surprised: 'zap', questioning: 'help-circle',
};
const EMOTION_COLOR: Record<string, string> = {
  happy: '#10b981', excited: '#f59e0b', thinking: '#3b82f6',
  celebrating: '#8b5cf6', surprised: '#ef4444', questioning: '#f59e0b',
};

// ── Web Video Player ─────────────────────────────────────────────────────────
function VideoPlayer({ src, onEnded, colors }: { src: string; onEnded?: () => void; colors: AppColors }) {
  if (Platform.OS !== 'web') {
    return (
      <View style={[vp.placeholder, { backgroundColor: colors.cardDark }]}>
        <Feather name="film" size={40} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, marginTop: 8 }}>Video plays on web</Text>
      </View>
    );
  }
  return (
    <video
      src={src}
      controls
      autoPlay={false}
      onEnded={onEnded}
      style={{ width: '100%', height: '100%', backgroundColor: '#000' } as any}
    />
  );
}
const vp = StyleSheet.create({
  placeholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 8 },
});

// ── Global audio controller — one audio at a time across the whole screen ────
let _currentAudio: any = null;

function stopCurrentAudio() {
  if (_currentAudio) {
    try { _currentAudio.pause(); _currentAudio.src = ''; } catch {}
    _currentAudio = null;
  }
}

// ── Web Audio Player — plays a URL (cached .mp3 from server) ─────────────────
function playAudioUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') { resolve(); return; }
    try {
      stopCurrentAudio(); // always stop previous before starting new
      const audio = new (window as any).Audio(url);
      _currentAudio = audio;
      audio.onended = () => { _currentAudio = null; resolve(); };
      audio.onerror = () => { _currentAudio = null; resolve(); };
      audio.play().catch(() => { _currentAudio = null; resolve(); });
    } catch { resolve(); }
  });
}

// ── Unified TTS response handler ──────────────────────────────────────────────
// Handles both new { audioUrl } format (disk cache) and legacy { audio } base64
async function playTTSResponse(ttsData: any, fallbackText: string): Promise<void> {
  if (ttsData?.audioUrl) {
    await playAudioUrl(`${SERVER_URL}${ttsData.audioUrl}`);
  } else {
    await speakText(fallbackText);
  }
}

// Web Speech API — free, no quota, works on all browsers
// Used as primary TTS when ElevenLabs quota is exhausted
function speakText(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web' || !(window as any).speechSynthesis) { resolve(); return; }
    try {
      const synth = (window as any).speechSynthesis as SpeechSynthesis;
      synth.cancel(); // stop any current speech

      const utter = new SpeechSynthesisUtterance(text);
      utter.rate   = 1.05;  // slightly faster = more energetic
      utter.pitch  = 1.45;  // higher pitch = cartoon/child-friendly energy
      utter.volume = 1.0;

      // Pick best available warm female English voice
      const voices = synth.getVoices();
      const pick = (
        voices.find(v => v.name === 'Microsoft Zira - English (United States)') ||  // Windows Chrome
        voices.find(v => v.name === 'Google US English')                          ||  // Chrome generic
        voices.find(v => v.name === 'Samantha')                                   ||  // macOS
        voices.find(v => v.name === 'Karen')                                      ||  // macOS/iOS
        voices.find(v => v.name === 'Victoria')                                   ||  // macOS
        voices.find(v => /zira/i.test(v.name))                                    ||
        voices.find(v => /google/i.test(v.name) && /en[-_]US/i.test(v.lang))     ||
        voices.find(v => /en[-_](US|GB|AU)/i.test(v.lang) && !v.localService)    ||  // cloud voice
        voices.find(v => /en[-_]US/i.test(v.lang))
      );
      if (pick) utter.voice = pick;

      utter.onend   = () => resolve();
      utter.onerror = () => resolve();
      synth.speak(utter);
    } catch { resolve(); }
  });
}

// ── PHASE 0: CHARACTER SELECT ─────────────────────────────────────────────────
function CharacterSelectPhase({ topic, colors, onSelect }: {
  topic: string; colors: AppColors; onSelect: (key: CharacterKey) => void;
}) {
  const [picked, setPicked] = useState<CharacterKey>('zara');
  const pickedChar = CHARACTER_CONFIG[picked];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDark }}>
      <ScrollView contentContainerStyle={cs.container} showsVerticalScrollIndicator={false}>

        {/* Hero header */}
        <View style={[cs.heroBlock, { backgroundColor: pickedChar.color + '12' }]}>
          <View style={[cs.heroAvatarRing, { borderColor: pickedChar.color, shadowColor: pickedChar.color }]}>
            <Image source={{ uri: pickedChar.avatar }} style={cs.heroAvatarImg} resizeMode="cover" />
          </View>
          <Text style={[cs.heroTitle, { color: colors.textMain }]}>Who's teaching you today?</Text>
          <View style={[cs.topicPill, { backgroundColor: pickedChar.color + '20', borderColor: pickedChar.color + '40' }]}>
            <Feather name="book-open" size={13} color={pickedChar.color} />
            <Text style={[cs.topicPillText, { color: pickedChar.color }]} numberOfLines={1}>{topic}</Text>
          </View>
        </View>

        {/* Character Cards */}
        <View style={cs.cardsGrid}>
          {(Object.keys(CHARACTER_CONFIG) as CharacterKey[]).map((key) => {
            const ch       = CHARACTER_CONFIG[key];
            const isPicked = picked === key;
            const isLocked = !ch.available;

            return (
              <TouchableOpacity
                key={key}
                activeOpacity={isLocked ? 0.7 : 0.88}
                onPress={() => { if (!isLocked) setPicked(key); }}
                style={[
                  cs.card,
                  {
                    borderColor:     isPicked ? ch.color : colors.borderColor,
                    borderWidth:     isPicked ? 2.5 : 1,
                    backgroundColor: isPicked ? ch.color + '14' : colors.cardDark,
                  },
                ]}
              >
                {/* Lock overlay for coming-soon */}
                {isLocked && (
                  <View style={cs.lockOverlay}>
                    <View style={[cs.lockBadge, { backgroundColor: 'rgba(0,0,0,0.72)' }]}>
                      <Feather name="lock" size={14} color="#fff" />
                      <Text style={cs.lockText}>Coming Soon</Text>
                    </View>
                  </View>
                )}

                {/* Selected glow ring */}
                {isPicked && (
                  <View style={[cs.selectedRing, { borderColor: ch.color }]} />
                )}

                {/* Avatar */}
                <View style={[cs.avatarWrap, { borderColor: isPicked ? ch.color : colors.borderColor, backgroundColor: ch.color + '18' }]}>
                  <Image source={{ uri: ch.avatar }} style={cs.avatarImg} resizeMode="cover" />
                </View>

                {/* Name + desc */}
                <Text style={[cs.charName, { color: isPicked ? ch.color : colors.textMain }]}>{ch.name}</Text>
                <Text style={[cs.charDesc, { color: colors.textMuted }]} numberOfLines={2}>{ch.desc}</Text>

                {/* Status badge */}
                <View style={[cs.statusBadge, {
                  backgroundColor: ch.available ? ch.color + '20' : colors.borderColor,
                  borderColor:     ch.available ? ch.color + '50' : colors.borderColor,
                }]}>
                  {ch.available
                    ? <Feather name="check-circle" size={10} color={ch.color} />
                    : <Feather name="clock" size={10} color={colors.textDim} />
                  }
                  <Text style={[cs.statusText, { color: ch.available ? ch.color : colors.textDim }]}>
                    {ch.available ? 'Available Now' : 'Unlocking Soon'}
                  </Text>
                </View>

                {isPicked && (
                  <View style={[cs.checkMark, { backgroundColor: ch.color }]}>
                    <Feather name="check" size={11} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Info hint */}
        <Text style={[cs.hint, { color: colors.textDim }]}>
          More guides unlock as you complete chapters!
        </Text>

        {/* CTA button */}
        <TouchableOpacity
          style={[cs.ctaBtn, { backgroundColor: pickedChar.color }]}
          onPress={() => onSelect(picked)}
          activeOpacity={0.88}
        >
          <Image source={{ uri: pickedChar.avatar }} style={cs.ctaAvatar} resizeMode="cover" />
          <Text style={cs.ctaText}>Learn with {pickedChar.name}</Text>
          <View style={cs.ctaArrow}>
            <Feather name="arrow-right" size={18} color={pickedChar.color} />
          </View>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const cs = StyleSheet.create({
  container:    { padding: 20, paddingBottom: 48, gap: 20 },

  heroBlock:    { borderRadius: 24, padding: 24, alignItems: 'center', gap: 12 },
  heroAvatarRing: { width: 110, height: 110, borderRadius: 55, borderWidth: 3, overflow: 'hidden', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  heroAvatarImg:  { width: 110, height: 110 },
  heroTitle:    { fontSize: 22, fontWeight: '900', textAlign: 'center' },
  topicPill:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  topicPillText:{ fontSize: 13, fontWeight: '700', maxWidth: 220 },

  cardsGrid:    { flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center' },
  card:         { width: 160, borderRadius: 22, padding: 16, alignItems: 'center', gap: 8, position: 'relative', overflow: 'hidden' },
  lockOverlay:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 10, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)' },
  lockBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  lockText:     { color: '#fff', fontSize: 11, fontWeight: '800' },
  selectedRing: { position: 'absolute', top: -2, left: -2, right: -2, bottom: -2, borderRadius: 24, borderWidth: 2.5 },
  avatarWrap:   { width: 90, height: 90, borderRadius: 45, borderWidth: 2.5, overflow: 'hidden' },
  avatarImg:    { width: 90, height: 90 },
  charName:     { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  charDesc:     { fontSize: 11, textAlign: 'center', lineHeight: 16 },
  statusBadge:  { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  statusText:   { fontSize: 10, fontWeight: '700' },
  checkMark:    { position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },

  hint:         { textAlign: 'center', fontSize: 12, fontStyle: 'italic' },
  ctaBtn:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: 20 },
  ctaAvatar:    { width: 38, height: 38, borderRadius: 19, borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.7)' },
  ctaText:      { color: '#fff', fontSize: 17, fontWeight: '900', flex: 1 },
  ctaArrow:     { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
});

// ── PHASE 1: WATCH ───────────────────────────────────────────────────────────
function WatchPhase({ topic, textChunks, colors, onDone }: {
  topic: string; textChunks: TextChunk[]; colors: AppColors; onDone: () => void;
}) {
  const videoFile = CHAPTER_VIDEOS[topic];
  const videoSrc  = videoFile ? `${SERVER_URL}/data/videos/${videoFile}` : null;

  // AI intro state (used when no video)
  const [introLoading, setIntroLoading] = useState(false);
  const [introText, setIntroText]       = useState('');
  const [hookText, setHookText]         = useState('');
  const [visualText, setVisualText]     = useState('');
  const [audioBase64, setAudioBase64]   = useState('');
  const [playing, setPlaying]           = useState(false);
  const [introReady, setIntroReady]     = useState(false);
  const [error, setError]               = useState('');

  // Load Groq intro + ElevenLabs audio for non-video chapters
  useEffect(() => {
    if (videoSrc) return; // has video — skip AI intro
    loadIntro();
  }, [topic]);

  async function loadIntro() {
    setIntroLoading(true); setError(''); setIntroReady(false);
    try {
      const context = textChunks.slice(0, 3).map(c => c.content).join('\n\n');
      // 1. Groq: generate intro text
      const hookRes  = await fetch(`${SERVER_URL}/lesson/hook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, context }),
      });
      const hookData = await hookRes.json();
      const intro    = hookData.intro  || `Hello! I am Ms. Zara. Today we learn about ${topic}! Let's begin!`;
      const hook     = hookData.hook   || '';
      const visual   = hookData.visual || topic;

      setIntroText(intro);
      setHookText(hook);
      setVisualText(visual);

      // Audio will be spoken via Web Speech API when Play is pressed

      setIntroReady(true);
    } catch {
      setError('Could not load intro. You can still start learning!');
      setIntroReady(true);
    }
    setIntroLoading(false);
  }

  async function playIntro() {
    if (playing) return;
    setPlaying(true);
    try {
      const ttsRes = await fetch(`${SERVER_URL}/lesson/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: introText }),
      });
      const ttsData = await ttsRes.json();
      await playTTSResponse(ttsData, introText);
    } catch { await speakText(introText); }
    setPlaying(false);
  }

  // Auto-play once intro text is ready
  useEffect(() => {
    if (introReady && introText) playIntro();
  }, [introReady]);

  // ── Video chapter ────────────────────────────────────────────────────────
  if (videoSrc) {
    return (
      <View style={{ flex: 1, padding: spacing.xl, gap: spacing.xl }}>
        <View style={[ph.headerCard, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
          <Feather name="play-circle" size={24} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[ph.headerTitle, { color: colors.textMain }]}>Ms. Zara introduces the chapter</Text>
            <Text style={[ph.headerSub, { color: colors.textMuted }]}>Watch, then we'll learn together!</Text>
          </View>
        </View>
        <View style={[ph.videoBox, { backgroundColor: '#000', borderColor: colors.borderColor }]}>
          <VideoPlayer src={videoSrc} colors={colors} onEnded={onDone} />
        </View>
        <TouchableOpacity style={[ph.btn, { backgroundColor: colors.primary }]} onPress={onDone}>
          <Text style={ph.btnText}>Skip Video — Start Learning</Text>
          <Feather name="arrow-right" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  // ── AI-powered intro (Groq + ElevenLabs) ─────────────────────────────────
  if (introLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textMuted, fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
          Ms. Zara is getting ready…
        </Text>
        <Text style={{ color: colors.textDim, fontSize: 12, textAlign: 'center' }}>
          Preparing your introduction with AI voice
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, paddingBottom: 48 }}>
      {/* Header badge */}
      <View style={[ph.headerCard, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
        <Feather name="volume-2" size={24} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[ph.headerTitle, { color: colors.textMain }]}>Ms. Zara says hello!</Text>
          <Text style={[ph.headerSub, { color: colors.textMuted }]}>AI voice powered by Groq</Text>
        </View>
        {playing && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>Speaking…</Text>
          </View>
        )}
      </View>

      {/* Visual box */}
      {visualText ? (
        <View style={[ph.visualCard, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' }]}>
          <Text style={[ph.visualText, { color: colors.textMain }]}>{visualText}</Text>
          <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 6 }}>Chapter preview</Text>
        </View>
      ) : null}

      {/* Ms. Zara's intro speech */}
      {introText ? (
        <View style={[ph.speechCard, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
          <View style={[ph.zaraTag, { backgroundColor: colors.primary }]}>
            <Feather name="mic" size={12} color="#fff" />
            <Text style={ph.zaraTagText}>Ms. Zara</Text>
          </View>
          <Text style={[ph.speechText, { color: colors.textMain }]}>{introText}</Text>

          {/* Replay button */}
          <TouchableOpacity
            style={[ph.playBtn, { backgroundColor: playing ? colors.primary + '20' : colors.primary, borderColor: colors.primary }]}
            onPress={playIntro}
            disabled={!introText || playing}
          >
            {playing
              ? <><ActivityIndicator size="small" color={colors.primary} /><Text style={[ph.playBtnText, { color: colors.primary }]}>Playing…</Text></>
              : <><Feather name="volume-2" size={16} color="#fff" /><Text style={ph.playBtnText}>Hear Ms. Zara Again</Text></>
            }
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Hook question */}
      {hookText ? (
        <View style={[ph.hookCard, { backgroundColor: '#f59e0b15', borderColor: '#f59e0b40' }]}>
          <Feather name="help-circle" size={18} color="#f59e0b" />
          <Text style={{ color: colors.textMain, fontSize: 14, fontWeight: '600', flex: 1, lineHeight: 22 }}>
            {hookText}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: '#ef4444', textAlign: 'center', fontSize: 13 }}>{error}</Text>
      ) : null}

      <TouchableOpacity style={[ph.btn, { backgroundColor: colors.primary }]} onPress={onDone}>
        <Text style={ph.btnText}>Start Learning!</Text>
        <Feather name="arrow-right" size={16} color="#fff" />
      </TouchableOpacity>
    </ScrollView>
  );
}
const ph = StyleSheet.create({
  headerCard:   { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  headerTitle:  { fontSize: 14, fontWeight: '700' },
  headerSub:    { fontSize: 12, color: '#888', marginTop: 2 },
  videoBox:     { flex: 1, borderRadius: 16, borderWidth: 1, overflow: 'hidden', minHeight: 300 },
  btn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: radius.lg },
  btnText:      { color: '#fff', fontSize: 15, fontWeight: '700' },

  // AI intro styles
  visualCard:   { borderRadius: 20, borderWidth: 1, padding: 32, alignItems: 'center', justifyContent: 'center', minHeight: 140 },
  visualText:   { fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5 },
  speechCard:   { borderRadius: 16, borderWidth: 1, padding: 20, gap: 14 },
  zaraTag:      { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  zaraTagText:  { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  speechText:   { fontSize: 16, lineHeight: 28, fontWeight: '500' },
  playBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: radius.lg, borderWidth: 1.5 },
  playBtnText:  { color: '#fff', fontSize: 14, fontWeight: '700' },
  hookCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, borderWidth: 1, padding: 16 },
});

// ── PHASE 2: LEARN — Continuous auto-play journey ────────────────────────────
function LearnPhase({ topic, grade, textChunks, imageChunks, colors, onDone, character = 'zara', isScience = false }: {
  topic: string; grade: string; textChunks: TextChunk[]; imageChunks: ImageChunk[];
  colors: AppColors; onDone: (quiz?: QuizQ[]) => void; character?: CharacterKey; isScience?: boolean;
}) {
  const [loading, setLoading]         = useState(false);
  const [scenes, setScenes]           = useState<Scene[]>([]);
  const [lessonQuizRef] = useState<{ quiz: QuizQ[] }>({ quiz: [] });
  const [sceneIdx, setSceneIdx]       = useState(0);
  const [error, setError]             = useState('');
  const [ttsLoading, setTtsLoading]   = useState(false);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [paused, setPaused]           = useState(false);
  // Cached concept image URLs keyed by imageSearch query
  const [conceptImages, setConceptImages] = useState<Record<string, string>>({});

  // session token — incremented when user manually navigates; cancels pending auto-advance
  const sessionRef   = useRef(0);
  const scenesRef    = useRef<Scene[]>([]);
  const sceneIdxRef  = useRef(0);
  const pausedRef    = useRef(false);
  const [autoProgress, setAutoProgress] = useState(0); // 0-100 fill for auto-advance bar
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [showCheckpoint, setShowCheckpoint] = useState(false);
  const showCheckpointRef = useRef(false);

  function toggleFullscreen() {
    setIsFullscreen(f => !f);
  }

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  scenesRef.current        = scenes;
  sceneIdxRef.current      = sceneIdx;
  pausedRef.current        = paused;
  showCheckpointRef.current = showCheckpoint;

  useEffect(() => { loadLesson(); }, [topic]);

  async function loadLesson() {
    setLoading(true); setError(''); setSceneIdx(0); setPaused(false);
    sessionRef.current++;
    try {
      const context       = textChunks.slice(0, 5).map(c => c.content).join('\n\n');
      // Pass image captions so Groq ties each scene to a specific book image
      const imageCaptions = imageChunks.map(img => img.caption || '').filter(Boolean);
      const res  = await fetch(`${SERVER_URL}/lesson/script`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, grade, curriculum: 'NCERT', context, imageCaptions, subject: isScience ? 'Science' : 'Mathematics' }),
      });
      const data = await res.json();
      if (data.scenes?.length) {
        setScenes(data.scenes);
        if (data.quiz?.length) lessonQuizRef.quiz = data.quiz;
        // Unsplash concept-image fetching disabled — using immersive color visuals instead
      } else setError('Could not generate lesson. Try again.');
    } catch { setError('Server error. Check server is running.'); }
    setLoading(false);
  }

  async function prefetchConceptImages(sceneList: Scene[]) {
    const uniqueQueries = [...new Set(
      sceneList.map(s => s.imageSearch).filter(q => q && q.trim().length > 0)
    )] as string[];

    for (const q of uniqueQueries) {
      try {
        const r = await fetch(`${SERVER_URL}/lesson/concept-image?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        // Always set a value — empty string means "failed, show text fallback"
        setConceptImages(prev => ({ ...prev, [q]: d.url ? `${SERVER_URL}${d.url}` : '' }));
      } catch {
        // Mark as failed so loading spinner doesn't get stuck
        setConceptImages(prev => ({ ...prev, [q]: '' }));
      }
    }
  }

  // Auto-play: fires whenever scene changes (or lesson loads). Plays TTS then advances.
  useEffect(() => {
    if (!scenes.length || loading) return;

    const token = ++sessionRef.current;
    setAutoProgress(0);
    setTtsLoading(false); setIsPlaying(false);

    let cancelled = false;

    async function run() {
      const text = scenesRef.current[sceneIdx]?.text;
      if (cancelled) return;
      if (!text) {
        // Empty scene — auto-advance to next without hanging
        const totalScenes = scenesRef.current.length;
        if (sceneIdx < totalScenes - 1) setSceneIdx(i => i + 1);
        else onDone(lessonQuizRef.quiz.length ? lessonQuizRef.quiz : undefined);
        return;
      }

      // 1. Speak via Web Speech API (instant — no network latency)
      setTtsLoading(false); setIsPlaying(true);
      if (!cancelled) {
        await speakText(text);
      }
      setIsPlaying(false);

      if (cancelled || pausedRef.current) return;

      // Check for checkpoint — pause auto-advance and show interactive card
      const currentScene = scenesRef.current[sceneIdx];
      if (currentScene?.checkpoint) {
        setShowCheckpoint(true);
        return; // CheckpointCard's onDone will call manualNext()
      }

      // 2. Animate the auto-advance progress bar (1.5 s gap between scenes)
      const GAP_MS = 1500;
      const STEPS  = 30;
      for (let i = 1; i <= STEPS; i++) {
        if (cancelled || pausedRef.current) return;
        await new Promise(r => setTimeout(r, GAP_MS / STEPS));
        setAutoProgress(Math.round((i / STEPS) * 100));
      }
      setAutoProgress(0);
      if (cancelled || pausedRef.current) return;

      // 3. Advance
      const totalScenes = scenesRef.current.length;
      if (sceneIdx < totalScenes - 1) {
        setSceneIdx(sceneIdx + 1);
      } else {
        await new Promise(r => setTimeout(r, 800));
        if (!cancelled) onDone(lessonQuizRef.quiz.length ? lessonQuizRef.quiz : undefined);
      }
    }

    run();
    return () => { cancelled = true; stopCurrentAudio(); setAutoProgress(0); };
  }, [sceneIdx, scenes.length, loading]);

  // Replay current scene manually (re-mounts the effect via token bump)
  function replayScene() {
    setSceneIdx(i => { sessionRef.current++; return i; }); // force re-run via token bump
    // simpler: just re-trigger by bumping session and calling speakAndPlay
    const token = ++sessionRef.current;
    setPaused(false);
    setAutoProgress(0);
    async function replay() {
      const text = scenesRef.current[sceneIdx]?.text;
      if (!text) return;
      setIsPlaying(true);
      await speakText(text);
      if (token === sessionRef.current) setIsPlaying(false);
    }
    replay();
  }

  function manualPrev() {
    if (sceneIdx === 0) return;
    setAutoProgress(0);
    setSceneIdx(i => Math.max(0, i - 1)); // useEffect cleanup cancels current, restart fires
  }
  function manualNext() {
    setAutoProgress(0);
    // If this scene has an unseen checkpoint, show it before advancing
    const currentScene = scenesRef.current[sceneIdxRef.current];
    if (currentScene?.checkpoint && !showCheckpointRef.current) {
      setShowCheckpoint(true);
      return;
    }
    if (sceneIdx < scenes.length - 1) setSceneIdx(i => i + 1);
    else onDone(lessonQuizRef.quiz.length ? lessonQuizRef.quiz : undefined);
  }
  function togglePause() {
    const resuming = paused;
    setPaused(!paused);
    if (resuming) {
      // Resume: restart current scene from beginning (re-triggers useEffect)
      if (_currentAudio) {
        try { _currentAudio.play().catch(() => {}); } catch {}
      } else {
        setSceneIdx(i => i); // no audio paused — restart scene
      }
    } else {
      // Pause: actually pause the HTML audio element
      if (_currentAudio) {
        try { _currentAudio.pause(); } catch {}
      }
    }
  }

  const scene  = scenes[sceneIdx];
  const isLast = sceneIdx >= scenes.length - 1;
  const eColor = EMOTION_COLOR[scene?.emotion] ?? '#8b5cf6';
  const eIcon  = EMOTION_ICON[scene?.emotion]  ?? 'smile';
  const pct    = scenes.length ? Math.round(((sceneIdx + 1) / scenes.length) * 100) : 0;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>Ms. Zara is preparing your lesson…</Text>
        <Text style={{ color: colors.textDim, fontSize: 12, textAlign: 'center', paddingHorizontal: 32 }}>
          Groq AI is reading the chapter and creating a lesson just for you
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
        <Feather name="alert-circle" size={40} color="#ef4444" />
        <Text style={{ color: '#ef4444', textAlign: 'center' }}>{error}</Text>
        <TouchableOpacity style={[lp.btn, { backgroundColor: '#8b5cf6' }]} onPress={loadLesson}>
          <Feather name="refresh-cw" size={16} color="#fff" />
          <Text style={lp.btnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!scenes.length) return null;

  // Resolve the image URI for this scene
  const sceneImgUri = (() => {
    if (scene?.sceneImage) {
      const img = scene.sceneImage;
      // Cloudinary URLs are absolute — don't prepend SERVER_URL
      return img.startsWith('http') ? img : `${SERVER_URL}${img}`;
    }
    const q = scene?.imageSearch;
    const s = q ? conceptImages[q] : undefined;
    return (s && s !== '') ? s : null;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgDark }}>

      {/* ── Top progress strip ─────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Scene counter pill */}
          <View style={[lp.scenePill, { backgroundColor: eColor + '22', borderColor: eColor + '55' }]}>
            <Feather name={eIcon as any} size={12} color={eColor} />
            <Text style={{ color: eColor, fontSize: 12, fontWeight: '700' }}>
              {sceneIdx + 1} / {scenes.length}
            </Text>
          </View>
          {/* Speaking + pause */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {isPlaying && !paused && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="volume-2" size={13} color={eColor} />
                <Text style={{ color: eColor, fontSize: 11, fontWeight: '600' }}>Speaking…</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={togglePause}
              style={[lp.pauseBtn, { backgroundColor: paused ? '#10b981' + '25' : colors.cardDark, borderColor: paused ? '#10b981' : colors.borderColor }]}
            >
              <Feather name={paused ? 'play' : 'pause'} size={14} color={paused ? '#10b981' : colors.textMuted} />
              <Text style={{ color: paused ? '#10b981' : colors.textMuted, fontSize: 11, fontWeight: '600' }}>
                {paused ? 'Resume' : 'Pause'}
              </Text>
            </TouchableOpacity>
            {Platform.OS === 'web' && (
              <TouchableOpacity
                onPress={toggleFullscreen}
                style={[lp.pauseBtn, { backgroundColor: isFullscreen ? colors.primary + '25' : colors.cardDark, borderColor: isFullscreen ? colors.primary : colors.borderColor }]}
              >
                <Feather name={isFullscreen ? 'minimize' : 'maximize'} size={14} color={isFullscreen ? colors.primary : colors.textMuted} />
                <Text style={{ color: isFullscreen ? colors.primary : colors.textMuted, fontSize: 11, fontWeight: '600' }}>
                  {isFullscreen ? 'Exit' : 'Full'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {/* Progress bar */}
        <View style={[lp.track, { backgroundColor: colors.borderColor }]}>
          <View style={[lp.fill, { width: `${pct}%` as any, backgroundColor: eColor }]} />
        </View>
      </View>

      {/* ── AUTO-ADVANCE BAR — thin animated bar shows scene is playing ── */}
      {(isPlaying || ttsLoading || autoProgress > 0) && !paused && (
        <View style={{ height: 3, backgroundColor: colors.borderColor }}>
          <View style={{ height: 3, width: `${autoProgress || (isPlaying ? 15 : 5)}%` as any, backgroundColor: eColor, borderRadius: 2 }} />
        </View>
      )}

      {/* ── IMAGE AREA — full width, large ────────────────────── */}
      <View style={[lp.imgArea, { backgroundColor: sceneImgUri ? '#fff' : eColor + '10', borderBottomColor: eColor + '30' }]}>
        {sceneImgUri ? (
          <Image source={{ uri: sceneImgUri }} style={lp.mainImg} resizeMode="contain" />
        ) : (scene?.imageSearch && conceptImages[scene.imageSearch] === undefined) ? (
          /* Still loading */
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator size="large" color={eColor} />
            <Text style={{ color: eColor, fontSize: 12, fontWeight: '600' }}>Loading image…</Text>
          </View>
        ) : (
          /* No image — show lesson text as a large readable card */
          <ScrollView
            style={{ flex: 1, backgroundColor: eColor + '08' }}
            contentContainerStyle={{ padding: 28, justifyContent: 'center', flexGrow: 1, gap: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {scene?.visual ? (
              <View style={{ alignSelf: 'center', backgroundColor: eColor + '20', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8, borderWidth: 1, borderColor: eColor + '50', marginBottom: 4 }}>
                <Text style={{ color: eColor, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>{scene.visual}</Text>
              </View>
            ) : null}
            <View style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 16, padding: 22, borderWidth: 1, borderColor: eColor + '30' }}>
              <Text style={{ color: '#fff', fontSize: 20, lineHeight: 34, fontWeight: '500', textAlign: 'center' }}>
                {scene?.text}
              </Text>
            </View>
          </ScrollView>
        )}
      </View>

      {/* ── SPEECH CARD ────────────────────────────────────────── */}
      <View style={[lp.speechCard, { backgroundColor: colors.cardDark, borderTopColor: eColor + '40' }]}>

        {/* Character label row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image
              source={{ uri: CHARACTER_CONFIG[character].avatar }}
              style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: CHARACTER_CONFIG[character].color }}
              resizeMode="cover"
            />
            <View style={[lp.zaraTag, { backgroundColor: CHARACTER_CONFIG[character].color }]}>
              <Feather name="volume-2" size={11} color="#fff" />
              <Text style={lp.zaraTagText}>{CHARACTER_CONFIG[character].name}</Text>
            </View>
          </View>
          {/* Replay button */}
          <TouchableOpacity
            style={[lp.replayBtn, { borderColor: eColor + '60', backgroundColor: eColor + '12' }]}
            onPress={replayScene}
            disabled={ttsLoading && !paused}
          >
            {ttsLoading && !paused
              ? <ActivityIndicator size="small" color={eColor} />
              : <Feather name="rotate-ccw" size={13} color={eColor} />
            }
            <Text style={{ color: eColor, fontSize: 12, fontWeight: '700' }}>
              {isPlaying && !paused ? 'Playing…' : 'Replay'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Scene text */}
        <Text style={[lp.sceneText, { color: colors.textMain }]}>{scene?.text}</Text>

        {/* Visual label chip */}
        {scene?.visual ? (
          <View style={{ flexDirection: 'row' }}>
            <View style={[lp.visualChip, { backgroundColor: eColor + '15', borderColor: eColor + '40' }]}>
              <Text style={{ color: eColor, fontSize: 11, fontWeight: '700' }}>{scene.visual}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* ── CHECKPOINT OVERLAY ─────────────────────────────────── */}
      {showCheckpoint && scene?.checkpoint && (
        <CheckpointCard
          checkpoint={scene.checkpoint}
          colors={colors}
          onDone={() => {
            setShowCheckpoint(false);
            manualNext();
          }}
        />
      )}

      {/* ── FULLSCREEN OVERLAY — covers entire viewport ────────── */}
      {isFullscreen && (
        <View style={[lp.fsOverlay, { backgroundColor: colors.bgDark }]}>
          {/* Top bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, width: '100%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[lp.scenePill, { backgroundColor: eColor + '22', borderColor: eColor + '55' }]}>
                <Feather name={eIcon as any} size={12} color={eColor} />
                <Text style={{ color: eColor, fontSize: 12, fontWeight: '700' }}>{sceneIdx + 1} / {scenes.length}</Text>
              </View>
              {/* Progress bar inline */}
              <View style={{ width: 80, height: 5, backgroundColor: colors.borderColor, borderRadius: 3, overflow: 'hidden' }}>
                <View style={{ height: 5, width: `${pct}%` as any, backgroundColor: eColor, borderRadius: 3 }} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity
                onPress={togglePause}
                style={[lp.pauseBtn, { backgroundColor: paused ? '#10b981' + '25' : colors.cardDark, borderColor: paused ? '#10b981' : colors.borderColor }]}
              >
                <Feather name={paused ? 'play' : 'pause'} size={14} color={paused ? '#10b981' : colors.textMuted} />
                <Text style={{ color: paused ? '#10b981' : colors.textMuted, fontSize: 11, fontWeight: '600' }}>
                  {paused ? 'Resume' : 'Pause'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[lp.pauseBtn, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]} onPress={() => setIsFullscreen(false)}>
                <Feather name="minimize" size={14} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>Exit</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Image / Visual area — takes all remaining space */}
          <View style={{ flex: 1, width: '100%', backgroundColor: sceneImgUri ? '#000' : eColor + '18', alignItems: 'center', justifyContent: 'center' }}>
            {sceneImgUri ? (
              <Image source={{ uri: sceneImgUri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            ) : (
              <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 20, paddingHorizontal: 48 }}>
                {/* Big emotion icon */}
                <View style={{ width: 130, height: 130, borderRadius: 65, backgroundColor: eColor + '30', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name={eIcon as any} size={70} color={eColor} />
                </View>
                {/* Scene visual label */}
                <Text style={{ color: eColor, fontSize: 26, fontWeight: '900', textAlign: 'center', lineHeight: 36, letterSpacing: 0.3 }}>
                  {scene?.visual || topic}
                </Text>
                {/* Ms. Zara speaking indicator */}
                {(isPlaying || ttsLoading) && !paused && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: eColor + '25', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 }}>
                    <ActivityIndicator size="small" color={eColor} />
                    <Text style={{ color: eColor, fontSize: 13, fontWeight: '700' }}>Ms. Zara is speaking…</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Speech text */}
          <View style={{ width: '100%', backgroundColor: colors.cardDark, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 10, borderTopWidth: 2.5, borderTopColor: eColor + '55', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image source={{ uri: CHARACTER_CONFIG[character].avatar }} style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 2.5, borderColor: CHARACTER_CONFIG[character].color }} resizeMode="cover" />
                <View style={[lp.zaraTag, { backgroundColor: CHARACTER_CONFIG[character].color, paddingHorizontal: 12, paddingVertical: 5 }]}>
                  <Feather name="volume-2" size={12} color="#fff" />
                  <Text style={[lp.zaraTagText, { fontSize: 12 }]}>{CHARACTER_CONFIG[character].name}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[lp.replayBtn, { borderColor: eColor + '60', backgroundColor: eColor + '12' }]}
                onPress={replayScene}
                disabled={ttsLoading && !paused}
              >
                {ttsLoading && !paused
                  ? <ActivityIndicator size="small" color={eColor} />
                  : <Feather name="rotate-ccw" size={13} color={eColor} />
                }
                <Text style={{ color: eColor, fontSize: 12, fontWeight: '700' }}>
                  {isPlaying && !paused ? 'Playing…' : 'Replay'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textMain, fontSize: 22, lineHeight: 34, fontWeight: '500', letterSpacing: 0.1 }}>{scene?.text}</Text>
          </View>

          {/* Navigation */}
          <View style={[lp.navRow, { borderTopColor: colors.borderColor, width: '100%' }]}>
            <TouchableOpacity
              style={[lp.navBtn, { backgroundColor: colors.cardDark, borderColor: colors.borderColor, opacity: sceneIdx === 0 ? 0.3 : 1 }]}
              onPress={manualPrev} disabled={sceneIdx === 0}
            >
              <Feather name="arrow-left" size={16} color={colors.textMain} />
              <Text style={[lp.navBtnText, { color: colors.textMain }]}>Prev</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[lp.nextBtn, { backgroundColor: isLast ? '#10b981' : eColor }]} onPress={manualNext}>
              <Text style={lp.btnText}>{isLast ? 'Start Practice!' : 'Skip'}</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── NAVIGATION ─────────────────────────────────────────── */}
      <View style={[lp.navRow, { borderTopColor: colors.borderColor }]}>
        <TouchableOpacity
          style={[lp.navBtn, { backgroundColor: colors.cardDark, borderColor: colors.borderColor, opacity: sceneIdx === 0 ? 0.3 : 1 }]}
          onPress={manualPrev}
          disabled={sceneIdx === 0}
        >
          <Feather name="arrow-left" size={16} color={colors.textMain} />
          <Text style={[lp.navBtnText, { color: colors.textMain }]}>Prev</Text>
        </TouchableOpacity>

        {/* Pause/Play control — centre */}
        <TouchableOpacity
          onPress={togglePause}
          style={[lp.navBtn, { backgroundColor: paused ? '#10b981' + '20' : colors.cardDark, borderColor: paused ? '#10b981' : colors.borderColor, paddingHorizontal: 20 }]}
        >
          <Feather name={paused ? 'play' : 'pause'} size={16} color={paused ? '#10b981' : colors.textMain} />
          <Text style={[lp.navBtnText, { color: paused ? '#10b981' : colors.textMain }]}>{paused ? 'Play' : 'Pause'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[lp.nextBtn, { backgroundColor: isLast ? '#10b981' : eColor, flex: 0, paddingHorizontal: 20 }]}
          onPress={manualNext}
        >
          <Text style={lp.btnText}>{isLast ? 'Practice!' : 'Next'}</Text>
          <Feather name="arrow-right" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const lp = StyleSheet.create({
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.xl, marginVertical: spacing.md, padding: 10, borderRadius: radius.sm, borderWidth: 1 },
  // New layout
  scenePill:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  pauseBtn:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  imgArea:     { flex: 1, borderBottomWidth: 1, overflow: 'hidden', backgroundColor: '#fff' },
  mainImg:     { width: '100%', height: '100%' },
  fsOverlay:   { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 99999, alignItems: 'center', justifyContent: 'center' },
  fsImg:       { width: '100%', height: '100%' },
  fsClose:     { position: 'absolute' as any, top: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  bigVisualBox:{ borderRadius: 20, borderWidth: 2, paddingHorizontal: 32, paddingVertical: 24, alignItems: 'center' },
  bigVisualText:{ fontSize: 32, fontWeight: '800', textAlign: 'center', letterSpacing: 1 },
  speechCard:  { paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 2, gap: 10 },
  replayBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  visualChip:  { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  nextBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radius.lg },
  progressText:{ fontSize: 12, fontWeight: '600' },
  track:       { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill:        { height: '100%', borderRadius: 3 },

  sceneCard:   { borderRadius: 20, borderWidth: 1.5, padding: 20, gap: 16 },
  emotionBadge:{ width: 48, height: 48, borderRadius: 24, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  visualBox:   { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  visualText:  { fontSize: 28, fontWeight: '800', textAlign: 'center', lineHeight: 40, letterSpacing: 1 },
  speechBubble:{ borderRadius: 14, borderWidth: 1, padding: 18, gap: 8 },
  zaraTag:     { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  zaraTagText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  sceneText:   { fontSize: 18, lineHeight: 30, fontWeight: '500', letterSpacing: 0.2 },
  speakBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: radius.lg, borderWidth: 1.5 },
  speakBtnText:{ fontSize: 14, fontWeight: '700' },

  navRow:      { flexDirection: 'row', gap: spacing.md, padding: 14, borderTopWidth: 1 },
  navBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1 },
  navBtnText:  { fontSize: 13, fontWeight: '600' },
  btn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: radius.lg },
  btnText:     { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Concept photos (Unsplash)
  conceptImgBox:   { borderRadius: 16, borderWidth: 2, overflow: 'hidden' },
  conceptImg:      { width: '100%', height: 260 },
  conceptImgLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, position: 'absolute', bottom: 0, left: 0, right: 0 },
});

// ── CHECKPOINT CARD — interactive pause between scenes ───────────────────────
const CP_CONFIG = {
  quick_check:   { label: 'Quick Check!',  icon: 'zap' as const,        color: '#f59e0b' },
  tap_reveal:    { label: 'Predict!',      icon: 'help-circle' as const, color: '#8b5cf6' },
  tap_highlight: { label: 'Spot It!',      icon: 'target' as const,      color: '#10b981' },
};

function CheckpointCard({ checkpoint, colors, onDone }: {
  checkpoint: Checkpoint; colors: AppColors; onDone: () => void;
}) {
  const [selected,     setSelected]     = useState(-1);
  const [revealed,     setRevealed]     = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const cfg = CP_CONFIG[checkpoint.type];
  const isCorrect = selected === checkpoint.correct;

  async function handleSelect(idx: number) {
    if (revealed) return;
    setSelected(idx);
    setRevealed(true);

    // Auto-play explanation via TTS
    const explanationText = checkpoint.explanation || checkpoint.reveal
      || (idx === checkpoint.correct
        ? 'Excellent! You got it right!'
        : `The correct answer is: ${checkpoint.options[checkpoint.correct]}`);

    setAudioPlaying(true);
    try {
      const ttsRes = await fetch(`${SERVER_URL}/lesson/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: explanationText }),
      });
      const ttsData = await ttsRes.json();
      if (ttsData.audioUrl) {
        await playAudioUrl(`${SERVER_URL}${ttsData.audioUrl}`);
      } else {
        await speakText(explanationText);
      }
    } catch { await speakText(explanationText); }
    setAudioPlaying(false);
  }

  return (
    <View style={cp.overlay}>
      <ScrollView contentContainerStyle={cp.scroll} showsVerticalScrollIndicator={false}>
        {/* Header badge */}
        <View style={[cp.header, { backgroundColor: cfg.color + '20', borderColor: cfg.color + '50' }]}>
          <Feather name={cfg.icon} size={18} color={cfg.color} />
          <Text style={[cp.headerText, { color: cfg.color }]}>{cfg.label}</Text>
          <View style={[cp.headerPill, { backgroundColor: cfg.color }]}>
            <Text style={cp.headerPillText}>Ms. Zara</Text>
          </View>
        </View>

        {/* Question */}
        <Text style={[cp.question, { color: colors.textMain }]}>{checkpoint.prompt}</Text>

        {/* Options */}
        <View style={checkpoint.type === 'tap_highlight' ? cp.optionsGrid : cp.optionsList}>
          {checkpoint.options.map((opt, idx) => {
            const isSelected  = selected === idx;
            const isCorrectOpt = idx === checkpoint.correct;
            let borderColor = colors.borderColor;
            let bgColor = colors.cardDark;
            if (revealed && isCorrectOpt)              { borderColor = '#10b981'; bgColor = '#10b98118'; }
            if (revealed && isSelected && !isCorrectOpt) { borderColor = '#ef4444'; bgColor = '#ef444418'; }

            const isGrid = checkpoint.type === 'tap_highlight';

            return (
              <TouchableOpacity
                key={idx}
                style={[isGrid ? cp.optionCard : cp.optionRow, { borderColor, backgroundColor: bgColor }]}
                onPress={() => handleSelect(idx)}
                disabled={revealed}
                activeOpacity={0.7}
              >
                {!isGrid && (
                  <View style={[cp.optionBadge, {
                    backgroundColor: revealed && isCorrectOpt ? '#10b981'
                      : revealed && isSelected ? '#ef4444' : colors.borderColor,
                  }]}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                      {String.fromCharCode(65 + idx)}
                    </Text>
                  </View>
                )}
                <Text style={[isGrid ? cp.optionCardText : cp.optionRowText, { color: colors.textMain, flex: isGrid ? undefined : 1 }]}>
                  {opt}
                </Text>
                {revealed && isCorrectOpt && <Feather name="check-circle" size={16} color="#10b981" />}
                {revealed && isSelected && !isCorrectOpt && <Feather name="x-circle" size={16} color="#ef4444" />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Feedback */}
        {revealed && (
          <View style={[cp.feedback, {
            backgroundColor: isCorrect ? '#10b98112' : '#ef444412',
            borderColor: isCorrect ? '#10b98140' : '#ef444440',
          }]}>
            {audioPlaying
              ? <ActivityIndicator size="small" color={isCorrect ? '#10b981' : '#f59e0b'} />
              : <Feather name={isCorrect ? 'award' : 'info'} size={18} color={isCorrect ? '#10b981' : '#f59e0b'} />
            }
            <Text style={[cp.feedbackText, { color: colors.textMain }]}>
              {audioPlaying ? 'Ms. Zara is explaining…' :
                (checkpoint.explanation || checkpoint.reveal
                || (isCorrect ? 'Excellent! You got it right!' : `The correct answer is: ${checkpoint.options[checkpoint.correct]}`))}
            </Text>
          </View>
        )}

        {/* Continue button */}
        {revealed && (
          <TouchableOpacity
            style={[cp.continueBtn, { backgroundColor: isCorrect ? '#10b981' : '#6366f1' }]}
            onPress={onDone}
            activeOpacity={0.85}
          >
            <Feather name={isCorrect ? 'star' : 'arrow-right'} size={16} color="#fff" />
            <Text style={cp.continueBtnText}>{isCorrect ? 'Keep Going!' : 'Continue'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const cp = StyleSheet.create({
  overlay:        { position: 'absolute' as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.82)', zIndex: 100, justifyContent: 'center' },
  scroll:         { padding: 20, paddingBottom: 36, gap: 14 },
  header:         { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  headerText:     { fontSize: 17, fontWeight: '800', flex: 1 },
  headerPill:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  headerPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  question:       { fontSize: 16, fontWeight: '700', lineHeight: 26 },
  optionsList:    { gap: 8 },
  optionsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optionRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1.5 },
  optionCard:     { width: '47%', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 14, borderWidth: 1.5, gap: 6, minHeight: 80 },
  optionBadge:    { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  optionRowText:  { fontSize: 14, fontWeight: '600', lineHeight: 22 },
  optionCardText: { fontSize: 13, fontWeight: '700', textAlign: 'center', lineHeight: 20 },
  feedback:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1.5 },
  feedbackText:   { fontSize: 13, lineHeight: 22, flex: 1, fontWeight: '500' },
  continueBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, borderRadius: 14 },
  continueBtnText:{ color: '#fff', fontSize: 16, fontWeight: '800' },
});

// ── PHASE 3: PRACTICE (adaptive quiz) ───────────────────────────────────────
function PracticePhase({ topic, textChunks, colors, onComplete, fixedQuiz, isScience }: {
  topic: string; textChunks: TextChunk[]; colors: AppColors; onComplete: (score: number) => void;
  fixedQuiz?: QuizQ[]; isScience?: boolean;
}) {
  const [loading, setLoading]           = useState(false);
  const [questions, setQuestions]       = useState<QuizQ[]>([]);
  const [answers, setAnswers]           = useState<number[]>([]);
  const [submitted, setSubmitted]       = useState(false);
  const [explanations, setExplanations] = useState<Record<number, string>>({});
  const [loadingExp, setLoadingExp]     = useState<Record<number, boolean>>({});
  const [expAudio, setExpAudio]         = useState<Record<number, string>>({});
  const [playingExp, setPlayingExp]     = useState<number | null>(null);
  const [error, setError]               = useState('');

  async function loadQuiz() {
    setLoading(true); setError('');
    setSubmitted(false); setExplanations({}); setAnswers([]); setExpAudio({});
    try {
      // Use fixed quiz from lesson script if available
      if (fixedQuiz?.length) {
        setQuestions(fixedQuiz);
        setAnswers(new Array(fixedQuiz.length).fill(-1));
        setLoading(false);
        return;
      }
      const context = textChunks.slice(0, 4).map(c => c.content).join('\n');
      const quizUrl = isScience ? `${SERVER_URL}/ncert/science-quiz` : `${SERVER_URL}/ncert/quiz`;
      const res  = await fetch(quizUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, context }),
      });
      const data = await res.json();
      if (data.questions?.length) {
        setQuestions(data.questions);
        setAnswers(new Array(data.questions.length).fill(-1));
      } else setError('Could not load quiz. Try again.');
    } catch { setError('Server error.'); }
    setLoading(false);
  }

  async function explainWrong(qi: number) {
    const q = questions[qi];
    setLoadingExp(l => ({ ...l, [qi]: true }));
    try {
      const res = await fetch(`${SERVER_URL}/ncert/explain-wrong`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          question:      q.question,
          wrongAnswer:   q.options[answers[qi]],
          correctAnswer: q.options[q.correct],
          subject:       isScience ? 'Science' : 'Mathematics',
        }),
      });
      const data = await res.json();
      const explanation = data.explanation || 'Please review this concept.';
      setExplanations(e => ({ ...e, [qi]: explanation }));

      // Auto-play explanation with energetic comic voice (Laura — for encouraging wrong-answer moments)
      setPlayingExp(qi);
      try {
        const ttsRes = await fetch(`${SERVER_URL}/lesson/tts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: explanation, voice: 'comic' }),
        });
        const ttsData = await ttsRes.json();
        await playTTSResponse(ttsData, explanation);
      } catch { await speakText(explanation); }
      setPlayingExp(null);
    } catch {
      setExplanations(e => ({ ...e, [qi]: 'Please review the Book Content for this concept.' }));
    }
    setLoadingExp(l => ({ ...l, [qi]: false }));
  }

  const allAnswered = answers.length > 0 && answers.every(a => a !== -1);
  const score       = submitted ? questions.filter((q, i) => answers[i] === q.correct).length : 0;
  const pct         = submitted && questions.length ? Math.round((score / questions.length) * 100) : 0;

  // Start screen
  if (!loading && questions.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 }}>
        <View style={[pr.badge, { backgroundColor: colors.primary + '15' }]}>
          <Feather name="edit-3" size={40} color={colors.primary} />
        </View>
        <Text style={{ color: colors.textMain, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>
          Time to Practice!
        </Text>
        <Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 22 }}>
          5 questions on "{topic}"{'\n'}Get one wrong? Ms. Zara will explain it to you.
        </Text>
        {error ? <Text style={{ color: '#ef4444', textAlign: 'center' }}>{error}</Text> : null}
        <TouchableOpacity style={[pr.btn, { backgroundColor: colors.primary, paddingHorizontal: 40 }]} onPress={loadQuiz}>
          <Feather name="play" size={18} color="#fff" />
          <Text style={pr.btnText}>Start Practice</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textMuted }}>Generating practice questions…</Text>
      </View>
    );
  }

  // Results view
  if (submitted) {
    return (
      <ScrollView contentContainerStyle={{ gap: spacing.lg, padding: spacing.xl, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {/* Score */}
        <View style={[pr.scoreBanner, {
          backgroundColor: pct >= 80 ? '#10b98115' : pct >= 60 ? '#f59e0b15' : '#ef444415',
          borderColor:     pct >= 80 ? '#10b98140' : pct >= 60 ? '#f59e0b40' : '#ef444440',
        }]}>
          <Feather name={pct >= 80 ? 'award' : pct >= 60 ? 'star' : 'target'}
            size={44} color={pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444'} />
          <Text style={{ color: colors.textMain, fontSize: 30, fontWeight: '900' }}>{score}/{questions.length}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            {pct >= 80
              ? 'Excellent! You understand this chapter!'
              : pct >= 60
              ? 'Good effort! Review the hints below.'
              : 'Ms. Zara will explain what you missed!'}
          </Text>
        </View>

        {/* Per-question review */}
        {questions.map((q, qi) => {
          const isCorrect = answers[qi] === q.correct;
          const hasExp    = explanations[qi];
          const isLoadExp = loadingExp[qi];
          const isPlayExp = playingExp === qi;
          return (
            <View key={qi} style={[pr.qCard, {
              backgroundColor: colors.cardDark,
              borderColor: isCorrect ? '#10b98140' : '#ef444430',
            }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Feather name={isCorrect ? 'check-circle' : 'x-circle'} size={18}
                  color={isCorrect ? '#10b981' : '#ef4444'} />
                <Text style={{ fontSize: 13, fontWeight: '800', color: isCorrect ? '#10b981' : '#ef4444', textTransform: 'uppercase' }}>
                  Q{qi + 1} — {isCorrect ? 'Correct!' : 'Incorrect'}
                </Text>
              </View>
              <Text style={{ color: colors.textMain, fontSize: 15, fontWeight: '600', lineHeight: 22, marginBottom: 12 }}>
                {q.question}
              </Text>

              {/* Options */}
              <View style={{ gap: 6 }}>
                {q.options.map((opt, oi) => {
                  const isCorrectOpt  = oi === q.correct;
                  const isStudentPick = oi === answers[qi];
                  return (
                    <View key={oi} style={[pr.optRow, {
                      backgroundColor: isCorrectOpt ? '#10b98120' : (isStudentPick && !isCorrect) ? '#ef444415' : colors.bgDark,
                      borderColor: isCorrectOpt ? '#10b98150' : (isStudentPick && !isCorrect) ? '#ef444440' : colors.borderColor,
                    }]}>
                      {isCorrectOpt
                        ? <Feather name="check" size={14} color="#10b981" />
                        : isStudentPick && !isCorrect
                        ? <Feather name="x" size={14} color="#ef4444" />
                        : <View style={{ width: 14 }} />
                      }
                      <Text style={{
                        fontSize: 13, flex: 1,
                        color: isCorrectOpt ? '#10b981' : (isStudentPick && !isCorrect) ? '#ef4444' : colors.textMuted,
                        fontWeight: isCorrectOpt ? '700' : '400',
                      }}>{opt}</Text>
                    </View>
                  );
                })}
              </View>

              {/* Ms. Zara explains wrong answers */}
              {!isCorrect && (
                <View style={{ marginTop: 14 }}>
                  {hasExp ? (
                    <View style={[pr.expBox, { borderColor: '#6366f130' }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={{ color: '#818cf8', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Ms. Zara explains
                        </Text>
                        {expAudio[qi] && (
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            onPress={async () => {
                              setPlayingExp(qi);
                              await speakText(explanations[qi] || '');
                              setPlayingExp(null);
                            }}
                          >
                            <Feather name={isPlayExp ? 'volume-2' : 'play-circle'} size={16} color="#818cf8" />
                            <Text style={{ color: '#818cf8', fontSize: 12, fontWeight: '700' }}>
                              {isPlayExp ? 'Playing…' : 'Listen'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={{ color: colors.textMain, fontSize: 14, lineHeight: 22 }}>{hasExp}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[pr.btn, { backgroundColor: '#6366f1' }]}
                      onPress={() => explainWrong(qi)}
                      disabled={isLoadExp}
                    >
                      {isLoadExp
                        ? <><ActivityIndicator size="small" color="#fff" /><Text style={pr.btnText}>Ms. Zara is thinking…</Text></>
                        : <><Feather name="help-circle" size={16} color="#fff" /><Text style={pr.btnText}>Ms. Zara, explain this to me</Text></>
                      }
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* Action buttons */}
        <View style={{ gap: spacing.md }}>
          {pct < 80 && (
            <TouchableOpacity style={[pr.btn, { backgroundColor: '#f59e0b' }]} onPress={loadQuiz}>
              <Feather name="refresh-cw" size={16} color="#fff" />
              <Text style={pr.btnText}>Try Again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[pr.btn, {
              backgroundColor: pct >= 80 ? '#10b981' : colors.cardDark,
              borderWidth: pct < 80 ? 1 : 0,
              borderColor: colors.borderColor,
            }]}
            onPress={() => onComplete(score)}
          >
            <Text style={[pr.btnText, { color: pct >= 80 ? '#fff' : colors.textMain }]}>
              {pct >= 80 ? 'Chapter Complete!' : 'Continue Anyway'}
            </Text>
            <Feather name="arrow-right" size={16} color={pct >= 80 ? '#fff' : colors.textMain} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Quiz view
  return (
    <ScrollView contentContainerStyle={{ gap: spacing.lg, padding: spacing.xl, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
      {questions.map((q, qi) => (
        <View key={qi} style={[pr.qCard, {
          backgroundColor: colors.cardDark,
          borderColor: answers[qi] !== -1 ? colors.primary + '60' : colors.borderColor,
        }]}>
          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 6 }}>
            Question {qi + 1} of {questions.length}
          </Text>
          <Text style={{ color: colors.textMain, fontSize: 16, fontWeight: '700', lineHeight: 24, marginBottom: 14 }}>
            {q.question}
          </Text>
          <View style={{ gap: 10 }}>
            {q.options.map((opt, oi) => {
              const selected = answers[qi] === oi;
              return (
                <TouchableOpacity
                  key={oi}
                  style={[pr.optBtn, {
                    backgroundColor: selected ? colors.primary + '15' : colors.bgDark,
                    borderColor:     selected ? colors.primary         : colors.borderColor,
                  }]}
                  onPress={() => setAnswers(a => a.map((v, idx) => idx === qi ? oi : v))}
                >
                  <View style={[pr.radio, {
                    borderColor:     selected ? colors.primary : colors.borderColor,
                    backgroundColor: selected ? colors.primary : 'transparent',
                  }]}>
                    {selected && <View style={pr.radioDot} />}
                  </View>
                  <Text style={{ fontSize: 14, flex: 1, color: selected ? colors.primary : colors.textMain, fontWeight: selected ? '700' : '400' }}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[pr.btn, {
          backgroundColor: allAnswered ? colors.primary : colors.cardDark,
          borderWidth: 1, borderColor: allAnswered ? colors.primary : colors.borderColor,
        }]}
        onPress={() => setSubmitted(true)}
        disabled={!allAnswered}
      >
        <Feather name="check" size={16} color={allAnswered ? '#fff' : colors.textMuted} />
        <Text style={[pr.btnText, { color: allAnswered ? '#fff' : colors.textMuted }]}>
          {allAnswered ? 'Submit Answers' : `Answer all ${questions.length} questions`}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const pr = StyleSheet.create({
  badge:       { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  scoreBanner: { borderRadius: 20, borderWidth: 1, padding: 28, alignItems: 'center', gap: 10 },
  qCard:       { borderRadius: 16, borderWidth: 1, padding: 18 },
  optRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, borderWidth: 1, padding: 12 },
  optBtn:      { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 2, padding: 14 },
  radio:       { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  expBox:      { backgroundColor: '#6366f115', borderRadius: 14, padding: 16, borderWidth: 1 },
  btn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: radius.lg },
  btnText:     { color: '#fff', fontSize: 15, fontWeight: '700' },
});

// ── COMPLETE PHASE ───────────────────────────────────────────────────────────
function CompletePhase({ topic, score, colors, onBack }: {
  topic: string; score: number; colors: AppColors; onBack: () => void;
}) {
  const pct   = Math.round((score / 5) * 100);
  const xp    = score * 20 + 10; // bonus 10 XP for completing
  const coins = Math.max(1, score);
  const perfect = pct === 100;
  const great = pct >= 80;
  const celebColor = perfect ? '#4ade80' : great ? '#10b981' : '#f59e0b';

  return (
    <ScrollView contentContainerStyle={{ padding: 28, gap: 20, paddingBottom: 48, alignItems: 'center' }} showsVerticalScrollIndicator={false}>

      {/* Celebration */}
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 16 }}>
        <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: celebColor + '20', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={perfect ? 'star' : great ? 'award' : 'star'} size={52} color={celebColor} />
        </View>
        <Text style={{ color: colors.textMain, fontSize: 26, fontWeight: '900', textAlign: 'center' }}>
          {perfect ? 'Perfect Score!' : great ? 'Chapter Complete!' : 'Lesson Done!'}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>{topic}</Text>
      </View>

      {/* Score + rewards */}
      <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
        <View style={{ flex: 1, backgroundColor: colors.cardDark, borderRadius: 16, padding: 16, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.borderColor }}>
          <Feather name="check-circle" size={22} color="#10b981" />
          <Text style={{ color: '#10b981', fontSize: 22, fontWeight: '900' }}>{score}/5</Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>SCORE</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.cardDark, borderRadius: 16, padding: 16, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.borderColor }}>
          <Feather name="zap" size={22} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '900' }}>+{xp}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>XP EARNED</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.cardDark, borderRadius: 16, padding: 16, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.borderColor }}>
          <Feather name="dollar-sign" size={22} color="#f59e0b" />
          <Text style={{ color: '#f59e0b', fontSize: 22, fontWeight: '900' }}>+{coins}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>COINS</Text>
        </View>
      </View>

      {/* What you learned */}
      <View style={{ backgroundColor: colors.cardDark, borderRadius: 16, padding: 18, width: '100%', gap: 10, borderWidth: 1, borderColor: colors.primary + '30' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="book-open" size={16} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '700' }}>What you learned today</Text>
        </View>
        <Text style={{ color: colors.textMain, fontSize: 14, lineHeight: 22 }}>
          You completed the chapter on <Text style={{ fontWeight: '700' }}>{topic}</Text>.{' '}
          {great
            ? 'Excellent understanding! You are ready for the next chapter.'
            : 'Good effort! Review the chapter once more to strengthen your understanding.'}
        </Text>
      </View>

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: radius.lg, backgroundColor: colors.primary }}
          onPress={onBack}
        >
          <Feather name="grid" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>All Chapters</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ── MAIN SCREEN ──────────────────────────────────────────────────────────────
export default function Learn5EScreen({ route, navigation }: any) {
  const { topic, chapterId, subject = 'Mathematics' } = route.params ?? {};
  const isScience = subject === 'Science';
  const { colors } = useTheme();
  const { completeLesson, recordStudyTime } = useStudentData();
  const studySessionStartRef = useRef<number | null>(null);
  const trackedStudyMinutesRef = useRef(0);

  const [phase, setPhase]         = useState<Phase>('select');
  const [character, setCharacter] = useState<CharacterKey>('zara');
  const [contentLoading, setContentLoading] = useState(true);
  const [textChunks, setTextChunks]         = useState<TextChunk[]>([]);
  const [imageChunks, setImageChunks]       = useState<ImageChunk[]>([]);
  const [finalScore, setFinalScore]         = useState(0);
  const [lessonQuiz, setLessonQuiz]         = useState<QuizQ[]>([]);

  // Warn user before leaving mid-lesson on Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (phase === 'select' || phase === 'complete') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'Leave Lesson?',
        'Your lesson progress will be lost. Are you sure you want to go back?',
        [
          { text: 'Stay', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
        ]
      );
      return true;
    });
    return () => handler.remove();
  }, [phase]);

  // Stop audio when screen loses focus (drawer nav keeps screens mounted)
  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      stopCurrentAudio();
      if (Platform.OS === 'web' && (window as any).speechSynthesis) {
        try { (window as any).speechSynthesis.cancel(); } catch {}
      }
    });
    return () => {
      unsubBlur();
      stopCurrentAudio();
      if (Platform.OS === 'web' && (window as any).speechSynthesis) {
        try { (window as any).speechSynthesis.cancel(); } catch {}
      }
    };
  }, [navigation]);

  // Reset on topic change
  useEffect(() => {
    setPhase('select');
    setFinalScore(0);
    setTextChunks([]);
    setImageChunks([]);
    setLessonQuiz([]);
    setContentLoading(true);
  }, [topic]);

  useEffect(() => {
    if (!topic) return;
    const url = isScience
      ? `${SERVER_URL}/ncert/science-chapter-content?topic=${encodeURIComponent(topic)}`
      : `${SERVER_URL}/ncert/chapter-content?topic=${encodeURIComponent(topic)}`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setTextChunks(data.textChunks || []);
        setImageChunks(data.imageChunks || []);
        setContentLoading(false);
      })
      .catch(() => setContentLoading(false));
  }, [topic, isScience]);

  // Track real study time while the learner is actively in Learn/Practice phases.
  useEffect(() => {
    function flushWholeMinutes() {
      if (studySessionStartRef.current == null) return;
      const elapsedWholeMinutes = Math.floor((Date.now() - studySessionStartRef.current) / 60000);
      const delta = elapsedWholeMinutes - trackedStudyMinutesRef.current;
      if (delta > 0) {
        recordStudyTime(delta);
        trackedStudyMinutesRef.current += delta;
      }
    }

    const isActiveStudyPhase = phase === 'learn' || phase === 'practice';
    if (!isActiveStudyPhase) {
      flushWholeMinutes();
      studySessionStartRef.current = null;
      trackedStudyMinutesRef.current = 0;
      return;
    }

    if (studySessionStartRef.current == null) {
      studySessionStartRef.current = Date.now();
      trackedStudyMinutesRef.current = 0;
    }

    const interval = setInterval(flushWholeMinutes, 15000);
    return () => {
      clearInterval(interval);
      flushWholeMinutes();
    };
  }, [phase]);

  const GRADE = 'Class 3';

  // No Watch phase — flow is: Select Guide → Learn → Practice → Done
  const PHASES = [
    { key: 'select',   label: 'Guide',    icon: 'user'   },
    { key: 'learn',    label: 'Learn',    icon: 'zap'    },
    { key: 'practice', label: 'Practice', icon: 'edit-3' },
    { key: 'complete', label: 'Done',     icon: 'award'  },
  ];
  const currentIdx = PHASES.findIndex(p => p.key === phase);

  return (
    <ScreenLayout>
      <View style={{ flex: 1, backgroundColor: colors.bgDark }}>
        {/* Header */}
        <View style={[ms.header, { borderBottomColor: colors.borderColor }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
            <Feather name="arrow-left" size={22} color={colors.textMain} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textMain, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{topic}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>Ch {chapterId} · NCERT Grade 3 · {subject}</Text>
          </View>
        </View>

        {/* Phase stepper */}
        <View style={[ms.stepper, { borderBottomColor: colors.borderColor }]}>
          {PHASES.map((p, i) => {
            const isDone   = currentIdx > i;
            const isActive = phase === p.key;
            return (
              <React.Fragment key={p.key}>
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <View style={[ms.dot, {
                    backgroundColor: isDone ? '#10b981' : isActive ? colors.primary : colors.cardDark,
                    borderColor: isDone ? '#10b981' : isActive ? colors.primary : colors.borderColor,
                  }]}>
                    <Feather name={(isDone ? 'check' : p.icon) as any} size={12} color={isDone || isActive ? '#fff' : colors.textDim} />
                  </View>
                  <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, color: isDone ? '#10b981' : isActive ? colors.primary : colors.textDim }}>
                    {p.label}
                  </Text>
                </View>
                {i < PHASES.length - 1 && (
                  <View style={[ms.line, { backgroundColor: isDone ? '#10b981' : colors.borderColor }]} />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {/* Content */}
        {contentLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {phase === 'select'   && (
              <CharacterSelectPhase
                topic={topic}
                colors={colors}
                onSelect={(key) => {
                  setCharacter(key);
                  setPhase('learn');
                }}
              />
            )}
            {phase === 'learn'    && <LearnPhase topic={topic} grade={GRADE} textChunks={textChunks} imageChunks={imageChunks} colors={colors} character={character} isScience={isScience} onDone={(quiz) => { if (quiz?.length) setLessonQuiz(quiz); setPhase('practice'); }} />}
            {phase === 'practice' && <PracticePhase topic={topic} textChunks={textChunks} colors={colors} fixedQuiz={lessonQuiz} isScience={isScience} onComplete={(s) => { setFinalScore(s); completeLesson(topic); setPhase('complete'); }} />}
            {phase === 'complete' && <CompletePhase topic={topic} score={finalScore} colors={colors} onBack={() => navigation.goBack()} />}
          </>
        )}
      </View>

      {/* Floating per-topic AI Coach — only show during learn/practice phases */}
      {(phase === 'learn' || phase === 'practice') && topic && (
        <TopicAICoach
          topic={topic}
          subject={subject}
          grade="Grade 3"
          curriculum="IB_PYP"
        />
      )}
    </ScreenLayout>
  );
}

const ms = StyleSheet.create({
  header:  { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.xl, paddingBottom: spacing.lg, borderBottomWidth: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: spacing.xl, borderBottomWidth: 1, gap: 0 },
  dot:     { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  line:    { flex: 1, height: 2, marginHorizontal: 6, maxWidth: 48 },
});
