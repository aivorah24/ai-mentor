import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, RefreshControl, Image, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

const TABS = ['Available', 'Assigned', 'Completed'];

// imageUrl is served directly from server (cloudinary_urls.json) — no URL construction needed

const DIFF_COLORS: Record<string, string> = {
  Easy:   '#10b981',
  Medium: '#f59e0b',
  Hard:   '#ef4444',
};

const CAT_COLORS: Record<string, string> = {
  'Chapter Quiz':    '#BAA467',
  'School Challenge':'#f59e0b',
};

interface Challenge {
  id: string;
  title: string;
  description: string;
  grade: string;
  curriculum: string;
  subject: string;
  chapterId: number | null;
  topic: string;
  difficulty: string;
  xpReward: number;
  questionCount: number;
  timeLimitMinutes: number;
  type: string;
  category: string;
  imageUrl: string | null;
  // annotated by server
  assignmentId: string | null;
  status: 'available' | 'assigned' | 'completed';
  score: number | null;
  xpAwarded: number | null;
  dueDate: string | null;
  assignedByRole: string | null;
}

interface Question {
  question: string;
  options: string[];
  answer: string;
  type?: 'mcq' | 'fill_blank' | 'open_ended';
  acceptAnswers?: string[] | null;
}

export default function ChallengesScreen({ navigation, route }: any) {
  const highlightId = route?.params?.highlightId;
  const initialTab = route?.params?.tab;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { stats, studentId, addXP, recordStudyTime } = useStudentData();
  // Time actually spent attempting a challenge quiz — counted as real "Study Time",
  // same pattern as TopicLessonScreen (flush whole minutes, not "screen was open").
  const challengeSessionStartRef = React.useRef<number>(0);
  const trackedChallengeMinutesRef = React.useRef(0);
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState(initialTab === 'assigned' ? 'Assigned' : 'Available');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);

  // Switch to Assigned tab when navigated with tab param
  useEffect(() => {
    if (initialTab === 'assigned') setActiveTab('Assigned');
  }, [initialTab]);
  const [refreshing, setRefreshing] = useState(false);

  // Quiz modal state
  const [quizVisible, setQuizVisible] = useState(false);
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<(string | null)[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizResult, setQuizResult] = useState<{ score: number; xpAwarded: number } | null>(null);

  // Timer state
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Challenge leaderboard state
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [leaderLoading, setLeaderLoading] = useState(false);

  const grade = user?.grade || 'Grade 3';

  const fetchChallenges = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const curriculum = user?.curriculum || 'IB PYP';
      const url = `${SERVER_URL}/challenges?grade=${encodeURIComponent(grade)}&curriculum=${encodeURIComponent(curriculum)}${studentId ? `&studentId=${studentId}` : ''}`;
      const [res, assignedRes] = await Promise.all([
        fetch(url),
        studentId ? fetch(`${SERVER_URL}/challenges/assigned?studentId=${studentId}`) : Promise.resolve(null),
      ]);
      if (res.ok) {
        const data: Challenge[] = await res.json();
        if (Array.isArray(data)) {
          // Merge parent-assigned challenges from other grades that won't appear in grade-filtered list
          let merged = [...data];
          if (assignedRes?.ok) {
            const assigned: Challenge[] = await assignedRes.json();
            for (const a of assigned) {
              if (!merged.find(c => c.id === a.id)) {
                merged.push({ ...a });
              }
            }
          }
          setChallenges(merged);
        }
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [grade, studentId]);

  useEffect(() => {
    fetchChallenges();
    const interval = setInterval(() => fetchChallenges(), 30 * 1000);
    return () => clearInterval(interval);
  }, [fetchChallenges]);

  useFocusEffect(useCallback(() => { fetchChallenges(); }, [fetchChallenges]));

  // Deep-link open: when arriving from a notification or the Schedule (both pass
  // highlightId), open the matching challenge the instant it's available — opens
  // immediately if the list is already loaded (no flash), otherwise as soon as it
  // arrives. Clearing the param prevents reopening on refocus.
  useEffect(() => {
    if (!highlightId) return;
    const target = challenges.find(c =>
      c.id === highlightId || (c as any).assignmentId === highlightId
    );
    if (target) {
      // startChallenge opens the quiz modal (sets quizVisible). Just setting
      // activeChallenge doesn't show anything — the modal is gated on quizVisible.
      startChallenge(target);
      navigation.setParams?.({ highlightId: undefined });
    }
  }, [highlightId, challenges]);

  const filtered = useMemo(() => {
    if (activeTab === 'Available')  return challenges.filter(c => c.status === 'available');
    if (activeTab === 'Assigned')   return challenges.filter(c => c.status === 'assigned');
    if (activeTab === 'Completed')  return challenges.filter(c => c.status === 'completed');
    return challenges;
  }, [challenges, activeTab]);

  const counts = useMemo(() => ({
    available:  challenges.filter(c => c.status === 'available').length,
    assigned:   challenges.filter(c => c.status === 'assigned').length,
    completed:  challenges.filter(c => c.status === 'completed').length,
  }), [challenges]);

  function flushChallengeStudyTime() {
    if (!challengeSessionStartRef.current) return;
    const elapsedWholeMinutes = Math.floor((Date.now() - challengeSessionStartRef.current) / 60000);
    const delta = elapsedWholeMinutes - trackedChallengeMinutesRef.current;
    if (delta > 0) {
      recordStudyTime(delta, 'challenge');
      trackedChallengeMinutesRef.current += delta;
    }
  }

  async function startChallenge(ch: Challenge) {
    setActiveChallenge(ch);
    setQuizResult(null);
    setAnswers([]);
    setQuizLoading(true);
    setQuizVisible(true);
    challengeSessionStartRef.current = Date.now();
    trackedChallengeMinutesRef.current = 0;

    try {
      // Auto-assign if not yet assigned
      let assignmentId = ch.assignmentId;
      if (!assignmentId && studentId) {
        const assignRes = await fetch(`${SERVER_URL}/challenges/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeId: ch.id,
            studentId,
            assignedById: user?.email,
            assignedByRole: 'student',
          }),
        });
        if (assignRes.ok) {
          const asgn = await assignRes.json();
          assignmentId = asgn.id;
          setActiveChallenge(prev => prev ? { ...prev, assignmentId: asgn.id } : prev);
        }
      }

      // Fetch quiz questions
      const qRes = await fetch(`${SERVER_URL}/ncert/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: ch.topic,
          count: ch.questionCount,
          grade: ch.grade || grade,
          subject: ch.subject || 'Mathematics',
          difficulty: ch.difficulty || 'Easy',
          challengeType: ch.type || '',
          challengeId: ch.id || '',
        }),
      });
      if (qRes.ok) {
        const data = await qRes.json();
        const qs: Question[] = (Array.isArray(data.questions) ? data.questions : []).map((q: any) => ({
          ...q,
          options: q.options ?? [],
          // server returns `correct` as index (0-3); map to the option string for comparison
          answer: q.options?.[q.correct] ?? q.answer ?? '',
          type: q.type || 'mcq',
          acceptAnswers: q.acceptAnswers ?? null,
        }));
        setQuestions(qs);
        setAnswers(new Array(qs.length).fill(null));
        // Start countdown timer
        if (ch.timeLimitMinutes && ch.timeLimitMinutes > 0) {
          const secs = ch.timeLimitMinutes * 60;
          setTimeLeft(secs);
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
              if (prev === null || prev <= 1) {
                clearInterval(timerRef.current!);
                timerRef.current = null;
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        }
      }
    } catch {}
    setQuizLoading(false);
  }

  // Auto-submit when timer expires
  React.useEffect(() => {
    if (timeLeft === 0 && !quizResult && !quizLoading && questions.length > 0) {
      submitQuiz();
    }
  }, [timeLeft]);

  // Cleanup timer on unmount or quiz close
  React.useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Score a single question: mcq compares to the correct option,
  // fill_blank checks the typed text against any accepted answer (case/space-insensitive),
  // open_ended has no wrong answer — any non-empty response earns credit.
  function isQuestionCorrect(q: Question, given: string | null): boolean {
    if (given === null) return false;
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    if (q.type === 'fill_blank') {
      const accepted = (q.acceptAnswers && q.acceptAnswers.length > 0) ? q.acceptAnswers : [q.answer];
      return accepted.some(a => norm(a) === norm(given));
    }
    if (q.type === 'open_ended') {
      return given.trim().length > 0;
    }
    return given === q.answer;
  }

  async function submitQuiz() {
    if (!activeChallenge?.assignmentId) return;
    const correct = questions.filter((q, i) => isQuestionCorrect(q, answers[i])).length;
    const score = Math.round((correct / questions.length) * 100);
    setQuizSubmitting(true);
    try {
      const res = await fetch(`${SERVER_URL}/challenges/${activeChallenge.assignmentId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, score }),
      });
      if (res.ok) {
        const data = await res.json();
        setQuizResult({ score: data.score, xpAwarded: data.xpAwarded });
        if (data.xpAwarded) addXP(data.xpAwarded);
        setChallenges(prev => prev.map(c =>
          c.id === activeChallenge.id
            ? { ...c, status: 'completed', score: data.score, xpAwarded: data.xpAwarded }
            : c
        ));
        // Fetch challenge leaderboard
        setLeaderLoading(true);
        try {
          const lb = await fetch(`${SERVER_URL}/challenges/leaderboard?grade=${encodeURIComponent(grade)}&limit=20`).then(r => r.json());
          const rows = lb.leaderboard ?? lb; // backward compat
          if (Array.isArray(rows)) setLeaderboard(rows);
        } catch { /* ignore */ } finally { setLeaderLoading(false); }
      }
    } catch {}
    setQuizSubmitting(false);
  }

  function closeQuiz() {
    flushChallengeStudyTime();
    challengeSessionStartRef.current = 0;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setTimeLeft(null);
    setQuizVisible(false);
    setActiveChallenge(null);
    setQuestions([]);
    setAnswers([]);
    setQuizResult(null);
  }

  // Flush on submit too (closeQuiz isn't always called right after — the result
  // screen can stay open a while before the student dismisses it).
  useEffect(() => {
    if (quizResult) flushChallengeStudyTime();
  }, [quizResult]);

  // Safety net: flush if the component unmounts while a challenge is still active
  // (e.g. student navigates away without tapping close).
  useEffect(() => () => flushChallengeStudyTime(), []);

  const allAnswered = answers.length > 0 && answers.every(a => a !== null && a.trim().length > 0);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Challenges" onMenuPress={() => navigation.openDrawer()} />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchChallenges(true)} tintColor={colors.accentYellow} />}
        >
          {/* Stats row */}
          <View style={styles.statsRow}>
            {[
              { label: 'Total XP',    value: stats.xpPoints.toLocaleString(),            icon: 'star' as const,         color: colors.accentYellow },
              { label: 'Challenges',  value: String(stats.challengesCompleted),           icon: 'award' as const,        color: colors.accentGreen },
              { label: 'Topics Done', value: String(stats.completedTopics?.length ?? 0), icon: 'book-open' as const,    color: colors.accentYellow },
              { label: 'Streak',      value: `${stats.currentStreak}d`,                  icon: 'zap' as const,          color: colors.accentRed },
            ].map(s => (
              <View key={s.label} style={styles.statCard}>
                <Feather name={s.icon} size={14} color={s.color} />
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Leaderboard CTA */}
          <TouchableOpacity
            style={[styles.leaderCTA, { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '0C' }]}
            onPress={() => navigation.navigate('Leaderboard')}
            activeOpacity={0.8}
          >
            <Feather name="award" size={16} color={colors.accentYellow} />
            <Text style={[styles.leaderCTAText, { color: colors.accentYellow }]}>Live Class Leaderboard</Text>
            <Feather name="chevron-right" size={16} color={colors.accentYellow} />
          </TouchableOpacity>

          {/* Tabs */}
          <View style={styles.tabRow}>
            {TABS.map(tab => {
              const count = tab === 'Available' ? counts.available : tab === 'Assigned' ? counts.assigned : counts.completed;
              return (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, activeTab === tab && styles.tabActive]}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
                  {count > 0 && (
                    <View style={[styles.tabBadge, { backgroundColor: activeTab === tab ? 'rgba(255,255,255,0.25)' : colors.borderColor }]}>
                      <Text style={[styles.tabBadgeText, { color: activeTab === tab ? 'white' : colors.textDim }]}>{count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Challenge list */}
          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="target" size={36} color={colors.textDim} />
              <Text style={styles.emptyTitle}>
                {activeTab === 'Assigned' ? 'No assigned challenges yet' :
                 activeTab === 'Completed' ? 'No completed challenges yet' :
                 'No challenges available'}
              </Text>
              <Text style={styles.emptyText}>
                {activeTab === 'Assigned' ? 'Ask your teacher or parent to assign a challenge' : 'Pull down to refresh'}
              </Text>
            </View>
          ) : (
            <View style={styles.grid}>
            {filtered.map(ch => {
              const diffColor = DIFF_COLORS[ch.difficulty] ?? colors.accentYellow;
              const catColor  = CAT_COLORS[ch.category]   ?? colors.accentYellow;
              const rawImg = (ch as any).thumbnailUrl ?? ch.imageUrl ?? null;
              const imgUrl = rawImg ? (rawImg.startsWith('http') ? rawImg : `${SERVER_URL}${rawImg}`) : null;
              return (
                <View key={ch.id} style={styles.challengeCard}>
                  {/* Full-height image with title + badges overlaid */}
                  <View style={styles.cardImageWrap}>
                    {imgUrl ? (
                      <Image source={{ uri: imgUrl }} style={styles.cardImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.cardImage, { backgroundColor: diffColor + '33' }]} />
                    )}
                    <View style={styles.cardScrim} />
                    {/* Difficulty pill — top right */}
                    <View style={[styles.diffPill, { backgroundColor: diffColor }]}>
                      <Text style={styles.diffPillText}>{ch.difficulty}</Text>
                    </View>
                    {/* Ranking band badge — top left, only for completed */}
                    {ch.status === 'completed' && ch.score != null && (() => {
                      const s = ch.score!;
                      let cfg: { label: string; emoji: string; bg: string; border: string; text: string } | null = null;
                      if (s >= 80)      cfg = { label: 'Top 1%',  emoji: '🥇', bg: '#fbbf24', border: '#f59e0b', text: '#78350f' };
                      else if (s >= 60) cfg = { label: 'Top 5%',  emoji: '🥈', bg: '#D8CFA8', border: '#BAA467', text: '#4A4228' };
                      else if (s >= 40) cfg = { label: 'Top 10%', emoji: '🥉', bg: '#C5BD96', border: '#9A7B2E', text: '#3A3520' };
                      else if (s >= 20) cfg = { label: 'Top 25%', emoji: '⭐', bg: '#C8DCCC', border: '#9FB2A4', text: '#2A3530' };
                      if (!cfg) return null;
                      const isGold = s >= 95;
                      return (
                        <View style={[styles.rankBadgeWrap, {
                          backgroundColor: isGold ? '#fbbf24' : cfg.bg,
                          borderColor: cfg.border,
                          shadowColor: cfg.border,
                        }]}>
                          {isGold && <View style={styles.rankBadgeShine} />}
                          <Text style={styles.rankBadgeEmoji}>{cfg.emoji}</Text>
                          <View>
                            <Text style={[styles.rankBadgeLabel, { color: isGold ? '#78350f' : '#fff' }]}>{cfg.label}</Text>
                            <Text style={[styles.rankBadgeSub, { color: isGold ? '#92400e' : 'rgba(255,255,255,0.8)' }]}>Performer</Text>
                          </View>
                        </View>
                      );
                    })()}
                    {/* Title + XP overlaid at bottom of image */}
                    <View style={styles.cardOverlay}>
                      <Text style={styles.cardOverlayTitle} numberOfLines={1}>{ch.title}</Text>
                      <View style={styles.cardOverlayMeta}>
                        <Feather name="star" size={11} color={colors.accentYellow} />
                        <Text style={styles.cardOverlayXP}>{ch.xpReward} XP</Text>
                        <Text style={styles.cardOverlayDot}>·</Text>
                        <Feather name="clock" size={11} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.cardOverlayTime}>{ch.timeLimitMinutes} min</Text>
                      </View>
                    </View>
                  </View>

                  {/* Action row */}
                  {ch.status === 'completed' ? (
                    <View style={styles.completedRow}>
                      <Feather name="check-circle" size={13} color={colors.accentGreen} />
                      <Text style={[styles.completedText, { color: colors.accentGreen }]}>{ch.score}% · +{ch.xpAwarded} XP</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.startBtn, { backgroundColor: ch.status === 'assigned' ? colors.accentGreen : colors.accentYellow }]}
                      onPress={() => startChallenge(ch)}
                      activeOpacity={0.85}
                    >
                      <Feather name="play" size={13} color="white" />
                      <Text style={styles.startBtnText}>
                        {ch.status === 'assigned' ? 'Start Now' : 'Start Challenge'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            </View>
          )}
        </ScrollView>

        {/* Quiz Modal */}
        <Modal visible={quizVisible} animationType="fade" transparent onRequestClose={closeQuiz}>
          <View style={styles.quizOverlay}>
            <View style={styles.quizSheet}>
              {/* Quiz header */}
              <View style={styles.quizHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quizTitle}>{activeChallenge?.title}</Text>
                  <Text style={styles.quizSub}>{questions.length || activeChallenge?.questionCount} questions · {activeChallenge?.timeLimitMinutes} min</Text>
                </View>
                {timeLeft !== null && !quizResult && (() => {
                  const m = Math.floor(timeLeft / 60);
                  const s = timeLeft % 60;
                  const urgent = timeLeft <= 60;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: urgent ? colors.accentRed + '22' : colors.cardDark, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginRight: 10 }}>
                      <Feather name="clock" size={13} color={urgent ? colors.accentRed : colors.textMuted} />
                      <Text style={{ fontSize: 14, fontWeight: '700', color: urgent ? colors.accentRed : colors.textMain, fontVariant: ['tabular-nums'] as any }}>
                        {String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
                      </Text>
                    </View>
                  );
                })()}
                {!quizResult && (
                  <TouchableOpacity onPress={closeQuiz} activeOpacity={0.7}>
                    <Feather name="x" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {quizLoading ? (
                <View style={styles.quizLoading}>
                  <ActivityIndicator size="large" color={colors.accentYellow} />
                  <Text style={styles.quizLoadingText}>Loading questions...</Text>
                </View>
              ) : quizResult ? (
                /* Result screen */
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.resultBox}>
                  {/* Score circle */}
                  {(() => {
                    const s = quizResult.score;
                    const circleColor = s === 100 ? '#4ade80' : s >= 70 ? colors.accentGreen : colors.accentYellow;
                    return (
                      <View style={[styles.resultCircle, { borderColor: circleColor }]}>
                        <Text style={[styles.resultScore, { color: circleColor }]}>{s}%</Text>
                        <Text style={styles.resultLabel}>Score</Text>
                      </View>
                    );
                  })()}
                  <Text style={styles.resultTitle}>
                    {quizResult.score === 100 ? 'Perfect Score!' : quizResult.score >= 80 ? 'Outstanding!' : quizResult.score >= 60 ? 'Well done!' : 'Good effort!'}
                  </Text>

                  {/* Score-based ranking band — shown immediately */}
                  {(() => {
                    const s = quizResult.score;
                    let band: { label: string; emoji: string; bg: string; border: string; labelColor: string; sub: string } | null = null;
                    if (s === 100)    band = { label: 'Perfect!',  emoji: '🌟', bg: '#bbf7d0', border: '#4ade80', labelColor: '#14532d', sub: 'Incredible! A flawless perfect score!' };
                    else if (s >= 80) band = { label: 'Top 1%',   emoji: '🥇', bg: '#bbf7d0', border: '#4ade80', labelColor: '#14532d', sub: 'Exceptional! You are among the best!' };
                    else if (s >= 60) band = { label: 'Top 5%',   emoji: '🥈', bg: '#E6DEBC', border: '#BAA467', labelColor: '#4A4228', sub: 'Outstanding result! Keep it up!' };
                    else if (s >= 40) band = { label: 'Top 10%',  emoji: '🥉', bg: '#E0D8B8', border: '#9A7B2E', labelColor: '#3A3520', sub: 'Great performance! Well done!' };
                    else if (s >= 20) band = { label: 'Top 25%',  emoji: '⭐', bg: '#D8E4DC', border: '#9FB2A4', labelColor: '#2A3530', sub: 'Good effort! Keep practising!' };
                    if (!band) return null;
                    return (
                      <View style={[styles.scoreBandBanner, { backgroundColor: band.bg, borderColor: band.border }]}>
                        <Text style={{ fontSize: 24 }}>{band.emoji}</Text>
                        <View>
                          <Text style={[styles.scoreBandLabel, { color: band.labelColor }]}>{band.label} Performer</Text>
                          <Text style={[styles.scoreBandSub, { color: band.labelColor, opacity: 0.75 }]}>{band.sub}</Text>
                        </View>
                      </View>
                    );
                  })()}

                  <View style={styles.xpEarned}>
                    <Feather name="star" size={18} color={colors.accentYellow} />
                    <Text style={[styles.xpEarnedText, { color: colors.accentYellow }]}>+{quizResult.xpAwarded} XP earned</Text>
                  </View>

                  {/* Challenge Leaderboard */}
                  <View style={styles.lbSection}>
                    <View style={styles.lbHeader}>
                      <Feather name="award" size={14} color={colors.accentYellow} />
                      <Text style={styles.lbTitle}>Challenge Rankings</Text>
                      <View style={styles.liveBadge2}>
                        <View style={[styles.liveDot2, { backgroundColor: colors.accentGreen }]} />
                        <Text style={[styles.liveText2, { color: colors.accentGreen }]}>LIVE</Text>
                      </View>
                    </View>

                    {leaderLoading ? (
                      <ActivityIndicator color={colors.accentYellow} style={{ marginVertical: 16 }} />
                    ) : leaderboard.length === 0 ? (
                      <Text style={styles.lbEmpty}>Be the first to top the leaderboard!</Text>
                    ) : (() => {
                      const myEntry      = leaderboard.find(s => s.id === studentId);
                      const myRank       = myEntry?.rank ?? null;
                      const totalStudents = myEntry?.totalStudents ?? leaderboard.length;
                      const top3         = leaderboard.slice(0, 3);
                      const MEDAL        = ['#f59e0b', '#94a3b8', '#cd7c2c'];

                      // Compute percentile band
                      let band: { label: string; color: string; icon: string } | null = null;
                      if (myRank && totalStudents > 0) {
                        const pct = (myRank / totalStudents) * 100;
                        if (pct <= 3)       band = { label: 'Top 3%',  color: '#C9A24E', icon: 'award' };
                        else if (pct <= 5)  band = { label: 'Top 5%',  color: '#BAA467', icon: 'trending-up' };
                        else if (pct <= 10) band = { label: 'Top 10%', color: '#9A7B2E', icon: 'trending-up' };
                        else if (pct <= 25) band = { label: 'Top 25%', color: '#9FB2A4', icon: 'trending-up' };
                      }

                      return (
                        <>
                          {/* Rank band — prominent banner */}
                          {band && (
                            <View style={[styles.rankBandBanner, { backgroundColor: band.color + '18', borderColor: band.color + '55' }]}>
                              <Feather name={band.icon as any} size={22} color={band.color} />
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.rankBandLabel, { color: band.color }]}>{band.label} in {grade}!</Text>
                                <Text style={[styles.rankBandSub, { color: colors.textMuted }]}>Ranked #{myRank} out of {totalStudents} students</Text>
                              </View>
                            </View>
                          )}
                          {!band && myRank && (
                            <View style={[styles.myRankBanner, { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '0C' }]}>
                              <Feather name="trending-up" size={16} color={colors.accentYellow} />
                              <Text style={[styles.myRankText, { color: colors.accentYellow }]}>You are ranked #{myRank} out of {totalStudents}</Text>
                            </View>
                          )}

                          {/* Top 3 leaderboard rows */}
                          {top3.map((s, i) => {
                            const isMe = s.id === studentId;
                            return (
                              <View key={s.id} style={[styles.lbRow, isMe && { backgroundColor: colors.accentYellow + '0C' }]}>
                                <View style={[styles.lbMedal, { backgroundColor: MEDAL[i] + '22' }]}>
                                  <Feather name="award" size={12} color={MEDAL[i]} />
                                </View>
                                <View style={[styles.lbAvatar, { backgroundColor: isMe ? colors.accentYellow + '30' : colors.borderColor }]}>
                                  <Text style={[styles.lbAvatarText, { color: isMe ? colors.accentYellow : colors.textMuted }]}>{s.name.split(' ').map((p: string) => p[0]).join('').slice(0,2).toUpperCase()}</Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    <Text style={[styles.lbName, isMe && { color: colors.accentYellow }]}>{s.name.split(' ')[0]}</Text>
                                    {isMe && <View style={styles.youChip}><Text style={[styles.youChipText, { color: colors.accentYellow }]}>You</Text></View>}
                                  </View>
                                  <Text style={styles.lbMeta}>{s.count} challenge{s.count !== 1 ? 's' : ''} · avg {s.avgScore}%</Text>
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                  <Text style={[styles.lbXP, { color: colors.accentYellow }]}>{s.xp}</Text>
                                  <Text style={styles.lbXPLabel}>XP</Text>
                                </View>
                              </View>
                            );
                          })}
                        </>
                      );
                    })()}
                  </View>

                  <TouchableOpacity style={styles.doneBtn} onPress={closeQuiz} activeOpacity={0.85}>
                    <Text style={styles.doneBtnText}>Done</Text>
                  </TouchableOpacity>
                </ScrollView>
              ) : (
                /* Questions */
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.questionsContent}>
                  {questions.map((q, qi) => (
                    <View key={qi} style={styles.questionBlock}>
                      <Text style={styles.questionNum}>Q{qi + 1} of {questions.length}</Text>
                      <Text style={styles.questionText}>{q.question}</Text>
                      {q.type === 'fill_blank' || q.type === 'open_ended' ? (
                        <TextInput
                          style={[styles.textAnswerInput, { color: colors.textMain, borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}
                          placeholder={q.type === 'fill_blank' ? 'Type your answer...' : 'Write your answer here...'}
                          placeholderTextColor={colors.textDim}
                          value={answers[qi] ?? ''}
                          onChangeText={(text) => setAnswers(prev => prev.map((a, i) => i === qi ? text : a))}
                          multiline={q.type === 'open_ended'}
                          numberOfLines={q.type === 'open_ended' ? 4 : 1}
                        />
                      ) : (
                        <View style={styles.optionsGrid}>
                          {q.options.map((opt, oi) => (
                            <TouchableOpacity
                              key={oi}
                              style={[
                                styles.optionBtn,
                                answers[qi] === opt && { backgroundColor: colors.accentYellow + '20', borderColor: colors.accentYellow },
                              ]}
                              onPress={() => setAnswers(prev => prev.map((a, i) => i === qi ? opt : a))}
                              activeOpacity={0.75}
                            >
                              <View style={[styles.optionDot, answers[qi] === opt && { backgroundColor: colors.accentYellow, borderColor: colors.accentYellow }]} />
                              <Text style={[styles.optionText, answers[qi] === opt && { color: colors.accentYellow, fontWeight: '600' }]}>{opt}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity
                    style={[styles.submitQuizBtn, !allAnswered && { opacity: 0.5 }]}
                    onPress={submitQuiz}
                    disabled={!allAnswered || quizSubmitting}
                    activeOpacity={0.85}
                  >
                    {quizSubmitting ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <>
                        <Feather name="send" size={15} color="white" />
                        <Text style={styles.submitQuizBtnText}>Submit Answers</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  {!allAnswered && (
                    <Text style={styles.answerAllHint}>Answer all questions to submit</Text>
                  )}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:       { flex: 1, backgroundColor: c.bgDark },
  content:      { padding: spacing.xl, paddingBottom: 40, gap: spacing.lg },

  statsRow:     { flexDirection: 'row', gap: spacing.sm },
  statCard:     { flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.sm, alignItems: 'center', gap: 3 },
  statValue:    { fontSize: 16, fontWeight: '800', letterSpacing: -0.5 },
  statLabel:    { fontSize: 9, color: c.textDim, textAlign: 'center', fontWeight: '500' },

  leaderCTA:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.xl, padding: spacing.lg },
  leaderCTAText:{ flex: 1, fontSize: 14, fontWeight: '700' },

  tabRow:       { flexDirection: 'row', gap: spacing.sm },
  tab:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
  tabActive:    { backgroundColor: c.accentYellow, borderColor: c.accentYellow },
  tabText:      { fontSize: 12, fontWeight: '600', color: c.textMuted },
  tabTextActive:{ color: 'white' },
  tabBadge:     { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  tabBadgeText: { fontSize: 10, fontWeight: '700' },

  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  challengeCard:     { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden', flexBasis: '47%', flexGrow: 0 },
  cardImageWrap:     { position: 'relative', width: '100%', height: 160 },
  cardImage:         { width: '100%', height: 160 },
  cardScrim:         { position: 'absolute', bottom: 0, left: 0, right: 0, height: 90, backgroundColor: 'rgba(0,0,0,0.55)' },
  diffPill:          { position: 'absolute', top: 10, right: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  diffPillText:      { fontSize: 10, fontWeight: '700', color: '#fff' },
  rankBadgeWrap:   { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 28, borderWidth: 2, overflow: 'hidden', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.55, shadowRadius: 10, elevation: 10 },
  rankBadgeShine:  { position: 'absolute', top: 0, left: 0, right: 0, height: '55%', backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 28 },
  rankBadgeEmoji:  { fontSize: 22 },
  rankBadgeLabel:  { fontSize: 13, fontWeight: '900', letterSpacing: 0.2 },
  rankBadgeSub:    { fontSize: 10, fontWeight: '700', marginTop: -1 },
  cardOverlay:       { position: 'absolute', bottom: 10, left: 10, right: 10 },
  cardOverlayTitle:  { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 4 },
  cardOverlayMeta:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardOverlayXP:     { fontSize: 11, fontWeight: '700', color: '#fbbf24' },
  cardOverlayDot:    { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  cardOverlayTime:   { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  catBadge:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  catText:      { fontSize: 10, fontWeight: '700' },
  diffBadge:    { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  diffText:     { fontSize: 10, fontWeight: '700' },
  scoreBadge:   { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  scoreText:    { fontSize: 10, fontWeight: '700' },
  challengeTitle:{ fontSize: 15, fontWeight: '700', color: c.textMain, paddingHorizontal: spacing.lg },
  challengeDesc: { fontSize: 12, color: c.textMuted, lineHeight: 18, paddingHorizontal: spacing.lg },
  cardMeta:     { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingHorizontal: spacing.lg },
  metaText:     { fontSize: 11, color: c.textDim, marginRight: 6 },
  completedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: spacing.lg },
  completedText:{ fontSize: 12, fontWeight: '700' },
  startBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginHorizontal: spacing.md, marginVertical: spacing.sm, borderRadius: radius.md },
  startBtnText: { fontSize: 13, fontWeight: '700', color: 'white' },

  emptyState:   { alignItems: 'center', paddingVertical: 40, gap: spacing.md },
  emptyTitle:   { fontSize: 16, fontWeight: '700', color: c.textMain },
  emptyText:    { fontSize: 13, color: c.textDim, textAlign: 'center' },

  // Quiz modal
  quizOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  quizSheet:    { backgroundColor: c.cardDark, borderRadius: 20, width: '100%', maxWidth: 720, maxHeight: '92%', borderWidth: 1, borderColor: c.borderColor },
  quizHeader:   { flexDirection: 'row', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  quizTitle:    { fontSize: 16, fontWeight: '800', color: c.textMain, fontFamily: fonts.serif },
  quizSub:      { fontSize: 12, color: c.textDim, marginTop: 2 },
  quizLoading:  { alignItems: 'center', paddingVertical: 60, gap: spacing.md },
  quizLoadingText: { fontSize: 14, color: c.textMuted },
  questionsContent: { padding: spacing.xl, gap: spacing.xl, paddingBottom: 40 },
  questionBlock:{ gap: spacing.md },
  questionNum:  { fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5 },
  questionText: { fontSize: 15, fontWeight: '600', color: c.textMain, lineHeight: 22 },
  optionsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  textAnswerInput: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, fontSize: 14, marginTop: 4, textAlignVertical: 'top' },
  optionBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark, flexBasis: '48%', flexGrow: 1 },
  optionDot:    { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.textDim },
  optionText:   { fontSize: 14, color: c.textMuted, flex: 1 },
  submitQuizBtn:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accentYellow, paddingVertical: 14, borderRadius: radius.md, marginTop: spacing.md },
  submitQuizBtnText: { fontSize: 15, fontWeight: '700', color: 'white' },
  answerAllHint:{ fontSize: 12, color: c.textDim, textAlign: 'center', marginTop: spacing.sm },
  // Result
  resultBox:    { alignItems: 'center', padding: spacing.xxl, gap: spacing.lg, paddingBottom: 40, maxWidth: 600, alignSelf: 'center', width: '100%' },
  resultCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 6, alignItems: 'center', justifyContent: 'center' },
  resultScore:  { fontSize: 32, fontWeight: '900' },
  resultLabel:  { fontSize: 12, color: c.textDim, fontWeight: '600' },
  resultTitle:  { fontSize: 22, fontWeight: '800', color: c.textMain, fontFamily: fonts.serif },
  resultSub:    { fontSize: 14, color: c.textMuted, textAlign: 'center' },
  xpEarned:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  xpEarnedText: { fontSize: 18, fontWeight: '800' },
  doneBtn:      { backgroundColor: c.accentYellow, paddingHorizontal: 48, paddingVertical: 14, borderRadius: radius.md, marginTop: spacing.sm },
  doneBtnText:  { fontSize: 15, fontWeight: '700', color: 'white' },

  // Leaderboard in result
  lbSection:    { alignSelf: 'stretch', gap: spacing.sm, backgroundColor: c.cardHover, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.borderColor },
  lbHeader:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  lbTitle:      { flex: 1, fontSize: 14, fontWeight: '700', color: c.textMain },
  liveBadge2:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot2:     { width: 6, height: 6, borderRadius: 3 },
  liveText2:    { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  scoreBandBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: 10, marginBottom: spacing.sm, alignSelf: 'center', overflow: 'hidden' },
  scoreBandLabel:  { fontSize: 15, fontWeight: '900', letterSpacing: -0.3, fontFamily: fonts.serif },
  scoreBandSub:    { fontSize: 11, fontWeight: '600', marginTop: 1 },
  rankBandBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: 10, marginBottom: 4, alignSelf: 'center' },
  rankBandLabel:  { fontSize: 15, fontWeight: '900', letterSpacing: -0.3, fontFamily: fonts.serif },
  rankBandSub:    { fontSize: 11, marginTop: 2 },
  myRankBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8, alignSelf: 'center' },
  myRankText:   { fontSize: 13, fontWeight: '800' },
  lbRow:        { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, padding: spacing.sm },
  lbMedal:      { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  lbRankNum:    { fontSize: 12, fontWeight: '700' },
  lbAvatar:     { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  lbAvatarText: { fontSize: 12, fontWeight: '700' },
  lbName:       { fontSize: 13, fontWeight: '600', color: c.textMain },
  lbMeta:       { fontSize: 10, color: c.textDim, marginTop: 1 },
  lbXP:         { fontSize: 14, fontWeight: '800' },
  lbXPLabel:    { fontSize: 9, color: c.textDim, fontWeight: '600' },
  lbEmpty:      { fontSize: 12, color: c.textDim, textAlign: 'center', paddingVertical: spacing.md },
  youChip:      { backgroundColor: c.accentYellow + '15', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  youChipText:  { fontSize: 9, fontWeight: '800' },
});
