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
import ImageZoomModal from '../../components/common/ImageZoomModal';
import LessonRenderer from './lesson/LessonRenderer';
import { buildLessonComponents } from './lesson/lessonComponents';
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
  utter.rate = rate; utter.pitch = 1.08;
  const voices = synth.getVoices();
  // Prefer the warmer, more natural neural voices when the browser/OS has them,
  // in quality order, before falling back to the older robotic default. These
  // sound far better for a young child than "Microsoft David/Zira".
  const PREFERRED = [
    /aria/i, /jenny/i, /michelle/i, /natural/i,      // Microsoft Edge neural voices
    /google us english/i, /google uk english female/i, // Google (Chrome)
    /samantha/i, /karen/i, /moira/i,                 // Apple
    /zira/i,                                          // last-resort Windows default
  ];
  let pick: SpeechSynthesisVoice | undefined;
  for (const re of PREFERRED) { pick = voices.find(v => re.test(v.name) && /^en/i.test(v.lang)); if (pick) break; }
  if (!pick) pick = voices.find(v => /en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
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
  // The compound "... Science" subjects must be matched BEFORE the bare
  // `includes('science')` test, or Computer Science and Political Science both
  // resolve to the /science/ folder and their textbooks 404 — which is most of
  // the senior-grade catalogue.
  if (s.includes('computer')) return 'computer_science';
  if (s.includes('political')) return 'political_science';
  if (s.includes('social')) return 'social_science';
  if (s.includes('home')) return 'home_science';
  if (s.includes('evs') || s.includes('environ')) return 'evs';
  if (s.includes('science')) return 'science';
  if (s.includes('math')) return 'mathematics';
  if (s.includes('english')) return 'english';
  if (s.includes('business')) return 'business_studies';
  if (s.includes('physical education')) return 'physical_education';
  if (s.includes('fine art')) return 'fine_arts';
  return s.replace(/\s+/g, '_');
}

// Where the textbook PDF lives. The lesson payload carries `bookPath`
// ("grade11/mathematics/kemh101.pdf") resolved from the syllabus map, which is
// authoritative; only fall back to rebuilding the path from grade+subject for
// older lessons published before the map existed.
function bookSrc(topic: any, grade: string, subject: string): string {
  const rel = topic?.bookPath
    || `grade${grade.replace(/[^0-9]/g, '')}/${subjectToBookFolder(subject)}/${topic?.pdfFile}`;
  return `${SERVER_URL}/data/ncert_books/${rel}`;
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

// Visual column subtraction — how a teacher actually solves it on the board for
// a child: numbers stacked in Tens/Ones columns, the borrow shown by crossing
// out the ten and writing the small carried "1". Parses "45 - 27" from a problem.
function parseSubtraction(problem: string): { top: number; bottom: number } | null {
  const m = String(problem || '').replace(/[^0-9\-]/g, ' ').match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  const top = parseInt(m[1], 10), bottom = parseInt(m[2], 10);
  if (isNaN(top) || isNaN(bottom) || top < bottom || top > 99 || bottom > 99) return null;
  return { top, bottom };
}
function ColumnSubtraction({ top, bottom, colors }: { top: number; bottom: number; colors: AppColors }) {
  const tT = Math.floor(top / 10), tO = top % 10;
  const bT = Math.floor(bottom / 10), bO = bottom % 10;
  const borrow = tO < bO;
  const onesTop = borrow ? tO + 10 : tO;
  const tensReduced = borrow ? tT - 1 : tT;
  const ans = top - bottom;
  const aT = Math.floor(ans / 10), aO = ans % 10;
  const green = colors.accentGreen, rose = '#C1666B', dim = colors.textDim, main = colors.textMain;
  const Cell = ({ children, style }: any) => (
    <View style={{ width: 44, alignItems: 'center', justifyContent: 'center', ...style }}>{children}</View>
  );
  const Digit = ({ v, color = main }: any) => (
    <Text style={{ fontSize: 30, fontWeight: '800', color, fontVariant: ['tabular-nums'] as any }}>{v}</Text>
  );
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.lg, padding: 16, gap: 2 }}>
      {/* column headers */}
      <View style={{ flexDirection: 'row', paddingLeft: 44 }}>
        <Cell><Text style={{ fontSize: 11, fontWeight: '700', color: dim }}>Tens</Text></Cell>
        <Cell><Text style={{ fontSize: 11, fontWeight: '700', color: dim }}>Ones</Text></Cell>
      </View>
      {/* borrow annotations row */}
      <View style={{ flexDirection: 'row', height: 22 }}>
        <Cell />
        <Cell>{borrow ? <Text style={{ fontSize: 15, fontWeight: '800', color: green }}>{tensReduced}</Text> : null}</Cell>
        <Cell>{borrow ? <Text style={{ fontSize: 13, fontWeight: '800', color: rose }}>¹</Text> : null}</Cell>
      </View>
      {/* top number (with the borrowed ten crossed out) */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Cell />
        <Cell>
          {borrow
            ? <Text style={{ fontSize: 30, fontWeight: '800', color: rose, textDecorationLine: 'line-through' }}>{tT}</Text>
            : <Digit v={tT} />}
        </Cell>
        <Cell><Digit v={tO} /></Cell>
      </View>
      {/* minus bottom number */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Cell><Text style={{ fontSize: 26, fontWeight: '800', color: main }}>−</Text></Cell>
        <Cell><Digit v={bT} /></Cell>
        <Cell><Digit v={bO} /></Cell>
      </View>
      {/* line */}
      <View style={{ height: 3, backgroundColor: main, marginLeft: 44, borderRadius: 2 }} />
      {/* answer */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Cell />
        <Cell><Digit v={aT} color={green} /></Cell>
        <Cell><Digit v={aO} color={green} /></Cell>
      </View>
      {borrow && (
        <Text style={{ fontSize: 11, color: dim, marginTop: 6, maxWidth: 200 }}>
          {tO} is smaller than {bO}, so we cross out the {tT} tens, make it {tensReduced}, and the {tO} becomes {onesTop}.
        </Text>
      )}
    </View>
  );
}

export default function LessonScreen({ navigation, route }: any) {
  const subject      = (route?.params?.subject      ?? 'English') as string;
  const curriculum   = (route?.params?.curriculum   ?? 'CBSE')    as string;
  const grade        = (route?.params?.grade        ?? 'Grade 6') as string;
  // Number(...), not just a type cast — URL-based navigation (deep links,
  // page refresh) delivers these as strings ("6"), and `"6" + 1` silently
  // produces "61" instead of 7 wherever the index is used arithmetically.
  const chapterIndex = Number(route?.params?.chapterIndex ?? 0);
  const topicIndex   = Number(route?.params?.topicIndex ?? 0);
  const topicId      = route?.params?.topicId as string | undefined;
  const chapterTitleParam = route?.params?.chapterTitle as string | undefined;

  // A real teacher-published topic (has a DB id) fetches its resolved
  // Read/Listen/Practice content instead of the static curated dataset —
  // this is what makes an uploaded book actually reach students.
  const [dbTopic, setDbTopic] = useState<typeof CBSE_G6_ENGLISH_SYLLABUS[0]['topics'][0] | null>(null);
  // Raw AI_EXPLANATION payload — fed to the type-driven LessonRenderer so the
  // Learn view is composed from canonical components (poem/story/math layouts),
  // not a hardcoded flat template.
  const [rawPayload, setRawPayload] = useState<any>(null);
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
        // The RAG-grounded G1 pipeline stores a rich payload on AI_EXPLANATION
        // (intro, keyLearnings, body, activity, vocab, listenParts, mathHelper).
        // Older imported topics only carry { text } — handle both. We never
        // synthesize a blank figure box: figureUrl stays undefined unless a real
        // image exists.
        const p = explanation?.status === 'READY' ? (explanation.payload || {}) : {};
        setRawPayload(p);
        const hasRich = Array.isArray(p.body) && p.body.length > 0;
        const realImg = images?.status === 'READY' ? images.payload?.items?.[0]?.description : undefined;
        setDbTopic({
          name: route?.params?.topicName || 'This topic',
          kind: 'Chapter',
          page: images?.payload?.pageRef ? String(images.payload.pageRef) : '',
          // Real source PDF → the "View in Book" right pane shows the actual
          // NCERT book (with its illustrations), same as the curated G6 topics.
          pdfFile: p.pdfFile || undefined,
          pdfPage: p.pdfFile ? (p.pdfPage || 1) : undefined,
          // Exact storage path from the syllabus map, so the reader opens the
          // right book without the client re-deriving a folder name.
          bookPath: p.bookPath || undefined,
          readText: {
            intro: p.intro || (typeof p.text === 'string' ? p.text : '') || '',
            keyLearnings: Array.isArray(p.keyLearnings) ? p.keyLearnings : [],
            body: hasRich ? p.body : [],
            figureUrl: realImg || undefined,
            figureCaption: realImg || '',
            activity: p.activity || '',
            vocab: Array.isArray(p.vocab) ? p.vocab : [],
            listenParts: Array.isArray(p.listenParts) ? p.listenParts : undefined,
            example: p.mathHelper?.example || undefined,
            mathHelper: p.mathHelper || undefined,
            // Richer schema fields the Curriculum Intelligence pipeline emits —
            // now carried through so the Learn view can render the full lesson
            // (poem lines, takeaways, reflection) instead of silently dropping them.
            originalLesson: Array.isArray(p.originalLesson) ? p.originalLesson : undefined,
            keyTakeaways: Array.isArray(p.keyTakeaways) ? p.keyTakeaways : [],
            thinkAndReflect: Array.isArray(p.thinkAndReflect) ? p.thinkAndReflect : [],
            workedExamples: Array.isArray(p.workedExamples) ? p.workedExamples : undefined,
            illustrationPrompts: Array.isArray(p.illustrationPrompts) ? p.illustrationPrompts : [],
            instructionalType: typeof p.instructionalType === 'string' ? p.instructionalType : undefined,
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
  // Allow the visual-QA harness (and deep links) to open a specific tab directly
  // via ?mode=listen|practice|ask — far more reliable than simulating tab clicks.
  const initialMode = ((): Mode => {
    const m = route?.params?.mode;
    if (m === 'listen' || m === 'practice' || m === 'ask' || m === 'read') return m;
    return 'read';
  })();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [speaking, setSpeaking] = useState(false);
  const [fullBookView, setFullBookView] = useState(false);
  const [listenStep, setListenStep] = useState(0);
  const [listenPlaying, setListenPlaying] = useState(false);
  const [listenCharIndex, setListenCharIndex] = useState(0);
  const [sentenceIdx, setSentenceIdx] = useState(0);
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
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [zoomImage, setZoomImage] = useState<{ uri: string; caption?: string } | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);
  const isMath = /math/i.test(subject);
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
    // Maths/Concept lessons: the AI Tutor walks through each WORKED EXAMPLE
    // step-by-step (that's what a tutor does), not just the intro theory.
    const worked = (topic.readText as any).workedExamples as any[] | undefined;
    if (worked && worked.length > 0) {
      return [
        { label: 'Introduction', heading: 'Introduction', text: topic.readText.intro },
        ...worked.map((ex, i) => ({
          label: `Example ${i + 1}`,
          heading: `Example ${i + 1}: ${ex.problem}`,
          text: `${ex.problem}. ${(ex.steps || []).join(' ')} So the answer is ${ex.answer}.`,
        })),
        { label: 'Your turn', heading: 'Your turn', text: topic.readText.activity || 'Now try a subtraction with borrowing on your own.' },
      ];
    }
    return [
      { label: 'Introduction', heading: 'Introduction', text: topic.readText.intro },
      ...topic.readText.body.map((p, i) => ({ label: `Part ${i + 1}`, heading: `Part ${i + 1}`, text: p })),
      { label: 'Try this yourself', heading: 'Try this yourself', text: topic.readText.activity },
    ];
  }, [topic]);

  const vocab = topic?.readText.vocab ?? [];

  // Poem lessons are recited, not read: slower pace + a short breath between
  // lines so it lands as a rhythmic recitation rather than flat narration.
  const isPoem = ((rawPayload?.instructionalType as string) || '').toLowerCase().includes('poem');
  const isPoemRef = useRef(isPoem);
  isPoemRef.current = isPoem;
  // Default speed stays 1× (normal); the poem cadence comes from the short
  // between-line pause below, not from slowing the voice down.

  // Practice tab: go straight to the quiz — no intermediate "Start Practice"
  // card. We flip mode back to 'read' right after launching so returning from
  // the quiz doesn't immediately re-trigger navigation (no loop).
  useEffect(() => {
    if (mode !== 'practice' || !topic) return;
    setMode('read');
    navigation.navigate('IBPYPQuiz', {
      topic: topic.name, grade, subject, curriculum, topicId,
      passageText: (topic as any).readText
        ? `${(topic as any).readText.intro} ${(topic as any).readText.body?.join(' ') ?? ''}`.trim()
        : undefined,
      returnTo: 'LessonScreen',
      returnParams: { subject, curriculum, grade, chapterIndex, topicIndex },
    });
  }, [mode, topic]);

  const currentListenStep = listenSteps[listenStep];
  const listenSentences = useMemo(
    () => (currentListenStep ? sentencesWithOffsets(currentListenStep.text) : []),
    [currentListenStep],
  );
  // ── Sentence-by-sentence narration engine ────────────────────────────────
  // Each SENTENCE is spoken as its own short utterance, then the engine
  // advances to the next. This is the reliable, premium approach (Khan Kids /
  // Read-Along style): pause/resume never desync, the highlighted line is
  // exact (we drive it), seeking maps to whole lines, and pauses fall only at
  // punctuation — no robotic word-by-word gaps. `curSentenceIdx` is the single
  // source of truth for which line is active.
  const curSentenceIdx = sentenceIdx;
  const playSeqRef = useRef(0);           // token invalidates stale onEnd callbacks
  const listenSentencesRef = useRef(listenSentences);
  listenSentencesRef.current = listenSentences;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  // Speak sentence `idx` of the current step, then chain to the next.
  function speakFromSentence(idx: number) {
    const sents = listenSentencesRef.current;
    if (!sents.length) return;
    const clamped = Math.max(0, Math.min(sents.length - 1, idx));
    const seq = ++playSeqRef.current;      // start a fresh sequence
    setSentenceIdx(clamped);
    setListenPlaying(true);
    const speakIdx = (i: number) => {
      if (seq !== playSeqRef.current) return;        // superseded — stop
      if (i >= sents.length) {                        // reached the end
        setListenPlaying(false);
        setVisitedSteps(prev => new Set(prev).add(listenStep));
        return;
      }
      setSentenceIdx(i);
      speakWithBoundary(
        sents[i].sentence.trim(),
        () => {},                                     // highlight is line-level, not word-level
        () => {
          if (seq !== playSeqRef.current) return;
          // Poem cadence: a short breath between lines; prose flows straight on.
          if (isPoemRef.current) setTimeout(() => { if (seq === playSeqRef.current) speakIdx(i + 1); }, 450);
          else speakIdx(i + 1);
        },
        playbackRateRef.current,
      );
    };
    speakIdx(clamped);
  }
  function stopNarration() {
    playSeqRef.current++;                             // invalidate any pending onEnd
    stopSpeaking();
    setListenPlaying(false);
  }
  function playListenStep(i: number) {
    if (!listenSteps[i]) return;
    stopNarration();
    setListenStep(i);
    setSentenceIdx(0);
    setVisitedSteps(prev => new Set(prev).add(i));
    // let the new step's sentences settle into the ref before speaking
    setTimeout(() => speakFromSentence(0), 0);
  }
  function toggleListenPlay() {
    if (listenPlaying) {
      stopNarration();                               // clean pause — no desync
    } else {
      speakFromSentence(sentenceIdx);                // resume from current line
    }
  }
  function repeatStep() {
    stopNarration();
    setSentenceIdx(0);
    setTimeout(() => speakFromSentence(0), 0);
  }
  function goToListenStep(i: number) {
    if (i < 0 || i >= listenSteps.length) return;
    stopNarration();
    setListenStep(i);
    setSentenceIdx(0);
    setVisitedSteps(prev => new Set(prev).add(i));
    setWhyOpen(false);
    setExplainOpen(false);
    setHintOpen(false);
    setExampleOpen(false);
  }
  // Previous / Next line (wired to the ⟲10 / ⟳10 transport buttons). Jumping
  // by whole sentences is accurate and meaningful for a Grade-1 reader, unlike
  // the old proportional char-offset guess the Web Speech API forced.
  function skipBy(deltaSec: number) {
    const sents = listenSentencesRef.current;
    if (!sents.length) return;
    const target = Math.max(0, Math.min(sents.length - 1, sentenceIdx + (deltaSec < 0 ? -1 : 1)));
    if (listenPlaying) speakFromSentence(target);
    else setSentenceIdx(target);
  }
  function changePlaybackRate(nextRate: number) {
    setPlaybackRate(nextRate);
    playbackRateRef.current = nextRate;
    if (listenPlaying) speakFromSentence(sentenceIdx);   // restart current line at new rate
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

  useEffect(() => () => { playSeqRef.current++; stopSpeaking(); }, []);
  useEffect(() => {
    playSeqRef.current++;
    stopSpeaking();
    setSpeaking(false);
    setListenPlaying(false);
    setListenStep(0);
    setSentenceIdx(0);
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
    { key: 'listen',   label: isMath ? 'AI Tutor' : 'Listen', icon: isMath ? 'cpu' : 'headphones' },
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
              <View style={{ gap: spacing.md }}>
                {/* A sample module must never be mistaken for real NCERT
                    content. Chapters whose textbook text is too sparse to ground
                    a lesson (or whose PDF was never shipped) get a placeholder
                    so the layout is complete — and it says so, on screen, above
                    the content rather than buried in it. */}
                {rawPayload?.isSample && (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10,
                    borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark,
                  }}>
                    <Feather name="info" size={15} color={colors.textMuted} />
                    <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.textMuted }}>
                      {rawPayload.sampleLabel || 'Interactive Practice Module — Sample Lesson'}
                    </Text>
                  </View>
                )}
                {/* Type-driven lesson body: the LessonRenderer composes canonical
                    components (poem / story / math / science layouts) from the
                    lesson's instructional type — the frontend half of the
                    Curriculum Intelligence pipeline contract. */}
                {rawPayload && (
                  <LessonRenderer
                    components={buildLessonComponents(rawPayload).components}
                    grade={rawPayload?.grade ?? (parseInt((grade || '').replace(/[^0-9]/g, ''), 10) || undefined)}
                    colors={colors}
                  />
                )}
                {!!(topic.readText as any).mathHelper && (() => {
                  const mh = (topic.readText as any).mathHelper;
                  return (
                    <View style={[styles.card, { borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '0d', marginTop: 12 }]}>
                      <Text style={[styles.activityLabel, { color: colors.accentGreen, marginBottom: 6 }]}>Math Helper — step by step</Text>
                      {!!mh.formula && <Text style={[styles.bodyText, { color: colors.textMain, fontWeight: '600' }]}>Rule: {mh.formula}</Text>}
                      {(mh.keyIdeas || []).map((k: string, i: number) => (
                        <Text key={i} style={[styles.bodyText, { color: colors.textMuted }]}>{'•'} {k}</Text>
                      ))}
                      {!!mh.example && (
                        <View style={{ marginTop: 8 }}>
                          <Text style={[styles.bodyText, { color: colors.textMain, fontWeight: '600' }]}>{mh.example.problem}</Text>
                          {(mh.example.steps || []).map((s: string, i: number) => (
                            <Text key={i} style={[styles.bodyText, { color: colors.textMuted, marginTop: 2 }]}>{s}</Text>
                          ))}
                          {!!mh.example.answer && <Text style={[styles.bodyText, { color: colors.accentGreen, fontWeight: '600', marginTop: 4 }]}>{mh.example.answer}</Text>}
                        </View>
                      )}
                    </View>
                  );
                })()}
                {(() => {
                  // Prefer the multi-image gallery; fall back to the single
                  // figureUrl for older content that predates `figures`.
                  const gallery = (topic.readText.figures && topic.readText.figures.length > 0)
                    ? topic.readText.figures
                    : (topic.readText.figureUrl ? [{ url: topic.readText.figureUrl, caption: topic.readText.figureCaption }] : []);
                  if (gallery.length === 0) return null; // no blank placeholder box when there's genuinely no image
                  return gallery.map((fig, i) => (
                    <View key={i} style={[styles.figure, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => setZoomImage({ uri: fig.url, caption: fig.caption || topic.readText.figureCaption })}
                      >
                        <Image source={{ uri: fig.url }} style={styles.figureImg} resizeMode="contain" />
                        <View style={styles.zoomHint}>
                          <Feather name="maximize-2" size={11} color="#fff" />
                        </View>
                      </TouchableOpacity>
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
                  src: `${bookSrc(topic, grade, subject)}#page=${topic.pdfPage}&view=FitH`,
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
              src: `${bookSrc(topic, grade, subject)}#page=${topic.pdfPage ?? 1}&view=FitH`,
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
                  src: `${bookSrc(topic, grade, subject)}#page=${topic.pdfPage}&view=FitH`,
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
          // Progress is line-based now (reliable), not a wall-clock guess: the
          // current line out of the step's lines. A completed line counts as
          // done; the active line counts as half so the bar always moves.
          const lineCount = Math.max(1, sentences.length);
          const lineProgress = Math.min(100, ((sentenceIdx + (listenPlaying ? 0.5 : 1)) / lineCount) * 100);
          void clockTick;
          const word = vocab[vocabIndex];
          const isLastStep = listenStep === listenSteps.length - 1;
          const isFirstStep = listenStep === 0;
          return (
          <View style={styles.listenModeWrap}>
          <View style={styles.dualPane}>
            <ScrollView ref={leftScrollRef} style={styles.leftPane} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={styles.listenTopRow}>
                <View style={[styles.listeningToChip, { backgroundColor: colors.accentGreen + '1c' }]}>
                  <Text style={[styles.listeningToText, { color: colors.accentGreen }]}>
                    {isMath ? `Step ${listenStep + 1} of ${listenSteps.length}: ${step?.label}` : `Listening to: ${step?.label} of ${listenSteps.length}`}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.aaBtn, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}
                    onPress={() => setFontLarge(v => !v)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.aaBtnText, { color: colors.textMain }]}>Aa</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {isMath && (
                <View style={[styles.aiTutorBadge, { backgroundColor: colors.primary + '14', borderColor: colors.primary + '30' }]}>
                  <Feather name="cpu" size={12} color={colors.primary} />
                  <Text style={[styles.aiTutorBadgeText, { color: colors.primary }]}>AI Tutor — let's understand this step by step</Text>
                </View>
              )}

              <Text style={[styles.listenHeading, { color: colors.textMain }]}>{step?.heading}</Text>

              {/* Visual column subtraction — solve it on the board like a teacher
                  would for a young child, not as a wall of text. */}
              {isMath && (() => {
                const worked = (topic.readText as any).workedExamples as any[] | undefined;
                const ex = worked?.[Math.max(0, Math.min((worked?.length || 1) - 1, listenStep - 1))];
                const parsed = ex ? parseSubtraction(ex.problem) : null;
                if (!parsed || listenStep === 0) return null;
                return (
                  <View style={{ marginVertical: 14 }}>
                    <ColumnSubtraction top={parsed.top} bottom={parsed.bottom} colors={colors} />
                  </View>
                );
              })()}

              <View style={styles.listenBodyRow}>
                {sentences.map((s, i) => {
                  const active = i === curSentenceIdx;
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

              {/* ── Maths AI Tutor: compact "Listen" so the tutor can read the
                  current step aloud (age 7 benefits from hearing it). ── */}
              {isMath && (
                <TouchableOpacity
                  onPress={toggleListenPlay}
                  activeOpacity={0.85}
                  style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, marginTop: 14,
                    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 22,
                    backgroundColor: colors.primary + '18', borderWidth: 1, borderColor: colors.primary + '40' }}
                >
                  <Feather name={listenPlaying ? 'pause' : 'volume-2'} size={15} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                    {listenPlaying ? 'Pause' : 'Listen to this step'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Step navigation — placed right under the content so the student
                  moves through steps without scrolling to a far footer. */}
              {isMath && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    style={[styles.mathFooterBtn, { borderColor: colors.borderColor }, listenStep === 0 && { opacity: 0.4 }]}
                    onPress={() => goToListenStep(listenStep - 1)}
                    disabled={listenStep === 0}
                    activeOpacity={0.85}
                  >
                    <Feather name="arrow-left" size={14} color={colors.textMain} />
                    <Text style={[styles.mathFooterBtnText, { color: colors.textMain }]}>Previous</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.mathFooterBtnPrimary, { backgroundColor: colors.accentGreen }, isLastStep && { opacity: 0.5 }]}
                    onPress={() => goToListenStep(listenStep + 1)}
                    disabled={isLastStep}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.nextPartText}>{isLastStep ? 'Finished' : 'Next'}</Text>
                    {!isLastStep && <Feather name="arrow-right" size={13} color="#fff" />}
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Player (Science/English/etc — full audiobook transport) ── */}
              {!isMath && (
              <View style={[styles.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark, marginTop: 16 }]}>
                <View style={styles.playerTimeRow}>
                  <Text style={[styles.playerTimeText, { color: colors.textMuted }]}>Line {Math.min(sentenceIdx + 1, lineCount)} of {lineCount}</Text>
                  <Text style={[styles.playerTimeText, { color: colors.textMuted }]}>{listenPlaying ? 'Reading…' : 'Paused'}</Text>
                </View>
                <View style={[styles.listenProgressTrack, { backgroundColor: colors.textDim + '35' }]}>
                  <View style={[styles.listenProgressFill, { backgroundColor: colors.accentGreen, width: `${lineProgress}%` }]} />
                  <View style={[styles.progressThumb, { left: `${lineProgress}%`, backgroundColor: colors.accentGreen }]} />
                </View>

                <View style={[styles.playerRow, { marginTop: 14 }]}>
                  <TouchableOpacity style={styles.skipBtn} onPress={() => skipBy(-10)} activeOpacity={0.7} disabled={sentenceIdx === 0}>
                    <Feather name="skip-back" size={20} color={sentenceIdx === 0 ? colors.borderColor : colors.textMuted} />
                    <Text style={[styles.skipBtnLabel, { color: colors.textMuted }]}>Line</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.playBtn, { backgroundColor: colors.accentGreen }]} onPress={toggleListenPlay} activeOpacity={0.85}>
                    <Feather name={listenPlaying ? 'pause' : 'play'} size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.skipBtn} onPress={() => skipBy(10)} activeOpacity={0.7} disabled={sentenceIdx >= lineCount - 1}>
                    <Feather name="skip-forward" size={20} color={sentenceIdx >= lineCount - 1 ? colors.borderColor : colors.textMuted} />
                    <Text style={[styles.skipBtnLabel, { color: colors.textMuted }]}>Line</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.skipBtn} onPress={repeatStep} activeOpacity={0.7}>
                    <Feather name="rotate-ccw" size={18} color={colors.textMuted} />
                    <Text style={[styles.skipBtnLabel, { color: colors.textMuted }]}>Repeat</Text>
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
              )}

              {/* Step navigation for Listen — SAME inline pattern as the Math AI
                  Tutor (Grade 2 Subtraction with Borrowing): compact Previous +
                  primary Next sitting directly under the content, so a young
                  reader never hunts for a far-away footer. */}
              {!isMath && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity
                    style={[styles.mathFooterBtn, { borderColor: colors.borderColor }, isFirstStep && { opacity: 0.4 }]}
                    onPress={() => goToListenStep(listenStep - 1)}
                    disabled={isFirstStep}
                    activeOpacity={0.85}
                  >
                    <Feather name="arrow-left" size={14} color={colors.textMain} />
                    <Text style={[styles.mathFooterBtnText, { color: colors.textMain }]}>Previous</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.mathFooterBtnPrimary, { backgroundColor: colors.accentGreen }, isLastStep && { opacity: 0.5 }]}
                    onPress={() => goToListenStep(listenStep + 1)}
                    disabled={isLastStep}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.nextPartText}>{isLastStep ? 'Finished' : 'Next'}</Text>
                    {!isLastStep && <Feather name="arrow-right" size={13} color="#fff" />}
                  </TouchableOpacity>
                </View>
              )}

              {/* ── "Explain This Step" — written, not spoken. No audio anywhere
                  in Math: the AI Tutor teaches by showing text/steps, never by
                  reading them aloud. ── */}
              {isMath && explainOpen && (
                <View style={[styles.whyBox, { borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '0d' }]}>
                  <Text style={[styles.whyLabel, { color: colors.accentGreen }]}>Explanation</Text>
                  <Text style={[styles.whyText, { color: colors.textMain }]}>
                    {step?.text || step?.heading}
                  </Text>
                </View>
              )}

              {/* ── "Why?" — expands this step's key idea inline, no tab switch. ── */}
              {isMath && whyOpen && (
                <View style={[styles.whyBox, { borderColor: colors.primary + '40', backgroundColor: colors.primary + '0d' }]}>
                  <Text style={[styles.whyLabel, { color: colors.primary }]}>Why?</Text>
                  <Text style={[styles.whyText, { color: colors.textMain }]}>
                    {step?.keyIdea || 'This step follows directly from the one before it — look at the reasoning in the step above.'}
                  </Text>
                </View>
              )}

              {/* ── "Give Me a Hint" — a real hint drawn from the first step of
                  the current example / the first key learning. ── */}
              {isMath && hintOpen && (() => {
                const worked = (topic.readText as any).workedExamples as any[] | undefined;
                const curEx = worked?.[Math.max(0, Math.min((worked?.length || 1) - 1, listenStep - 1))];
                const hint = (topic.readText as any).hint
                  || curEx?.steps?.[1]   // the "borrow" step is the real hint
                  || (topic.readText as any).keyLearnings?.[1]
                  || 'When the top ones digit is smaller than the bottom, borrow 1 ten first.';
                return (
                  <View style={[styles.whyBox, { borderColor: colors.accentYellow + '50', backgroundColor: colors.accentYellow + '0d' }]}>
                    <Text style={[styles.whyLabel, { color: colors.accentYellow }]}>Hint</Text>
                    <Text style={[styles.whyText, { color: colors.textMain }]}>{hint}</Text>
                  </View>
                );
              })()}

              {/* ── "Show Another Example" — shows a DIFFERENT worked example than
                  the current step, structured as problem + steps. ── */}
              {isMath && exampleOpen && (() => {
                const worked = ((topic.readText as any).workedExamples as any[]) || [];
                const curIdx = Math.max(0, listenStep - 1);
                const other = worked.filter((_, i) => i !== curIdx);
                const ex = other[0] || worked[0];
                return (
                  <View style={[styles.whyBox, { borderColor: colors.accentGreen + '50', backgroundColor: colors.accentGreen + '0d' }]}>
                    <Text style={[styles.whyLabel, { color: colors.accentGreen }]}>Another Example</Text>
                    {ex ? (() => {
                      const parsed = parseSubtraction(ex.problem);
                      return (
                        <>
                          <Text style={[styles.whyText, { color: colors.textMain, fontWeight: '700', marginBottom: 10 }]}>{ex.problem}</Text>
                          {parsed
                            ? <ColumnSubtraction top={parsed.top} bottom={parsed.bottom} colors={colors} />
                            : <>
                                {(ex.steps || []).map((s: string, i: number) => (
                                  <Text key={i} style={[styles.whyText, { color: colors.textMain, marginTop: 4 }]}>{i + 1}. {s}</Text>
                                ))}
                                {ex.answer != null && <Text style={[styles.whyText, { color: colors.accentGreen, fontWeight: '800', marginTop: 6 }]}>= {ex.answer}</Text>}
                              </>}
                        </>
                      );
                    })() : (
                      <Text style={[styles.whyText, { color: colors.textMain }]}>No further example is ready for this topic yet.</Text>
                    )}
                  </View>
                );
              })()}

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
              {(() => {
                // Per-stanza illustration for the current Listen step — map the
                // active stanza to its book image so the panel shows the real
                // picture, not "coming soon".
                const prompts = (topic.readText as any).illustrationPrompts as any[] | undefined;
                const withImg = (prompts || []).filter(p => p?.image || p?.image_ref || p?.url);
                if (withImg.length === 0) return null;
                const pick = withImg[Math.min(listenStep, withImg.length - 1)];
                const raw = pick.image || pick.image_ref || pick.url;
                const uri = /^https?:/.test(raw) ? raw : `${SERVER_URL}${raw}`;
                return (
                  <View>
                    <TouchableOpacity
                      style={[styles.illustrationBox, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}
                      activeOpacity={0.85}
                      onPress={() => setZoomImage({ uri, caption: pick.altText })}
                    >
                      <Image source={{ uri }} style={styles.figureImg} resizeMode="contain" />
                      <View style={styles.zoomHint}><Feather name="maximize-2" size={11} color="#fff" /></View>
                    </TouchableOpacity>
                    {!!pick.altText && (
                      <View style={[styles.captionBox, { borderColor: colors.accentYellow + '30', backgroundColor: colors.accentYellow + '10' }]}>
                        <Text style={[styles.captionText, { color: colors.textMain }]}>{pick.altText}</Text>
                      </View>
                    )}
                  </View>
                );
              })() || (topic.readText.figureUrl ? (
                <View>
                  <TouchableOpacity
                    style={[styles.illustrationBox, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}
                    activeOpacity={0.85}
                    onPress={() => setZoomImage({ uri: topic.readText.figureUrl!, caption: topic.readText.figureCaption })}
                  >
                    <Image source={{ uri: topic.readText.figureUrl }} style={styles.figureImg} resizeMode="contain" />
                    <View style={styles.zoomHint}>
                      <Feather name="maximize-2" size={11} color="#fff" />
                    </View>
                  </TouchableOpacity>
                  {!!topic.readText.figureCaption && (
                    <View style={[styles.captionBox, { borderColor: colors.accentYellow + '30', backgroundColor: colors.accentYellow + '10' }]}>
                      <Text style={[styles.captionText, { color: colors.textMain }]}>{topic.readText.figureCaption}</Text>
                    </View>
                  )}
                </View>
              ) : (() => {
                // Maths AI Tutor: no illustration — show the worked example being
                // taught, solved step-by-step on a "whiteboard" card that follows
                // the current tutor step. This is the AI explaining, not an image.
                const worked = (topic.readText as any).workedExamples as any[] | undefined;
                if (worked && worked.length > 0) {
                  const ex = worked[Math.max(0, Math.min(worked.length - 1, listenStep - 1))];
                  return (
                    <View style={[styles.card, { borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '0a' }]}>
                      <View style={styles.newWordHeader}>
                        <Feather name="edit-3" size={13} color={colors.accentGreen} />
                        <Text style={[styles.newWordLabel, { color: colors.accentGreen }]}>Let's solve it together</Text>
                      </View>
                      <Text style={[styles.whyText, { color: colors.textMain, fontWeight: '800', fontSize: 18, marginTop: 8 }]}>
                        {ex.problem}
                      </Text>
                      {(ex.steps || []).map((s: string, i: number) => (
                        <View key={i} style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                          <Text style={{ color: colors.accentGreen, fontWeight: '800', fontSize: 13 }}>{i + 1}</Text>
                          <Text style={[styles.whyText, { color: colors.textMuted, flex: 1 }]}>{s}</Text>
                        </View>
                      ))}
                      {ex.answer != null && (
                        <Text style={{ color: colors.accentGreen, fontWeight: '800', fontSize: 16, marginTop: 10 }}>= {ex.answer}</Text>
                      )}
                    </View>
                  );
                }
                // No picture exists for this lesson (senior-grade NCERT chapters
                // are often text-only). Render NOTHING rather than an empty grey
                // frame promising art that isn't coming — the placeholder read as
                // a broken page. The right pane still shows New Word etc.
                return null;
              })())}

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

          {/* ── Bottom bar: audiobook progress for Science/English, a
              step-notebook footer (Previous/Hint/Try Yourself/Next) for Math ── */}
          {!isMath && (
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
            {/* Step navigation now lives inline under the content (Math pattern).
                The footer keeps only the replay control so there is exactly ONE
                Previous/Next control on screen. */}
            <View style={styles.listenBottomActions}>
              <TouchableOpacity
                style={[styles.listenAgainBtn, { borderColor: colors.borderColor }]}
                onPress={repeatStep}
                activeOpacity={0.8}
              >
                <Feather name="rotate-ccw" size={13} color={colors.textMain} />
                <Text style={[styles.listenAgainText, { color: colors.textMain }]}>Listen Again</Text>
              </TouchableOpacity>
            </View>
          </View>
          )}

          {isMath && (
          <View style={[styles.mathFooter, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
            <View style={styles.mathActionGrid}>
              <TouchableOpacity
                style={[styles.mathActionChip, { borderColor: colors.borderColor }]}
                onPress={() => { setWhyOpen(false); setHintOpen(false); setExampleOpen(false); setExplainOpen(v => !v); }}
                activeOpacity={0.8}
              >
                <Feather name="zap" size={13} color={colors.primary} />
                <Text style={[styles.mathActionChipText, { color: colors.textMain }]}>Explain This Step</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mathActionChip, { borderColor: colors.borderColor }]}
                onPress={() => { setExplainOpen(false); setHintOpen(false); setExampleOpen(false); setWhyOpen(v => !v); }}
                activeOpacity={0.8}
              >
                <Feather name="help-circle" size={13} color={colors.accentYellow} />
                <Text style={[styles.mathActionChipText, { color: colors.textMain }]}>Why?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mathActionChip, { borderColor: colors.borderColor }]}
                onPress={() => { setExplainOpen(false); setWhyOpen(false); setExampleOpen(false); setHintOpen(v => !v); }}
                activeOpacity={0.8}
              >
                <Feather name="compass" size={13} color={colors.accentYellow} />
                <Text style={[styles.mathActionChipText, { color: colors.textMain }]}>Give Me a Hint</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mathActionChip, { borderColor: colors.borderColor }]}
                onPress={() => { setExplainOpen(false); setWhyOpen(false); setHintOpen(false); setExampleOpen(v => !v); }}
                activeOpacity={0.8}
              >
                <Feather name="repeat" size={13} color={colors.accentGreen} />
                <Text style={[styles.mathActionChipText, { color: colors.textMain }]}>Show Another Example</Text>
              </TouchableOpacity>
            </View>
            {/* Try Yourself / Ask Aivorah — de-emphasized into one small link for now,
                not prominent buttons; the practice/chat experience needs real
                per-problem content before it deserves equal billing above. */}
            <TouchableOpacity onPress={() => setMode('practice')} activeOpacity={0.7}>
              <Text style={[styles.learnDeeperLink, { color: colors.textMuted }]}>Want to go deeper? Try a problem yourself, or ask Aivorah →</Text>
            </TouchableOpacity>
          </View>
          )}
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
                  // Lets the quiz endpoint prefer the book's own grounded
                  // exercises stored for this topic over LLM-generated ones.
                  topicId,
                  // Ground the quiz in the REAL lesson text (not just the topic name) —
                  // without this the quiz LLM had nothing to go on but "Change of Heart"
                  // as a bare string, and produced unrelated filler questions (a math
                  // word problem lifted straight from the generic prompt's own example).
                  passageText: (topic as any).readText
                    ? `${(topic as any).readText.intro} ${(topic as any).readText.body?.join(' ') ?? ''}`.trim()
                    : undefined,
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
      <ImageZoomModal
        visible={!!zoomImage}
        uri={zoomImage?.uri || ''}
        caption={zoomImage?.caption}
        onClose={() => setZoomImage(null)}
      />
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
  poemLine:  { fontFamily: fonts.serif, fontSize: 17, lineHeight: 30 },
  illusRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  illusSlot: { flex: 1, minWidth: 120, aspectRatio: 1.2, borderWidth: 1.5, borderStyle: 'dashed',
               borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 },
  illusCap:  { fontSize: 10.5, lineHeight: 14, textAlign: 'center' },

  figure: { borderWidth: 1, borderRadius: radius.md, padding: 20, alignItems: 'center', gap: 8 },
  figureImg: { width: '100%', height: 260, borderRadius: radius.sm ?? 8 },
  zoomHint: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 5 },
  mathFooter: { gap: 10, padding: 12, borderTopWidth: 1 },
  mathFooterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12 },
  mathFooterBtnText: { fontSize: 12.5, fontWeight: '600' },
  mathFooterBtnPrimary: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 16 },
  mathNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 },
  mathActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mathActionChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.md, paddingVertical: 7, paddingHorizontal: 11 },
  mathActionChipText: { fontSize: 12, fontWeight: '600' },
  learnDeeperLink: { fontSize: 12, textDecorationLine: 'underline' },
  aiTutorBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.sm ?? 8, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 10 },
  aiTutorBadgeText: { fontSize: 11.5, fontWeight: '600' },
  whyBox: { borderWidth: 1, borderRadius: radius.md, padding: 12, marginTop: 10 },
  whyLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  whyText: { fontSize: 13, lineHeight: 19 },
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
