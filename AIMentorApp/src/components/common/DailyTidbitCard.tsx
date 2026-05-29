/**
 * DailyTidbitCard.tsx
 * Dashboard widget — shows today's GK Fact + Current Affairs.
 * Content is grade-specific and rotates daily via the server cache.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface GKFact {
  fact: string;
  category: string;
}
interface CurrentAffair {
  headline: string;
  summary: string;
}
interface TidbitData {
  grade: string;
  date: string;
  gk: GKFact;
  currentAffairs: CurrentAffair;
}

const CATEGORY_ICONS: Record<string, string> = {
  'Geography':                'globe',
  'Science & Nature':         'zap',
  'Human Body':               'heart',
  'Indian History & Culture': 'book-open',
  'Space & Universe':         'moon',
  'Animals':                  'feather',
  'Technology':               'cpu',
  'Amazing World Records':    'award',
  'Current Affairs':          'radio',
};

function categoryIcon(cat: string): any {
  return CATEGORY_ICONS[cat] ?? 'star';
}

interface QuizQuestion {
  question: string;
  options: string[];
  correct: number;
}

type QuizState = 'idle' | 'loading' | 'active' | 'done' | 'already_done';

interface Props {
  grade: string;
  studentId?: string;
}

export default function DailyTidbitCard({ grade, studentId }: Props) {
  const { colors, isDark } = useTheme();
  const [tab, setTab]         = useState<'gk' | 'news'>('gk');
  const [data, setData]       = useState<TidbitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  // Quiz state
  const [quizState, setQuizState]         = useState<QuizState>('idle');
  const [quizError, setQuizError]         = useState('');
  const [questions, setQuestions]         = useState<QuizQuestion[]>([]);
  const [currentQ, setCurrentQ]           = useState(0);
  const [selected, setSelected]           = useState<number | null>(null);
  const [answered, setAnswered]           = useState(false);
  const [correctCount, setCorrectCount]   = useState(0);
  const [xpEarned, setXpEarned]           = useState(0);

  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `daily_tidbit_v3_${grade}_${today}`;

  useEffect(() => {
    loadTidbit();
  }, [grade]);

  async function loadTidbit() {
    setLoading(true);
    setError(false);
    setQuizState('idle');
    setQuestions([]);
    setCurrentQ(0);
    try {
      // Check AsyncStorage cache first
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        setData(JSON.parse(cached));
        setLoading(false);
        return;
      }
      // Fetch from server
      const resp = await fetch(`${SERVER_URL}/daily-tidbit?grade=${encodeURIComponent(grade)}`);
      if (!resp.ok) throw new Error('Server error');
      const json: TidbitData = await resp.json();
      await AsyncStorage.setItem(cacheKey, JSON.stringify(json));
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // ── Quiz helpers ─────────────────────────────────────────────────
  function quizCacheKey(headline: string) {
    const hash = headline.replace(/\W+/g, '').toLowerCase().slice(0, 24);
    return `quiz_done_${hash}_${new Date().toISOString().split('T')[0]}`;
  }

  async function startQuiz() {
    if (!data?.currentAffairs) return;
    const key = quizCacheKey(data.currentAffairs.headline);
    const done = await AsyncStorage.getItem(key);
    if (done) { setQuizState('already_done'); return; }

    setQuizState('loading');
    setCurrentQ(0);
    setSelected(null);
    setAnswered(false);
    setCorrectCount(0);
    try {
      const resp = await fetch(`${SERVER_URL}/daily-tidbit/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: data.currentAffairs.headline, summary: data.currentAffairs.summary, grade }),
      });
      const json = await resp.json();
      if (!json.questions?.length) throw new Error('No questions');
      setQuestions(json.questions);
      setQuizState('active');
    } catch (e: any) {
      setQuizError('Could not load quiz. Please try again.');
      setQuizState('idle');
    }
  }

  async function handleAnswer(idx: number) {
    if (answered) return;
    setSelected(idx);
    setAnswered(true);
    const isCorrect = idx === questions[currentQ].correct;
    const newCount = correctCount + (isCorrect ? 1 : 0);
    setCorrectCount(newCount);

    // Last question → finish after short delay
    if (currentQ === questions.length - 1) {
      setTimeout(async () => {
        // Award XP
        let xp = 0;
        if (studentId) {
          try {
            const r = await fetch(`${SERVER_URL}/daily-tidbit/quiz-complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ studentId, correct: newCount }),
            });
            const j = await r.json();
            xp = j.xpAwarded || 0;
          } catch {}
        }
        setXpEarned(xp);
        setQuizState('done');
        if (data?.currentAffairs) {
          await AsyncStorage.setItem(quizCacheKey(data.currentAffairs.headline), '1');
        }
      }, 800);
    } else {
      // Next question after delay
      setTimeout(() => {
        setCurrentQ(q => q + 1);
        setSelected(null);
        setAnswered(false);
      }, 800);
    }
  }

  // ── Theme tokens ─────────────────────────────────────────────────
  const teal        = '#5F8A86';
  const rose        = '#B8797E';
  const cardBg      = isDark ? colors.cardDark  : '#F0F7F6';
  const borderCol   = isDark ? colors.borderColor : teal + '25';
  const activeTab   = tab === 'gk' ? teal : rose;
  const titleColor  = isDark ? colors.textMain : '#1C2A28';
  const mutedColor  = colors.textMuted;

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor: borderCol }]}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <View style={[s.iconCircle, { backgroundColor: activeTab + '20' }]}>
            <Feather name={tab === 'gk' ? 'star' : 'radio'} size={14} color={activeTab} />
          </View>
          <View>
            <Text style={[s.cardTitle, { color: titleColor }]}>
              {tab === 'gk' ? 'Did You Know?' : 'Today in the World'}
            </Text>
            <Text style={[s.cardSub, { color: mutedColor }]}>
              {tab === 'gk' ? 'Daily Knowledge' : 'Current Affairs'} · {grade}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={loadTidbit} style={s.refreshBtn} disabled={loading}>
          <Feather name="refresh-cw" size={14} color={mutedColor} />
        </TouchableOpacity>
      </View>

      {/* Tab switcher */}
      <View style={[s.tabs, { backgroundColor: isDark ? colors.bgDark : teal + '10', borderColor: borderCol }]}>
        <TouchableOpacity
          style={[s.tab, tab === 'gk' && { backgroundColor: teal, borderRadius: radius.sm - 2 }]}
          onPress={() => setTab('gk')}
          activeOpacity={0.8}
        >
          <Feather name="star" size={12} color={tab === 'gk' ? '#fff' : mutedColor} />
          <Text style={[s.tabText, { color: tab === 'gk' ? '#fff' : mutedColor }]}>GK Fact</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, tab === 'news' && { backgroundColor: rose, borderRadius: radius.sm - 2 }]}
          onPress={() => setTab('news')}
          activeOpacity={0.8}
        >
          <Feather name="radio" size={12} color={tab === 'news' ? '#fff' : mutedColor} />
          <Text style={[s.tabText, { color: tab === 'news' ? '#fff' : mutedColor }]}>Current Affairs</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={s.loadingBox}>
          <ActivityIndicator size="small" color={activeTab} />
          <Text style={[s.loadingText, { color: mutedColor }]}>Fetching today's tidbit...</Text>
        </View>
      ) : error ? (
        <View style={s.loadingBox}>
          <Feather name="wifi-off" size={20} color={mutedColor} />
          <Text style={[s.loadingText, { color: mutedColor }]}>Couldn't load. Tap refresh to try again.</Text>
        </View>
      ) : data ? (
        tab === 'gk' ? (
          <View style={s.content}>
            <View style={[s.categoryBadge, { backgroundColor: teal + '18', borderColor: teal + '40' }]}>
              <Feather name={categoryIcon(data.gk.category) as any} size={11} color={teal} />
              <Text style={[s.categoryText, { color: teal }]}>{data.gk.category}</Text>
            </View>
            <Text style={[s.factText, { color: titleColor }]}>
              {(() => {
                const f = data.gk.fact;
                if (typeof f === 'string' && f.trim().startsWith('{')) {
                  try { return JSON.parse(f).fact || f; } catch { return f; }
                }
                return f;
              })()}
            </Text>
          </View>
        ) : (
          <View style={s.content}>
            <View style={[s.categoryBadge, { backgroundColor: rose + '18', borderColor: rose + '40' }]}>
              <Feather name="radio" size={11} color={rose} />
              <Text style={[s.categoryText, { color: rose }]}>Current Affairs</Text>
            </View>
            <Text style={[s.headlineText, { color: titleColor }]}>{data.currentAffairs.headline}</Text>
            <Text style={[s.summaryText, { color: mutedColor }]}>{data.currentAffairs.summary}</Text>

            {/* ── Comprehension Quiz ───────────────────────────── */}
            {quizState === 'idle' && (
              <View>
                <TouchableOpacity
                  style={[s.quizBtn, { backgroundColor: teal }]}
                  onPress={() => { setQuizError(''); startQuiz(); }}
                  activeOpacity={0.85}
                >
                  <Feather name="check-square" size={13} color="#fff" />
                  <Text style={s.quizBtnText}>Test Your Knowledge</Text>
                </TouchableOpacity>
                {!!quizError && (
                  <Text style={[s.quizLoadText, { color: '#C85870', marginTop: 4 }]}>{quizError}</Text>
                )}
              </View>
            )}

            {quizState === 'loading' && (
              <View style={s.quizLoadRow}>
                <ActivityIndicator size="small" color={teal} />
                <Text style={[s.quizLoadText, { color: mutedColor }]}>Generating quiz...</Text>
              </View>
            )}

            {quizState === 'already_done' && (
              <View style={[s.quizDoneBanner, { backgroundColor: teal + '15', borderColor: teal + '35' }]}>
                <View style={[s.quizDoneIcon, { backgroundColor: teal + '25' }]}>
                  <Feather name="check-circle" size={13} color={teal} />
                </View>
                <Text style={[s.quizDoneText, { color: teal }]}>Quiz done today! Come back tomorrow.</Text>
              </View>
            )}

            {quizState === 'active' && questions[currentQ] && (
              <View style={[s.quizBox, { backgroundColor: isDark ? colors.bgDark : '#f5f9f8', borderColor: teal + '40' }]}>
                <Text style={[s.quizCounter, { color: mutedColor }]}>
                  Question {currentQ + 1} of {questions.length}
                </Text>
                <Text style={[s.quizQuestion, { color: titleColor }]}>{questions[currentQ].question}</Text>
                <View style={s.optionsCol}>
                  {questions[currentQ].options.map((opt, i) => {
                    const isSelected = selected === i;
                    const isCorrect  = i === questions[currentQ].correct;
                    let bg = isDark ? colors.cardDark : '#fff';
                    let border = teal + '40';
                    if (answered) {
                      if (isCorrect)               { bg = '#4A9E7018'; border = '#4A9E7080'; }
                      else if (isSelected)          { bg = '#C8587018'; border = '#C8587080'; }
                    } else if (isSelected) {
                      bg = teal + '18'; border = teal;
                    }
                    return (
                      <TouchableOpacity
                        key={i}
                        style={[s.optionBtn, { backgroundColor: bg, borderColor: border }]}
                        onPress={() => handleAnswer(i)}
                        activeOpacity={0.8}
                        disabled={answered}
                      >
                        <View style={[s.optionIdx, { backgroundColor: teal + '20' }]}>
                          <Text style={[s.optionIdxText, { color: teal }]}>{String.fromCharCode(65 + i)}</Text>
                        </View>
                        <Text style={[s.optionText, { color: titleColor }]}>{opt}</Text>
                        {answered && isCorrect && <Feather name="check" size={13} color="#4A9E70" />}
                        {answered && isSelected && !isCorrect && <Feather name="x" size={13} color="#C85870" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {quizState === 'done' && (
              <View style={[s.quizDoneBanner, { backgroundColor: teal + '15', borderColor: teal + '35' }]}>
                <View style={[s.quizDoneIcon, { backgroundColor: teal + '25' }]}>
                  <Feather name="award" size={14} color={teal} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.quizDoneTitle, { color: teal }]}>
                    {correctCount === questions.length ? 'Perfect score!' : `${correctCount}/${questions.length} correct`}
                  </Text>
                  {xpEarned > 0 && (
                    <Text style={[s.quizXpText, { color: mutedColor }]}>+{xpEarned} XP earned</Text>
                  )}
                </View>
              </View>
            )}
          </View>
        )
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle:  { fontSize: 14, fontWeight: '700' },
  cardSub:    { fontSize: 11, marginTop: 1 },
  refreshBtn: { padding: 6 },

  tabs: {
    flexDirection: 'row',
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: 3,
    gap: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
  },
  tabText: { fontSize: 12, fontWeight: '600' },

  loadingBox: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  loadingText: { fontSize: 12, textAlign: 'center' },

  content:      { gap: spacing.sm },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  categoryText: { fontSize: 11, fontWeight: '700' },
  factText:     { fontSize: 14, fontWeight: '500', lineHeight: 22 },
  headlineText: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  summaryText:  { fontSize: 13, lineHeight: 20 },

  // Quiz
  quizBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    gap: 6, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, marginTop: 4,
  },
  quizBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  quizLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  quizLoadText: { fontSize: 12 },
  quizDoneBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 4,
  },
  quizDoneIcon: {
    width: 30, height: 30, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  quizDoneText:  { fontSize: 13, fontWeight: '600', flex: 1 },
  quizDoneTitle: { fontSize: 14, fontWeight: '800' },
  quizXpText:    { fontSize: 12, marginTop: 2 },
  quizBox: {
    borderWidth: 1, borderRadius: 12, padding: 12, gap: 10, marginTop: 4,
  },
  quizCounter:  { fontSize: 11, fontWeight: '600' },
  quizQuestion: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  optionsCol:   { gap: 6 },
  optionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: 8, borderWidth: 1,
  },
  optionIdx: {
    width: 22, height: 22, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  optionIdxText: { fontSize: 11, fontWeight: '800' },
  optionText:    { flex: 1, fontSize: 13, fontWeight: '500' },
});
