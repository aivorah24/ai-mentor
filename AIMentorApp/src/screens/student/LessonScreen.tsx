/**
 * LessonScreen.tsx
 * Step 4 of the redesigned Learning Path flow: the actual lesson, opened
 * from SubjectSyllabusScreen. Four modes, matching the approved prototype:
 *   Read (default) · Listen · Ask AI (Aivorah) · Practice
 *
 * Backed today by the curated CBSE Grade 6 English dataset. Falls back to
 * TopicLesson's existing scene-based viewer for anything not yet curated.
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, Image, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import TopicAICoach from '../../components/common/TopicAICoach';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import { CBSE_G6_ENGLISH_SYLLABUS } from '../../data/cbseG6EnglishSyllabus';
import { getSubjectSyllabus } from '../../data/syllabusRegistry';
import SERVER_URL from '../../config/serverUrl';

type Mode = 'read' | 'listen' | 'ask' | 'practice';

type ListenStep = {
  label: string;
  heading: string;
  text: string;
  keyIdea?: string;
  pauseThink?: { question: string; options: string[]; correctIndex: number };
};

// Speaks text and reports word-boundary positions so the UI can highlight
// the word currently being read (karaoke-style), and calls onEnd when done.
function speakWithBoundary(
  text: string,
  onWordBoundary: (charIndex: number) => void,
  onEnd: () => void,
  rate: number = 0.78,
): void {
  if (Platform.OS !== 'web' || !(window as any).speechSynthesis) { onEnd(); return; }
  const synth = (window as any).speechSynthesis as SpeechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = rate; utter.pitch = 1.05;
  const voices = synth.getVoices();
  const pick = voices.find(v => /zira/i.test(v.name)) || voices.find(v => /en[-_]US/i.test(v.lang));
  if (pick) utter.voice = pick;
  utter.onboundary = (e: any) => { if (e.name === 'word' || e.charIndex !== undefined) onWordBoundary(e.charIndex ?? 0); };
  utter.onend = () => onEnd();
  utter.onerror = () => onEnd();
  synth.speak(utter);
}
function stopSpeaking() {
  if (Platform.OS === 'web' && (window as any).speechSynthesis) {
    try { (window as any).speechSynthesis.cancel(); } catch {}
  }
}
// True pause/resume (keeps the utterance's position) rather than cancel+restart,
// so pausing mid-sentence and resuming continues from where it left off.
function pauseSpeakingInPlace() {
  if (Platform.OS === 'web' && (window as any).speechSynthesis) {
    try { (window as any).speechSynthesis.pause(); } catch {}
  }
}
function resumeSpeakingInPlace() {
  if (Platform.OS === 'web' && (window as any).speechSynthesis) {
    try { (window as any).speechSynthesis.resume(); } catch {}
  }
}

// Splits text into sentences with their char-offset range, so the Listen tab
// can highlight the whole sentence currently being read (not just one word).
function sentencesWithOffsets(text: string): { sentence: string; start: number; end: number }[] {
  const out: { sentence: string; start: number; end: number }[] = [];
  const re = /[^.!?]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0].trim()) continue;
    out.push({ sentence: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// The source PDFs live in server/data/ncert_books/grade6/<folder>/ — folder
// names don't always match the subject label shown in the UI (e.g. "Social
// Science" → "social_science"), so this maps between them.
function subjectToBookFolder(subject: string): string {
  const s = subject.trim().toLowerCase();
  if (s.includes('social')) return 'social_science';
  if (s.includes('science')) return 'science';
  if (s.includes('math')) return 'mathematics';
  if (s.includes('english')) return 'english';
  return s.replace(/\s+/g, '_');
}

// The real NCERT book title varies by grade + subject — "Poorvi" is only the
// Grade 6 English reader. Using it as a blanket label mislabels every other
// book (e.g. Grade 6 Science is "Curiosity"). Map the ones we ship; fall back
// to a neutral, non-misleading label for the rest.
function bookTitleFor(grade: string, subject: string): string {
  const g = grade.replace(/[^0-9]/g, '');
  const s = subject.trim().toLowerCase();
  const G6: Record<string, string> = {
    english: 'Poorvi',
    science: 'Curiosity',
    'social science': 'Exploring Society: India and Beyond',
    mathematics: 'Ganita Prakash',
  };
  const key = s.includes('social') ? 'social science'
    : s.includes('science') ? 'science'
    : s.includes('math') ? 'mathematics'
    : s.includes('english') ? 'english' : s;
  if (g === '6' && G6[key]) return G6[key];
  return `${grade} ${subject} Textbook`;
}

export default function LessonScreen({ navigation, route }: any) {
  const subject      = (route?.params?.subject      ?? 'English') as string;
  const curriculum   = (route?.params?.curriculum   ?? 'CBSE')    as string;
  const grade        = (route?.params?.grade        ?? 'Grade 6') as string;
  const chapterIndex = (route?.params?.chapterIndex ?? 0)         as number;
  const topicIndex   = (route?.params?.topicIndex   ?? 0)         as number;
  const topicId      = route?.params?.topicId as string | undefined;
  const chapterTitleParam = route?.params?.chapterTitle as string | undefined;

  // A real teacher-published topic (has a DB id) fetches its resolved
  // Read/Listen/Practice content instead of the static curated dataset —
  // this is what makes an uploaded book actually reach students.
  const [dbTopic, setDbTopic] = useState<typeof CBSE_G6_ENGLISH_SYLLABUS[0]['topics'][0] | null>(null);
  const [loadingDbTopic, setLoadingDbTopic] = useState(!!topicId);
  useEffect(() => {
    if (!topicId) { setLoadingDbTopic(false); return; }
    let cancelled = false;
    setLoadingDbTopic(true);
    fetch(`${SERVER_URL}/teacher/syllabus/topic/${topicId}/resources`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const byType: Record<string, any> = {};
        for (const r of data.resources || []) byType[r.resourceType] = r;
        const explanation = byType.AI_EXPLANATION;
        const images = byType.IMAGES;
        setDbTopic({
          name: route?.params?.topicName || 'This topic',
          kind: 'Chapter',
          page: images?.payload?.pageRef ? String(images.payload.pageRef) : '',
          readText: {
            intro: explanation?.status === 'READY' ? explanation.payload?.text : '',
            body: [],
            figureUrl: images?.status === 'READY' ? images.payload?.items?.[0]?.description : undefined,
            figureCaption: images?.status === 'READY' ? (images.payload?.items?.[0]?.description || '') : '',
            activity: '',
          },
        } as any);
        setLoadingDbTopic(false);
      })
      .catch(() => { if (!cancelled) setLoadingDbTopic(false); });
    return () => { cancelled = true; };
  }, [topicId]);

  const { colors } = useTheme();
  const { completeLesson } = useStudentData();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mode, setMode] = useState<Mode>('read');
  const [speaking, setSpeaking] = useState(false);
  const [fullBookView, setFullBookView] = useState(false);
  const [listenStep, setListenStep] = useState(0);
  const [listenPlaying, setListenPlaying] = useState(false);
  const [listenCharIndex, setListenCharIndex] = useState(0);
  const [fontLarge, setFontLarge] = useState(false);
  const [pauseAnswer, setPauseAnswer] = useState<number | null>(null);
  const [vocabIndex, setVocabIndex] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  // Real measured playback time (not a word-count guess) — the transport bar
  // shows the actual duration the browser's TTS took for each part, captured
  // the first time it's played, so times never look "frozen"/made-up.
  const [stepDurations, setStepDurations] = useState<Record<number, number>>({});
  const [clockTick, setClockTick] = useState(0);
  const [hasPausedUtterance, setHasPausedUtterance] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(0.78);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const playStartRef = useRef<number | null>(null);
  // Seconds already elapsed before the current play/resume segment started —
  // carries over across pause/resume so the clock never snaps back to 0:00.
  const accumulatedRef = useRef(0);
  // Char offset into the step's text where the CURRENT utterance started —
  // non-zero after a 10s skip, since we speak a substring, not the full text.
  const charOffsetRef = useRef(0);
  const leftScrollRef = useRef<any>(null);
  const sentenceYRef = useRef<Record<number, number>>({});
  const PLAYBACK_RATES = [0.6, 0.78, 1.0, 1.25];

  const chapter = topicId
    ? { title: chapterTitleParam || '', topics: dbTopic ? [dbTopic] : [] }
    : getSubjectSyllabus(curriculum, grade, subject)[chapterIndex];
  const topic = topicId ? dbTopic ?? undefined : chapter?.topics[topicIndex];

  const listenSteps: ListenStep[] = useMemo(() => {
    if (!topic) return [];
    if (topic.readText.listenParts && topic.readText.listenParts.length > 0) {
      return topic.readText.listenParts.map(p => ({
        label: p.heading, heading: p.heading, text: p.text, keyIdea: p.keyIdea, pauseThink: p.pauseThink,
      }));
    }
    return [
      { label: 'Introduction', heading: 'Introduction', text: topic.readText.intro },
      ...topic.readText.body.map((p, i) => ({ label: `Part ${i + 1}`, heading: `Part ${i + 1}`, text: p })),
      { label: 'Try this yourself', heading: 'Try this yourself', text: topic.readText.activity },
    ];
  }, [topic]);

  const vocab = topic?.readText.vocab ?? [];

  const currentListenStep = listenSteps[listenStep];
  const listenSentences = useMemo(
    () => (currentListenStep ? sentencesWithOffsets(currentListenStep.text) : []),
    [currentListenStep],
  );
  const curSentenceIdx = listenSentences.reduce((best, s, i) => (s.start <= listenCharIndex ? i : best), 0);

  function playListenStep(i: number) {
    if (!listenSteps[i]) return;
    setListenStep(i);
    setListenCharIndex(0);
    setListenPlaying(true);
    setVisitedSteps(prev => new Set(prev).add(i));
    accumulatedRef.current = 0;
    charOffsetRef.current = 0;
    playStartRef.current = Date.now();
    setHasPausedUtterance(false);
    speakWithBoundary(
      listenSteps[i].text,
      (charIndex) => setListenCharIndex(charIndex),
      () => {
        const measured = accumulatedRef.current + (playStartRef.current ? (Date.now() - playStartRef.current) / 1000 : 0);
        setStepDurations(prev => ({ ...prev, [i]: measured }));
        accumulatedRef.current = 0;
        charOffsetRef.current = 0;
        playStartRef.current = null;
        setHasPausedUtterance(false);
        setListenPlaying(false);
      },
      playbackRate,
    );
  }
  function toggleListenPlay() {
    if (listenPlaying) {
      // Pause in place — keeps the utterance's spoken position so resume
      // continues from here, and the elapsed time doesn't jump back to 0:00.
      if (playStartRef.current) accumulatedRef.current += (Date.now() - playStartRef.current) / 1000;
      playStartRef.current = null;
      pauseSpeakingInPlace();
      setHasPausedUtterance(true);
      setListenPlaying(false);
    } else if (hasPausedUtterance) {
      playStartRef.current = Date.now();
      resumeSpeakingInPlace();
      setListenPlaying(true);
    } else {
      playListenStep(listenStep);
    }
  }
  function goToListenStep(i: number) {
    if (i < 0 || i >= listenSteps.length) return;
    stopSpeaking();
    accumulatedRef.current = 0;
    charOffsetRef.current = 0;
    playStartRef.current = null;
    setHasPausedUtterance(false);
    setListenPlaying(false);
    setListenStep(i);
    setListenCharIndex(0);
    setVisitedSteps(prev => new Set(prev).add(i));
  }
  // Current elapsed seconds into the step, whether playing, paused, or idle —
  // shared by the transport display and the skip/seek logic below.
  function currentElapsedSec(totalSec: number): number {
    if (listenPlaying && playStartRef.current) {
      return Math.min(accumulatedRef.current + (Date.now() - playStartRef.current) / 1000, totalSec);
    }
    if (hasPausedUtterance) return Math.min(accumulatedRef.current, totalSec);
    return Math.min(stepDurations[listenStep] ?? 0, totalSec);
  }
  // Jumps playback forward/back by deltaSec (YouTube-style ±10s), by
  // re-starting the utterance from an estimated character position — the Web
  // Speech API has no real seek, so this maps time to a proportional offset
  // into the step's text.
  function skipBy(deltaSec: number) {
    const step = listenSteps[listenStep];
    if (!step) return;
    const wordCount = step.text.trim().split(/\s+/).length;
    const estimateSec = Math.max(1, wordCount / (1.9 * (playbackRate / 0.78)));
    const totalSec = stepDurations[listenStep] ?? estimateSec;
    const targetSec = Math.min(totalSec, Math.max(0, currentElapsedSec(totalSec) + deltaSec));
    const targetCharIndex = Math.min(step.text.length - 1, Math.max(0, Math.round((targetSec / totalSec) * step.text.length)));
    stopSpeaking();
    charOffsetRef.current = targetCharIndex;
    accumulatedRef.current = targetSec;
    playStartRef.current = Date.now();
    setListenCharIndex(targetCharIndex);
    setListenPlaying(true);
    setHasPausedUtterance(false);
    setVisitedSteps(prev => new Set(prev).add(listenStep));
    speakWithBoundary(
      step.text.slice(targetCharIndex),
      (charIndex) => setListenCharIndex(charOffsetRef.current + charIndex),
      () => {
        const measured = accumulatedRef.current + (playStartRef.current ? (Date.now() - playStartRef.current) / 1000 : 0);
        setStepDurations(prev => ({ ...prev, [listenStep]: measured }));
        accumulatedRef.current = 0;
        charOffsetRef.current = 0;
        playStartRef.current = null;
        setHasPausedUtterance(false);
        setListenPlaying(false);
      },
      playbackRate,
    );
  }
  // Sets an exact speed (chosen from the speed menu). If mid-playback,
  // restarts the utterance from the current position at the new rate (Web
  // Speech API can't change an in-flight utterance's rate).
  function changePlaybackRate(nextRate: number) {
    setPlaybackRate(nextRate);
    setStepDurations({}); // durations were measured at the old rate — stale now
    if (listenPlaying || hasPausedUtterance) {
      const step = listenSteps[listenStep];
      if (!step) return;
      const wordCount = step.text.trim().split(/\s+/).length;
      const estimateSec = Math.max(1, wordCount / (1.9 * (nextRate / 0.78)));
      const resumeSec = currentElapsedSec(estimateSec);
      const resumeCharIndex = Math.min(step.text.length - 1, Math.max(0, Math.round((resumeSec / estimateSec) * step.text.length)));
      stopSpeaking();
      charOffsetRef.current = resumeCharIndex;
      accumulatedRef.current = resumeSec;
      playStartRef.current = Date.now();
      setListenPlaying(true);
      setHasPausedUtterance(false);
      speakWithBoundary(
        step.text.slice(resumeCharIndex),
        (charIndex) => setListenCharIndex(charOffsetRef.current + charIndex),
        () => {
          const measured = accumulatedRef.current + (playStartRef.current ? (Date.now() - playStartRef.current) / 1000 : 0);
          setStepDurations(prev => ({ ...prev, [listenStep]: measured }));
          accumulatedRef.current = 0;
          charOffsetRef.current = 0;
          playStartRef.current = null;
          setHasPausedUtterance(false);
          setListenPlaying(false);
        },
        nextRate,
      );
    }
  }

  // Ticks every 200ms while a part is actually playing, so the elapsed-time
  // readout moves in real time instead of only updating on word boundaries.
  useEffect(() => {
    if (!listenPlaying) return;
    const id = setInterval(() => setClockTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, [listenPlaying]);

  // Auto-scrolls the passage so the sentence being read stays in view, the
  // same "keep the current line ~1/3 down" behaviour as the bedtime-story
  // Read Along screen.
  useEffect(() => { sentenceYRef.current = {}; }, [listenStep]);
  useEffect(() => {
    if (!listenPlaying) return;
    const y = sentenceYRef.current[curSentenceIdx];
    if (y == null) return;
    const target = Math.max(0, y - 130);
    leftScrollRef.current?.scrollTo?.({ y: target, animated: true });
  }, [curSentenceIdx, listenPlaying]);

  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    stopSpeaking();
    setSpeaking(false);
    setListenPlaying(false);
    setListenStep(0);
    setListenCharIndex(0);
    setPauseAnswer(null);
    setVocabIndex(0);
    setVisitedSteps(new Set([0]));
    setStepDurations({});
    setHasPausedUtterance(false);
    accumulatedRef.current = 0;
    playStartRef.current = null;
  }, [mode, topicIndex, chapterIndex]);
  useEffect(() => { setPauseAnswer(null); }, [listenStep]);

  if (loadingDbTopic) {
    return (
      <ScreenLayout>
        <View style={styles.screen}>
          <Header title="Lesson" showBack onMenuPress={() => navigation.openDrawer()} />
          <View style={styles.centerWrap}><ActivityIndicator color={colors.primary} /></View>
        </View>
      </ScreenLayout>
    );
  }

  if (!chapter || !topic) {
    return (
      <ScreenLayout>
        <View style={styles.screen}>
          <Header title="Lesson" showBack onMenuPress={() => navigation.openDrawer()} />
          <View style={styles.centerWrap}>
            <Feather name="alert-circle" size={32} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: 10 }}>This lesson isn't available yet.</Text>
          </View>
        </View>
      </ScreenLayout>
    );
  }


  const tabs: { key: Mode; label: string; icon: any }[] = [
    { key: 'read',     label: 'Learn',    icon: 'book-open' },
    { key: 'listen',   label: 'Listen',   icon: 'headphones' },
    { key: 'ask',      label: 'Ask Aivorah', icon: 'message-circle' },
    { key: 'practice', label: 'Practice', icon: 'check-square' },
  ];

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title={topic.name}
          subtitle={`Unit ${chapterIndex + 1} · ${chapter.title}`}
          showBack
          onMenuPress={() => navigation.openDrawer()}
        />

        <View style={styles.tabBarRow}>
          <View style={[styles.tabBar, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}>
            {tabs.map(t => {
              const active = mode === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.tab, active && { backgroundColor: colors.cardDark }]}
                  onPress={() => setMode(t.key)}
                  activeOpacity={0.75}
                >
                  <Feather name={t.icon} size={14} color={active ? colors.primary : colors.textMuted} />
                  <Text style={[styles.tabText, { color: active ? colors.primary : colors.textMuted }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {!!topic.pdfFile && (
            <TouchableOpacity
              style={[styles.viewInBookBtn, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}
              onPress={() => setFullBookView(true)}
              activeOpacity={0.8}
            >
              <Feather name="book" size={13} color={colors.textMain} />
              <Text style={[styles.viewInBookText, { color: colors.textMain }]}>View in Book</Text>
            </TouchableOpacity>
          )}
        </View>

        {mode === 'read' && (() => {
          const hasRealPdf = Platform.OS === 'web' && !!topic.pdfFile && !!topic.pdfPage;
          return (
          <View style={styles.dualPane}>
            <ScrollView style={hasRealPdf ? styles.leftPane : styles.leftPaneFull} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={styles.paneLabel}>
                <Feather name="book-open" size={12} color={colors.primary} />
                <Text style={[styles.paneLabelText, { color: colors.textMuted }]}>Learn with Aivorah — simplified</Text>
              </View>
              <View style={[styles.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
                <Text style={[styles.introText, { color: colors.textMain }]}>{topic.readText.intro}</Text>
                {topic.readText.body.map((p, i) => (
                  <Text key={i} style={[styles.bodyText, { color: colors.textMuted }]}>{p}</Text>
                ))}
                {(() => {
                  // Prefer the multi-image gallery; fall back to the single
                  // figureUrl for older content that predates `figures`.
                  const gallery = (topic.readText.figures && topic.readText.figures.length > 0)
                    ? topic.readText.figures
                    : (topic.readText.figureUrl ? [{ url: topic.readText.figureUrl, caption: topic.readText.figureCaption }] : []);
                  if (gallery.length === 0) return null; // no blank placeholder box when there's genuinely no image
                  return gallery.map((fig, i) => (
                    <View key={i} style={[styles.figure, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                      <Image source={{ uri: fig.url }} style={styles.figureImg} resizeMode="contain" />
                      {!!(fig.caption || topic.readText.figureCaption) && (
                        <Text style={[styles.figureCaption, { color: colors.textMuted }]}>
                          {fig.caption || topic.readText.figureCaption}
                        </Text>
                      )}
                    </View>
                  ));
                })()}
                <View style={[styles.activityBox, { borderColor: colors.primary + '55', backgroundColor: colors.primary + '14' }]}>
                  <Text style={[styles.activityLabel, { color: colors.primary }]}>Try this yourself</Text>
                  <Text style={[styles.activityText, { color: colors.textMain }]}>{topic.readText.activity}</Text>
                </View>
              </View>
            </ScrollView>

            {hasRealPdf && (
              <View style={[styles.rightPane, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                <View style={{ marginHorizontal: 0, marginBottom: 8, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Feather name="file-text" size={12} color={colors.textMuted} />
                    <Text style={[styles.paneLabelText, { color: colors.textMuted }]} numberOfLines={1}>
                      Original Textbook · {bookTitleFor(grade, subject)}, {grade} {subject}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.fullBookBtn, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}
                    onPress={() => setFullBookView(true)}
                  >
                    <Feather name="maximize-2" size={10} color={colors.primary} />
                    <Text style={[styles.fullBookBtnText, { color: colors.primary }]}>Read full book</Text>
                  </TouchableOpacity>
                </View>
                {React.createElement('iframe', {
                  src: `${SERVER_URL}/data/ncert_books/grade${grade.replace(/[^0-9]/g, '')}/${subjectToBookFolder(subject)}/${topic.pdfFile}#page=${topic.pdfPage}&view=FitH`,
                  style: { flex: 1, border: 'none', width: '100%', height: '100%', backgroundColor: colors.cardDark },
                  title: `${topic.name} — real textbook page`,
                })}
              </View>
            )}
          </View>
          );
        })()}

        {fullBookView && Platform.OS === 'web' && topic.pdfFile && (
          <View style={styles.fullBookOverlay}>
            <View style={[styles.fullBookHeader, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
              <TouchableOpacity style={styles.fullBookExit} onPress={() => setFullBookView(false)}>
                <Feather name="x" size={16} color={colors.textMain} />
                <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 13 }}>Back to Learning</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>
                {bookTitleFor(grade, subject)} — {grade} {subject} · full textbook, use the built-in page controls to browse
              </Text>
              <View style={{ width: 130 }} />
            </View>
            {React.createElement('iframe', {
              src: `${SERVER_URL}/data/ncert_books/grade${grade.replace(/[^0-9]/g, '')}/${subjectToBookFolder(subject)}/${topic.pdfFile}#page=${topic.pdfPage ?? 1}&view=FitH`,
              style: { flex: 1, border: 'none', width: '100%', height: '100%' },
              title: `Full book — ${topic.pdfFile}`,
            })}
          </View>
        )}

        {mode === 'ask' && (() => {
          const hasRealPdf = Platform.OS === 'web' && !!topic.pdfFile && !!topic.pdfPage;
          return (
          <View style={styles.dualPane}>
            <View style={[hasRealPdf ? styles.leftPane : styles.leftPaneFull, { padding: spacing.xl }]}>
              <View style={[styles.contextPill, { backgroundColor: colors.primary + '18', marginBottom: 10 }]}>
                <Feather name="zap" size={11} color={colors.primary} />
                <Text style={[styles.contextPillText, { color: colors.primary }]}>
                  Context loaded: {grade} · {subject} · Unit {chapterIndex + 1} · {topic.name}
                </Text>
              </View>
              <TopicAICoach
                topic={topic.name}
                subject={subject}
                grade={grade}
                curriculum={curriculum}
                chapter={chapter.title}
                autoOpen
                inline
              />
            </View>

            {hasRealPdf && (
              <View style={[styles.rightPane, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                <View style={{ marginHorizontal: 0, marginBottom: 8, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Feather name="file-text" size={12} color={colors.textMuted} />
                    <Text style={[styles.paneLabelText, { color: colors.textMuted }]} numberOfLines={1}>
                      Original Textbook · {bookTitleFor(grade, subject)}, {grade} {subject}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.fullBookBtn, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}
                    onPress={() => setFullBookView(true)}
                  >
                    <Feather name="maximize-2" size={10} color={colors.primary} />
                    <Text style={[styles.fullBookBtnText, { color: colors.primary }]}>Read full book</Text>
                  </TouchableOpacity>
                </View>
                {React.createElement('iframe', {
                  src: `${SERVER_URL}/data/ncert_books/grade${grade.replace(/[^0-9]/g, '')}/${subjectToBookFolder(subject)}/${topic.pdfFile}#page=${topic.pdfPage}&view=FitH`,
                  style: { flex: 1, border: 'none', width: '100%', height: '100%', backgroundColor: colors.cardDark },
                  title: `${topic.name} — real textbook page`,
                })}
              </View>
            )}
          </View>
          );
        })()}

        {mode === 'listen' && (() => {
          const step = currentListenStep;
          const sentences = listenSentences;
          // Real duration once this part has been played through at least once
          // (measured wall-clock time of the actual TTS playback); before that,
          // a rough word-count estimate so the transport bar isn't empty.
          const wordCount = step ? step.text.trim().split(/\s+/).length : 0;
          const estimateSec = Math.max(1, wordCount / (1.9 * (playbackRate / 0.78)));
          const measuredSec = stepDurations[listenStep];
          const totalSec = measuredSec ?? estimateSec;
          const elapsedSec = currentElapsedSec(totalSec);
          void clockTick; // referenced only to force a re-render tick while playing
          const word = vocab[vocabIndex];
          const isLastStep = listenStep === listenSteps.length - 1;
          return (
          <View style={styles.listenModeWrap}>
          <View style={styles.dualPane}>
            <ScrollView ref={leftScrollRef} style={styles.leftPane} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={styles.listenTopRow}>
                <View style={[styles.listeningToChip, { backgroundColor: colors.accentGreen + '1c' }]}>
                  <Text style={[styles.listeningToText, { color: colors.accentGreen }]}>
                    Listening to: {step?.label} of {listenSteps.length}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.aaBtn, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}
                  onPress={() => setFontLarge(v => !v)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.aaBtnText, { color: colors.textMain }]}>Aa</Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.listenHeading, { color: colors.textMain }]}>{step?.heading}</Text>

              <View style={styles.listenBodyRow}>
                {sentences.map((s, i) => {
                  const active = i === curSentenceIdx && listenPlaying;
                  return (
                    <View key={i} onLayout={(e) => { sentenceYRef.current[i] = e.nativeEvent.layout.y; }}>
                      <Text
                        style={[
                          styles.listenBodyText,
                          fontLarge && styles.listenBodyTextLarge,
                          {
                            color: active ? colors.textMain : colors.textMuted,
                            backgroundColor: active ? colors.accentGreen + '20' : 'transparent',
                          },
                        ]}
                      >
                        {s.sentence}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* ── Player ── */}
              <View style={[styles.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark, marginTop: 16 }]}>
                <View style={styles.playerTimeRow}>
                  <Text style={[styles.playerTimeText, { color: colors.textMuted }]}>{formatTime(elapsedSec)}</Text>
                  <Text style={[styles.playerTimeText, { color: colors.textMuted }]}>{formatTime(totalSec)}</Text>
                </View>
                <View style={[styles.listenProgressTrack, { backgroundColor: colors.textDim + '35' }]}>
                  <View style={[styles.listenProgressFill, { backgroundColor: colors.accentGreen, width: `${Math.min(100, (elapsedSec / totalSec) * 100)}%` }]} />
                  <View style={[styles.progressThumb, { left: `${Math.min(100, (elapsedSec / totalSec) * 100)}%`, backgroundColor: colors.accentGreen }]} />
                </View>

                <View style={[styles.playerRow, { marginTop: 14 }]}>
                  <TouchableOpacity style={styles.skipBtn} onPress={() => skipBy(-10)} activeOpacity={0.7}>
                    <Feather name="rotate-ccw" size={20} color={colors.textMuted} />
                    <Text style={[styles.skipBtnLabel, { color: colors.textMuted }]}>10</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.playBtn, { backgroundColor: colors.accentGreen }]} onPress={toggleListenPlay} activeOpacity={0.85}>
                    <Feather name={listenPlaying ? 'pause' : 'play'} size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.skipBtn} onPress={() => skipBy(10)} activeOpacity={0.7}>
                    <Feather name="rotate-cw" size={20} color={colors.textMuted} />
                    <Text style={[styles.skipBtnLabel, { color: colors.textMuted }]}>10</Text>
                  </TouchableOpacity>
                  <View style={styles.speedBtn}>
                    <TouchableOpacity onPress={() => setSpeedMenuOpen(v => !v)} activeOpacity={0.7}>
                      <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 13 }}>{playbackRate}x</Text>
                      <Text style={{ color: colors.textMuted, fontSize: 10 }}>Speed</Text>
                    </TouchableOpacity>
                    {speedMenuOpen && (
                      <View style={[styles.speedMenu, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
                        {PLAYBACK_RATES.map(r => (
                          <TouchableOpacity
                            key={r}
                            style={[styles.speedMenuRow, r === playbackRate && { backgroundColor: colors.accentGreen + '18' }]}
                            onPress={() => { changePlaybackRate(r); setSpeedMenuOpen(false); }}
                            activeOpacity={0.7}
                          >
                            <Text style={{ color: r === playbackRate ? colors.accentGreen : colors.textMain, fontWeight: r === playbackRate ? '700' : '500', fontSize: 12.5 }}>
                              {r}x
                            </Text>
                            {r === playbackRate && <Feather name="check" size={12} color={colors.accentGreen} />}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* ── Pause & Think ── */}
              {!!step?.pauseThink && (
                <View style={[styles.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark, marginTop: 14 }]}>
                  <View style={styles.pauseThinkHeader}>
                    <View style={styles.pauseThinkTitleRow}>
                      <Feather name="zap" size={14} color="#6C5CE7" />
                      <Text style={[styles.pauseThinkTitle, { color: '#6C5CE7' }]}>Pause & Think</Text>
                    </View>
                    <View style={[styles.aivorahDot, { backgroundColor: colors.accentGreen + '20' }]}>
                      <Feather name="cpu" size={13} color={colors.accentGreen} />
                    </View>
                  </View>
                  <Text style={[styles.pauseThinkQuestion, { color: colors.textMain }]}>{step.pauseThink.question}</Text>
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {step.pauseThink.options.map((opt, i) => {
                      const isCorrect = i === step.pauseThink!.correctIndex;
                      const chosen = pauseAnswer === i;
                      const reveal = chosen && isCorrect;
                      const wrongChosen = chosen && !isCorrect;
                      return (
                        <TouchableOpacity
                          key={i}
                          style={[
                            styles.pauseOption,
                            { borderColor: colors.borderColor },
                            reveal && { borderColor: colors.accentGreen, backgroundColor: colors.accentGreen + '16' },
                            wrongChosen && { borderColor: colors.accentRed, backgroundColor: colors.accentRed + '14' },
                          ]}
                          onPress={() => setPauseAnswer(i)}
                          activeOpacity={0.8}
                        >
                          <View style={[
                            styles.pauseCheckbox,
                            { borderColor: colors.borderColor },
                            reveal && { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
                          ]}>
                            {reveal && <Feather name="check" size={11} color="#fff" />}
                          </View>
                          <Text style={[styles.pauseOptionText, { color: colors.textMain }]}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {pauseAnswer === step.pauseThink.correctIndex && (
                    <TouchableOpacity
                      style={[styles.continueBtn, { backgroundColor: colors.accentGreen }]}
                      onPress={() => goToListenStep(listenStep + 1)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.continueBtnText}>Nice thinking! Continue</Text>
                      <Feather name="arrow-right" size={14} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </ScrollView>

            {/* ── Right pane: illustration + New Word ── */}
            <ScrollView style={styles.rightPane} contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false}>
              <View>
                <View style={[styles.illustrationBox, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                  {topic.readText.figureUrl ? (
                    <Image source={{ uri: topic.readText.figureUrl }} style={styles.figureImg} resizeMode="contain" />
                  ) : (
                    <>
                      <Feather name="image" size={32} color={colors.textMuted} />
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>Illustration coming soon</Text>
                    </>
                  )}
                </View>
                {!!topic.readText.figureCaption && (
                  <View style={[styles.captionBox, { borderColor: colors.accentYellow + '30', backgroundColor: colors.accentYellow + '10' }]}>
                    <Text style={[styles.captionText, { color: colors.textMain }]}>{topic.readText.figureCaption}</Text>
                  </View>
                )}
              </View>

              {!!word && (
                <View style={[styles.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
                  <View style={styles.newWordHeader}>
                    <Feather name="book" size={13} color={colors.accentYellow} />
                    <Text style={[styles.newWordLabel, { color: colors.accentYellow }]}>New Word</Text>
                  </View>
                  <View style={styles.newWordRow}>
                    <Text style={[styles.newWordText, { color: colors.textMain }]}>{word.word}</Text>
                    <TouchableOpacity
                      style={[styles.wordSpeakBtn, { backgroundColor: colors.accentGreen + '18' }]}
                      onPress={() => speakWithBoundary(word.word, () => {}, () => {})}
                      activeOpacity={0.7}
                    >
                      <Feather name="volume-2" size={13} color={colors.accentGreen} />
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.newWordDef, { color: colors.textMuted }]}>{word.definition}</Text>
                  <View style={styles.newWordFooter}>
                    <TouchableOpacity style={styles.useInSentenceLink} activeOpacity={0.7}>
                      <Feather name="edit-3" size={12} color={colors.accentGreen} />
                      <Text style={[styles.useInSentenceText, { color: colors.accentGreen }]}>Use in a sentence</Text>
                    </TouchableOpacity>
                    <View style={styles.vocabNavRow}>
                      <Text style={[styles.vocabPageText, { color: colors.textMuted }]}>{vocabIndex + 1}/{vocab.length}</Text>
                      <TouchableOpacity onPress={() => setVocabIndex(i => Math.max(0, i - 1))} disabled={vocabIndex === 0}>
                        <Feather name="chevron-left" size={16} color={vocabIndex === 0 ? colors.borderColor : colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.vocabNavActive, { backgroundColor: colors.accentGreen + '18' }]}
                        onPress={() => setVocabIndex(i => Math.min(vocab.length - 1, i + 1))}
                        disabled={vocabIndex === vocab.length - 1}
                      >
                        <Feather name="chevron-right" size={16} color={colors.accentGreen} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>

          {/* ── Bottom bar ── */}
          <View style={[styles.listenBottomBar, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
            <View style={styles.listenBottomProgress}>
              <Feather name="headphones" size={13} color={colors.textMuted} />
              <Text style={[styles.listenBottomLabel, { color: colors.textMuted }]}>Listening Progress</Text>
              <View style={[styles.listenBottomTrack, { backgroundColor: colors.borderColor }]}>
                <View style={[styles.listenBottomFill, { backgroundColor: colors.accentGreen, width: `${(visitedSteps.size / Math.max(1, listenSteps.length)) * 100}%` }]} />
              </View>
              <Text style={[styles.listenBottomCount, { color: colors.textMuted }]}>{listenStep + 1} of {listenSteps.length}</Text>
            </View>
            <View style={[styles.listenToast, { backgroundColor: colors.accentYellow + '16' }]}>
              <Feather name="star" size={12} color={colors.accentYellow} />
              <Text style={[styles.listenToastText, { color: colors.textMain }]}>Great! You are building strong listening skills.</Text>
            </View>
            <View style={styles.listenBottomActions}>
              <TouchableOpacity
                style={[styles.listenAgainBtn, { borderColor: colors.borderColor }]}
                onPress={() => goToListenStep(listenStep)}
                activeOpacity={0.8}
              >
                <Feather name="rotate-ccw" size={13} color={colors.textMain} />
                <Text style={[styles.listenAgainText, { color: colors.textMain }]}>Listen Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.nextPartBtn, { backgroundColor: colors.accentGreen }, isLastStep && { opacity: 0.5 }]}
                onPress={() => goToListenStep(listenStep + 1)}
                disabled={isLastStep}
                activeOpacity={0.85}
              >
                <Text style={styles.nextPartText}>{isLastStep ? 'Finished' : 'Next Part'}</Text>
                {!isLastStep && <Feather name="arrow-right" size={13} color="#fff" />}
              </TouchableOpacity>
            </View>
          </View>
          </View>
          );
        })()}

        {mode !== 'read' && mode !== 'ask' && mode !== 'listen' && (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {mode === 'practice' && (
            <View style={[styles.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <Text style={[styles.introText, { color: colors.textMain }]}>Practice — {topic.name}</Text>
              <Text style={[styles.bodyText, { color: colors.textMuted, marginBottom: 16 }]}>
                Questions are generated from this topic only, not the whole chapter.
              </Text>
              <TouchableOpacity
                style={[styles.practiceBtn, { backgroundColor: colors.accentGreen }]}
                onPress={() => navigation.navigate('IBPYPQuiz', {
                  topic: topic.name, grade, subject, curriculum,
                  // So the quiz's back button returns here instead of the old
                  // SubjectTopics list — it only knew that one hardcoded target before.
                  returnTo: 'LessonScreen',
                  returnParams: { subject, curriculum, grade, chapterIndex, topicIndex },
                })}
                activeOpacity={0.85}
              >
                <Feather name="play-circle" size={15} color="#fff" />
                <Text style={styles.practiceBtnText}>Start Practice</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
        )}
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: c.bgDark },
  content: { padding: spacing.xl, paddingBottom: 40 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Bounds the Listen tab (scrollable dual pane + fixed bottom bar) to the
  // remaining screen height so the bottom bar can never be pushed off-screen.
  listenModeWrap: { flex: 1, minHeight: 0 },

  tabBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: spacing.xl },
  tabBar: { flex: 1, flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.lg, borderWidth: 1 },
  tab:    { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
  tabText:{ fontSize: 12.5, fontWeight: '700' },
  viewInBookBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 14 },
  viewInBookText: { fontSize: 12.5, fontWeight: '700' },

  dualPane:  { flex: 1, flexDirection: 'row', minHeight: 0 },
  leftPane:  { flex: 0.6 },
  leftPaneFull: { flex: 1 },
  rightPane: { flex: 0.4, borderLeftWidth: 1, padding: spacing.lg, gap: 8 },
  paneLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, marginHorizontal: spacing.xl },
  paneLabelText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  bookFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, padding: 20 },

  listenStepBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: spacing.xl, marginBottom: 14 },
  listenStepChip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999 },
  listenStepChipText: { fontSize: 11.5, fontWeight: '700' },
  listenProgressTrack: { width: '100%', height: 6, borderRadius: 3, position: 'relative' },
  listenProgressFill: { position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 3 },
  progressThumb: { position: 'absolute', top: -4, width: 14, height: 14, borderRadius: 7, marginLeft: -7, borderWidth: 2, borderColor: '#fff' },
  listenBadge: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999 },
  listenBadgeText: { fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  listenEyebrow: { fontSize: 11.5, fontWeight: '700', marginTop: 10 },
  listenBodyText: { fontSize: 15, lineHeight: 26, marginTop: 4 },
  listenBodyTextLarge: { fontSize: 18, lineHeight: 30 },

  listenTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: spacing.xl, marginBottom: 10 },
  listeningToChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  listeningToText: { fontSize: 12, fontWeight: '700' },
  aaBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  aaBtnText: { fontSize: 12, fontWeight: '700' },
  listenHeading: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '700', marginHorizontal: spacing.xl, marginBottom: 12 },
  listenBodyRow: { marginHorizontal: spacing.xl },


  playerTimeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  playerTimeText: { fontSize: 11.5, fontWeight: '600' },

  pauseThinkHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pauseThinkTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pauseThinkTitle: { fontSize: 14, fontWeight: '700' },
  aivorahDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pauseThinkQuestion: { fontSize: 14.5, fontWeight: '600', lineHeight: 21 },
  pauseOption: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 12 },
  pauseCheckbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pauseOptionText: { fontSize: 13.5, flex: 1 },
  continueBtn: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.md },
  continueBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  illustrationBox: { borderWidth: 1, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', minHeight: 240, padding: 14 },
  captionBox: { borderWidth: 1, borderRadius: radius.md, padding: 10, marginTop: 8 },
  captionText: { fontSize: 12, textAlign: 'center' },

  newWordHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  newWordLabel: { fontSize: 11.5, fontWeight: '700' },
  newWordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  newWordText: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '700' },
  wordSpeakBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  newWordDef: { fontSize: 13, lineHeight: 20 },
  newWordImg: { width: '100%', height: 130, borderRadius: radius.md },
  newWordFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  useInSentenceLink: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  useInSentenceText: { fontSize: 12, fontWeight: '700' },
  vocabNavRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  vocabPageText: { fontSize: 12 },
  vocabNavActive: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  listenBottomBar: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, paddingVertical: 12, paddingHorizontal: spacing.xl, flexWrap: 'wrap' },
  listenBottomProgress: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 220 },
  listenBottomLabel: { fontSize: 12, fontWeight: '600' },
  listenBottomTrack: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden', maxWidth: 140 },
  listenBottomFill: { height: '100%', borderRadius: 3 },
  listenBottomCount: { fontSize: 12, fontWeight: '600' },
  listenToast: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999 },
  listenToastText: { fontSize: 11.5, fontWeight: '600' },
  listenBottomActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listenAgainBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 14 },
  listenAgainText: { fontSize: 12.5, fontWeight: '700' },
  nextPartBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 16 },
  nextPartText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },

  progressStepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },

  fullBookBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  fullBookBtnText: { fontSize: 9.5, fontWeight: '700' },
  fullBookOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: '#000' },
  fullBookHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1 },
  fullBookExit: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 130 },

  card: { borderWidth: 1, borderRadius: radius.lg, padding: 20, gap: 12 },
  introText: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  bodyText:  { fontSize: 14, lineHeight: 22 },

  figure: { borderWidth: 1, borderRadius: radius.md, padding: 20, alignItems: 'center', gap: 8 },
  figureImg: { width: '100%', height: 260, borderRadius: radius.sm ?? 8 },
  figureCaption: { fontSize: 11.5, textAlign: 'center' },

  activityBox: { borderWidth: 1, borderRadius: radius.md, padding: 14, gap: 4 },
  activityLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  activityText: { fontSize: 13.5, lineHeight: 20 },

  playerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, position: 'relative' },
  speedBtn: { position: 'absolute', right: 0, alignItems: 'center' },
  speedMenu: {
    position: 'absolute', bottom: 34, right: 0, minWidth: 80,
    borderWidth: 1, borderRadius: radius.md, paddingVertical: 4,
    elevation: 8, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6,
  },
  speedMenuRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12 },
  playBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  skipBtn: { alignItems: 'center', justifyContent: 'center' },
  skipBtnLabel: { fontSize: 9, fontWeight: '700', marginTop: -4 },

  contextPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999 },
  contextPillText: { fontSize: 10.5, fontWeight: '700' },

  practiceBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 18, borderRadius: radius.md },
  practiceBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
