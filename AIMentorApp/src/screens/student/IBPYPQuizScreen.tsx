/**
 * IBPYPQuizScreen.tsx
 * Practice test for any IB PYP topic — Grades 3, 4, 5
 * - Generates mixed MCQ + fill-in-the-blank questions via Groq (/ibpyp/quiz)
 * - MCQ wrong → hint available → retry (up to 2 attempts) → explanation
 * - Fill-blank: 3-attempt nudge logic (wrong1 → retry, wrong2 → hint, wrong3 → reveal)
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, BackHandler, Platform, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useStudentData } from '../../context/StudentDataContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

type Question = {
  type:        'mcq' | 'fill_blank';
  question:    string;
  options:     string[];
  correct:     number | string; // index for mcq, string for fill_blank
  hint:        string;
  explanation: string;
};

type QuizPhase = 'loading' | 'quiz' | 'result';

const SUBJECT_COLOR: Record<string, string> = {
  Mathematics:          '#4A9E9A',
  Science:              '#3D8A60',
  English:              '#C85870',
  'Social Studies':     '#A89840',
  Arts:                 '#C87848',
  'Physical Education': '#C84868',
  ICT:                  '#3A9896',
};

export default function IBPYPQuizScreen({ navigation, route }: any) {
  const { topic, grade = 'Grade 3', subject = 'Mathematics', curriculum = 'IB PYP' } = route?.params ?? {};
  const { colors, isDark } = useTheme();
  const { user }           = useAuth();
  const { completeLesson, addXP } = useStudentData();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const accent = SUBJECT_COLOR[subject] || colors.primary;

  const [phase, setPhase]       = useState<QuizPhase>('loading');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [score, setScore]       = useState(0);

  // MCQ state
  const [mcqSelected, setMcqSelected]     = useState<number | null>(null);
  const [mcqAttempts, setMcqAttempts]     = useState(0); // attempts on current MCQ
  const [showMcqHint, setShowMcqHint]     = useState(false);
  const [mcqDone, setMcqDone]             = useState(false); // locked after 2nd wrong

  // Fill-blank state
  const [fillInput, setFillInput]         = useState('');
  const [fillAttempts, setFillAttempts]   = useState(0);
  const [fillFeedback, setFillFeedback]   = useState<'idle'|'wrong1'|'wrong2'|'revealed'|'correct'>('idle');
  const [fillValidating, setFillValidating] = useState(false);

  // Explanation
  const [explanation, setExplanation]     = useState('');
  const [loadingExplain, setLoadingExplain] = useState(false);

  const scoreRef = useRef(score);
  scoreRef.current = score;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (phase !== 'quiz') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert('Leave Quiz?', 'Your progress will be lost.',
        [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() }]);
      return true;
    });
    return () => handler.remove();
  }, [phase]);

  const fetchQuiz = useCallback(async () => {
    setPhase('loading');
    setScore(0); setCurrentQ(0);
    resetQuestionState();
    try {
      const res  = await fetch(`${SERVER_URL}/ibpyp/quiz`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, grade, subject, userEmail: user?.email, role: user?.role }),
      });
      const data = await res.json();
      if (!data.questions?.length) throw new Error('No questions');
      setQuestions(data.questions);
      setPhase('quiz');
    } catch {
      Alert.alert('Error', 'Could not generate quiz. Please try again.');
      navigation.goBack();
    }
  }, [topic, grade, subject, user?.email]);

  useEffect(() => { fetchQuiz(); }, [fetchQuiz]);

  function resetQuestionState() {
    setMcqSelected(null); setMcqAttempts(0); setShowMcqHint(false); setMcqDone(false);
    setFillInput(''); setFillAttempts(0); setFillFeedback('idle'); setFillValidating(false);
    setExplanation(''); setLoadingExplain(false);
  }

  function finishQuiz(finalScore: number) {
    const pct = Math.round((finalScore / questions.length) * 100);
    fetch(`${SERVER_URL}/ibpyp/track-result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: user?.email, role: user?.role, topic, subject, grade, score: pct, totalQuestions: questions.length, correctAnswers: finalScore }),
    }).catch(() => {});
    completeLesson(topic);
    addXP(pct >= 80 ? 100 : pct >= 60 ? 60 : 30);
    setScore(finalScore);
    setPhase('result');
  }

  function goNext(isCorrect: boolean) {
    const newScore = scoreRef.current + (isCorrect ? 1 : 0);
    scoreRef.current = newScore;
    setScore(newScore);
    if (currentQ < questions.length - 1) {
      setCurrentQ(q => q + 1);
      resetQuestionState();
    } else {
      finishQuiz(newScore);
    }
  }

  // ── MCQ handlers ────────────────────────────────────────────────
  async function handleMcqAnswer(optIdx: number) {
    if (mcqDone || mcqSelected !== null) return;
    const q = questions[currentQ];
    const isCorrect = optIdx === (q.correct as number);
    setMcqSelected(optIdx);
    const attempts = mcqAttempts + 1;
    setMcqAttempts(attempts);

    if (isCorrect) {
      setMcqDone(true);
      // fetch explanation for correct answer too
      fetchExplanation(q, q.options[optIdx], q.options[q.correct as number], true);
    } else if (attempts < 2) {
      // 1st wrong — allow retry with hint available
      setTimeout(() => {
        setMcqSelected(null); // unlock for retry
        setShowMcqHint(true);
      }, 900);
    } else {
      // 2nd wrong — lock and show explanation
      setMcqDone(true);
      fetchExplanation(q, q.options[optIdx], q.options[q.correct as number], false);
    }
  }

  async function fetchExplanation(q: Question, wrong: string, correct: string, wasCorrect: boolean) {
    if (wasCorrect) { setExplanation(q.explanation || 'Great job! That\'s correct!'); return; }
    setLoadingExplain(true);
    try {
      const res = await fetch(`${SERVER_URL}/ibpyp/explain-wrong`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, subject, grade, question: q.question, wrongAnswer: wrong, correctAnswer: correct }),
      });
      const data = await res.json();
      setExplanation(data.explanation || q.explanation || 'The correct answer is highlighted above.');
    } catch {
      setExplanation(q.explanation || 'The correct answer is highlighted above. Keep going!');
    } finally {
      setLoadingExplain(false);
    }
  }

  // ── Fill-blank handlers ─────────────────────────────────────────
  async function handleFillSubmit() {
    if (!fillInput.trim() || fillValidating) return;
    setFillValidating(true);
    try {
      const resp = await fetch(`${SERVER_URL}/assignments/validate-fill-blank`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentAnswer: fillInput.trim(), correctAnswer: questions[currentQ].correct }),
      });
      const { correct } = await resp.json();
      if (correct) {
        setFillFeedback('correct');
        setExplanation(questions[currentQ].explanation || 'Excellent! That\'s correct!');
      } else {
        const attempts = fillAttempts + 1;
        setFillAttempts(attempts);
        if (attempts === 1)      setFillFeedback('wrong1');
        else if (attempts === 2) setFillFeedback('wrong2');
        else {
          setFillFeedback('revealed');
          setExplanation(questions[currentQ].explanation || '');
        }
      }
    } catch {
      setFillFeedback('correct'); // network error — give benefit of doubt
      setExplanation(questions[currentQ].explanation || '');
    } finally {
      setFillValidating(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────
  if (phase === 'loading') return (
    <ScreenLayout>
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={accent} />
        <Text style={[styles.loadingText, { color: colors.textMuted }]}>Preparing your practice test…</Text>
      </View>
    </ScreenLayout>
  );

  // ── Results ────────────────────────────────────────────────────
  if (phase === 'result') {
    const pct      = Math.round((score / questions.length) * 100);
    const scoreColor = pct === 100 ? '#4ade80' : pct >= 70 ? '#4A9E70' : accent;
    const emoji    = pct === 100 ? '🌟' : pct >= 80 ? '🏆' : pct >= 60 ? '👍' : '💪';
    const message  = pct === 100 ? 'Perfect score! Outstanding work!'
      : pct >= 80 ? 'Excellent! You really understand this topic!'
      : pct >= 60 ? 'Good job! A little more practice and you will master this!'
      : 'Keep practising — every attempt makes you stronger!';
    return (
      <ScreenLayout>
        <View style={styles.screen}>
          <Header title="Quiz Results" showBack onBack={() => navigation.goBack()} onMenuPress={() => navigation.openDrawer()} />
          <ScrollView contentContainerStyle={[styles.scrollContent]}><View style={[styles.content, { alignItems: 'center', paddingTop: 32 }]}>
            <Text style={{ fontSize: 64 }}>{emoji}</Text>
            <Text style={[styles.resultScore, { color: scoreColor }]}>{pct}%</Text>
            <Text style={[styles.resultLabel, { color: colors.textMain }]}>{score} / {questions.length} correct</Text>
            <Text style={[styles.resultMessage, { color: colors.textMuted }]}>{message}</Text>
            <View style={[styles.topicBadge, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
              <Text style={[styles.topicBadgeText, { color: accent }]}>{topic}</Text>
            </View>
            <View style={styles.resultBtns}>
              <TouchableOpacity style={[styles.retryBtn, { borderColor: accent, backgroundColor: accent + '14' }]} onPress={fetchQuiz} activeOpacity={0.8}>
                <Feather name="refresh-cw" size={16} color={accent} />
                <Text style={[styles.retryBtnText, { color: accent }]}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.doneBtn, { backgroundColor: accent }]} onPress={() => navigation.navigate('SubjectTopics', { subject, grade, curriculum })} activeOpacity={0.8}>
                <Text style={styles.doneBtnText}>Back to Topics</Text>
              </TouchableOpacity>
            </View>
          </View></ScrollView>
        </View>
      </ScreenLayout>
    );
  }

  // ── Quiz ───────────────────────────────────────────────────────
  const q = questions[currentQ];
  const isFill    = q.type === 'fill_blank';
  const fillDone  = fillFeedback === 'correct' || fillFeedback === 'revealed';
  const mcqCorrect = mcqDone && mcqSelected === (q.correct as number);
  const showNext  = isFill ? fillDone : (mcqDone && !loadingExplain);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title={`${subject} Practice`} subtitle={topic} showBack onBack={() => navigation.goBack()} onMenuPress={() => navigation.openDrawer()} />
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.twoPanel}>

          {/* ── LEFT PANEL: subject + progress ── */}
          <View style={[styles.leftPanel, { backgroundColor: accent }]}>
            <View style={styles.leftTop}>
              <View style={[styles.subjectIcon, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <Feather name={subject === 'Mathematics' ? 'hash' : subject === 'Science' ? 'zap' : subject === 'English' ? 'book-open' : subject === 'Arts' ? 'feather' : subject === 'ICT' ? 'monitor' : 'globe'} size={22} color="#fff" />
              </View>
              <Text style={styles.leftSubject}>{subject}</Text>
              <Text style={styles.leftTopic} numberOfLines={3}>{topic}</Text>
            </View>

            {/* Step dots */}
            <View style={styles.stepDots}>
              {questions.map((_, i) => (
                <View key={i} style={[styles.stepDot, {
                  backgroundColor: i < currentQ ? 'rgba(255,255,255,0.9)' : i === currentQ ? '#fff' : 'rgba(255,255,255,0.3)',
                  width: i === currentQ ? 22 : 8,
                }]} />
              ))}
            </View>

            <View style={styles.leftBottom}>
              <Text style={styles.leftCounter}>{currentQ + 1}</Text>
              <Text style={styles.leftOf}>of {questions.length}</Text>
              <View style={styles.leftTypeBadge}>
                <Feather name={isFill ? 'edit-3' : 'list'} size={10} color={accent} />
                <Text style={[styles.leftTypeTxt, { color: accent }]}>{isFill ? 'Fill Blank' : 'MCQ'}</Text>
              </View>
            </View>
          </View>

          {/* ── RIGHT PANEL: question + options ── */}
          <View style={[styles.rightPanel, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>

            {/* Question text */}
            <Text style={[styles.questionText, { color: colors.textMain }]}>{q.question}</Text>
            <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />

          {/* ── MCQ options — inside the card ── */}
          {!isFill && (
            <View style={styles.optionsList}>
              {q.options.map((opt, i) => {
                const isSelected = mcqSelected === i;
                const isCorrect  = (q.correct as number) === i;
                const LETTERS    = ['A','B','C','D'];
                const TEAL       = '#5F8A86';
                const showResult = mcqDone;

                let radioFill   = 'transparent';
                let radioBorder = isDark ? '#555' : '#B8CCCA';
                let textCol     = colors.textMain;
                let rowBg       = 'transparent';
                let leftBorder  = 'transparent';
                let resultIcon: 'check-circle' | 'x-circle' | null = null;

                if (showResult) {
                  if (isCorrect)       { radioFill = '#4A9E70'; radioBorder = '#4A9E70'; textCol = '#4A9E70'; rowBg = isDark ? '#4A9E7012' : '#F0FFF6'; leftBorder = '#4A9E70'; resultIcon = 'check-circle'; }
                  else if (isSelected) { radioFill = '#C84870'; radioBorder = '#C84870'; textCol = '#C84870'; rowBg = isDark ? '#C8487012' : '#FFF2F4'; leftBorder = '#C84870'; resultIcon = 'x-circle'; }
                  else                 { radioBorder = isDark ? '#333' : '#DDD'; textCol = isDark ? '#444' : '#CCC'; }
                } else if (mcqSelected === i) {
                  radioFill = TEAL; radioBorder = TEAL; textCol = isDark ? '#9ECFCC' : '#2D6A66';
                  rowBg = isDark ? '#5F8A8618' : '#EBF5F4'; leftBorder = TEAL;
                }

                return (
                  <TouchableOpacity key={i}
                    style={[styles.optionRow, { backgroundColor: rowBg, borderLeftColor: leftBorder }]}
                    onPress={() => handleMcqAnswer(i)}
                    activeOpacity={mcqSelected !== null ? 1 : 0.65}
                    disabled={mcqSelected !== null || mcqDone}
                  >
                    <View style={[styles.radioOuter, { borderColor: radioBorder }]}>
                      {radioFill !== 'transparent' && <View style={[styles.radioInner, { backgroundColor: radioFill }]} />}
                    </View>
                    <Text style={[styles.optionLetter, { color: showResult ? (isCorrect ? '#4A9E70' : isSelected ? '#C84870' : isDark ? '#444' : '#DDD') : (isDark ? '#7ABFBB' : TEAL) }]}>{LETTERS[i]}</Text>
                    <Text style={[styles.optionText, { color: textCol }]}>{opt}</Text>
                    {resultIcon && <Feather name={resultIcon} size={14} color={resultIcon === 'check-circle' ? '#4A9E70' : '#C84870'} style={{ marginLeft: 'auto' as any }} />}
                  </TouchableOpacity>
                );
              })}

              {/* Hint row inside card */}
              {showMcqHint && !mcqDone && (
                <View style={[styles.hintBanner, { backgroundColor: isDark ? '#0F2624' : '#EBF5F4', borderColor: '#5F8A8660' }]}>
                  <Feather name="zap" size={12} color="#fff" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hintBannerLabel}>Ms. Zara's Hint</Text>
                    <Text style={styles.hintBannerText}>{q.hint || 'Think carefully before your next attempt!'}</Text>
                  </View>
                  <View style={[styles.retryChip, { backgroundColor: accent + '20', borderColor: accent + '40' }]}>
                    <Feather name="refresh-cw" size={9} color={accent} />
                    <Text style={[styles.retryChipText, { color: accent }]}>retry</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ── Fill-in-the-blank — inside card ── */}
          {isFill && (
            <View style={styles.fillArea}>
              {fillFeedback === 'correct' ? (
                <View style={[styles.fillResultRow, { backgroundColor: isDark ? '#4A9E7012' : '#F0FFF6', borderColor: '#4A9E7040' }]}>
                  <Feather name="check-circle" size={14} color="#4A9E70" />
                  <Text style={[styles.fillCorrectText, { color: '#4A9E70' }]}>{fillInput}</Text>
                </View>
              ) : fillFeedback === 'revealed' ? (
                <View style={[styles.fillResultRow, { backgroundColor: isDark ? '#C8587012' : '#FFF2F4', borderColor: '#C8587040' }]}>
                  <Feather name="info" size={14} color="#C85870" />
                  <Text style={[styles.fillCorrectText, { color: '#C85870' }]}>Answer: {q.correct as string}</Text>
                </View>
              ) : (
                <>
                  <TextInput
                    style={[styles.fillInput, { borderColor: fillFeedback !== 'idle' ? '#E8A02070' : accent + '50', color: colors.textMain, backgroundColor: isDark ? colors.bgDark : '#F8FAFA' }]}
                    placeholder="Type your answer here..."
                    placeholderTextColor={colors.textDim}
                    value={fillInput}
                    onChangeText={setFillInput}
                    onSubmitEditing={handleFillSubmit}
                    returnKeyType="done"
                    editable={!fillValidating}
                    autoCapitalize="none"
                  />
                  {fillFeedback === 'wrong1' && (
                    <View style={styles.nudgeRow}>
                      <Feather name="alert-circle" size={12} color="#E8A020" />
                      <Text style={[styles.nudgeText, { color: '#E8A020' }]}>Not quite — give it another try!</Text>
                    </View>
                  )}
                  {fillFeedback === 'wrong2' && (
                    <View style={[styles.hintBanner, { backgroundColor: isDark ? '#0F2624' : '#EBF5F4', borderColor: '#5F8A8660' }]}>
                      <Feather name="zap" size={12} color="#fff" />
                      <Text style={[styles.hintBannerText, { flex: 1 }]}>Hint: {q.hint || 'Think carefully!'}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={[styles.checkBtn, { backgroundColor: fillValidating || !fillInput.trim() ? accent + '45' : accent }]}
                    onPress={handleFillSubmit}
                    activeOpacity={0.85}
                    disabled={fillValidating || !fillInput.trim()}
                  >
                    {fillValidating
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <><Feather name="check" size={14} color="#fff" /><Text style={styles.checkBtnText}>Check Answer</Text></>
                    }
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* Explanation row — inside card, after divider */}
          {(explanation || loadingExplain) && (
            <View style={[styles.explanationRow, { borderTopWidth: 1, borderTopColor: colors.borderColor, paddingTop: 12, marginTop: 4 }]}>
              {loadingExplain
                ? <ActivityIndicator color={accent} size="small" />
                : <>
                    <Feather name={(mcqCorrect || fillFeedback === 'correct') ? 'check-circle' : 'info'} size={13}
                      color={(mcqCorrect || fillFeedback === 'correct') ? '#4A9E70' : '#C87848'} />
                    <Text style={[styles.explanationText, { color: isDark ? colors.textMuted : '#666' }]}>
                      <Text style={{ fontWeight: '700', color: (mcqCorrect || fillFeedback === 'correct') ? '#4A9E70' : '#C87848' }}>
                        {(mcqCorrect || fillFeedback === 'correct') ? 'Well done! ' : 'Ms. Zara: '}
                      </Text>
                      {explanation}
                    </Text>
                  </>
              }
            </View>
          )}

          {/* Next button — bottom of card */}
          {showNext && (
            <TouchableOpacity
              style={[styles.nextBtn, { backgroundColor: accent, alignSelf: 'flex-end' }]}
              onPress={() => goNext(isFill ? fillFeedback === 'correct' : mcqCorrect)}
              activeOpacity={0.85}
            >
              <Text style={styles.nextBtnText}>{currentQ < questions.length - 1 ? 'Next Question' : 'See Results'}</Text>
              <Feather name="arrow-right" size={15} color="#fff" />
            </TouchableOpacity>
          )}

          </View>{/* end rightPanel */}

        </View>{/* end twoPanel */}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  screen:       { flex: 1, backgroundColor: c.bgDark },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText:  { marginTop: 16, fontSize: 14, textAlign: 'center' },

  // Two-panel layout
  twoPanel: {
    flexDirection: 'row', width: '100%', maxWidth: 800,
    borderRadius: radius.xl, overflow: 'hidden',
    borderWidth: 1, borderColor: c.borderColor,
    minHeight: 480,
  },
  leftPanel: {
    width: 200, flexShrink: 0,
    padding: spacing.xl, justifyContent: 'space-between',
  },
  leftTop: { gap: 10 },
  subjectIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  leftSubject: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.8 },
  leftTopic:   { fontSize: 16, fontWeight: '800', color: '#fff', lineHeight: 22 },
  stepDots:    { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  stepDot:     { height: 8, borderRadius: 4 },
  leftBottom:  { gap: 6 },
  leftCounter: { fontSize: 42, fontWeight: '900', color: '#fff', lineHeight: 46 },
  leftOf:      { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.65)', marginTop: -6 },
  leftTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', marginTop: 4 },
  leftTypeTxt:   { fontSize: 11, fontWeight: '800' },

  // Right panel
  rightPanel:  { flex: 1, backgroundColor: c.cardDark },
  divider:     { height: 1 },
  questionText: { fontSize: 17, fontWeight: '700', lineHeight: 27, padding: spacing.xl },

  // Keep these minimal for backward compat
  progressText: { fontSize: 12, fontWeight: '600' },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 2 },
  questionBadge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7 },
  questionBadgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  typeBadgeText: { fontSize: 10, fontWeight: '700' },

  // Options — full-width rows within card, left-border accent when selected/correct
  optionsList: { gap: 0 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: spacing.xl, borderLeftWidth: 3 },
  radioOuter: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  radioInner: { width: 8, height: 8, borderRadius: 4 },
  optionLetter: { fontSize: 13, fontWeight: '800', width: 16, flexShrink: 0 },
  optionLetterText: { fontSize: 11, fontWeight: '900' },
  optionText: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 20 },

  // Hint
  hintBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 11, marginHorizontal: spacing.xl, marginVertical: 6, borderRadius: 9, borderWidth: 1 },
  hintBannerLabel: { fontSize: 10, fontWeight: '900', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.4 },
  hintBannerText: { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.85)', lineHeight: 18 },
  retryChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  retryChipText: { fontSize: 10, fontWeight: '700' },

  // Fill blank
  fillArea: { paddingHorizontal: spacing.xl, paddingTop: 4, paddingBottom: spacing.md, gap: 10 },
  fillInput: { borderWidth: 1.5, borderRadius: 10, padding: 12, fontSize: 14 },
  nudgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nudgeText: { fontSize: 13, fontWeight: '600' },
  fillResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  fillCorrectText: { fontSize: 14, fontWeight: '700', flex: 1 },
  checkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: radius.lg },
  checkBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  hintBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 9, borderWidth: 1 },
  hintText: { flex: 1, fontSize: 13, lineHeight: 18 },

  // Explanation + next
  explanationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  explanationText: { flex: 1, fontSize: 13, lineHeight: 20 },
  nextBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: radius.lg, paddingVertical: 11, paddingHorizontal: 20, margin: spacing.lg, marginTop: 4, alignSelf: 'flex-end' },
  nextBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  resultScore: { fontSize: 64, fontWeight: '900', marginTop: 16 },
  resultLabel: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  resultMessage: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 8, maxWidth: 320 },
  topicBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, marginTop: 16 },
  topicBadgeText: { fontSize: 13, fontWeight: '700' },
  resultBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl, width: '100%' },
  retryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: radius.lg, paddingVertical: 14 },
  retryBtnText: { fontSize: 14, fontWeight: '700' },
  doneBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, paddingVertical: 14 },
  doneBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
