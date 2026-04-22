/**
 * IBPYPQuizScreen.tsx
 * Practice test for any IB PYP topic — Grades 3, 4, 5
 * - Generates 5 MCQ questions via Groq (/ibpyp/quiz)
 * - Wrong answer → AI explanation (/ibpyp/explain-wrong) → retry
 * - Tracks result to analytics (/ibpyp/track-result)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

type Question = {
  question:    string;
  options:     string[];
  correct:     number;
  explanation: string;
};

type QuizPhase = 'loading' | 'quiz' | 'explanation' | 'result';

// Subject accent colors
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
  const { topic, grade = 'Grade 3', subject = 'Mathematics' } = route?.params ?? {};
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const accent = SUBJECT_COLOR[subject] || colors.primary;

  const [phase, setPhase]                   = useState<QuizPhase>('loading');
  const [questions, setQuestions]           = useState<Question[]>([]);
  const [currentQ, setCurrentQ]             = useState(0);
  const [selectedOpt, setSelectedOpt]       = useState<number | null>(null);
  const [answers, setAnswers]               = useState<(number | null)[]>([]);
  const [explanation, setExplanation]       = useState('');
  const [loadingExplain, setLoadingExplain] = useState(false);
  const [score, setScore]                   = useState(0);

  const fetchQuiz = useCallback(async () => {
    setPhase('loading');
    // Reset all quiz state so retries always start fresh
    setScore(0);
    setCurrentQ(0);
    setSelectedOpt(null);
    setExplanation('');
    try {
      const res = await fetch(`${SERVER_URL}/ibpyp/quiz`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topic, grade, subject, userEmail: user?.email, role: user?.role }),
      });
      const data = await res.json();
      if (!data.questions || data.questions.length === 0) throw new Error('No questions returned');
      setQuestions(data.questions);
      setAnswers(new Array(data.questions.length).fill(null));
      setPhase('quiz');
    } catch (err) {
      Alert.alert('Error', 'Could not generate quiz. Please check your connection and try again.');
      navigation.goBack();
    }
  }, [topic, grade, subject, user?.email]);

  useEffect(() => { fetchQuiz(); }, [fetchQuiz]);

  async function handleAnswer(optIdx: number) {
    if (selectedOpt !== null) return; // already answered
    setSelectedOpt(optIdx);

    const q = questions[currentQ];
    const isCorrect = optIdx === q.correct;

    const newAnswers = [...answers];
    newAnswers[currentQ] = optIdx;
    setAnswers(newAnswers);

    if (!isCorrect) {
      // Fetch AI explanation for wrong answer
      setLoadingExplain(true);
      setPhase('explanation');
      try {
        const res = await fetch(`${SERVER_URL}/ibpyp/explain-wrong`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            topic, subject, grade,
            question:     q.question,
            wrongAnswer:  q.options[optIdx],
            correctAnswer: q.options[q.correct],
          }),
        });
        const data = await res.json();
        setExplanation(data.explanation || 'The correct answer is highlighted above.');
      } catch {
        setExplanation('The correct answer is highlighted above. Keep going — you are doing great!');
      } finally {
        setLoadingExplain(false);
      }
    }
  }

  function nextQuestion() {
    const q = questions[currentQ];
    const isCorrect = selectedOpt === q.correct;
    // Compute directly to avoid stale `score` closure on the last question
    const newScore = score + (isCorrect ? 1 : 0);

    if (currentQ < questions.length - 1) {
      setScore(newScore);
      setCurrentQ(q => q + 1);
      setSelectedOpt(null);
      setExplanation('');
      setPhase('quiz');
    } else {
      const finalScore = newScore;
      const finalPct   = Math.round((finalScore / questions.length) * 100);
      setScore(finalScore);

      // Track result
      fetch(`${SERVER_URL}/ibpyp/track-result`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          userEmail:      user?.email,
          role:           user?.role,
          topic, subject, grade,
          score:          finalPct,
          totalQuestions: questions.length,
          correctAnswers: finalScore,
        }),
      }).catch(() => {});

      setPhase('result');
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <ScreenLayout>
        <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Preparing your practice test…
          </Text>
        </View>
      </ScreenLayout>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────────
  if (phase === 'result') {
    const pct      = Math.round((score / questions.length) * 100);
    const isGood   = pct >= 70;
    const emoji    = pct === 100 ? '🏆' : pct >= 80 ? '🌟' : pct >= 60 ? '👍' : '💪';
    const message  = pct === 100
      ? 'Perfect score! Outstanding work!'
      : pct >= 80 ? 'Excellent! You really understand this topic!'
      : pct >= 60 ? 'Good job! A little more practice and you will master this!'
      : 'Keep practising — every attempt makes you stronger!';

    return (
      <ScreenLayout>
        <View style={styles.screen}>
          <Header title="Quiz Results" onMenuPress={() => navigation.goBack()} />
          <ScrollView contentContainerStyle={[styles.content, { alignItems: 'center', paddingTop: 40 }]}>
            <Text style={{ fontSize: 64 }}>{emoji}</Text>
            <Text style={[styles.resultScore, { color: isGood ? '#4A9E70' : accent }]}>{pct}%</Text>
            <Text style={[styles.resultLabel, { color: colors.textMain }]}>
              {score} / {questions.length} correct
            </Text>
            <Text style={[styles.resultMessage, { color: colors.textMuted }]}>{message}</Text>

            <View style={[styles.topicBadge, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
              <Text style={[styles.topicBadgeText, { color: accent }]}>{topic}</Text>
            </View>

            <View style={styles.resultBtns}>
              <TouchableOpacity
                style={[styles.retryBtn, { borderColor: accent, backgroundColor: accent + '14' }]}
                onPress={fetchQuiz}
                activeOpacity={0.8}
              >
                <Feather name="refresh-cw" size={16} color={accent} />
                <Text style={[styles.retryBtnText, { color: accent }]}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.doneBtn, { backgroundColor: accent }]}
                onPress={() => navigation.goBack()}
                activeOpacity={0.8}
              >
                <Text style={styles.doneBtnText}>Back to Topics</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </ScreenLayout>
    );
  }

  // ── Quiz / Explanation ─────────────────────────────────────────────────────
  const q = questions[currentQ];
  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title={`${subject} Practice`}
          subtitle={topic}
          onMenuPress={() => navigation.goBack()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Progress */}
          <View style={styles.progressRow}>
            <Text style={[styles.progressText, { color: colors.textMuted }]}>
              Question {currentQ + 1} of {questions.length}
            </Text>
            <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
              <View style={[styles.progressFill, { width: `${((currentQ + 1) / questions.length) * 100}%`, backgroundColor: accent }]} />
            </View>
          </View>

          {/* Question Card */}
          <View style={[styles.questionCard, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
            <View style={[styles.questionBadge, { backgroundColor: accent + '18' }]}>
              <Text style={[styles.questionBadgeText, { color: accent }]}>Q{currentQ + 1}</Text>
            </View>
            <Text style={[styles.questionText, { color: colors.textMain }]}>{q.question}</Text>
          </View>

          {/* Options */}
          <View style={styles.optionsGrid}>
            {q.options.map((opt, i) => {
              const isSelected = selectedOpt === i;
              const isCorrect  = q.correct === i;
              const showResult = selectedOpt !== null;

              let bgColor = colors.cardDark;
              let borderColor = colors.borderColor;
              let textColor = colors.textMain;

              if (showResult) {
                if (isCorrect) {
                  bgColor = '#4A9E7018'; borderColor = '#4A9E70'; textColor = '#4A9E70';
                } else if (isSelected && !isCorrect) {
                  bgColor = '#C8487018'; borderColor = '#C84870'; textColor = '#C84870';
                }
              } else if (isSelected) {
                bgColor = accent + '18'; borderColor = accent; textColor = accent;
              }

              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.optionBtn, { backgroundColor: bgColor, borderColor }]}
                  onPress={() => handleAnswer(i)}
                  activeOpacity={selectedOpt !== null ? 1 : 0.8}
                  disabled={selectedOpt !== null}
                >
                  <View style={[styles.optionLetter, { backgroundColor: borderColor + '30' }]}>
                    <Text style={[styles.optionLetterText, { color: borderColor }]}>
                      {['A', 'B', 'C', 'D'][i]}
                    </Text>
                  </View>
                  <Text style={[styles.optionText, { color: textColor }]}>{opt}</Text>
                  {showResult && isCorrect && <Feather name="check-circle" size={16} color="#4A9E70" />}
                  {showResult && isSelected && !isCorrect && <Feather name="x-circle" size={16} color="#C84870" />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Explanation (after wrong answer) */}
          {phase === 'explanation' && (
            <View style={[styles.explanationCard, { backgroundColor: '#FFF8EC', borderColor: '#F0C858' }]}>
              {loadingExplain ? (
                <ActivityIndicator color="#C87848" size="small" />
              ) : (
                <>
                  <View style={styles.explanationHeader}>
                    <Feather name="info" size={16} color="#C87848" />
                    <Text style={[styles.explanationTitle, { color: '#C87848' }]}>Ms. Zara explains</Text>
                  </View>
                  <Text style={styles.explanationText}>{explanation}</Text>
                </>
              )}
            </View>
          )}

          {/* Next button — visible after any answer */}
          {selectedOpt !== null && !loadingExplain && (
            <TouchableOpacity
              style={[styles.nextBtn, { backgroundColor: accent }]}
              onPress={nextQuestion}
              activeOpacity={0.85}
            >
              <Text style={styles.nextBtnText}>
                {currentQ < questions.length - 1 ? 'Next Question' : 'See Results'}
              </Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:    { flex: 1, backgroundColor: c.bgDark },
  content:   { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },
  loadingText: { marginTop: 16, fontSize: 14, textAlign: 'center' },

  progressRow:  { gap: 8 },
  progressText: { fontSize: 12, fontWeight: '600' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },

  questionCard: {
    borderWidth: 1, borderRadius: radius.xl,
    padding: spacing.xl, gap: spacing.md,
  },
  questionBadge:     { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  questionBadgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  questionText:      { fontSize: 17, fontWeight: '700', lineHeight: 26 },

  optionsGrid: { gap: spacing.md },
  optionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.lg,
  },
  optionLetter: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  optionLetterText: { fontSize: 13, fontWeight: '800' },
  optionText:       { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },

  explanationCard: {
    borderWidth: 1.5, borderRadius: radius.xl,
    padding: spacing.xl, gap: spacing.md,
  },
  explanationHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  explanationTitle:  { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  explanationText:   { fontSize: 14, lineHeight: 22, color: '#6A4A20' },

  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.md, borderRadius: radius.lg, paddingVertical: 16,
  },
  nextBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },

  // Results
  resultScore:   { fontSize: 64, fontWeight: '900', marginTop: 16 },
  resultLabel:   { fontSize: 18, fontWeight: '700', marginTop: 4 },
  resultMessage: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 8, maxWidth: 320 },
  topicBadge:    { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, marginTop: 16 },
  topicBadgeText:{ fontSize: 13, fontWeight: '700' },
  resultBtns:    { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl, width: '100%' },
  retryBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: radius.lg, paddingVertical: 14 },
  retryBtnText:  { fontSize: 14, fontWeight: '700' },
  doneBtn:       { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, paddingVertical: 14 },
  doneBtnText:   { fontSize: 14, fontWeight: '700', color: '#fff' },
});
