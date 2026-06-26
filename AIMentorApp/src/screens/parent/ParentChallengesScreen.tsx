import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

interface Child { id: string; name: string; grade: string; curriculum?: string; }

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
  // assignment fields
  assignmentId?: string | null;
  status?: string;
}


export default function ParentChallengesScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [children, setChildren]       = useState<Child[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [childStats, setChildStats]   = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const [challenges, setChallenges]   = useState<Challenge[]>([]);
  const [loadingCh, setLoadingCh]     = useState(false);

  // Assign modal
  const [assignModal, setAssignModal]         = useState(false);
  const [assignChallenge, setAssignChallenge] = useState<Challenge | null>(null);
  const [assigning, setAssigning]             = useState(false);
  const [assignError, setAssignError]         = useState('');
  const [assignSuccess, setAssignSuccess]     = useState('');
  const [assignDueDate, setAssignDueDate]     = useState('');

  // Fetch children
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data) && data.length > 0) setChildren(data); })
      .catch(() => {});
  }, [user?.email]);

  const child = children[selectedIdx] ?? null;

  // Fetch child stats
  useEffect(() => {
    if (!child) return;
    setLoadingStats(true);
    fetch(`${SERVER_URL}/student/${child.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setChildStats(data))
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  }, [child?.id]);

  // Fetch challenges for child's grade
  const fetchChallenges = useCallback(() => {
    if (!child?.grade) return;
    setLoadingCh(true);
    fetch(`${SERVER_URL}/challenges?grade=${encodeURIComponent(child.grade)}&curriculum=${encodeURIComponent(child.curriculum || 'IB PYP')}&studentId=${child.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setChallenges(data); })
      .catch(() => {})
      .finally(() => setLoadingCh(false));
  }, [child?.id, child?.grade]);

  useEffect(() => { fetchChallenges(); }, [fetchChallenges]);

  // Open assign confirm modal
  function openAssign(ch: Challenge) {
    setAssignChallenge(ch);
    setAssignError('');
    setAssignSuccess('');
    // Default due date: 7 days from now
    const d = new Date(); d.setDate(d.getDate() + 7);
    setAssignDueDate(d.toISOString().split('T')[0]);
    setAssignModal(true);
  }

  function closeAssign() {
    setAssignModal(false);
    setAssignChallenge(null);
    setAssignError('');
    setAssignSuccess('');
    setAssignDueDate('');
  }

  // Due date helper
  function getDueDateLabel(offset: number) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
  }

  async function doAssign() {
    if (!assignChallenge || !child) return;
    if (!assignDueDate) { setAssignError('Please select a due date'); return; }
    setAssigning(true);
    setAssignError('');
    try {
      const res = await fetch(`${SERVER_URL}/challenges/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId:    assignChallenge.id,
          studentId:      child.id,
          assignedById:   user?.email ?? '',
          assignedByRole: 'parent',
          dueDate:        assignDueDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAssignError(err.error ?? 'Failed to assign. Try again.');
        return;
      }
      setAssignSuccess(`"${assignChallenge.title}" assigned to ${child.name}!`);
      // Refresh challenges to update status
      fetchChallenges();
    } catch {
      setAssignError('Network error. Please try again.');
    } finally {
      setAssigning(false);
    }
  }

  const schoolChallenges = challenges.filter(c => c.type === 'school_challenge');
  const olympiadChallenges = challenges.filter(c => c.type === 'olympiad');
  const advancedPractice = challenges.filter(c => c.type === 'advanced_practice');

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Challenges"
          subtitle="School challenges, olympiad prep, and advanced practice"
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Child selector */}
          {children.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.childRow} contentContainerStyle={{ gap: 8 }}>
              {children.map((c, i) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.childTab, i === selectedIdx && styles.childTabActive]}
                  onPress={() => setSelectedIdx(i)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.childTabName, i === selectedIdx && styles.childTabNameActive]}>{c.name}</Text>
                  <Text style={[styles.childTabGrade, i === selectedIdx && styles.childTabGradeActive]}>{c.grade}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Child stats strip */}
          {child && (
            <View style={styles.statsRow}>
              {loadingStats ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <View style={styles.statItem}>
                    <Feather name="star" size={14} color={colors.accentYellow} />
                    <Text style={styles.statValue}>{childStats?.xpPoints?.toLocaleString() ?? '—'}</Text>
                    <Text style={styles.statLabel}>XP</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Feather name="check-circle" size={14} color={colors.accentGreen} />
                    <Text style={styles.statValue}>{childStats?.challengesCompleted ?? '—'}</Text>
                    <Text style={styles.statLabel}>Done</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Feather name="zap" size={14} color={colors.accentRed} />
                    <Text style={styles.statValue}>{childStats?.currentStreak ?? '—'}d</Text>
                    <Text style={styles.statLabel}>Streak</Text>
                  </View>
                </>
              )}
            </View>
          )}

          {/* Leaderboard CTA */}
          <TouchableOpacity
            style={[styles.leaderCTA, { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '0C' }]}
            onPress={() => navigation.navigate('ParentLeaderboard')}
            activeOpacity={0.8}
          >
            <Feather name="award" size={16} color={colors.accentYellow} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.leaderCTATitle, { color: colors.accentYellow }]}>Class Leaderboard</Text>
              <Text style={styles.leaderCTASub}>See how {child?.name ?? 'your child'} ranks in the class</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.accentYellow} />
          </TouchableOpacity>

          {/* Challenges list */}
          {!child ? (
            <View style={styles.emptyState}>
              <Feather name="user" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>No child linked to your account yet.</Text>
            </View>
          ) : loadingCh ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 32 }} />
          ) : (
            <>
              {schoolChallenges.length > 0 && (
                <>
                  <View style={styles.sectionHeader}>
                    <View style={[styles.sectionIcon, { backgroundColor: colors.primaryGlow }]}>
                      <Feather name="award" size={15} color={colors.primary} />
                    </View>
                    <View>
                      <Text style={styles.sectionLabel}>School Challenges</Text>
                      <Text style={styles.sectionDesc}>School-wide competitive challenges for {child.name}</Text>
                    </View>
                  </View>
                  <View style={styles.cardGrid}>
                    {schoolChallenges.map(ch => (
                      <ChallengeCard key={ch.id} ch={ch} colors={colors} styles={styles} onAssign={() => openAssign(ch)} />
                    ))}
                  </View>
                </>
              )}

              {olympiadChallenges.length > 0 && (
                <>
                  <View style={[styles.sectionHeader, { marginTop: spacing.sm }]}>
                    <View style={[styles.sectionIcon, { backgroundColor: colors.accentYellow + '18' }]}>
                      <Feather name="target" size={15} color={colors.accentYellow} />
                    </View>
                    <View>
                      <Text style={styles.sectionLabel}>Olympiad-Style Questions</Text>
                      <Text style={styles.sectionDesc}>Competitive exam prep — logical reasoning and beyond</Text>
                    </View>
                  </View>
                  <View style={styles.cardGrid}>
                    {olympiadChallenges.map(ch => (
                      <ChallengeCard key={ch.id} ch={ch} colors={colors} styles={styles} onAssign={() => openAssign(ch)} />
                    ))}
                  </View>
                </>
              )}

              {advancedPractice.length > 0 && (
                <>
                  <View style={[styles.sectionHeader, { marginTop: spacing.sm }]}>
                    <View style={[styles.sectionIcon, { backgroundColor: colors.accentOrange + '18' }]}>
                      <Feather name="trending-up" size={15} color={colors.accentOrange} />
                    </View>
                    <View>
                      <Text style={styles.sectionLabel}>Advanced Practice</Text>
                      <Text style={styles.sectionDesc}>Push beyond normal assignments</Text>
                    </View>
                  </View>
                  <View style={styles.cardGrid}>
                    {advancedPractice.map(ch => (
                      <ChallengeCard key={ch.id} ch={ch} colors={colors} styles={styles} onAssign={() => openAssign(ch)} />
                    ))}
                  </View>
                </>
              )}

              {challenges.length === 0 && (
                <View style={styles.emptyState}>
                  <Feather name="inbox" size={28} color={colors.textDim} />
                  <Text style={styles.emptyText}>No challenges available for {child.grade} yet.</Text>
                </View>
              )}
            </>
          )}

          {/* Info note */}
          <View style={styles.infoCard}>
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={styles.infoText}>
              You can assign challenges to {child?.name ?? 'your child'} directly. Teachers can also assign school and olympiad challenges from their dashboard.
            </Text>
          </View>

        </ScrollView>
      </View>

      {/* Assign Confirm Modal */}
      <Modal visible={assignModal} transparent animationType="fade" onRequestClose={closeAssign}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            {assignSuccess ? (
              <>
                <View style={styles.successIcon}>
                  <Feather name="check-circle" size={28} color={colors.accentGreen} />
                </View>
                <Text style={styles.successTitle}>Challenge Assigned!</Text>
                <Text style={styles.successSub}>{assignSuccess}</Text>
                <TouchableOpacity style={styles.doneBtn} onPress={closeAssign} activeOpacity={0.85}>
                  <Text style={styles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.confirmTitle}>Assign Challenge</Text>
                <Text style={styles.confirmDesc}>
                  Assign <Text style={{ fontWeight: '700', color: colors.textMain }}>{assignChallenge?.title}</Text> to{' '}
                  <Text style={{ fontWeight: '700', color: colors.primary }}>{child?.name}</Text>?
                </Text>

                <View style={styles.confirmMeta}>
                  <Feather name="star" size={13} color={colors.accentYellow} />
                  <Text style={[styles.confirmMetaText, { color: colors.accentYellow }]}>{assignChallenge?.xpReward} XP reward</Text>
                  <View style={styles.dot} />
                  <Text style={styles.confirmMetaText}>{assignChallenge?.questionCount} questions</Text>
                  <View style={styles.dot} />
                  <Text style={styles.confirmMetaText}>{assignChallenge?.timeLimitMinutes} min</Text>
                </View>

                {/* Due date picker */}
                <View style={{ marginTop: 14 }}>
                  <Text style={[styles.confirmMetaText, { marginBottom: 8, fontWeight: '600', color: colors.textMain }]}>
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
                        <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: assignDueDate === opt.date ? colors.primary : colors.textMuted }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 6 }}>
                    Due: {assignDueDate || 'Not set'}
                  </Text>
                </View>

                {assignError ? (
                  <View style={styles.errorBox}>
                    <Feather name="alert-circle" size={13} color={colors.accentRed} />
                    <Text style={[styles.errorText, { color: colors.accentRed }]}>{assignError}</Text>
                  </View>
                ) : null}

                <View style={styles.confirmBtns}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={closeAssign} activeOpacity={0.7}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, assigning && styles.confirmBtnDisabled]}
                    onPress={doAssign} disabled={assigning} activeOpacity={0.85}
                  >
                    {assigning ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.confirmBtnText}>Assign</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
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
  const diffColor = ch.difficulty === 'Easy' ? colors.accentGreen
    : ch.difficulty === 'Hard' ? colors.accentRed : colors.accentYellow;
  const isAssigned = ch.status === 'assigned' || ch.status === 'completed';

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={2}>{ch.title}</Text>
        {isAssigned && (
          <View style={[styles.assignedBadge, {
            backgroundColor: ch.status === 'completed' ? colors.accentGreen + '20' : colors.primary + '20',
            borderColor: ch.status === 'completed' ? colors.accentGreen + '40' : colors.primary + '40',
          }]}>
            <Text style={[styles.assignedBadgeText, {
              color: ch.status === 'completed' ? colors.accentGreen : colors.primary,
            }]}>
              {ch.status === 'completed' ? 'Done' : 'Assigned'}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.cardDesc}>{ch.description}</Text>
      <View style={styles.metaRow}>
        <View style={[styles.metaChip, { backgroundColor: diffColor + '20', borderColor: diffColor + '40' }]}>
          <Text style={[styles.metaChipText, { color: diffColor }]}>{ch.difficulty}</Text>
        </View>
        <View style={styles.xpChip}>
          <Feather name="star" size={10} color={colors.accentYellow} />
          <Text style={[styles.xpChipText, { color: colors.accentYellow }]}>{ch.xpReward} XP</Text>
        </View>
        <View style={styles.metaItem}>
          <Feather name="clock" size={10} color={colors.textDim} />
          <Text style={styles.metaItemText}>{ch.timeLimitMinutes} min</Text>
        </View>
      </View>
      {!isAssigned && (
        <TouchableOpacity style={styles.assignBtn} onPress={onAssign} activeOpacity={0.8}>
          <Feather name="plus-circle" size={13} color={colors.primary} />
          <Text style={styles.assignBtnText}>Assign to Child</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────
const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:   { flex: 1, backgroundColor: c.bgDark },
  content:  { padding: spacing.xl, paddingBottom: 40, gap: spacing.lg },

  childRow:           { marginBottom: spacing.sm },
  childTab:           { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark, alignItems: 'center' },
  childTabActive:     { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
  childTabName:       { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: c.textMuted },
  childTabNameActive: { color: c.accentYellow },
  childTabGrade:      { fontFamily: fonts.serif, fontSize: 11, color: c.textDim, marginTop: 1 },
  childTabGradeActive:{ color: c.accentYellow + 'aa' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, justifyContent: 'space-around',
  },
  statItem:    { alignItems: 'center', gap: 4, flexDirection: 'row' },
  statValue:   { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: c.textMain, marginLeft: 4 },
  statLabel:   { fontFamily: fonts.serif, fontSize: 11, color: c.textDim },
  statDivider: { width: 1, height: 24, backgroundColor: c.borderColor },

  leaderCTA: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderRadius: radius.xl, padding: spacing.lg,
  },
  leaderCTATitle: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700' },
  leaderCTASub:   { fontFamily: fonts.serif, fontSize: 12, color: c.textDim, marginTop: 2 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sectionIcon:   { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  sectionLabel:  { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: c.textMain },
  sectionDesc:   { fontFamily: fonts.serif, fontSize: 12, color: c.textDim, marginTop: 2 },

  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText:  { fontFamily: fonts.serif, fontSize: 14, color: c.textDim, textAlign: 'center' },

  // Challenge card grid
  cardGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md,
  },
  card: {
    width: '48.5%' as any,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm,
  },
  cardTop:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle:     { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: c.textMain, flex: 1 },
  cardDesc:      { fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, lineHeight: 18 },
  metaRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaChip:      { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  metaChipText:  { fontFamily: fonts.serif, fontSize: 10, fontWeight: '600' },
  xpChip:        { flexDirection: 'row', alignItems: 'center', gap: 3 },
  xpChipText:    { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700' },
  metaItem:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaItemText:  { fontFamily: fonts.serif, fontSize: 11, color: c.textDim },

  assignedBadge:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  assignedBadgeText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700' },

  assignBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: c.primary + '50', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: c.primaryGlow,
  },
  assignBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: c.primary },

  infoCard: {
    flexDirection: 'row', gap: 8, backgroundColor: c.primaryGlow,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.primary + '30',
  },
  infoText: { flex: 1, fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, lineHeight: 18 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  modalBox: {
    backgroundColor: c.cardDark, borderRadius: radius.xl,
    padding: spacing.xl, width: '100%', maxWidth: 380,
    borderWidth: 1, borderColor: c.borderColor, gap: spacing.lg,
  },
  confirmTitle:    { fontFamily: fonts.serif, fontSize: 17, fontWeight: '800', color: c.textMain },
  confirmDesc:     { fontFamily: fonts.serif, fontSize: 14, color: c.textMuted, lineHeight: 20 },
  confirmMeta:     { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  confirmMetaText: { fontFamily: fonts.serif, fontSize: 12, color: c.textDim, fontWeight: '500' },
  dot:             { width: 3, height: 3, borderRadius: 2, backgroundColor: c.textDim },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentRed + '20', borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: c.accentRed + '40',
  },
  errorText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', flex: 1 },

  confirmBtns:    { flexDirection: 'row', gap: spacing.md },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg,
    paddingVertical: 13, alignItems: 'center',
  },
  cancelBtnText:  { fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', color: c.textMuted },
  confirmBtn: {
    flex: 1, backgroundColor: c.primary, borderRadius: radius.lg,
    paddingVertical: 13, alignItems: 'center',
  },
  confirmBtnDisabled: { opacity: 0.45 },
  confirmBtnText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: '#fff' },

  successIcon:  { alignItems: 'center' },
  successTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '800', color: c.textMain, textAlign: 'center' },
  successSub:   { fontFamily: fonts.serif, fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20 },
  doneBtn: {
    backgroundColor: c.primary, borderRadius: radius.lg,
    paddingVertical: 13, alignItems: 'center',
  },
  doneBtnText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: '#fff' },
});



