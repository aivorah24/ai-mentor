import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polyline, Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import SERVER_URL from '../../config/serverUrl';

// ── Types ─────────────────────────────────────────────────────────
interface Challenge {
  id: string;
  title: string;
  description: string;
  grade: string;
  curriculum: string;
  subject: string;
  chapterId: number;
  topic: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  xpReward: number;
  questionCount: number;
  timeLimitMinutes: number;
  type: string;
  category: string;
}

interface StudentItem { id: string; name: string; grade: string; }

const GRADES = ['Grade 3', 'Grade 4', 'Grade 5'];

const DIFF_COLOR = (d: string, c: AppColors) =>
  d === 'Easy' ? c.accentGreen : d === 'Hard' ? c.accentRed : c.accentYellow;

// Aligned to the Aivorah landing palette (green → gold), so cards harmonize
// with the sage/green app chrome instead of clashing indigo/orange.
// Exact landing.html accent tokens so cards match the marketing-site standard:
// sage (--sage) for quizzes, gold (--gold) for school challenges.
const CAT_COLOR: Record<string, string> = {
  'Chapter Quiz':     '#BAA467', // landing sage
  'School Challenge': '#BAA467', // landing gold
};

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

type LeaderEntry = {
  rank: number; id: string; name: string; grade: string;
  score: number; level: number; streak: number; topics: number;
};
const MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#cd7c2c'];
const GOLD = '#D9A93E'; // Aivorah brand gold for leaderboard accents
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Component ─────────────────────────────────────────────────────
export default function TeacherChallengesScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const gold = colors.accentYellow;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  // Same pattern as TeacherAssignmentsScreen — was hardcoded to 'IB PYP', which
  // silently hid all challenges for NCERT/Cambridge teachers.
  const teacherCurriculum = (user as any)?.teaches?.[0]?.curriculum || (user as any)?.curriculum || 'IB PYP';

  const [activeTab, setActiveTab]         = useState<'challenges' | 'leaderboard'>('challenges');
  const [selectedGrade, setSelectedGrade] = useState('Grade 3');
  const [challenges, setChallenges]       = useState<Challenge[]>([]);
  const [loading, setLoading]             = useState(false);
  // Grades this teacher handles — fetched authoritatively from saved preferences.
  const [fetchedGrades, setFetchedGrades] = useState<string[]>([]);
  const gradeTabs = fetchedGrades.length > 0 ? fetchedGrades : GRADES;

  // Students for the assign picker
  const [students, setStudents]           = useState<StudentItem[]>([]);

  // Leaderboard
  const [leaderboard, setLeaderboard]     = useState<LeaderEntry[]>([]);
  const [lbLoading, setLbLoading]         = useState(false);
  const [lbExpanded, setLbExpanded]       = useState(false);
  const [rankChange, setRankChange]       = useState<Record<string, number>>({});
  const [weekly, setWeekly]               = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);

  // Assign modal state
  const [assignModal, setAssignModal]     = useState(false);
  const [assignChallenge, setAssignChallenge] = useState<Challenge | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [assigning, setAssigning]         = useState(false);
  const [assignError, setAssignError]     = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');
  const [assignDueDate, setAssignDueDate] = useState('');

  // Fetch students linked to this teacher — on EVERY focus so a newly added student
  // appears in the assign picker instantly (no manual refresh needed).
  useFocusEffect(useCallback(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setStudents(data); })
      .catch(() => {});
  }, [user?.email]));

  // Fetch the teacher's grades authoritatively from saved preferences — on every
  // focus, so a grade change in Settings is reflected instantly (no refresh).
  useFocusEffect(useCallback(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : null)
      .then(p => {
        const g = Array.isArray(p?.teaches)
          ? [...new Set(p.teaches.map((t: any) => t.grade).filter(Boolean))] as string[]
          : [];
        if (g.length > 0) {
          setFetchedGrades(g);
          setSelectedGrade(prev => g.includes(prev) ? prev : g[0]);
        }
      })
      .catch(() => {});
  }, [user?.email]));

  // Fetch challenges for selected grade
  const fetchChallenges = useCallback(() => {
    setLoading(true);
    fetch(`${SERVER_URL}/challenges?grade=${encodeURIComponent(selectedGrade)}&curriculum=${encodeURIComponent(teacherCurriculum)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setChallenges(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedGrade, teacherCurriculum]);

  // Fetch challenges regardless of active tab so the "Active Challenges" stat on
  // the Leaderboard tab is populated too.
  useEffect(() => { fetchChallenges(); }, [fetchChallenges]);

  // Fetch leaderboard — scoped to THIS teacher's class (same school + curriculum
  // + the grades they teach) via teacherEmail.
  useEffect(() => {
    if (activeTab !== 'leaderboard') return;
    if (!user?.email) return;
    setLbLoading(true);
    fetch(`${SERVER_URL}/student/leaderboard?limit=50&teacherEmail=${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setLeaderboard(data);
        // Rank movement vs. the previously seen snapshot (self-contained, no
        // backend history needed) — positive = climbed, negative = dropped.
        AsyncStorage.getItem('lb_prev_ranks').then(raw => {
          const prev = raw ? JSON.parse(raw) : {};
          const changes: Record<string, number> = {};
          data.forEach((e: LeaderEntry) => {
            if (prev[e.id] != null) changes[e.id] = prev[e.id] - e.rank;
          });
          setRankChange(changes);
          const now: Record<string, number> = {};
          data.forEach((e: LeaderEntry) => { now[e.id] = e.rank; });
          AsyncStorage.setItem('lb_prev_ranks', JSON.stringify(now)).catch(() => {});
        }).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLbLoading(false));
  }, [activeTab, user?.email]);

  // Derived leaderboard values
  const norm = (s?: string) => (s ?? '').toLowerCase().replace(/\s+/g, '');
  const totalXP = useMemo(
    () => leaderboard.reduce((a, e) => a + (e.score || 0), 0),
    [leaderboard]
  );
  const yourEntry = useMemo(
    () => leaderboard.find(e => norm(e.name) === norm(user?.name)) || null,
    [leaderboard, user?.name]
  );
  const yourAbove = useMemo(
    () => (yourEntry ? leaderboard.find(e => e.rank === yourEntry.rank - 1) || null : null),
    [leaderboard, yourEntry]
  );
  // Days remaining in the current week (incl. today → Sunday).
  const daysLeft = useMemo(() => { const d = new Date().getDay(); return d === 0 ? 1 : 8 - d; }, []);
  // A real podium needs a genuine top-3; below that we skip it (no lone floating card).
  const showPodium = leaderboard.length >= 3;

  // Weekly activity for the logged-in user (if they appear in the leaderboard).
  useEffect(() => {
    if (!yourEntry?.id) { setWeekly([0, 0, 0, 0, 0, 0, 0]); return; }
    fetch(`${SERVER_URL}/student/${yourEntry.id}/weekly`)
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (res?.days) {
          const m: Record<string, number> = {};
          res.days.forEach((d: any) => { m[d.day] = d.xp || 0; });
          setWeekly(WEEK_DAYS.map(d => m[d] ?? 0));
        }
      })
      .catch(() => {});
  }, [yourEntry?.id]);

  // Open assign modal
  function openAssign(ch: Challenge) {
    setAssignChallenge(ch);
    setSelectedStudent(null);
    setStudentSearch('');
    setAssignError('');
    setAssignSuccess('');
    const d = new Date(); d.setDate(d.getDate() + 7);
    setAssignDueDate(d.toISOString().split('T')[0]);
    setAssignModal(true);
  }

  function closeAssign() {
    setAssignModal(false);
    setAssignChallenge(null);
    setSelectedStudent(null);
    setStudentSearch('');
    setAssignError('');
    setAssignSuccess('');
    setAssignDueDate('');
  }

  function getDueDateLabel(offset: number) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
  }

  async function doAssign() {
    if (!assignChallenge || !selectedStudent) {
      setAssignError('Please select a student.');
      return;
    }
    if (!assignDueDate) { setAssignError('Please select a due date.'); return; }
    setAssigning(true);
    setAssignError('');
    try {
      const res = await fetch(`${SERVER_URL}/challenges/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId:    assignChallenge.id,
          studentId:      selectedStudent.id,
          assignedById:   user?.email ?? '',
          assignedByRole: 'teacher',
          dueDate:        assignDueDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAssignError(err.error ?? 'Failed to assign. Try again.');
        return;
      }
      setAssignSuccess(`"${assignChallenge.title}" assigned to ${selectedStudent.name}!`);
    } catch {
      setAssignError('Network error. Please try again.');
    } finally {
      setAssigning(false);
    }
  }

  // Normalise grade labels so "Grade 4", "grade 4", and "4" all compare equal.
  const normGrade = (g?: string) => (g ?? '').toLowerCase().replace(/grade/g, '').replace(/\s+/g, '').trim();

  // Only students in the SAME grade as the challenge may be assigned it — a Grade 4
  // challenge must never be assignable to a Grade 6 student (and vice-versa).
  const filteredStudents = students.filter(s => {
    const matchesName  = s.name.toLowerCase().includes(studentSearch.toLowerCase());
    const matchesGrade = !assignChallenge?.grade || normGrade(s.grade) === normGrade(assignChallenge.grade);
    return matchesName && matchesGrade;
  });

  // Group challenges by category
  const chapterQuizzes   = challenges.filter(c => c.type === 'chapter_quiz');
  const schoolChallenges = challenges.filter(c => c.type === 'school_challenge');

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Challenges"
          subtitle="Assign competitive challenges to students"
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Tab Toggle */}
          <View style={styles.toggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, activeTab === 'challenges' && styles.toggleActive]}
              onPress={() => setActiveTab('challenges')} activeOpacity={0.8}
            >
              <Feather name="target" size={14} color={activeTab === 'challenges' ? gold : colors.textMuted} />
              <Text style={[styles.toggleText, activeTab === 'challenges' && styles.toggleTextActive]}>Challenges</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, activeTab === 'leaderboard' && styles.toggleActive]}
              onPress={() => setActiveTab('leaderboard')} activeOpacity={0.8}
            >
              <Feather name="award" size={14} color={activeTab === 'leaderboard' ? gold : colors.textMuted} />
              <Text style={[styles.toggleText, activeTab === 'leaderboard' && styles.toggleTextActive]}>Leaderboard</Text>
            </TouchableOpacity>
          </View>

          {activeTab === 'challenges' ? (
            <>
              {/* Grade selector */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 40 }}
                contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {gradeTabs.map(g => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.gradeChip, selectedGrade === g && styles.gradeChipActive]}
                    onPress={() => setSelectedGrade(g)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.gradeChipText, selectedGrade === g && styles.gradeChipTextActive]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {loading ? (
                <ActivityIndicator color={colors.accentYellow} style={{ paddingVertical: 32 }} />
              ) : (
                <>
                  {/* Chapter Quizzes */}
                  {chapterQuizzes.length > 0 && (
                    <>
                      <Text style={styles.sectionTitle}>Chapter Quizzes</Text>
                      <Text style={styles.sectionSub}>Assign to individual students to test chapter mastery</Text>
                      <View style={styles.challengeGrid}>
                        {chapterQuizzes.map(ch => (
                          <ChallengeCard
                            key={ch.id} ch={ch} colors={colors} isDark={isDark} styles={styles}
                            onAssign={() => openAssign(ch)}
                          />
                        ))}
                      </View>
                    </>
                  )}

                  {/* School Challenges */}
                  {schoolChallenges.length > 0 && (
                    <>
                      <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>School Challenges</Text>
                      <Text style={styles.sectionSub}>Competitive challenges covering multiple chapters</Text>
                      <View style={styles.challengeGrid}>
                        {schoolChallenges.map(ch => (
                          <ChallengeCard
                            key={ch.id} ch={ch} colors={colors} isDark={isDark} styles={styles}
                            onAssign={() => openAssign(ch)}
                          />
                        ))}
                      </View>
                    </>
                  )}

                  {challenges.length === 0 && (
                    <View style={styles.emptyState}>
                      <Feather name="inbox" size={32} color={colors.textDim} />
                      <Text style={styles.emptyText}>No challenges for {selectedGrade} yet.</Text>
                    </View>
                  )}
                </>
              )}
            </>
          ) : (
            /* Leaderboard */
            lbLoading ? (
              <ActivityIndicator color={colors.accentYellow} style={{ paddingVertical: 48 }} />
            ) : leaderboard.length === 0 ? (
              <View style={styles.leaderCard}>
                <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24, fontSize: 13 }}>
                  No students in this class yet. Link students to see rankings.
                </Text>
              </View>
            ) : (
              <View style={styles.lbWrap}>
                {/* Stat cards */}
                <View style={styles.statRow}>
                  <StatCard styles={styles} icon="users"    tint={gold}   value={String(leaderboard.length)} label="Students" />
                  <StatCard styles={styles} icon="zap"      tint={GOLD}             value={String(challenges.length)} label="Active Challenges" />
                  <StatCard styles={styles} icon="star"     tint={GOLD}             value={totalXP.toLocaleString()} label="Total XP Earned" />
                  <StatCard styles={styles} icon="calendar" tint={colors.textMuted} value={String(daysLeft)} label="Days Left" />
                </View>

                {/* Top Performers podium — only when there's a genuine top-3 */}
                {showPodium && (
                  <View style={styles.panel}>
                    <View style={styles.panelHeadRow}>
                      <Feather name="award" size={16} color={GOLD} />
                      <Text style={styles.panelTitle}>Top Performers This Week</Text>
                      <View style={styles.periodChip}>
                        <Text style={styles.periodChipText}>This Week</Text>
                        <Feather name="chevron-down" size={13} color={colors.textMuted} />
                      </View>
                    </View>
                    <View style={styles.podiumRow}>
                      <PodiumCard entry={leaderboard[1]} place={2} colors={colors} styles={styles} isDark={isDark} />
                      <PodiumCard entry={leaderboard[0]} place={1} colors={colors} styles={styles} isDark={isDark} elevated />
                      <PodiumCard entry={leaderboard[2]} place={3} colors={colors} styles={styles} isDark={isDark} />
                    </View>
                  </View>
                )}

                {/* Bottom: table + side column */}
                <View style={styles.lbBottomRow}>
                  <View style={styles.lbTablePanel}>
                    <View style={styles.lbPanelHead}>
                      <Feather name="award" size={15} color={GOLD} />
                      <Text style={styles.panelTitle}>Live Class Leaderboard</Text>
                      <View style={styles.periodChip}>
                        <Text style={styles.periodChipText}>By XP</Text>
                        <Feather name="chevron-down" size={13} color={colors.textMuted} />
                      </View>
                    </View>

                    <View style={styles.colHeadRow}>
                      <Text style={[styles.colHead, styles.colRankW]}>Rank</Text>
                      <Text style={[styles.colHead, { flex: 1 }]}>Student</Text>
                      <Text style={[styles.colHead, styles.colGradeHead]}>Grade</Text>
                      <Text style={[styles.colHead, styles.colXPHead]}>XP</Text>
                      <Text style={[styles.colHead, styles.colChangeHead]}>Change</Text>
                    </View>

                    {(() => {
                      // When the podium is shown it already covers ranks 1–3, so the
                      // table lists the rest; otherwise it lists everyone.
                      const rest  = showPodium ? leaderboard.slice(3) : leaderboard;
                      const shown = lbExpanded ? rest : rest.slice(0, 5);
                      if (rest.length === 0) {
                        return (
                          <Text style={{ color: colors.textDim, textAlign: 'center', paddingVertical: 22, fontSize: 12 }}>
                            All class members are on the podium above.
                          </Text>
                        );
                      }
                      return (
                        <>
                          {shown.map((s, i) => {
                            const ch = rankChange[s.id] ?? 0;
                            return (
                              <View key={s.id} style={[styles.tableRow, i < shown.length - 1 && styles.tableRowBorder]}>
                                <View style={styles.colRankW}>
                                  <View style={styles.rankPill}><Text style={styles.rankPillText}>{s.rank}</Text></View>
                                </View>
                                <View style={styles.cellStudent}>
                                  <View style={[styles.tableAvatar, { backgroundColor: gold + '20' }]}>
                                    <Text style={[styles.tableInitials, { color: gold }]}>{initials(s.name)}</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.tableName} numberOfLines={1}>{s.name}</Text>
                                    <Text style={styles.tableSub} numberOfLines={1}>{s.grade} · {s.streak}d streak</Text>
                                  </View>
                                </View>
                                <Text style={[styles.cellGrade, styles.colGradeHead]}>{(s.grade || '').replace('Grade ', '')}</Text>
                                <View style={styles.colXPCell}>
                                  <Text style={styles.cellXP}>{s.score.toLocaleString()} <Text style={styles.cellXPUnit}>XP</Text></Text>
                                </View>
                                <View style={styles.colChangeCell}>
                                  {ch > 0 ? (
                                    <><Feather name="arrow-up" size={12} color={colors.accentGreen} /><Text style={[styles.changeText, { color: colors.accentGreen }]}>{ch}</Text></>
                                  ) : ch < 0 ? (
                                    <><Feather name="arrow-down" size={12} color={colors.accentRed} /><Text style={[styles.changeText, { color: colors.accentRed }]}>{Math.abs(ch)}</Text></>
                                  ) : (
                                    <Text style={[styles.changeText, { color: colors.textDim }]}>—</Text>
                                  )}
                                </View>
                              </View>
                            );
                          })}
                          {rest.length > 5 && (
                            <TouchableOpacity style={styles.viewFullBtn} onPress={() => setLbExpanded(v => !v)} activeOpacity={0.7}>
                              <Text style={styles.viewFullText}>{lbExpanded ? 'Show Less' : 'View Full Leaderboard'}</Text>
                              <Feather name={lbExpanded ? 'chevron-up' : 'chevron-right'} size={15} color={gold} />
                            </TouchableOpacity>
                          )}
                        </>
                      );
                    })()}
                  </View>

                  {/* Side column — only when the viewer is themselves ranked here */}
                  {yourEntry && (
                    <View style={styles.lbSideCol}>
                      <View style={styles.sideCard}>
                        <View style={styles.panelHeadRow}>
                          <Feather name="user" size={15} color={GOLD} />
                          <Text style={styles.panelTitle}>Your Rank</Text>
                        </View>
                        <Text style={styles.yourRankNum}>#{yourEntry.rank}</Text>
                        <Text style={styles.yourRankName}>{yourEntry.name}</Text>
                        <Text style={styles.yourRankXP}>{yourEntry.score.toLocaleString()} XP</Text>
                        {(rankChange[yourEntry.id] ?? 0) !== 0 && (
                          <Text style={[styles.yourRankDelta, { color: (rankChange[yourEntry.id] ?? 0) > 0 ? colors.accentGreen : colors.accentRed }]}>
                            {(rankChange[yourEntry.id] ?? 0) > 0 ? '↑' : '↓'} {Math.abs(rankChange[yourEntry.id] ?? 0)} ranks today
                          </Text>
                        )}
                        {yourAbove && (
                          <>
                            <View style={styles.progressTrack}>
                              <View style={[styles.progressFill, { width: `${Math.min(100, Math.round((yourEntry.score / Math.max(1, yourAbove.score)) * 100))}%` }]} />
                            </View>
                            <Text style={styles.progressLabel}>{Math.max(0, yourAbove.score - yourEntry.score).toLocaleString()} XP to reach Rank #{yourAbove.rank}</Text>
                            <Text style={styles.progressSub}>{yourEntry.score.toLocaleString()} / {yourAbove.score.toLocaleString()} XP</Text>
                          </>
                        )}
                      </View>

                      <View style={styles.sideCard}>
                        <Text style={styles.panelTitle}>Weekly Progress</Text>
                        <WeeklyChart data={weekly} styles={styles} />
                      </View>
                    </View>
                  )}
                </View>
              </View>
            )
          )}
        </ScrollView>
      </View>

      {/* Assign Modal */}
      <Modal visible={assignModal} transparent animationType="fade" onRequestClose={closeAssign}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={closeAssign} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assign Challenge</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>{assignChallenge?.title}</Text>
              </View>
              <TouchableOpacity onPress={closeAssign} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>

            {/* Success state */}
            {assignSuccess ? (
              <View style={styles.successBox}>
                <Feather name="check-circle" size={16} color={colors.accentGreen} />
                <Text style={[styles.successText, { color: colors.accentGreen }]}>{assignSuccess}</Text>
              </View>
            ) : null}

            {/* Error */}
            {assignError ? (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={14} color={colors.accentRed} />
                <Text style={[styles.errorText, { color: colors.accentRed }]}>{assignError}</Text>
              </View>
            ) : null}

            {!assignSuccess && (
              <>
                <Text style={styles.pickerLabel}>Select Student</Text>

                {selectedStudent ? (
                  <TouchableOpacity style={styles.selectedChip} onPress={() => setSelectedStudent(null)} activeOpacity={0.7}>
                    <Feather name="user" size={13} color={gold} />
                    <Text style={styles.selectedChipName}>{selectedStudent.name}</Text>
                    <Text style={styles.selectedChipGrade}>{selectedStudent.grade}</Text>
                    <View style={{ flex: 1 }} />
                    <Feather name="x-circle" size={14} color={colors.textDim} />
                  </TouchableOpacity>
                ) : (
                  <>
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search student by name..."
                      placeholderTextColor={colors.textDim}
                      value={studentSearch}
                      onChangeText={setStudentSearch}
                    />
                    <ScrollView style={styles.studentList} nestedScrollEnabled>
                      {filteredStudents.length === 0 ? (
                        <Text style={styles.noStudents}>
                          {students.length === 0
                            ? 'No students linked to your account.'
                            : studentSearch
                              ? 'No matching students.'
                              : `No ${assignChallenge?.grade || 'matching'} students linked to your account.`}
                        </Text>
                      ) : filteredStudents.map(s => (
                        <TouchableOpacity
                          key={s.id}
                          style={styles.studentRow}
                          onPress={() => { setSelectedStudent(s); setStudentSearch(''); setAssignError(''); }}
                          activeOpacity={0.7}
                        >
                          <View style={styles.studentAvatar}>
                            <Text style={styles.studentAvatarText}>{initials(s.name)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.studentName}>{s.name}</Text>
                            <Text style={styles.studentGrade}>{s.grade}</Text>
                          </View>
                          <Feather name="chevron-right" size={14} color={colors.textDim} />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                {/* Due date picker */}
                <View style={{ marginTop: 14 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain, marginBottom: 8 }}>
                    <Feather name="calendar" size={13} color={gold} /> Due Date
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {[
                      { label: 'Tomorrow', date: getDueDateLabel(1) },
                      { label: '3 Days',   date: getDueDateLabel(3) },
                      { label: '1 Week',   date: getDueDateLabel(7) },
                      { label: '2 Weeks',  date: getDueDateLabel(14) },
                    ].map(opt => (
                      <TouchableOpacity
                        key={opt.label}
                        onPress={() => setAssignDueDate(opt.date)}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: assignDueDate === opt.date ? gold : colors.borderColor,
                          backgroundColor: assignDueDate === opt.date ? gold + '18' : 'transparent',
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 12, color: assignDueDate === opt.date ? gold : colors.textMuted }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 6 }}>
                    Due: {assignDueDate || 'Not set'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.assignBtn, (!selectedStudent || assigning) && styles.assignBtnDisabled]}
                  onPress={doAssign}
                  disabled={!selectedStudent || assigning}
                  activeOpacity={0.85}
                >
                  {assigning ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name="send" size={15} color="#fff" />
                      <Text style={styles.assignBtnText}>Assign Challenge</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            {assignSuccess && (
              <TouchableOpacity style={styles.doneBtn} onPress={closeAssign} activeOpacity={0.85}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenLayout>
  );
}

// ── Challenge Card ─────────────────────────────────────────────────
function ChallengeCard({ ch, colors, isDark, styles, onAssign }: {
  ch: Challenge; colors: AppColors; isDark: boolean;
  styles: ReturnType<typeof makeStyles>;
  onAssign: () => void;
}) {
  const diffColor  = DIFF_COLOR(ch.difficulty, colors);
  const catColor   = CAT_COLOR[ch.category] ?? GOLD;

  // Dark: follow the landing standard — flat near-black card surface with only a
  // whisper-subtle neutral sheen (NO full-card colour wash, which read as muddy
  // brown for gold challenges). Colour identity comes from the left accent bar +
  // category badge, exactly like the Assignments cards.
  // Light: keep the soft category tint melting into white (the pastel look).
  const cardGradient: [string, string] = isDark
    ? [colors.cardHover, colors.cardDark]
    : [catColor + '22', '#FFFFFF'];
  const titleColor = isDark ? colors.textMain  : '#16241B';
  const descColor  = isDark ? colors.textMuted : '#5C6F62';
  const dimColor   = isDark ? colors.textDim   : '#7C8A82';
  const xpColor    = isDark ? colors.accentYellow : '#9A7B2E';
  const assignBg   = isDark ? 'transparent' : '#FFFFFF';

  return (
    <LinearGradient
      colors={cardGradient}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={[styles.cardAccent, { backgroundColor: catColor }]} />
      <View style={styles.cardBody}>
        {/* Badges row */}
        <View style={styles.badgesRow}>
          <View style={[styles.categoryBadge, { backgroundColor: catColor + '22', borderColor: catColor + '55' }]}>
            <Text style={[styles.categoryBadgeText, { color: catColor }]}>{ch.category}</Text>
          </View>
          <View style={[styles.diffBadge, { backgroundColor: diffColor + '22', borderColor: diffColor + '55' }]}>
            <Text style={[styles.diffBadgeText, { color: diffColor }]}>{ch.difficulty}</Text>
          </View>
        </View>

        <Text style={[styles.cardTitle, { color: titleColor }]}>{ch.title}</Text>
        <Text style={[styles.cardDesc, { color: descColor }]}>{ch.description}</Text>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Feather name="star" size={11} color={xpColor} />
            <Text style={[styles.statText, { color: xpColor }]}>{ch.xpReward} XP</Text>
          </View>
          <View style={styles.statItem}>
            <Feather name="help-circle" size={11} color={dimColor} />
            <Text style={[styles.statText, { color: dimColor }]}>{ch.questionCount} Qs</Text>
          </View>
          <View style={styles.statItem}>
            <Feather name="clock" size={11} color={dimColor} />
            <Text style={[styles.statText, { color: dimColor }]}>{ch.timeLimitMinutes} min</Text>
          </View>
        </View>

        {/* Assign button */}
        <TouchableOpacity
          style={[styles.assignRowBtn, { backgroundColor: assignBg, borderColor: catColor + '66' }]}
          onPress={onAssign} activeOpacity={0.8}
        >
          <Feather name="user-plus" size={13} color={catColor} />
          <Text style={[styles.assignRowBtnText, { color: catColor }]}>Assign to Student</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

// ── Leaderboard sub-components ─────────────────────────────────────
function StatCard({ icon, tint, value, label, styles }: {
  icon: any; tint: string; value: string; label: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: tint + '22' }]}>
        <Feather name={icon} size={18} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
        <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

function PodiumCard({ entry, place, colors, styles, isDark, elevated }: {
  entry: LeaderEntry; place: number; colors: AppColors;
  styles: ReturnType<typeof makeStyles>; isDark: boolean; elevated?: boolean;
}) {
  const medal = MEDAL_COLORS[place - 1];
  const body = (
    <>
      <View style={[styles.podiumBadge, { backgroundColor: medal, borderColor: colors.cardDark }]}>
        <Text style={styles.podiumBadgeNum}>{place}</Text>
      </View>
      <View style={[styles.podiumAvatar, { backgroundColor: GOLD + '22', borderColor: medal }]}>
        <Text style={[styles.podiumInitials, { color: GOLD }]}>{initials(entry.name)}</Text>
      </View>
      <Text style={styles.podiumName} numberOfLines={1}>{entry.name}</Text>
      <Text style={styles.podiumGrade}>{entry.grade}</Text>
      <Text style={[styles.podiumXP, elevated && { color: medal, fontSize: 22 }]}>
        {entry.score.toLocaleString()} <Text style={styles.podiumXPUnit}>XP</Text>
      </Text>
    </>
  );
  if (elevated) {
    return (
      <LinearGradient
        colors={[medal + (isDark ? '33' : '22'), isDark ? colors.cardDark : '#FFFFFF']}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={[styles.podiumCard, styles.podiumCardTop, { borderColor: medal + '99' }]}
      >
        {body}
      </LinearGradient>
    );
  }
  const surface = isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.025)';
  return <View style={[styles.podiumCard, { backgroundColor: surface, borderColor: colors.borderColor }]}>{body}</View>;
}

function WeeklyChart({ data, styles }: {
  data: number[]; styles: ReturnType<typeof makeStyles>;
}) {
  const W = 280, H = 96, pad = 10;
  const max = Math.max(...data, 1);
  const n = data.length;
  const stepX = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const ptY = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const points = data.map((v, i) => `${pad + i * stepX},${ptY(v)}`).join(' ');
  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Polyline points={points} fill="none" stroke={GOLD} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((v, i) => <Circle key={i} cx={pad + i * stepX} cy={ptY(v)} r={3} fill={GOLD} />)}
      </Svg>
      <View style={styles.weekLabels}>
        {WEEK_DAYS.map(d => <Text key={d} style={styles.weekLabel}>{d}</Text>)}
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────
const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:   { flex: 1, backgroundColor: c.bgDark },
  scroll:   { flex: 1 },
  content:  { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  toggle: {
    flexDirection: 'row', backgroundColor: c.cardDark,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, overflow: 'hidden',
  },
  toggleBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11 },
  toggleActive:    { backgroundColor: c.accentYellow + '18' },
  toggleText:      { fontSize: 14, fontWeight: '600', color: c.textMuted },
  toggleTextActive:{ color: c.accentYellow },

  // Grade chips
  gradeChip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
  gradeChipActive:   { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
  gradeChipText:     { fontSize: 13, fontWeight: '600', color: c.textMuted },
  gradeChipTextActive:{ color: c.accentYellow },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  sectionSub:   { fontSize: 12, color: c.textDim, marginTop: -spacing.sm },

  emptyState:  { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText:   { fontSize: 14, color: c.textDim },

  // Challenge cards laid out in a responsive 2-column grid
  challengeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'stretch' },
  // Challenge card
  card: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, overflow: 'hidden', flexDirection: 'row',
    // flexGrow 0 → a lone card keeps the column (half) width instead of
    // stretching full-width; pairs sit two-up, wrapping to 1 col under 300px.
    flexGrow: 0, flexBasis: '48%', minWidth: 300,
  },
  cardAccent: { width: 4 },
  cardBody:   { flex: 1, padding: spacing.lg, gap: spacing.sm },
  badgesRow:  { flexDirection: 'row', gap: 6 },
  categoryBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  categoryBadgeText: { fontSize: 10, fontWeight: '700' },
  diffBadge:   { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  diffBadgeText:{ fontSize: 10, fontWeight: '700' },
  cardTitle:   { fontSize: 15, fontWeight: '700', color: c.textMain },
  cardDesc:    { fontSize: 12, color: c.textMuted, lineHeight: 18 },
  statsRow:    { flexDirection: 'row', gap: spacing.lg },
  statItem:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText:    { fontSize: 12, color: c.textDim, fontWeight: '500' },

  assignRowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: c.accentYellow + '50', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: c.accentYellow + '18',
  },
  assignRowBtnText: { fontSize: 13, fontWeight: '600', color: c.accentYellow },

  // Leaderboard
  leaderCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, overflow: 'hidden',
    // Cap to a focused reading width + center, so rows aren't stretched across
    // the full ultra-wide screen with a cavernous gap between name and score.
    width: '100%', maxWidth: 820, alignSelf: 'center',
  },
  leaderHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  leaderTitle:  { fontSize: 14, fontWeight: '700', color: c.textMain, flex: 1 },
  leaderPeriod: { fontSize: 11, color: c.textDim, fontWeight: '600' },
  leaderRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  leaderBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  rankBadge:    { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankNum:      { fontSize: 13, fontWeight: '800', color: c.textMuted },
  leaderAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  leaderInitials:{ fontSize: 13, fontWeight: '800' },
  leaderInfo:   { flex: 1 },
  leaderName:   { fontSize: 14, fontWeight: '600', color: c.textMain },
  leaderGrade:  { fontSize: 11, color: c.textDim, marginTop: 2 },
  leaderRight:  { alignItems: 'flex-end' },
  leaderScore:  { fontSize: 15, fontWeight: '800', color: c.textMain },
  xpRow:        { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  xpLabel:      { fontSize: 10, fontWeight: '600' },

  // ── Leaderboard redesign ──
  lbWrap:        { width: '100%', maxWidth: 1180, alignSelf: 'center', gap: spacing.lg },
  statRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard:      { flexGrow: 1, flexBasis: '22%', minWidth: 150, flexDirection: 'row', alignItems: 'center', gap: 12,
                   backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg },
  statIcon:      { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statValue:     { fontSize: 22, fontWeight: '800', color: c.textMain },
  statLabel:     { fontSize: 12, color: c.textDim, marginTop: 1 },

  panel:         { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.lg },
  panelHeadRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelTitle:    { fontSize: 15, fontWeight: '700', color: c.textMain, flex: 1 },
  periodChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  periodChipText:{ fontSize: 12, color: c.textMuted, fontWeight: '600' },

  podiumRow:     { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.lg, paddingTop: 22 },
  podiumCard:    { flexGrow: 1, flexBasis: 0, maxWidth: 300, minWidth: 150, alignItems: 'center', borderWidth: 1, borderRadius: radius.xl,
                   paddingTop: 32, paddingBottom: spacing.lg, paddingHorizontal: spacing.md, gap: 3, overflow: 'visible' },
  podiumCardTop: { paddingTop: 44, paddingBottom: spacing.xl, borderWidth: 1.5 },
  podiumBadge:   { position: 'absolute', top: -16, alignSelf: 'center', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  podiumBadgeNum:{ fontSize: 13, fontWeight: '800', color: '#fff' },
  podiumAvatar:  { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, marginBottom: 4 },
  podiumInitials:{ fontSize: 15, fontWeight: '800' },
  podiumName:    { fontSize: 14, fontWeight: '700', color: c.textMain, textAlign: 'center' },
  podiumGrade:   { fontSize: 11, color: c.textDim },
  podiumXP:      { fontSize: 17, fontWeight: '800', color: c.textMain, marginTop: 4 },
  podiumXPUnit:  { fontSize: 11, fontWeight: '700', color: c.textDim },

  lbBottomRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'flex-start' },
  lbTablePanel:  { flexGrow: 3, flexBasis: 520, minWidth: 300, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden' },
  lbSideCol:     { flexGrow: 1, flexBasis: 280, minWidth: 260, gap: spacing.lg },
  lbPanelHead:   { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.borderColor },

  colHeadRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  colHead:       { fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.3 },
  colRankW:      { width: 46 },
  colGradeHead:  { width: 54, textAlign: 'center' },
  colXPHead:     { width: 92, textAlign: 'right' },
  colChangeHead: { width: 64, textAlign: 'right' },
  colXPCell:     { width: 92, alignItems: 'flex-end' },
  colChangeCell: { width: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },

  tableRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 10 },
  tableRowBorder:{ borderBottomWidth: 1, borderBottomColor: c.borderColor },
  rankPill:      { width: 28, height: 28, borderRadius: 8, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  rankPillText:  { fontSize: 12, fontWeight: '800', color: c.textMuted },
  cellStudent:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 8 },
  tableAvatar:   { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  tableInitials: { fontSize: 12, fontWeight: '800' },
  tableName:     { fontSize: 14, fontWeight: '600', color: c.textMain },
  tableSub:      { fontSize: 11, color: c.textDim, marginTop: 1 },
  cellGrade:     { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  cellXP:        { fontSize: 14, fontWeight: '800', color: c.textMain },
  cellXPUnit:    { fontSize: 10, fontWeight: '700', color: c.textDim },
  changeText:    { fontSize: 12, fontWeight: '700' },
  viewFullBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.borderColor },
  viewFullText:  { fontSize: 13, fontWeight: '700', color: c.accentYellow },

  sideCard:      { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg, gap: 6 },
  yourRankNum:   { fontSize: 30, fontWeight: '900', color: GOLD, marginTop: 2 },
  yourRankName:  { fontSize: 14, fontWeight: '700', color: c.textMain },
  yourRankXP:    { fontSize: 14, fontWeight: '800', color: GOLD },
  yourRankDelta: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, overflow: 'hidden', marginTop: 8 },
  progressFill:  { height: '100%', backgroundColor: GOLD, borderRadius: 4 },
  progressLabel: { fontSize: 11, color: c.textMuted, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  progressSub:   { fontSize: 10, color: c.textDim, textAlign: 'center' },
  weekLabels:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 4 },
  weekLabel:     { fontSize: 10, color: c.textDim, fontWeight: '600' },

  // Assign modal
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: {
    backgroundColor: c.cardDark, borderRadius: 24,
    padding: spacing.xl, paddingBottom: 28, gap: spacing.lg,
    borderWidth: 1, borderColor: c.borderColor, maxHeight: '88%',
    width: '100%', maxWidth: 460, alignSelf: 'center',
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderColor,
    alignSelf: 'center', marginBottom: spacing.sm,
  },
  modalHeader:    { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  modalTitle:     { fontSize: 17, fontWeight: '800', color: c.textMain },
  modalSubtitle:  { fontSize: 13, color: c.textDim, marginTop: 2 },

  pickerLabel:    { fontSize: 13, fontWeight: '700', color: c.textMain },
  searchInput: {
    borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: 14, color: c.textMain, backgroundColor: c.bgDark,
  },
  studentList:    { maxHeight: 180, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, overflow: 'hidden' },
  studentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  studentAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.accentYellow + '20', alignItems: 'center', justifyContent: 'center',
  },
  studentAvatarText: { fontSize: 12, fontWeight: '800', color: c.accentYellow },
  studentName:    { fontSize: 14, fontWeight: '600', color: c.textMain },
  studentGrade:   { fontSize: 11, color: c.textDim },
  noStudents:     { padding: spacing.lg, fontSize: 13, color: c.textDim, textAlign: 'center' },

  selectedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.accentYellow + '50', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 11,
    backgroundColor: c.accentYellow + '18',
  },
  selectedChipName:  { fontSize: 14, fontWeight: '600', color: c.accentYellow, flex: 1 },
  selectedChipGrade: { fontSize: 11, color: c.accentYellow + 'aa' },

  assignBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.accentYellow, borderRadius: radius.lg, paddingVertical: 14,
  },
  assignBtnDisabled: { opacity: 0.45 },
  assignBtnText:     { fontSize: 15, fontWeight: '700', color: '#fff' },

  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#10b98120', borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: '#10b98140',
  },
  successText:  { fontSize: 13, fontWeight: '600', flex: 1 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#ef444420', borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: '#ef444440',
  },
  errorText:    { fontSize: 13, fontWeight: '600', flex: 1 },

  doneBtn: {
    backgroundColor: c.accentYellow, borderRadius: radius.lg,
    paddingVertical: 14, alignItems: 'center',
  },
  doneBtnText:  { fontSize: 15, fontWeight: '700', color: '#fff' },
});
