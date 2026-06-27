import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius, fonts } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface Challenge {
  prompt:      string;
  options:     string[];
  correct:     number;
  explanation: string;
}
interface WordEntry {
  word:       string;
  meaning:    string;
  example:    string;
  connection: string;
  challenge:  Challenge;
}
interface WordResult { word: string; stars: number; correct: boolean; }

const CARD_COLORS = ['#BAA467', '#9FB2A4', '#C9A24E', '#B2C2B7'];
const STAR_COLOR  = '#C9A24E';

// ── Audio helpers ─────────────────────────────────────────────────────────────
let _audio: any = null;
function stopAudio() {
  if (_audio) { try { _audio.pause(); _audio.src = ''; } catch {} _audio = null; }
}
async function playUrl(url: string) {
  return new Promise<void>((resolve) => {
    if (Platform.OS !== 'web') { resolve(); return; }
    stopAudio();
    const a = new (window as any).Audio(url);
    _audio = a;
    a.onended = () => { _audio = null; resolve(); };
    a.onerror = () => { _audio = null; resolve(); };
    a.play().catch(() => { _audio = null; resolve(); });
  });
}
function speakFallback(text: string) {
  if (Platform.OS !== 'web' || !(window as any).speechSynthesis) return;
  const s = (window as any).speechSynthesis as SpeechSynthesis;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.0; u.pitch = 1.3;
  const v = s.getVoices().find(v => /zira|google.*en/i.test(v.name)) || s.getVoices().find(v => /en[-_]US/i.test(v.lang));
  if (v) u.voice = v;
  s.speak(u);
}
async function speak(text: string) {
  try {
    const res  = await fetch(`${SERVER_URL}/lesson/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json();
    if (data.audioUrl) { await playUrl(`${SERVER_URL}${data.audioUrl}`); return; }
  } catch {}
  speakFallback(text);
}

// ── Stars display ─────────────────────────────────────────────────────────────
function Stars({ count, max = 2, size = 16 }: { count: number; max?: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {Array.from({ length: max }).map((_, i) => (
        <Feather key={i} name="star" size={size} color={i < count ? STAR_COLOR : '#ffffff25'} />
      ))}
    </View>
  );
}

// ── Word Challenge Card ───────────────────────────────────────────────────────
function WordChallenge({ word, meaning, challenge, accent, colors, onResult }: {
  word: string; meaning: string; challenge: Challenge; accent: string;
  colors: any; onResult: (stars: number, correct: boolean) => void;
}) {
  // phase: 'quiz' → 'hint' (if wrong) → 'retry' → 'explain' → 'sentence' → 'done'
  const [phase,       setPhase]       = useState<'quiz'|'hint'|'retry'|'explain'|'sentence'|'done'>('quiz');
  const [selected,    setSelected]    = useState(-1);
  const [retryPick,   setRetryPick]   = useState(-1);
  const [stars,       setStars]       = useState(0);
  const [aiExplain,   setAiExplain]   = useState('');
  const [loading,     setLoading]     = useState(false);
  const [speaking,    setSpeaking]    = useState(false);
  const [sentence,    setSentence]    = useState('');
  const [sentResult,  setSentResult]  = useState<{correct:boolean;feedback:string}|null>(null);
  const [sentChecking,setSentChecking]= useState(false);

  const correct      = challenge.correct;
  const correctOpt   = challenge.options[correct];
  const optionLetters = ['A','B','C','D'];

  async function handleFirstPick(idx: number) {
    setSelected(idx);
    if (idx === correct) {
      // Correct first try → 2 stars
      setStars(2);
      const text = `Yes! ${challenge.explanation}`;
      setAiExplain(text);
      setPhase('explain');
      setSpeaking(true);
      await speak(text);
      setSpeaking(false);
    } else {
      // Wrong → show hint first
      setPhase('hint');
    }
  }

  async function handleSkipToExplain() {
    // Student wants full explanation
    setLoading(true);
    let explanation = challenge.explanation;
    try {
      const res  = await fetch(`${SERVER_URL}/modules/word-explain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, meaning, wrongAnswer: challenge.options[selected], correctAnswer: correctOpt, topic: word }),
      });
      const d = await res.json();
      explanation = d.explanation || explanation;
    } catch {}
    setAiExplain(explanation);
    setLoading(false);
    setPhase('explain');
    setSpeaking(true);
    await speak(explanation);
    setSpeaking(false);
  }

  async function handleRetryPick(idx: number) {
    setRetryPick(idx);
    if (idx === correct) {
      setStars(1); // correct but needed a hint
      const text = `Yes! ${challenge.explanation}`;
      setAiExplain(text);
      setPhase('explain');
      setSpeaking(true); await speak(text); setSpeaking(false);
    } else {
      setStars(0);
      setLoading(true);
      let explanation = challenge.explanation;
      try {
        const res  = await fetch(`${SERVER_URL}/modules/word-explain`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, meaning, wrongAnswer: challenge.options[idx], correctAnswer: correctOpt, topic: word }),
        });
        const d = await res.json();
        explanation = d.explanation || explanation;
      } catch {}
      setAiExplain(explanation);
      setLoading(false);
      setPhase('explain');
      setSpeaking(true); await speak(explanation); setSpeaking(false);
    }
  }

  async function goToSentence() {
    setPhase('sentence');
    const prompt = `Now try using the word "${word}" in your own sentence!`;
    setSpeaking(true); await speak(prompt); setSpeaking(false);
  }

  async function checkSentence() {
    if (!sentence.trim()) return;
    setSentChecking(true);
    try {
      const res  = await fetch(`${SERVER_URL}/modules/word-sentence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, sentence, meaning }),
      });
      const d = await res.json();
      setSentResult(d);
      setSpeaking(true); await speak(d.feedback); setSpeaking(false);
    } catch {
      setSentResult({ correct: true, feedback: 'Great effort using that word!' });
    }
    setSentChecking(false);
  }

  function finish() {
    setPhase('done');
    onResult(stars, stars > 0);
  }

  // Hint text derived from the word's example/meaning
  const hintText = `Think about it: ${meaning.split('.')[0].toLowerCase()}.`;

  if (phase === 'done') return null;

  return (
    <View style={[wc.wrap, { backgroundColor: accent + '10' }]}>
      {/* Header */}
      <View style={wc.row}>
        <View style={[wc.badge, { backgroundColor: accent }]}>
          <Feather name="zap" size={11} color="#fff" />
          <Text style={wc.badgeText}>Your Turn!</Text>
        </View>
        <Stars count={stars} max={2} />
        {speaking && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <ActivityIndicator size="small" color={accent} />
            <Text style={{ color: accent, fontSize: 11, fontWeight: '700' }}>Ms. Zara…</Text>
          </View>
        )}
      </View>

      {/* ── QUIZ phase ── */}
      {(phase === 'quiz') && (
        <>
          <Text style={[wc.prompt, { color: colors.textMain }]}>{challenge.prompt}</Text>
          <View style={wc.options}>
            {challenge.options.map((opt, idx) => (
              <TouchableOpacity
                key={idx}
                style={[wc.option, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}
                onPress={() => handleFirstPick(idx)}
                activeOpacity={0.75}
              >
                <View style={[wc.optLetter, { backgroundColor: colors.borderColor }]}>
                  <Text style={wc.optLetterText}>{optionLetters[idx]}</Text>
                </View>
                <Text style={[wc.optText, { color: colors.textMain }]} numberOfLines={2}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* ── HINT phase — show hint, let student try again OR skip to explanation ── */}
      {phase === 'hint' && (
        <>
          <View style={[wc.hintBox, { backgroundColor: '#f59e0b15', borderColor: '#f59e0b40' }]}>
            <Feather name="help-circle" size={16} color="#f59e0b" />
            <Text style={[wc.hintText, { color: colors.textMain }]}>
              Hmm, not quite! Here is a hint: {hintText}
            </Text>
          </View>
          <Text style={[wc.prompt, { color: colors.textMain }]}>Try again — {challenge.prompt}</Text>
          <View style={wc.options}>
            {challenge.options.map((opt, idx) => (
              <TouchableOpacity
                key={idx}
                style={[wc.option, {
                  borderColor: idx === selected ? '#ef444460' : colors.borderColor,
                  backgroundColor: idx === selected ? '#ef444410' : colors.cardDark,
                  opacity: idx === selected ? 0.5 : 1,
                }]}
                onPress={() => idx !== selected && handleRetryPick(idx)}
                disabled={idx === selected}
                activeOpacity={0.75}
              >
                <View style={[wc.optLetter, { backgroundColor: idx === selected ? '#ef4444' : colors.borderColor }]}>
                  <Text style={wc.optLetterText}>{optionLetters[idx]}</Text>
                </View>
                <Text style={[wc.optText, { color: colors.textMain }]} numberOfLines={2}>{opt}</Text>
                {idx === selected && <Feather name="x" size={14} color="#ef4444" />}
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={handleSkipToExplain} style={[wc.skipBtn, { borderColor: colors.borderColor }]}>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>
              {loading ? 'Loading…' : 'Just show me why'}
            </Text>
            {loading && <ActivityIndicator size="small" color={colors.textMuted} />}
          </TouchableOpacity>
        </>
      )}

      {/* ── EXPLAIN phase ── */}
      {phase === 'explain' && (
        <>
          {/* Show which options were correct/wrong */}
          <View style={wc.options}>
            {challenge.options.map((opt, idx) => {
              const pickedIdx  = retryPick !== -1 ? retryPick : selected;
              const isCorr     = idx === correct;
              const isPicked   = idx === pickedIdx;
              return (
                <View key={idx} style={[wc.option, {
                  borderColor: isCorr ? '#10b981' : (isPicked && !isCorr) ? '#ef4444' : colors.borderColor,
                  backgroundColor: isCorr ? '#10b98118' : (isPicked && !isCorr) ? '#ef444418' : colors.cardDark,
                }]}>
                  <View style={[wc.optLetter, { backgroundColor: isCorr ? '#10b981' : (isPicked && !isCorr) ? '#ef4444' : colors.borderColor }]}>
                    <Text style={wc.optLetterText}>{optionLetters[idx]}</Text>
                  </View>
                  <Text style={[wc.optText, { color: colors.textMain }]} numberOfLines={2}>{opt}</Text>
                  {isCorr && <Feather name="check-circle" size={15} color="#10b981" />}
                  {isPicked && !isCorr && <Feather name="x-circle" size={15} color="#ef4444" />}
                </View>
              );
            })}
          </View>

          <View style={[wc.explainBox, {
            backgroundColor: stars > 0 ? '#10b98112' : '#BAA46712',
            borderColor:     stars > 0 ? '#10b98140' : '#BAA46740',
          }]}>
            <Feather name={stars > 0 ? 'award' : 'info'} size={16} color={stars > 0 ? '#10b981' : '#BAA467'} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[wc.explainText, { color: colors.textMain }]}>
                {speaking ? 'Ms. Zara is explaining…' : aiExplain}
              </Text>
              {!speaking && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
                  onPress={async () => { setSpeaking(true); await speak(aiExplain); setSpeaking(false); }}
                >
                  <Feather name="volume-2" size={12} color={stars > 0 ? '#10b981' : '#BAA467'} />
                  <Text style={{ color: stars > 0 ? '#10b981' : '#BAA467', fontSize: 11, fontWeight: '700' }}>Hear again</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {!speaking && (
            <TouchableOpacity
              style={[wc.nextBtn, { backgroundColor: accent }]}
              onPress={goToSentence}
            >
              <Text style={wc.nextBtnText}>Use this word in a sentence!</Text>
              <Feather name="arrow-right" size={14} color="#fff" />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* ── SENTENCE phase ── */}
      {phase === 'sentence' && (
        <>
          <View style={[wc.hintBox, { backgroundColor: accent + '15', borderColor: accent + '40' }]}>
            <Feather name="edit-3" size={14} color={accent} />
            <Text style={[wc.hintText, { color: colors.textMain }]}>
              Write a sentence using the word <Text style={{ fontWeight: '800', color: accent }}>{word}</Text>:
            </Text>
          </View>
          <TextInput
            style={[wc.input, { color: colors.textMain, borderColor: accent + '50', backgroundColor: colors.cardDark }]}
            placeholder={`My sentence with "${word}"…`}
            placeholderTextColor={colors.textDim}
            value={sentence}
            onChangeText={setSentence}
            multiline
          />
          {!sentResult ? (
            <TouchableOpacity
              style={[wc.nextBtn, { backgroundColor: sentence.trim() ? accent : colors.borderColor }]}
              onPress={checkSentence}
              disabled={!sentence.trim() || sentChecking}
            >
              {sentChecking
                ? <><ActivityIndicator size="small" color="#fff" /><Text style={wc.nextBtnText}>Checking…</Text></>
                : <><Feather name="check" size={14} color="#fff" /><Text style={wc.nextBtnText}>Check my sentence</Text></>
              }
            </TouchableOpacity>
          ) : (
            <>
              <View style={[wc.explainBox, {
                backgroundColor: sentResult.correct ? '#10b98112' : '#f59e0b12',
                borderColor:     sentResult.correct ? '#10b98140' : '#f59e0b40',
              }]}>
                <Feather name={sentResult.correct ? 'check-circle' : 'alert-circle'} size={16} color={sentResult.correct ? '#10b981' : '#f59e0b'} />
                <Text style={[wc.explainText, { color: colors.textMain }]}>{sentResult.feedback}</Text>
              </View>
              <TouchableOpacity style={[wc.nextBtn, { backgroundColor: '#10b981' }]} onPress={finish}>
                <Feather name="star" size={14} color="#fff" />
                <Text style={wc.nextBtnText}>Next Word!</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity onPress={finish} style={[wc.skipBtn, { borderColor: colors.borderColor }]}>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>Skip — next word</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const wc = StyleSheet.create({
  wrap:        { borderRadius: 12, padding: 14, gap: 10 },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText:   { color: '#fff', fontSize: 11, fontWeight: '800' },
  prompt:      { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  options:     { gap: 7 },
  option:      { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 10, borderWidth: 1.5 },
  optLetter:   { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optLetterText:{ color: '#fff', fontSize: 11, fontWeight: '800' },
  optText:     { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  hintBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  hintText:    { flex: 1, fontSize: 13, lineHeight: 19 },
  explainBox:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1.5 },
  explainText: { fontSize: 13, lineHeight: 20, fontWeight: '500' },
  nextBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 12 },
  nextBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  skipBtn:     { alignItems: 'center', padding: 8, borderRadius: 8, borderWidth: 1 },
  input:       { borderWidth: 1.5, borderRadius: 10, padding: 12, fontSize: 14, lineHeight: 22, minHeight: 70 },
});

// ── Performance Summary ───────────────────────────────────────────────────────
function PerformanceSummary({ topic, results, colors, onRetry }: {
  topic: string; results: WordResult[]; colors: any; onRetry: () => void;
}) {
  const [summary,  setSummary]  = useState('');
  const [loading,  setLoading]  = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const totalStars = results.reduce((a, r) => a + r.stars, 0);
  const maxStars   = results.length * 2;

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`${SERVER_URL}/modules/word-performance`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, results }),
        });
        const d = await res.json();
        setSummary(d.summary || 'Great work today!');
        setLoading(false);
        setSpeaking(true);
        await speak(d.summary || 'Great work today!');
        setSpeaking(false);
      } catch {
        setSummary('You worked so hard today! Keep practising these words!');
        setLoading(false);
      }
    })();
  }, []);

  return (
    <View style={[ps.card, { backgroundColor: colors.cardDark, borderColor: STAR_COLOR + '40' }]}>
      <View style={ps.headerRow}>
        <Feather name="award" size={22} color={STAR_COLOR} />
        <Text style={[ps.title, { color: colors.textMain }]}>Word Wizard Complete!</Text>
      </View>

      {/* Stars earned */}
      <View style={ps.starsRow}>
        <Stars count={totalStars} max={maxStars} size={22} />
        <Text style={[ps.starsLabel, { color: colors.textMuted }]}>
          {totalStars}/{maxStars} stars
        </Text>
      </View>

      {/* Per-word breakdown */}
      <View style={ps.wordGrid}>
        {results.map((r, i) => (
          <View key={i} style={[ps.wordChip, { backgroundColor: r.stars > 0 ? '#10b98115' : '#ef444415', borderColor: r.stars > 0 ? '#10b98130' : '#ef444430' }]}>
            <Text style={[ps.wordChipText, { color: r.stars > 0 ? '#10b981' : '#ef4444' }]}>{r.word}</Text>
            <Stars count={r.stars} max={2} size={10} />
          </View>
        ))}
      </View>

      {/* Groq summary */}
      {loading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator size="small" color={STAR_COLOR} />
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>Ms. Zara is preparing your report…</Text>
        </View>
      ) : (
        <View style={[ps.summaryBox, { backgroundColor: STAR_COLOR + '12', borderColor: STAR_COLOR + '35' }]}>
          <Text style={[ps.summaryText, { color: colors.textMain }]}>
            {speaking ? 'Ms. Zara is speaking…' : summary}
          </Text>
          {!speaking && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start' }}
              onPress={async () => { setSpeaking(true); await speak(summary); setSpeaking(false); }}
            >
              <Feather name="volume-2" size={12} color={STAR_COLOR} />
              <Text style={{ color: STAR_COLOR, fontSize: 11, fontWeight: '700' }}>Hear again</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <TouchableOpacity style={[ps.retryBtn, { backgroundColor: STAR_COLOR }]} onPress={onRetry}>
        <Feather name="refresh-cw" size={14} color="#fff" />
        <Text style={ps.retryBtnText}>Learn New Words</Text>
      </TouchableOpacity>
    </View>
  );
}

const ps = StyleSheet.create({
  card:        { borderRadius: 18, borderWidth: 1.5, padding: 20, gap: 14 },
  headerRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title:       { fontSize: 18, fontWeight: '900', fontFamily: fonts.serif },
  starsRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  starsLabel:  { fontSize: 14, fontWeight: '700' },
  wordGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wordChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  wordChipText:{ fontSize: 12, fontWeight: '700' },
  summaryBox:  { borderRadius: 12, borderWidth: 1, padding: 14 },
  summaryText: { fontSize: 14, lineHeight: 22, fontWeight: '500' },
  retryBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 14 },
  retryBtnText:{ color: '#fff', fontSize: 14, fontWeight: '800' },
});

// ── Streak Banner ─────────────────────────────────────────────────────────────
function StreakBanner({ streak, colors }: { streak: number; colors: any }) {
  if (streak < 3) return null;
  const msgs: Record<number, string> = { 3: 'On fire! 3 in a row!', 4: 'Incredible! 4 correct!', 5: 'Word Wizard! 5 in a row!' };
  return (
    <View style={[sb.banner, { backgroundColor: STAR_COLOR + '20', borderColor: STAR_COLOR + '50' }]}>
      <Feather name="zap" size={16} color={STAR_COLOR} />
      <Text style={[sb.text, { color: STAR_COLOR }]}>{msgs[streak] ?? `${streak} in a row! Amazing!`}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1.5 },
  text:   { fontSize: 14, fontWeight: '800' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function WordWizardScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const { topic, chapterId, unit } = route.params ?? {};

  const [loading,    setLoading]    = useState(false);
  const [ttsIdx,     setTtsIdx]     = useState<number | null>(null);
  const [words,      setWords]      = useState<WordEntry[]>([]);
  const [expanded,   setExpanded]   = useState<number | null>(null);
  const [error,      setError]      = useState('');

  // Performance tracking
  const [results,    setResults]    = useState<WordResult[]>([]);
  const [streak,     setStreak]     = useState(0);
  const [showSummary, setShowSummary] = useState(false);

  const fetchWords = useCallback(async () => {
    setLoading(true);
    setWords([]); setExpanded(null); setError('');
    setResults([]); setStreak(0); setShowSummary(false);
    try {
      const res = await fetch(`${SERVER_URL}/modules/word-wizard`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic, unit }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setWords(data.words ?? []);
    } catch {
      setError('Could not load words. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [topic]);

  useEffect(() => { fetchWords(); }, [fetchWords]);

  // Stop audio when navigating away (drawer keeps screen mounted)
  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      stopAudio();
      if (Platform.OS === 'web' && (window as any).speechSynthesis) {
        try { (window as any).speechSynthesis.cancel(); } catch {}
      }
    });
    return () => {
      unsubBlur();
      stopAudio();
      if (Platform.OS === 'web' && (window as any).speechSynthesis) {
        try { (window as any).speechSynthesis.cancel(); } catch {}
      }
    };
  }, [navigation]);

  // Auto-play audio when a word card is expanded
  const prevExpanded = useRef<number | null>(null);
  useEffect(() => {
    if (expanded !== null && expanded !== prevExpanded.current) {
      const w = words[expanded];
      if (w) speak(`${w.word}. ${w.meaning}. For example, ${w.example}`);
    }
    prevExpanded.current = expanded;
  }, [expanded]);

  function handleWordResult(wordIdx: number, word: string, stars: number, correct: boolean) {
    const newResults = [...results, { word, stars, correct }];
    setResults(newResults);
    const newStreak = correct ? streak + 1 : 0;
    setStreak(newStreak);
    if (newStreak === 3 || newStreak === 4 || newStreak === 5) {
      speak(newStreak === 3 ? 'On fire! Three in a row!' : newStreak === 4 ? 'Incredible! Four correct!' : 'Word Wizard! Five in a row!');
    }
    // Close this card, open next — or show summary
    if (newResults.length >= words.length) {
      setTimeout(() => setShowSummary(true), 600);
    } else {
      setExpanded(wordIdx + 1 < words.length ? wordIdx + 1 : null);
    }
  }

  const totalStars = results.reduce((a, r) => a + r.stars, 0);
  const s = makeStyles(colors);

  return (
    <ScreenLayout>
      <View style={[s.screen, { backgroundColor: colors.bgDark }]}>
        <Header
          title="Word Wizard"
          subtitle={`Chapter ${chapterId}: ${topic}`}
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Top bar */}
          <View style={s.topBar}>
            <View style={[s.badge, { backgroundColor: colors.accentYellow + '20' }]}>
              <Feather name="zap" size={13} color={colors.accentYellow} />
              <Text style={[s.badgeText, { color: colors.accentYellow }]}>Word Wizard</Text>
            </View>
            {/* Stars counter */}
            {results.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: STAR_COLOR + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
                <Feather name="star" size={13} color={STAR_COLOR} />
                <Text style={{ color: STAR_COLOR, fontSize: 13, fontWeight: '800' }}>{totalStars} stars</Text>
              </View>
            )}
            <Text style={[s.chapterLabel, { color: colors.textMuted }]}>{results.length}/{words.length} words</Text>
          </View>

          <Text style={[s.subtitle, { color: colors.textMuted }]}>
            Tap a word — Ms. Zara will explain and quiz you!
          </Text>

          {/* Streak banner */}
          <StreakBanner streak={streak} colors={colors} />

          {loading && (
            <View style={s.center}>
              <ActivityIndicator size="large" color={colors.accentYellow} />
              <Text style={[s.hint, { color: colors.textMuted, marginTop: 12 }]}>Finding key words…</Text>
            </View>
          )}

          {error ? (
            <View style={s.center}>
              <Feather name="alert-circle" size={32} color={colors.accentRed} />
              <Text style={[s.hint, { color: colors.textMuted, marginTop: 8 }]}>{error}</Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: colors.accentYellow, marginTop: 16 }]} onPress={fetchWords}>
                <Text style={s.btnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Performance summary */}
          {showSummary && (
            <PerformanceSummary
              topic={topic}
              results={results}
              colors={colors}
              onRetry={fetchWords}
            />
          )}

          {/* Word cards */}
          {words.length > 0 && !loading && !showSummary && (
            <View style={s.grid}>
              {words.map((w, i) => {
                const accent    = CARD_COLORS[i % CARD_COLORS.length];
                const isOpen    = expanded === i;
                const wordDone  = results.find(r => r.word === w.word);

                return (
                  <TouchableOpacity
                    key={i}
                    style={[s.wordCard, {
                      backgroundColor: colors.cardDark,
                      borderColor: isOpen ? accent : wordDone ? '#10b98150' : colors.borderColor,
                      borderWidth: isOpen ? 2 : 1,
                      opacity: wordDone && !isOpen ? 0.7 : 1,
                    }]}
                    onPress={() => setExpanded(isOpen ? null : i)}
                    activeOpacity={0.8}
                  >
                    <View style={s.wordHeader}>
                      <View style={[s.wordIcon, { backgroundColor: accent + '20' }]}>
                        <Text style={[s.wordIconText, { color: accent }]}>{w.word.charAt(0).toUpperCase()}</Text>
                      </View>
                      <Text style={[s.wordTitle, { color: colors.textMain }]} numberOfLines={isOpen ? 10 : 1}>{w.word}</Text>
                      <View style={s.headerRight}>
                        {wordDone && <Stars count={wordDone.stars} max={2} size={13} />}
                        {wordDone && <Feather name="check-circle" size={14} color="#10b981" />}
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation?.(); setTtsIdx(i); speak(`${w.word}. ${w.meaning}`).then(() => setTtsIdx(null)); }}
                          disabled={ttsIdx === i}
                        >
                          {ttsIdx === i
                            ? <ActivityIndicator size="small" color={accent} />
                            : <Feather name="volume-2" size={15} color={accent} />
                          }
                        </TouchableOpacity>
                        <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                      </View>
                    </View>

                    {isOpen && (
                      <View style={s.expandedContent}>
                        <View style={[s.section, { backgroundColor: accent + '10' }]}>
                          <View style={s.sectionLabel}>
                            <Feather name="book" size={12} color={accent} />
                            <Text style={[s.sectionLabelText, { color: accent }]}>Meaning</Text>
                          </View>
                          <Text style={[s.sectionText, { color: colors.textMain }]}>{w.meaning}</Text>
                        </View>

                        <View style={[s.section, { backgroundColor: colors.accentGreen + '10' }]}>
                          <View style={s.sectionLabel}>
                            <Feather name="star" size={12} color={colors.accentGreen} />
                            <Text style={[s.sectionLabelText, { color: colors.accentGreen }]}>Real-life Example</Text>
                          </View>
                          <Text style={[s.sectionText, { color: colors.textMain }]}>{w.example}</Text>
                        </View>

                        <View style={[s.section, { backgroundColor: colors.accentYellow + '10' }]}>
                          <View style={s.sectionLabel}>
                            <Feather name="link" size={12} color={colors.accentYellow} />
                            <Text style={[s.sectionLabelText, { color: colors.accentYellow }]}>In this Chapter</Text>
                          </View>
                          <Text style={[s.sectionText, { color: colors.textMain }]}>{w.connection}</Text>
                        </View>

                        {w.challenge?.options?.length > 0 && !wordDone && (
                          <WordChallenge
                            word={w.word}
                            meaning={w.meaning}
                            challenge={w.challenge}
                            accent={accent}
                            colors={colors}
                            onResult={(stars, correct) => handleWordResult(i, w.word, stars, correct)}
                          />
                        )}

                        {wordDone && (
                          <View style={[s.section, { backgroundColor: '#10b98112', borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                            <Feather name="check-circle" size={14} color="#10b981" />
                            <Text style={{ color: '#10b981', fontSize: 13, fontWeight: '700' }}>
                              Done! You earned <Stars count={wordDone.stars} max={2} size={12} />
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {words.length > 0 && !loading && !showSummary && (
            <View style={s.actionRow}>
              <TouchableOpacity style={[s.btn, { backgroundColor: colors.accentYellow, flex: 1 }]} onPress={fetchWords}>
                <Feather name="refresh-cw" size={14} color="#fff" />
                <Text style={s.btnText}>New Words</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, flex: 1 }]}
                onPress={() => navigation.navigate('NCERTChapters')}
              >
                <Feather name="grid" size={14} color={colors.textMuted} />
                <Text style={[s.btnText, { color: colors.textMuted }]}>All Chapters</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    screen:          { flex: 1 },
    content:         { padding: spacing.xl, paddingBottom: 48, gap: spacing.md },
    center:          { alignItems: 'center', paddingVertical: 40 },
    topBar:          { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    badge:           { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    badgeText:       { fontSize: 12, fontWeight: '700' },
    chapterLabel:    { fontSize: 12, marginLeft: 'auto' as any },
    subtitle:        { fontSize: 13, lineHeight: 19 },
    grid:            { gap: spacing.md },
    wordCard:        { borderRadius: radius.lg, padding: 16, gap: 12 },
    wordHeader:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
    wordIcon:        { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    wordIconText:    { fontSize: 16, fontWeight: '800' },
    wordTitle:       { fontSize: 16, fontWeight: '700', flex: 1 },
    headerRight:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
    expandedContent: { gap: 10 },
    section:         { borderRadius: 10, padding: 12, gap: 6 },
    sectionLabel:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
    sectionLabelText:{ fontSize: 11, fontWeight: '700' },
    sectionText:     { fontSize: 14, lineHeight: 20 },
    actionRow:       { flexDirection: 'row', gap: spacing.md },
    btn:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md },
    btnText:         { color: '#fff', fontWeight: '700', fontSize: 13 },
    hint:            { fontSize: 13, textAlign: 'center' },
  });
}
