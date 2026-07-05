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
import Confetti from '../../components/common/Confetti';
import TrophyIcon from '../../components/common/TrophyIcon';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { computeCappedQuizMinutes } from '../../services/studyTime';

// Play a sound effect (web only)
function playSound(name: 'gold' | 'silver' | 'bronze') {
  if (Platform.OS !== 'web') return;
  try {
    const audio = new Audio(`${SERVER_URL}/sounds/${name}.wav`);
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch {}
}

type Question = {
  type:        'mcq' | 'fill_blank';
  question:    string;
  options:     string[];
  correct:     number | string; // index for mcq, string for fill_blank
  hint:        string;
  explanation: string;
};

type QuizPhase = 'loading' | 'quiz' | 'result';

// Landing palette — sage left panel for all subjects
const SUBJECT_ICON: Record<string, string> = {
  Mathematics: 'hash', Science: 'zap', English: 'book-open',
  Arts: 'feather', ICT: 'monitor',
};

export default function IBPYPQuizScreen({ navigation, route }: any) {
  const { topic, grade = 'Grade 3', subject = 'Mathematics', curriculum = 'IB PYP' } = route?.params ?? {};
  const { colors, isDark } = useTheme();
  const { user }           = useAuth();
  const { completeLesson, addXP, recordStudyTime } = useStudentData();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const accent = colors.accentYellow;    // gold — landing theme
  const gold   = colors.accentYellow;    // gold accent

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

  // Issue #121 — attempt tracking, time tracking, per-question results
  const [attemptNumber, setAttemptNumber] = useState(1);
  const perQuestionResultsRef = useRef<any[]>([]);
  const explanationsRef       = useRef<Record<number, string>>({});
  const quizStartTimeRef      = useRef(Date.now());
  const questionStartTimeRef  = useRef(Date.now());

  // Issue #106 — auto-loaded explanations in result screen
  const [resultExplanations, setResultExplanations] = useState<Record<number, string>>({});

  const scoreRef = useRef(score);
  scoreRef.current = score;

  // Auto-fetch explanations for all wrong answers when results load
  useEffect(() => {
    if (phase !== 'result') return;
    perQuestionResultsRef.current.forEach((r, i) => {
      if (r.isCorrect) return;
      if (explanationsRef.current[i]) return; // already have it
      fetch(`${SERVER_URL}/ibpyp/explain-wrong`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, subject, grade, question: r.question, wrongAnswer: r.studentAnswer, correctAnswer: r.correctAnswer }),
      })
        .then(res => res.json())
        .then(data => {
          const text = data.explanation || 'The correct answer is shown above.';
          explanationsRef.current[i] = text;
          setResultExplanations(prev => ({ ...prev, [i]: text }));
        })
        .catch(() => {
          setResultExplanations(prev => ({ ...prev, [i]: 'The correct answer is shown above.' }));
        });
    });
  }, [phase]);

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

  const fetchQuiz = useCallback(async (isRetake = false) => {
    setPhase('loading');
    setScore(0); setCurrentQ(0);
    resetQuestionState();
    perQuestionResultsRef.current = [];
    explanationsRef.current = {};
    setResultExplanations({});
    quizStartTimeRef.current = Date.now();
    questionStartTimeRef.current = Date.now();
    if (isRetake) setAttemptNumber(n => n + 1);
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
    const totalTimeSeconds = Math.round((Date.now() - quizStartTimeRef.current) / 1000);

    // Legacy analytics
    fetch(`${SERVER_URL}/ibpyp/track-result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: user?.email, role: user?.role, topic, subject, grade, score: pct, totalQuestions: questions.length, correctAnswers: finalScore, firstAttemptCorrect: finalScore, attemptNumber, perQuestionAttempts: [] }),
    }).catch(() => {});

    // Issue #121 — detailed attempt tracking
    if (user?.id) {
      fetch(`${SERVER_URL}/student/track-attempt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId:          user.id,
          topic, subject, grade, curriculum,
          totalQuestions:      questions.length,
          correctAnswers:      finalScore,
          score:               pct,
          timeSpentSeconds:    totalTimeSeconds,
          perQuestionResults:  perQuestionResultsRef.current,
          attemptNumber,
        }),
      }).catch(() => {});
    }

    if (pct >= 60) completeLesson(topic, subject, grade, curriculum);
    addXP(pct >= 80 ? 100 : pct >= 60 ? 60 : 30);

    // Quiz time is real learning time too — a student who skips straight to the
    // quiz (no lesson-reading session beforehand) was getting 0 study time
    // recorded even though they spent real minutes on it. Use the SUM of
    // per-question times (each capped), not raw quiz-start-to-now wall-clock
    // time — a question left open/backgrounded for hours must not leak that
    // idle gap into recorded study time.
    const quizMinutes = computeCappedQuizMinutes(perQuestionResultsRef.current);
    if (quizMinutes > 0) recordStudyTime(quizMinutes, 'learningPath', subject);

    // Sound effect based on score tier
    playSound(pct >= 80 ? 'gold' : pct >= 60 ? 'silver' : 'bronze');

    setScore(finalScore);
    setPhase('result');
  }

  function goNext(isCorrect: boolean) {
    const q = questions[currentQ];
    const qTimeSeconds = Math.round((Date.now() - questionStartTimeRef.current) / 1000);

    // Record per-question result
    const studentAnswer = q.type === 'fill_blank'
      ? fillInput.trim()
      : (mcqSelected != null ? q.options[mcqSelected] : '');
    const correctAnswer = q.type === 'fill_blank'
      ? String(q.correct)
      : q.options[q.correct as number];
    perQuestionResultsRef.current.push({
      question:      q.question,
      studentAnswer,
      correctAnswer,
      isCorrect,
      timeSeconds:   qTimeSeconds,
    });

    const newScore = scoreRef.current + (isCorrect ? 1 : 0);
    scoreRef.current = newScore;
    setScore(newScore);
    if (currentQ < questions.length - 1) {
      setCurrentQ(c => c + 1);
      resetQuestionState();
      questionStartTimeRef.current = Date.now();
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
    if (wasCorrect) {
      const text = q.explanation || 'Great job! That\'s correct!';
      setExplanation(text);
      explanationsRef.current[currentQ] = text;
      return;
    }
    setLoadingExplain(true);
    try {
      const res = await fetch(`${SERVER_URL}/ibpyp/explain-wrong`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, subject, grade, question: q.question, wrongAnswer: wrong, correctAnswer: correct }),
      });
      const data = await res.json();
      const text = data.explanation || q.explanation || 'The correct answer is highlighted above.';
      setExplanation(text);
      explanationsRef.current[currentQ] = text;
    } catch {
      const text = q.explanation || 'The correct answer is highlighted above. Keep going!';
      setExplanation(text);
      explanationsRef.current[currentQ] = text;
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
        const text = questions[currentQ].explanation || 'Excellent! That\'s correct!';
        setFillFeedback('correct');
        setExplanation(text);
        explanationsRef.current[currentQ] = text;
      } else {
        const attempts = fillAttempts + 1;
        setFillAttempts(attempts);
        if (attempts === 1)      setFillFeedback('wrong1');
        else if (attempts === 2) setFillFeedback('wrong2');
        else {
          setFillFeedback('revealed');
          const text = questions[currentQ].explanation || '';
          setExplanation(text);
          explanationsRef.current[currentQ] = text;
        }
      }
    } catch {
      setFillFeedback('correct'); // network error — give benefit of doubt
      const text = questions[currentQ].explanation || '';
      setExplanation(text);
      explanationsRef.current[currentQ] = text;
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
    const pct        = Math.round((score / questions.length) * 100);
    const passed     = pct >= 60;
    const totalTime  = Math.round((Date.now() - quizStartTimeRef.current) / 1000);
    const timeStr    = totalTime >= 60 ? `${Math.floor(totalTime / 60)}m ${totalTime % 60}s` : `${totalTime}s`;
    const scoreColor = pct >= 60 ? gold : '#C98A8A';
    const trophyTier: 'gold' | 'silver' | 'bronze' = pct >= 80 ? 'gold' : pct >= 60 ? 'silver' : 'bronze';
    const message    = pct === 100 ? 'Perfect score! Outstanding work!'
      : pct >= 80 ? 'Excellent! You really understand this topic!'
      : pct >= 60 ? 'Good job! A little more practice and you will master this!'
      : 'Keep going! Review what you missed below and try again.';

    const correctQs = perQuestionResultsRef.current.filter(r => r.isCorrect);
    const wrongQs   = perQuestionResultsRef.current.map((r, i) => ({ ...r, idx: i })).filter(r => !r.isCorrect);

    return (
      <ScreenLayout>
        <View style={styles.screen}>
          <Header title="Practice Results" showBack onBack={() => navigation.navigate('SubjectTopics', { subject, grade, curriculum })} onMenuPress={() => navigation.openDrawer()} />
          <ScrollView contentContainerStyle={[styles.scrollContent]} showsVerticalScrollIndicator={false}>
          <View style={[styles.content, { alignItems: 'center', paddingTop: 32 }]}>

            {/* ── Score hero ── */}
            {passed && <Confetti trigger />}
            <TrophyIcon size={96} tier={trophyTier} />
            <Text style={[styles.resultScore, { color: scoreColor, marginTop: 12 }]}>{pct}%</Text>
            <Text style={[styles.resultLabel, { color: colors.textMain }]}>{score} / {questions.length} correct</Text>
            <Text style={[styles.resultMessage, { color: colors.textMuted }]}>{message}</Text>

            {/* badges */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              <View style={[styles.topicBadge, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
                <Text style={[styles.topicBadgeText, { color: accent }]}>{topic}</Text>
              </View>
              <View style={[styles.topicBadge, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
                <Feather name="clock" size={11} color={colors.textMuted} />
                <Text style={[styles.topicBadgeText, { color: colors.textMuted }]}> {timeStr}</Text>
              </View>
              {attemptNumber > 1 && (
                <View style={[styles.topicBadge, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
                  <Text style={[styles.topicBadgeText, { color: colors.textMuted }]}>Attempt #{attemptNumber}</Text>
                </View>
              )}
            </View>

            {/* action buttons */}
            <View style={styles.resultBtns}>
              <TouchableOpacity
                style={[styles.retryBtn, { borderColor: !passed ? '#C98A8A' : accent, backgroundColor: !passed ? '#C98A8A14' : accent + '14' }]}
                onPress={() => fetchQuiz(true)} activeOpacity={0.8}
              >
                <Feather name="refresh-cw" size={16} color={!passed ? '#C98A8A' : accent} />
                <Text style={[styles.retryBtnText, { color: !passed ? '#C98A8A' : accent }]}>
                  {!passed ? 'Retake (New Questions)' : 'Try Again'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── What you got RIGHT ── */}
            {correctQs.length > 0 && (
              <View style={styles.reviewSection}>
                <View style={styles.reviewSectionHeader}>
                  <View style={[styles.reviewSectionIcon, { backgroundColor: '#9FB2A420' }]}>
                    <Feather name="check-circle" size={16} color="#9FB2A4" />
                  </View>
                  <Text style={[styles.reviewSectionTitle, { color: '#9FB2A4' }]}>
                    Questions You Got Right ({correctQs.length})
                  </Text>
                </View>
                {correctQs.map((r, i) => (
                  <View key={i} style={[styles.reviewCard, {
                    backgroundColor: colors.cardDark,
                    borderColor: '#9FB2A430',
                    borderLeftColor: '#9FB2A4',
                  }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#9FB2A420', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                        <Feather name="check" size={13} color="#9FB2A4" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textMain, lineHeight: 22 }}>{r.question}</Text>
                        <View style={[styles.reviewAnswerRow, { backgroundColor: colors.bgDark, borderRadius: 8, marginTop: 10 }]}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: '#9FB2A4', width: 90, letterSpacing: 0.3 }}>Your answer</Text>
                          <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: '#9FB2A4' }}>{r.studentAnswer}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* ── What you got WRONG ── */}
            {wrongQs.length > 0 && (
              <View style={styles.reviewSection}>
                <View style={styles.reviewSectionHeader}>
                  <View style={[styles.reviewSectionIcon, { backgroundColor: '#C5BD9620' }]}>
                    <Feather name="x-circle" size={16} color="#C5BD96" />
                  </View>
                  <Text style={[styles.reviewSectionTitle, { color: '#C5BD96' }]}>
                    Questions You Got Wrong ({wrongQs.length})
                  </Text>
                </View>
                {wrongQs.map((r) => {
                  const expl = resultExplanations[r.idx] || explanationsRef.current[r.idx];
                  return (
                    <View key={r.idx} style={[styles.reviewCard, {
                      backgroundColor: colors.cardDark,
                      borderColor: '#C5BD9630',
                      borderLeftColor: '#C5BD96',
                    }]}>
                      {/* question */}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#C5BD9620', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                          <Feather name="x" size={13} color="#C5BD96" />
                        </View>
                        <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.textMain, lineHeight: 22 }}>{r.question}</Text>
                      </View>

                      {/* your answer vs correct answer */}
                      <View style={{ gap: 7, marginBottom: 14, marginLeft: 36 }}>
                        <View style={[styles.reviewAnswerRow, { backgroundColor: colors.bgDark, borderRadius: 8 }]}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: '#C9A24E', width: 100, letterSpacing: 0.3 }}>Your answer</Text>
                          <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: '#C9A24E' }}>{r.studentAnswer || '—'}</Text>
                        </View>
                        <View style={[styles.reviewAnswerRow, { backgroundColor: colors.bgDark, borderRadius: 8 }]}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: '#C5BD96', width: 100, letterSpacing: 0.3 }}>Correct answer</Text>
                          <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: '#C5BD96' }}>{r.correctAnswer}</Text>
                        </View>
                      </View>

                      {/* Aivorah explanation */}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, backgroundColor: isDark ? '#171612' : '#F8F6ED', borderWidth: 1, borderColor: '#C5BD9625' }}>
                        {expl ? (
                          <>
                            <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: '#C5BD9620', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Feather name="book-open" size={12} color="#C5BD96" />
                            </View>
                            <Text style={{ flex: 1, fontSize: 13, color: colors.textMain, lineHeight: 21 }}>
                              <Text style={{ fontWeight: '800', color: '#C5BD96' }}>Aivorah: </Text>{expl}
                            </Text>
                          </>
                        ) : (
                          <>
                            <ActivityIndicator size="small" color="#C5BD96" />
                            <Text style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>Aivorah is preparing your explanation…</Text>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

          </View>
          </ScrollView>
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
        <Header title={`${subject} Practice`} subtitle={topic} showBack onBack={() => navigation.navigate('SubjectTopics', { subject, grade, curriculum })} onMenuPress={() => navigation.openDrawer()} />
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.twoPanel}>

          {/* ── LEFT PANEL: subject + progress ── */}
          <View style={[styles.leftPanel, { backgroundColor: colors.cardDark, borderRightWidth: 1, borderRightColor: colors.borderColor }]}>
            <View style={styles.leftTop}>
              <View style={[styles.subjectIcon, { backgroundColor: accent + '20', borderWidth: 1, borderColor: accent + '40' }]}>
                <Feather name={(SUBJECT_ICON[subject] || 'globe') as any} size={22} color={accent} />
              </View>
              <Text style={[styles.leftSubject, { color: accent }]}>{subject}</Text>
              <Text style={[styles.leftTopic, { color: colors.textMain }]} numberOfLines={3}>{topic}</Text>
            </View>

            {/* Step dots */}
            <View style={styles.stepDots}>
              {questions.map((_, i) => (
                <View key={i} style={[styles.stepDot, {
                  backgroundColor: i < currentQ ? accent : i === currentQ ? accent : colors.borderColor,
                  opacity: i < currentQ ? 0.9 : i === currentQ ? 1 : 0.35,
                  width: i === currentQ ? 22 : 8,
                }]} />
              ))}
            </View>

            <View style={styles.leftBottom}>
              <Text style={[styles.leftCounter, { color: colors.textMain }]}>{currentQ + 1}</Text>
              <Text style={[styles.leftOf, { color: colors.textMuted }]}>of {questions.length}</Text>
              <View style={[styles.leftTypeBadge, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
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
                const showResult = mcqDone;

                let radioFill   = 'transparent';
                let radioBorder = isDark ? '#555' : '#B8CCCA';
                let textCol     = colors.textMain;
                let rowBg       = 'transparent';
                let leftBorder  = 'transparent';
                let resultIcon: 'check-circle' | 'x-circle' | null = null;

                const CORRECT = accent;       // gold for correct
                const WRONG   = '#C98A8A';    // warm amber-red for wrong
                if (showResult) {
                  if (isCorrect)       { radioFill = CORRECT; radioBorder = CORRECT; textCol = CORRECT; rowBg = accent + '12'; leftBorder = CORRECT; resultIcon = 'check-circle'; }
                  else if (isSelected) { radioFill = WRONG; radioBorder = WRONG; textCol = WRONG; rowBg = isDark ? '#C98A8A12' : '#FFF6F0'; leftBorder = WRONG; resultIcon = 'x-circle'; }
                  else                 { radioBorder = isDark ? '#333' : '#DDD'; textCol = isDark ? '#444' : '#CCC'; }
                } else if (mcqSelected === i) {
                  radioFill = accent; radioBorder = accent; textCol = accent;
                  rowBg = accent + '14'; leftBorder = accent;
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
                    <Text style={[styles.optionLetter, { color: showResult ? (isCorrect ? CORRECT : isSelected ? WRONG : isDark ? '#444' : '#DDD') : (mcqSelected === i ? accent : colors.textMuted) }]}>{LETTERS[i]}</Text>
                    <Text style={[styles.optionText, { color: textCol }]}>{opt}</Text>
                    {resultIcon && <Feather name={resultIcon} size={14} color={resultIcon === 'check-circle' ? CORRECT : WRONG} style={{ marginLeft: 'auto' as any }} />}
                  </TouchableOpacity>
                );
              })}

              {/* Hint row inside card */}
              {showMcqHint && !mcqDone && (
                <View style={[styles.hintBanner, { backgroundColor: accent + '10', borderColor: accent + '40' }]}>
                  <Feather name="zap" size={12} color="#fff" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hintBannerLabel}>Aivorah's Hint</Text>
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
                <View style={[styles.fillResultRow, { backgroundColor: accent + '12', borderColor: accent + '40' }]}>
                  <Feather name="check-circle" size={14} color={accent} />
                  <Text style={[styles.fillCorrectText, { color: accent }]}>{fillInput}</Text>
                </View>
              ) : fillFeedback === 'revealed' ? (
                <View style={[styles.fillResultRow, { backgroundColor: accent + '12', borderColor: accent + '40' }]}>
                  <Feather name="info" size={14} color={accent} />
                  <Text style={[styles.fillCorrectText, { color: accent }]}>Answer: {q.correct as string}</Text>
                </View>
              ) : (
                <>
                  <TextInput
                    style={[styles.fillInput, { borderColor: fillFeedback !== 'idle' ? accent + '70' : accent + '50', color: colors.textMain, backgroundColor: isDark ? colors.bgDark : '#F8FAFA' }]}
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
                      <Feather name="alert-circle" size={12} color={accent} />
                      <Text style={[styles.nudgeText, { color: accent }]}>Not quite — give it another try!</Text>
                    </View>
                  )}
                  {fillFeedback === 'wrong2' && (
                    <View style={[styles.hintBanner, { backgroundColor: accent + '10', borderColor: accent + '40' }]}>
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
                      color={accent} />
                    <Text style={[styles.explanationText, { color: isDark ? colors.textMuted : '#666' }]}>
                      <Text style={{ fontWeight: '700', color: accent }}>
                        {(mcqCorrect || fillFeedback === 'correct') ? 'Well done! ' : 'Aivorah: '}
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
  content:      { width: '100%', maxWidth: 480 },
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
  leftSubject: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  leftTopic:   { fontSize: 16, fontWeight: '800', lineHeight: 22 },
  stepDots:    { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  stepDot:     { height: 8, borderRadius: 4 },
  leftBottom:  { gap: 6 },
  leftCounter: { fontSize: 42, fontWeight: '900', lineHeight: 46 },
  leftOf:      { fontSize: 13, fontWeight: '600', marginTop: -6 },
  leftTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', marginTop: 4 },
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

  failBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, marginTop: 12 },
  failBannerText: { fontSize: 13, fontWeight: '700', color: '#C98A8A' },
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

  // Answer review
  reviewSection: { width: '100%', marginTop: 28 },
  reviewSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  reviewSectionIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  reviewSectionTitle: { fontSize: 15, fontWeight: '800' },
  reviewCard: { width: '100%', borderWidth: 1, borderLeftWidth: 3, borderRadius: radius.lg, padding: 14, marginBottom: 10 },
  reviewQNum: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  reviewAnswerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8 },
  reviewExplRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 12, borderTopWidth: 1 },
});
