import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
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

const CAT_COLOR: Record<string, string> = {
  'Chapter Quiz':     '#6366f1',
  'School Challenge': '#f59e0b',
};

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

type LeaderEntry = {
  rank: number; id: string; name: string; grade: string;
  score: number; level: number; streak: number; topics: number;
};
const MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#cd7c2c'];

// ── Component ─────────────────────────────────────────────────────
export default function TeacherChallengesScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

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

  // Assign modal state
  const [assignModal, setAssignModal]     = useState(false);
  const [assignChallenge, setAssignChallenge] = useState<Challenge | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [assigning, setAssigning]         = useState(false);
  const [assignError, setAssignError]     = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');
  const [assignDueDate, setAssignDueDate] = useState('');

  // Fetch students linked to this teacher
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setStudents(data); })
      .catch(() => {});
  }, [user?.email]);

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
    fetch(`${SERVER_URL}/challenges?grade=${encodeURIComponent(selectedGrade)}&curriculum=IB%20PYP`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setChallenges(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedGrade]);

  useEffect(() => {
    if (activeTab === 'challenges') fetchChallenges();
  }, [activeTab, fetchChallenges]);

  // Fetch leaderboard
  useEffect(() => {
    if (activeTab !== 'leaderboard') return;
    setLbLoading(true);
    fetch(`${SERVER_URL}/student/leaderboard?limit=10`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setLeaderboard(data); })
      .catch(() => {})
      .finally(() => setLbLoading(false));
  }, [activeTab]);

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

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(studentSearch.toLowerCase())
  );

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
              <Feather name="target" size={14} color={activeTab === 'challenges' ? colors.primary : colors.textMuted} />
              <Text style={[styles.toggleText, activeTab === 'challenges' && styles.toggleTextActive]}>Challenges</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, activeTab === 'leaderboard' && styles.toggleActive]}
              onPress={() => setActiveTab('leaderboard')} activeOpacity={0.8}
            >
              <Feather name="award" size={14} color={activeTab === 'leaderboard' ? colors.primary : colors.textMuted} />
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
                <ActivityIndicator color={colors.primary} style={{ paddingVertical: 32 }} />
              ) : (
                <>
                  {/* Chapter Quizzes */}
                  {chapterQuizzes.length > 0 && (
                    <>
                      <Text style={styles.sectionTitle}>Chapter Quizzes</Text>
                      <Text style={styles.sectionSub}>Assign to individual students to test chapter mastery</Text>
                      {chapterQuizzes.map(ch => (
                        <ChallengeCard
                          key={ch.id} ch={ch} colors={colors} styles={styles}
                          onAssign={() => openAssign(ch)}
                        />
                      ))}
                    </>
                  )}

                  {/* School Challenges */}
                  {schoolChallenges.length > 0 && (
                    <>
                      <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>School Challenges</Text>
                      <Text style={styles.sectionSub}>Competitive challenges covering multiple chapters</Text>
                      {schoolChallenges.map(ch => (
                        <ChallengeCard
                          key={ch.id} ch={ch} colors={colors} styles={styles}
                          onAssign={() => openAssign(ch)}
                        />
                      ))}
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
            <View style={styles.leaderCard}>
              <View style={styles.leaderHeader}>
                <Feather name="award" size={15} color={colors.accentYellow} />
                <Text style={styles.leaderTitle}>Live Class Leaderboard</Text>
                <Text style={styles.leaderPeriod}>By XP</Text>
              </View>

              {lbLoading ? (
                <ActivityIndicator color={colors.primary} style={{ paddingVertical: 32 }} />
              ) : leaderboard.length === 0 ? (
                <Text style={{ color: colors.textMuted, textAlign: 'center', padding: 24, fontSize: 13 }}>
                  No students yet. Add students to see rankings.
                </Text>
              ) : null}

              {leaderboard.map(s => {
                const medalColor = MEDAL_COLORS[s.rank - 1];
                return (
                  <View key={s.rank} style={[styles.leaderRow, s.rank < leaderboard.length && styles.leaderBorder]}>
                    <View style={[styles.rankBadge, medalColor ? { backgroundColor: medalColor + '22' } : { backgroundColor: colors.borderColor }]}>
                      {s.rank <= 3 ? (
                        <Feather name="award" size={13} color={medalColor} />
                      ) : (
                        <Text style={styles.rankNum}>{s.rank}</Text>
                      )}
                    </View>
                    <View style={[styles.leaderAvatar, { backgroundColor: colors.primary + '20' }]}>
                      <Text style={[styles.leaderInitials, { color: colors.primary }]}>{initials(s.name)}</Text>
                    </View>
                    <View style={styles.leaderInfo}>
                      <Text style={styles.leaderName}>{s.name}</Text>
                      <Text style={styles.leaderGrade}>{s.grade} · {s.streak}d streak</Text>
                    </View>
                    <View style={styles.leaderRight}>
                      <Text style={styles.leaderScore}>{s.score.toLocaleString()}</Text>
                      <View style={styles.xpRow}>
                        <Feather name="star" size={11} color={colors.accentYellow} />
                        <Text style={[styles.xpLabel, { color: colors.accentYellow }]}>XP</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Assign Modal */}
      <Modal visible={assignModal} transparent animationType="slide" onRequestClose={closeAssign}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={closeAssign} />
          <View style={styles.modalSheet}>
            {/* Handle */}
            <View style={styles.modalHandle} />

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
                    <Feather name="user" size={13} color={colors.primary} />
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
                          {students.length === 0 ? 'No students linked to your account.' : 'No matching students.'}
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
                    <Feather name="calendar" size={13} color={colors.primary} /> Due Date
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
                          borderColor: assignDueDate === opt.date ? colors.primary : colors.borderColor,
                          backgroundColor: assignDueDate === opt.date ? colors.primaryGlow : 'transparent',
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 12, color: assignDueDate === opt.date ? colors.primary : colors.textMuted }}>
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
function ChallengeCard({ ch, colors, styles, onAssign }: {
  ch: Challenge; colors: AppColors;
  styles: ReturnType<typeof makeStyles>;
  onAssign: () => void;
}) {
  const diffColor  = DIFF_COLOR(ch.difficulty, colors);
  const catColor   = CAT_COLOR[ch.category] ?? colors.primary;

  return (
    <View style={styles.card}>
      <View style={[styles.cardAccent, { backgroundColor: catColor }]} />
      <View style={styles.cardBody}>
        {/* Badges row */}
        <View style={styles.badgesRow}>
          <View style={[styles.categoryBadge, { backgroundColor: catColor + '20', borderColor: catColor + '40' }]}>
            <Text style={[styles.categoryBadgeText, { color: catColor }]}>{ch.category}</Text>
          </View>
          <View style={[styles.diffBadge, { backgroundColor: diffColor + '20', borderColor: diffColor + '40' }]}>
            <Text style={[styles.diffBadgeText, { color: diffColor }]}>{ch.difficulty}</Text>
          </View>
        </View>

        <Text style={styles.cardTitle}>{ch.title}</Text>
        <Text style={styles.cardDesc}>{ch.description}</Text>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Feather name="star" size={11} color={colors.accentYellow} />
            <Text style={[styles.statText, { color: colors.accentYellow }]}>{ch.xpReward} XP</Text>
          </View>
          <View style={styles.statItem}>
            <Feather name="help-circle" size={11} color={colors.textDim} />
            <Text style={styles.statText}>{ch.questionCount} Qs</Text>
          </View>
          <View style={styles.statItem}>
            <Feather name="clock" size={11} color={colors.textDim} />
            <Text style={styles.statText}>{ch.timeLimitMinutes} min</Text>
          </View>
        </View>

        {/* Assign button */}
        <TouchableOpacity style={styles.assignRowBtn} onPress={onAssign} activeOpacity={0.8}>
          <Feather name="user-plus" size={13} color={colors.primary} />
          <Text style={styles.assignRowBtnText}>Assign to Student</Text>
        </TouchableOpacity>
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
  toggleActive:    { backgroundColor: c.primaryGlow },
  toggleText:      { fontSize: 14, fontWeight: '600', color: c.textMuted },
  toggleTextActive:{ color: c.primary },

  // Grade chips
  gradeChip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
  gradeChipActive:   { borderColor: c.primary, backgroundColor: c.primaryGlow },
  gradeChipText:     { fontSize: 13, fontWeight: '600', color: c.textMuted },
  gradeChipTextActive:{ color: c.primary },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  sectionSub:   { fontSize: 12, color: c.textDim, marginTop: -spacing.sm },

  emptyState:  { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText:   { fontSize: 14, color: c.textDim },

  // Challenge card
  card: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, overflow: 'hidden', flexDirection: 'row',
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
    borderWidth: 1, borderColor: c.primary + '50', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: c.primaryGlow,
  },
  assignRowBtnText: { fontSize: 13, fontWeight: '600', color: c.primary },

  // Leaderboard
  leaderCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, overflow: 'hidden',
  },
  leaderHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  leaderTitle:  { fontSize: 14, fontWeight: '700', color: c.textMain, flex: 1 },
  leaderPeriod: { fontSize: 11, color: c.textDim, fontWeight: '600' },
  leaderRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
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

  // Assign modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: {
    backgroundColor: c.cardDark, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: 36, gap: spacing.lg,
    borderTopWidth: 1, borderColor: c.borderColor, maxHeight: '85%',
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
    backgroundColor: c.primary + '20', alignItems: 'center', justifyContent: 'center',
  },
  studentAvatarText: { fontSize: 12, fontWeight: '800', color: c.primary },
  studentName:    { fontSize: 14, fontWeight: '600', color: c.textMain },
  studentGrade:   { fontSize: 11, color: c.textDim },
  noStudents:     { padding: spacing.lg, fontSize: 13, color: c.textDim, textAlign: 'center' },

  selectedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.primary + '50', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 11,
    backgroundColor: c.primaryGlow,
  },
  selectedChipName:  { fontSize: 14, fontWeight: '600', color: c.primary, flex: 1 },
  selectedChipGrade: { fontSize: 11, color: c.primary + 'aa' },

  assignBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, borderRadius: radius.lg, paddingVertical: 14,
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
    backgroundColor: c.primary, borderRadius: radius.lg,
    paddingVertical: 14, alignItems: 'center',
  },
  doneBtnText:  { fontSize: 15, fontWeight: '700', color: '#fff' },
});
