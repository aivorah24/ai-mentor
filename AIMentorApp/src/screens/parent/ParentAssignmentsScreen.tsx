import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import SERVER_URL from '../../config/serverUrl';

const FILTERS = ['All', 'School', 'Parent', 'Done'];
const SUBJECTS = ['Mathematics', 'Science', 'English', 'Social Studies'];
const TYPES = ['assignment', 'quiz'] as const;

interface Assignment {
  id: string;
  title: string;
  subject: string;
  chapter?: string;
  grade?: string | null;
  curriculum?: string | null;
  dueDate: string;
  type: string;
  status: 'pending' | 'completed';
  score: number | null;
  note: string;
  createdBy: string;
  aiFeedback?: string | null;
}

const SUBJECT_COLOR: Record<string, string> = {
  Mathematics: '#818CF8',
  Science: '#34D399',
  English: '#C084FC',
  'Social Studies': '#FBBF24',
};

function formatDue(iso: string): { label: string; isOverdue: boolean } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(iso); due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: `Overdue (${Math.abs(diff)} day${Math.abs(diff) > 1 ? 's' : ''})`, isOverdue: true };
  if (diff === 0) return { label: 'Due today', isOverdue: false };
  if (diff === 1) return { label: 'Due tomorrow', isOverdue: false };
  return { label: `Due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, isOverdue: false };
}

export default function ParentAssignmentsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { clearUnreadAssignments } = useNotification();
  const parentEmail = user?.email || 'parent@demo.com';

  const [children, setChildren] = useState<any[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeFilter, setActiveFilter] = useState('All');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [childStats, setChildStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [reportAssignment, setReportAssignment] = useState<Assignment | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Mathematics');
  const [chapter, setChapter] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [type, setType] = useState<'assignment' | 'quiz'>('assignment');
  const [note, setNote] = useState('');
  const [questions, setQuestions] = useState<string[]>(['']);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    clearUnreadAssignments(); // mark as seen when parent opens this screen
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setChildren(data); })
      .catch(() => {});
  }, [parentEmail]);

  const child = children[selectedIdx];

  useEffect(() => {
    if (!child) return;
    setLoading(true);
    Promise.all([
      fetch(`${SERVER_URL}/assignments?studentId=${child.id}`).then(r => r.json()).catch(() => []),
      fetch(`${SERVER_URL}/student/${child.id}`).then(r => r.json()).catch(() => null),
    ]).then(([assignData, statsData]) => {
      if (Array.isArray(assignData)) setAssignments(assignData);
      if (statsData && !statsData.error) setChildStats(statsData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [child?.id]);

  const filtered = useMemo(() => {
    if (activeFilter === 'All') return assignments;
    if (activeFilter === 'Done') return assignments.filter(a => a.status === 'completed');
    if (activeFilter === 'School') return assignments.filter(a => a.createdBy === 'teacher');
    if (activeFilter === 'Parent') return assignments.filter(a => a.createdBy === 'parent');
    return assignments;
  }, [assignments, activeFilter]);

  const completed = assignments.filter(a => a.status === 'completed').length;
  const pending = assignments.filter(a => a.status === 'pending').length;
  const overdue = assignments.filter(a => {
    if (a.status !== 'pending') return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(a.dueDate) < today;
  }).length;
  const totalStudyMins = childStats?.studyTimeMinutes ?? 0;
  const completionPct = assignments.length > 0 ? Math.round((completed / assignments.length) * 100) : 0;
  const onTrackPct = childStats ? Math.round(((childStats.currentStreak ?? 0) / 7) * 100) : null;

  function resetForm() {
    setTitle(''); setChapter(''); setDueDate(''); setNote('');
    setSubject('Mathematics'); setType('assignment');
    setQuestions(['']); setFormError('');
  }

  async function createAssignment() {
    if (!title.trim()) { setFormError('Title is required'); return; }
    if (!dueDate.trim()) { setFormError('Due date is required (YYYY-MM-DD)'); return; }
    if (!child) { setFormError('No child selected'); return; }
    setFormError('');
    setCreating(true);
    try {
      const res = await fetch(`${SERVER_URL}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          subject,
          chapter: chapter.trim(),
          dueDate,
          type,
          note: note.trim(),
          studentId: child.id,
          createdById: parentEmail,
          createdByRole: 'parent',
          grade: child.grade,
          questions: questions.filter(q => q.trim()),
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setAssignments(prev => [created, ...prev]);
        setShowModal(false);
        resetForm();
      } else {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || 'Failed to create assignment');
      }
    } catch {
      setFormError('Network error — is the server running?');
    } finally {
      setCreating(false);
    }
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Assignments"
          subtitle={child ? `${child.name} · ${child.grade}` : 'Loading...'}
          searchPlaceholder="Search assignments..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Child Selector */}
          {children.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.childRow}>
              {children.map((c, i) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.childTab, selectedIdx === i && styles.childTabActive]}
                  onPress={() => setSelectedIdx(i)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.childTabName, { color: selectedIdx === i ? colors.primary : colors.textMuted }]}>{c.name}</Text>
                  <Text style={styles.childTabGrade}>{c.grade}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* This week at a glance */}
          <View style={styles.glanceCard}>
            <View style={styles.glanceHeader}>
              <View>
                <Text style={styles.glanceTitle}>This week at a glance</Text>
                <Text style={styles.glanceSub}>School vs parent tasks · Mon–Sun</Text>
              </View>
              {child && (
                <View style={styles.childBadge}>
                  <Text style={styles.childBadgeText}>{child.name} · {child.grade}</Text>
                </View>
              )}
            </View>
            <View style={styles.glanceStats}>
              <View style={styles.glanceStat}>
                <Text style={styles.glanceStatLabel}>Completed</Text>
                <Text style={styles.glanceStatValue}>{completed}<Text style={styles.glanceStatTotal}> /{assignments.length}</Text></Text>
                <Text style={[styles.glanceStatNote, { color: colors.accentGreen }]}>{completionPct}% done</Text>
              </View>
              <View style={styles.glanceDivider} />
              <View style={styles.glanceStat}>
                <Text style={styles.glanceStatLabel}>Upcoming</Text>
                <Text style={styles.glanceStatValue}>{pending}</Text>
                <Text style={[styles.glanceStatNote, { color: colors.accentYellow }]}>{overdue > 0 ? `${overdue} overdue` : 'On track'}</Text>
              </View>
              <View style={styles.glanceDivider} />
              <View style={styles.glanceStat}>
                <Text style={styles.glanceStatLabel}>Study Time</Text>
                <Text style={styles.glanceStatValue}>{Math.floor(totalStudyMins / 60)}.{Math.floor((totalStudyMins % 60) / 6)}<Text style={styles.glanceStatTotal}>h</Text></Text>
                {onTrackPct !== null && (
                  <Text style={[styles.glanceStatNote, { color: colors.accentBlue }]}>{onTrackPct}% on track</Text>
                )}
              </View>
            </View>
          </View>

          {/* Filter + New Assignment */}
          <View style={styles.filterRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              {FILTERS.map(f => (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterTab, activeFilter === f && styles.filterTabActive]}
                  onPress={() => setActiveFilter(f)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.newBtn} activeOpacity={0.8} onPress={() => setShowModal(true)}>
              <Feather name="plus" size={14} color="white" />
              <Text style={styles.newBtnText}>New</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>TODAY & UPCOMING</Text>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="check-square" size={32} color={colors.textDim} />
              <Text style={styles.emptyText}>No assignments here</Text>
              {activeFilter === 'Parent' && (
                <TouchableOpacity style={styles.emptyAddBtn} onPress={() => setShowModal(true)} activeOpacity={0.8}>
                  <Feather name="plus" size={14} color={colors.primary} />
                  <Text style={styles.emptyAddText}>Add an assignment for {child?.name}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            filtered.map(a => {
              const color = SUBJECT_COLOR[a.subject] ?? '#6366f1';
              const due = a.status === 'completed'
                ? { label: a.score != null ? `Score: ${a.score}%` : 'Completed', isOverdue: false }
                : formatDue(a.dueDate);
              const statusLabel = a.status === 'completed' ? 'Completed'
                : due.isOverdue ? 'Needs Attention' : 'Upcoming';
              const statusColor = a.status === 'completed' ? colors.accentGreen
                : due.isOverdue ? colors.accentRed : colors.accentBlue;

              return (
                <View key={a.id} style={styles.assignmentCard}>
                  <View style={[styles.assignmentIcon, { backgroundColor: color + '18' }]}>
                    <Feather name="book-open" size={18} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.assignmentTitleRow}>
                      <Text style={styles.assignmentTitle} numberOfLines={1}>{a.title}</Text>
                      <View style={[styles.statusPill, { backgroundColor: statusColor + '18', borderColor: statusColor + '33' }]}>
                        <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
                      </View>
                    </View>
                    <View style={styles.assignmentMeta}>
                      <Feather name="alert-circle" size={11} color={due.isOverdue ? colors.accentRed : colors.textDim} />
                      <Text style={[styles.assignmentDue, { color: due.isOverdue ? colors.accentRed : colors.textMuted }]}>
                        {due.label}
                      </Text>
                      {a.createdBy === 'parent' && (
                        <>
                          <Feather name="user" size={11} color={colors.accentGreen} />
                          <Text style={[styles.assignmentTime, { color: colors.accentGreen }]}>By you</Text>
                        </>
                      )}
                    </View>
                    {a.status === 'completed' && a.aiFeedback ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                        <Text style={{ flex: 1, fontSize: 11, color: colors.accentGreen }} numberOfLines={1}>
                          {(() => {
                            try { return JSON.parse(a.aiFeedback || '{}').text || 'AI feedback available'; }
                            catch { return a.aiFeedback || 'AI feedback available'; }
                          })()}
                        </Text>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: color + '50', backgroundColor: color + '12' }}
                          onPress={() => setReportAssignment(a)}
                          activeOpacity={0.75}
                        >
                          <Feather name="bar-chart-2" size={12} color={color} />
                          <Text style={{ fontSize: 11, fontWeight: '700', color }}>Report</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {reportAssignment && (
          <ParentAIReportModal
            assignment={reportAssignment}
            colors={colors}
            onClose={() => setReportAssignment(null)}
          />
        )}

        {/* Create Assignment Modal */}
        <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => { setShowModal(false); resetForm(); }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>New Assignment</Text>
                    {child && <Text style={styles.modalSub}>For {child.name} · {child.grade}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => { setShowModal(false); resetForm(); }} activeOpacity={0.75}>
                    <Feather name="x" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent} nestedScrollEnabled>

                  <Text style={styles.fieldLabel}>Title *</Text>
                  <TextInput
                    style={[styles.input, formError && !title.trim() && { borderColor: colors.accentRed }]}
                    placeholder="e.g. Practice fractions worksheet"
                    placeholderTextColor={colors.textDim}
                    value={title}
                    onChangeText={t => { setTitle(t); if (t.trim()) setFormError(''); }}
                  />

                  <Text style={styles.fieldLabel}>Subject</Text>
                  <View style={styles.chipRow}>
                    {SUBJECTS.map(s => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.chip, subject === s && { backgroundColor: colors.primaryGlow, borderColor: colors.primary }]}
                        onPress={() => setSubject(s)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.chipText, subject === s && { color: colors.primary }]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Chapter / Topic</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Chapter 5 — Fractions"
                    placeholderTextColor={colors.textDim}
                    value={chapter}
                    onChangeText={setChapter}
                  />

                  <Text style={styles.fieldLabel}>Due Date * (YYYY-MM-DD)</Text>
                  <TextInput
                    style={[styles.input, formError && !dueDate.trim() && { borderColor: colors.accentRed }]}
                    placeholder="2026-04-15"
                    placeholderTextColor={colors.textDim}
                    value={dueDate}
                    onChangeText={t => { setDueDate(t); if (t.trim()) setFormError(''); }}
                    keyboardType="numeric"
                  />

                  <Text style={styles.fieldLabel}>Type</Text>
                  <View style={styles.chipRow}>
                    {TYPES.map(t => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.chip, type === t && { backgroundColor: colors.primaryGlow, borderColor: colors.primary }]}
                        onPress={() => setType(t)}
                        activeOpacity={0.75}
                      >
                        <Feather name={t === 'quiz' ? 'help-circle' : 'file-text'} size={13} color={type === t ? colors.primary : colors.textMuted} />
                        <Text style={[styles.chipText, type === t && { color: colors.primary }]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={styles.fieldLabel}>Questions (optional)</Text>
                    {questions.length < 8 && (
                      <TouchableOpacity onPress={() => setQuestions(prev => [...prev, ''])} activeOpacity={0.75} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Feather name="plus-circle" size={14} color={colors.primary} />
                        <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '600' }}>Add</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {questions.map((q, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder={`Question ${i + 1}...`}
                        placeholderTextColor={colors.textDim}
                        value={q}
                        onChangeText={t => setQuestions(prev => prev.map((x, j) => j === i ? t : x))}
                      />
                      {questions.length > 1 && (
                        <TouchableOpacity onPress={() => setQuestions(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.75}>
                          <Feather name="trash-2" size={16} color={colors.accentRed} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}

                  <Text style={styles.fieldLabel}>Note (optional)</Text>
                  <TextInput
                    style={[styles.input, styles.inputMulti]}
                    placeholder="Instructions or context for your child..."
                    placeholderTextColor={colors.textDim}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    numberOfLines={3}
                  />

                  <View style={styles.infoNote}>
                    <Feather name="user" size={13} color={colors.accentGreen} />
                    <Text style={styles.infoNoteText}>
                      This assignment will be visible to {child?.name ?? 'your child'} in their Assignments screen.
                    </Text>
                  </View>

                  {formError ? (
                    <View style={styles.errorBox}>
                      <Feather name="alert-circle" size={13} color={colors.accentRed} />
                      <Text style={styles.errorText}>{formError}</Text>
                    </View>
                  ) : null}

                  <TouchableOpacity style={styles.submitBtn} onPress={createAssignment} activeOpacity={0.85} disabled={creating}>
                    {creating ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Feather name="send" size={15} color="#fff" />
                        <Text style={styles.submitBtnText}>Create Assignment</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },

  childRow: { flexDirection: 'row', marginBottom: spacing.md },
  childTab: {
    alignItems: 'center', marginRight: spacing.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.lg, borderWidth: 1, borderColor: 'transparent',
  },
  childTabActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  childTabName: { fontSize: 14, fontWeight: '700' },
  childTabGrade: { fontSize: 10, color: c.textDim, marginTop: 2 },

  glanceCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.xl,
  },
  glanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xl },
  glanceTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  glanceSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  childBadge: { backgroundColor: c.primaryGlow, borderWidth: 1, borderColor: c.primary + '40', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  childBadgeText: { fontSize: 11, fontWeight: '600', color: c.primary },
  glanceStats: { flexDirection: 'row' },
  glanceStat: { flex: 1, paddingHorizontal: spacing.md },
  glanceDivider: { width: 1, backgroundColor: c.borderColor },
  glanceStatLabel: { fontSize: 11, color: c.textMuted, marginBottom: 4 },
  glanceStatValue: { fontSize: 26, fontWeight: '700', color: c.textMain },
  glanceStatTotal: { fontSize: 14, fontWeight: '400', color: c.textMuted },
  glanceStatNote: { fontSize: 11, fontWeight: '600', marginTop: 4 },

  filterRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl, gap: spacing.md },
  filterTab: {
    paddingHorizontal: spacing.lg, paddingVertical: 10, marginRight: spacing.sm,
    borderRadius: radius.md, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
  },
  filterTabActive: { backgroundColor: c.primary, borderColor: c.primary },
  filterText: { fontSize: 13, fontWeight: '500', color: c.textMuted },
  filterTextActive: { color: 'white' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md },
  newBtnText: { fontSize: 13, fontWeight: '700', color: 'white' },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: c.textDim, letterSpacing: 0.8, marginBottom: spacing.md, textTransform: 'uppercase' },

  assignmentCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md,
  },
  assignmentIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  assignmentTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  assignmentTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: c.textMain },
  statusPill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: '600' },
  assignmentMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  assignmentDue: { fontSize: 11, fontWeight: '500', marginRight: 8 },
  assignmentTime: { fontSize: 11, color: c.textMuted },

  emptyState: { alignItems: 'center', paddingVertical: 48, gap: spacing.md },
  emptyText: { fontSize: 14, color: c.textDim },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  emptyAddText: { fontSize: 13, color: c.primary, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: c.cardDark, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%', borderWidth: 1, borderColor: c.borderColor,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: c.textMain },
  modalSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  modalContent: { padding: spacing.xl, gap: spacing.md, paddingBottom: 40 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
    color: c.textMain, fontSize: 14,
  },
  inputMulti: { height: 80, textAlignVertical: 'top', paddingTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  infoNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentGreen + '12', borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: c.accentGreen + '30',
  },
  infoNoteText: { fontSize: 12, color: c.textMuted, flex: 1 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.accentRed + '14', borderWidth: 1, borderColor: c.accentRed + '40',
    borderRadius: radius.sm, padding: spacing.md,
  },
  errorText: { fontSize: 12, color: c.accentRed, flex: 1 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.primary, padding: 16, borderRadius: radius.md, marginTop: spacing.sm,
  },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

const REPORT_SUBJECT_COLORS: Record<string, string> = {
  Mathematics: '#818CF8',
  Science: '#34D399',
  English: '#FBBF24',
  'Social Studies': '#22D3EE',
};

function ParentAIReportModal({ assignment, colors, onClose }: { assignment: Assignment; colors: AppColors; onClose: () => void }) {
  const color = REPORT_SUBJECT_COLORS[assignment.subject] || colors.primary;

  let feedbackText = '';
  let stamp = '';
  let wellDone = '';
  let improve = '';
  let perQuestion: any[] = [];
  try {
    const parsed = JSON.parse(assignment.aiFeedback || '{}');
    feedbackText = parsed.text || '';
    stamp = parsed.stamp || '';
    wellDone = parsed.wellDone || '';
    improve = parsed.improve || '';
    perQuestion = Array.isArray(parsed.perQuestion) ? parsed.perQuestion : [];
  } catch {
    feedbackText = assignment.aiFeedback || '';
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.cardDark, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', borderWidth: 1, borderBottomWidth: 0, borderColor: colors.borderColor }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.borderColor, gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: color + '20', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="bar-chart-2" size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: colors.textMain }} numberOfLines={1}>{assignment.title}</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>AI Score & Feedback</Text>
            </View>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, alignItems: 'center', padding: 20, borderRadius: 14, backgroundColor: color + '12', borderWidth: 1, borderColor: color + '30' }}>
                <Text style={{ fontSize: 42, fontWeight: '900', color, letterSpacing: -1 }}>
                  {assignment.score != null ? `${assignment.score}%` : '--'}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color, marginTop: 4 }}>Overall Score</Text>
              </View>
              {stamp ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 14, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Feather name="award" size={24} color={color} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color, textAlign: 'center', marginTop: 8 }}>{stamp}</Text>
                </View>
              ) : null}
            </View>

            {feedbackText ? (
              <View style={{ backgroundColor: colors.bgDark, borderRadius: 12, padding: 16, gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Overall Feedback</Text>
                <Text style={{ fontSize: 14, color: colors.textMain, lineHeight: 22 }}>{feedbackText}</Text>
              </View>
            ) : null}

            {wellDone ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '08' }}>
                <Feather name="check-circle" size={16} color={colors.accentGreen} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accentGreen, textTransform: 'uppercase' }}>Strength</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{wellDone}</Text>
                </View>
              </View>
            ) : null}
            {improve ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '08' }}>
                <Feather name="target" size={16} color={colors.accentYellow} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accentYellow, textTransform: 'uppercase' }}>Needs Improvement</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{improve}</Text>
                </View>
              </View>
            ) : null}

            {perQuestion.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Question Analysis</Text>
                {perQuestion.map((q: any, idx: number) => {
                  const qColor = !q.answered ? colors.textDim : q.correct ? colors.accentGreen : q.score >= 50 ? colors.accentYellow : colors.accentRed;
                  const qIcon = !q.answered ? 'minus-circle' : q.correct ? 'check-circle' : q.score >= 50 ? 'alert-circle' : 'x-circle';
                  return (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: qColor + '40', backgroundColor: qColor + '08' }}>
                      <Feather name={qIcon as any} size={16} color={qColor} style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: qColor }}>Q{q.number ?? idx + 1}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain, lineHeight: 18, marginBottom: 3 }} numberOfLines={2}>{q.question}</Text>
                        <Text style={{ fontSize: 12, color: q.answered ? colors.textMuted : qColor, lineHeight: 17 }}>{q.comment}</Text>
                      </View>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: qColor + '20' }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: qColor }}>{q.answered ? `${q.score}%` : '--'}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: 12, backgroundColor: color }}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Feather name="check" size={16} color="#fff" />
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Close Report</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
