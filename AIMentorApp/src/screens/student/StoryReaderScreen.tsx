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

// Story-specific ambient music: base freq + harmonics for each story theme
const STORY_AMBIENT: Record<string, { freq: number; tempo: number }> = {
  prahlada:            { freq: 174, tempo: 0.4 }, // devotional, intense
  hanuman:             { freq: 285, tempo: 0.6 }, // brave, energetic
  ramayana_rama_sita:  { freq: 396, tempo: 0.3 }, // peaceful, lyrical
  bhagavad_gita_arjuna:{ freq: 528, tempo: 0.3 }, // wisdom, calm
  dhruva:              { freq: 432, tempo: 0.35 }, // determination
  ambarisha:           { freq: 417, tempo: 0.3 }, // devotion
  bharat:              { freq: 396, tempo: 0.3 }, // gentle
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

// Page flip sound via Web Audio API
function playPageFlip() {
  if (Platform.OS !== 'web') return;
  try {
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.18;
    src.connect(g); g.connect(ctx.destination); src.start();
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

// Ambient music via Web Audio API (story-specific)
function createAmbientMusic(storyId: string) {
  if (Platform.OS !== 'web') return null;
  try {
    const config = STORY_AMBIENT[storyId] ?? { freq: 396, tempo: 0.3 };
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = 0;
    master.connect(ctx.destination);

    // Harmonic drone: root + 5th + octave
    [1, 1.5, 2, 3].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = config.freq * ratio;
      g.gain.value = [0.4, 0.25, 0.15, 0.08][i];
      osc.connect(g); g.connect(master);
      osc.start();
    });

    // Fade in
    master.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 2);

    return { ctx, master, stop() {
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      setTimeout(() => { try { ctx.close(); } catch {} }, 2000);
    }};
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
  const [readCount,    setReadCount]    = useState(0);
  const [donePages,    setDonePages]    = useState<Set<number>>(new Set());

  const audioRef   = useRef<any>(null);
  const ambientRef = useRef<any>(null);
  const playGenRef = useRef(0);
  const fadeAnim   = useRef(new Animated.Value(1)).current;
  const slideAnim  = useRef(new Animated.Value(0)).current;

  // Load completed pages from storage
  useEffect(() => {
    AsyncStorage.getItem(`story_done_${storyId}`).then(v => {
      if (v) setDonePages(new Set(JSON.parse(v)));
    }).catch(() => {});
  }, [storyId]);

  useEffect(() => {
    fetch(`${SERVER_URL}/stories/${storyId}`)
      .then(r => r.json())
      .then((data: Story) => { setStory(data); setLoading(false); })
      .catch(() => setLoading(false));
    return () => { stopAudio(); ambientRef.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  useEffect(() => { setReadCount(0); }, [currentPage]);

  useEffect(() => {
    if (autoPlay && story) {
      const page = story.pages[currentPage];
      if (page) speakPage(page.pageNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, autoPlay]);

  function markPageDone(pageNum: number) {
    setDonePages(prev => {
      const next = new Set(prev).add(pageNum);
      AsyncStorage.setItem(`story_done_${storyId}`, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }

  function pauseAudio() {
    // Pause but keep position — resume will continue from here
    if (audioRef.current) {
      try { audioRef.current.pause(); } catch {}
    }
    if (bgMusicRef.current) {
      try { bgMusicRef.current.pause(); } catch {}
    }
    setPlaying(false);
  }

  function stopAudio() {
    // Full stop — clears audio and resets position
    playGenRef.current++;
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {}
      audioRef.current = null;
    }
    ambientRef.current?.stop(); ambientRef.current = null;
    setIsLoading(false); setPlaying(false);
  }

  function resumeAudio() {
    if (audioRef.current) {
      try {
        audioRef.current.play();
        if (bgMusicRef.current) bgMusicRef.current.play().catch(() => {});
        setPlaying(true);
      } catch {}
    }
  }

  async function speakPage(pageNum: number) {
    if (!story) return;
    // If same page audio is loaded and paused, just resume
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
        audioRef.current = audio;
        setIsLoading(false); setPlaying(true);

        const sentences = splitSentences(story.pages.find(p => p.pageNumber === pageNum)?.text ?? '');

        // Start story-specific ambient music
        ambientRef.current = createAmbientMusic(story.id);

        audio.ontimeupdate = () => {
          if (!audio.duration) return;
          setReadCount(Math.floor((audio.currentTime / audio.duration) * sentences.length));
        };
        audio.onended = () => {
          setReadCount(sentences.length);
          setPlaying(false);
          markPageDone(pageNum);
          ambientRef.current?.stop(); ambientRef.current = null;
          if (autoPlay && story && currentPage < story.pages.length - 1) goToPage(currentPage + 1);
        };
        audio.onerror = () => { setIsLoading(false); setPlaying(false); ambientRef.current?.stop(); ambientRef.current = null; };
        audio.play();
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
    stopAudio(); playPageFlip();
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
  const sentences   = splitSentences(page.text);
  const isBusy      = isLoading || playing;
  const totalDone   = donePages.size;

  return (
    <ScreenLayout>
      <View style={styles.screen}>

        <LinearGradient colors={pastelGrad} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.topBar}>
          <TouchableOpacity onPress={() => { stopAudio(); navigation.goBack(); }} style={styles.backBtn} activeOpacity={0.7}>
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

              {/* Story text — sentences turn grey as narration progresses */}
              <Text style={styles.storyText}>
                {sentences.map((s, i) => (
                  <Text key={i} style={{ color: i < readCount ? colors.textMuted : colors.textMain }}>{s}</Text>
                ))}
              </Text>

              <View style={styles.listenRow}>
                <TouchableOpacity
                  style={[styles.listenBtn, { backgroundColor: isBusy ? '#e11d48' : pastelAccent }]}
                  onPress={() => playing ? pauseAudio() : speakPage(page.pageNumber)}
                  activeOpacity={0.85}
                >
                  {isLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name={playing ? 'pause' : 'headphones'} size={14} color="#fff" />
                  }
                  <Text style={styles.listenBtnText}>{isLoading ? 'Loading…' : playing ? 'Pause' : 'Listen'}</Text>
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
