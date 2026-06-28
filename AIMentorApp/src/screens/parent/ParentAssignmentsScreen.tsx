import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import DatePicker from '../../components/common/DatePicker';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import SERVER_URL from '../../config/serverUrl';

const FILTERS = ['All', 'School', 'Parent', 'Done'];
// IB PYP official subject groups
const IB_PYP_SUBJECTS = ['Mathematics', 'Science', 'English', 'Social Studies', 'Arts', 'Physical Education', 'ICT'];
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
  questions?: string[];
  taskSteps?: any[];
  quizQuestions?: any[];
  documentUrl?: string | null;
  documentUrls?: string[];
  successCriteria?: string[];
}

function formatDue(iso: string): { label: string; isOverdue: boolean } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(iso); due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: 'Pending', isOverdue: false };
  if (diff === 0) return { label: 'Due today', isOverdue: false };
  if (diff === 1) return { label: 'Due tomorrow', isOverdue: false };
  return { label: `Due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, isOverdue: false };
}

// Grace period after a page load — a refresh that restores this route shouldn't
// instantly clear the unread badge; only a real in-session navigation should.
let pPageJustLoaded = true;
setTimeout(() => { pPageJustLoaded = false; }, 3000);

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
  const [detailAssignment, setDetailAssignment] = useState<Assignment | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Mathematics');
  const [chapter, setChapter] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [type, setType] = useState<'assignment' | 'quiz'>('assignment');
  const [note, setNote] = useState('');
  const [questions, setQuestions] = useState<string[]>(['']);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  // AI generate state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [quizCount, setQuizCount] = useState(5);
  // Curriculum topics
  const [curriculumTopics, setCurriculumTopics] = useState<{subject: string; topic: string; grade: string}[]>([]);
  const [showTopicPicker, setShowTopicPicker] = useState(false);

  // Refresh the children list on every focus so a newly added child appears in the
  // assign picker instantly (no manual refresh needed).
  useFocusEffect(useCallback(() => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setChildren(data); })
      .catch(() => {});
  }, [parentEmail]));

  // Mark assignments as seen only when this screen is actually focused (viewed),
  // not on mount, and not during the post-refresh grace period — otherwise a page
  // refresh clears the unread badge.
  useFocusEffect(useCallback(() => {
    if (!pPageJustLoaded) clearUnreadAssignments();
  }, [parentEmail]));

  const child = children[selectedIdx];

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAssignments = useCallback(() => {
    if (!child) return;
    Promise.all([
      fetch(`${SERVER_URL}/assignments?studentId=${child.id}&viewerRole=parent`).then(r => r.json()).catch(() => []),
      fetch(`${SERVER_URL}/student/${child.id}`).then(r => r.json()).catch(() => null),
    ]).then(([assignData, statsData]) => {
      if (Array.isArray(assignData)) setAssignments(assignData);
      if (statsData && !statsData.error) setChildStats(statsData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [child?.id]);

  useEffect(() => {
    if (!child) return;
    setLoading(true);
    fetchAssignments();
  }, [fetchAssignments]);

  // Reload on focus + poll every 30s while screen is visible
  useFocusEffect(useCallback(() => {
    fetchAssignments();
    intervalRef.current = setInterval(fetchAssignments, 30000);
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [fetchAssignments]));

  // Load IB PYP curriculum topics for the child's grade
  useEffect(() => {
    if (!child?.grade) return;
    fetch(`${SERVER_URL}/curriculum`)
      .then(r => r.json())
      .then(data => {
        const topics = (data.topics || []).filter((t: any) => t.grade === child.grade);
        setCurriculumTopics(topics);
      })
      .catch(() => {});
  }, [child?.grade]);

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
    setAiPrompt(''); setAiGenerated(false); setQuizCount(5); setShowTopicPicker(false);
  }

  async function generateWithAI() {
    if (!aiPrompt.trim()) return;
    if (!child) return;
    setAiGenerating(true);
    setFormError('');
    try {
      const res = await fetch(`${SERVER_URL}/assignments/ai-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          subject,
          grade: child.grade,
          curriculum: child.curriculum || 'IB PYP',
          count: quizCount,
          type,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTitle(data.title || '');
        setChapter(data.chapter || '');
        setNote(data.note || '');
        setType(data.type === 'quiz' ? 'quiz' : 'assignment');
        setQuestions(data.questions?.length > 0 ? data.questions : ['']);
        setAiGenerated(true);
      } else {
        const err = await res.json().catch(() => ({}));
        setFormError(err.error || 'AI generation failed');
      }
    } catch {
      setFormError('Network error — is the server running?');
    } finally {
      setAiGenerating(false);
    }
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
                  <Text style={[styles.childTabName, { color: selectedIdx === i ? colors.accentYellow : colors.textMuted }]}>{c.name}</Text>
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
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 24 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="check-square" size={32} color={colors.textDim} />
              <Text style={styles.emptyText}>No assignments here</Text>
              {activeFilter === 'Parent' && (
                <TouchableOpacity style={styles.emptyAddBtn} onPress={() => setShowModal(true)} activeOpacity={0.8}>
                  <Feather name="plus" size={14} color={colors.accentYellow} />
                  <Text style={styles.emptyAddText}>Add an assignment for {child?.name}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.assignmentList}>
            {filtered.map(a => {
              const due = a.status === 'completed'
                ? { label: (a as any).scoreHidden ? 'Score hidden by teacher' : (a.score != null ? `Score: ${a.score}%` : 'Completed'), isOverdue: false }
                : formatDue(a.dueDate);
              const statusLabel = a.status === 'completed' ? 'Done' : 'Upcoming';
              const statusColor = a.status === 'completed' ? colors.accentGreen : colors.accentBlue;

              return (
                <TouchableOpacity key={a.id} style={styles.assignmentRow} activeOpacity={0.75} onPress={() => setDetailAssignment(a)}>
                  <View style={[styles.assignmentIconSm, { backgroundColor: colors.accentYellow + '18' }]}>
                    <Feather name="book-open" size={14} color={colors.accentYellow} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.assignmentTitle} numberOfLines={1}>{a.title}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name="clock" size={10} color={colors.textDim} />
                      <Text style={[styles.assignmentDue, { color: colors.textMuted }]}>{due.label}</Text>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.accentYellow + '18' }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 9, fontWeight: '700', color: colors.accentYellow }}>
                          {a.type === 'quiz' ? 'Quiz' : (a.taskSteps?.length ?? 0) > 0 ? 'Scaffolded' : (a.documentUrls?.length ?? 0) > 0 ? 'Worksheet' : 'Task'}
                        </Text>
                      </View>
                      {a.createdBy === 'parent' && (
                        <Text style={{ fontFamily: fonts.serif, fontSize: 9, color: colors.accentGreen, fontWeight: '600' }}>By you</Text>
                      )}
                    </View>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: statusColor + '18', borderColor: statusColor + '33' }]}>
                    <Text style={[styles.statusPillText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            </View>
          )}
        </ScrollView>

        {reportAssignment && (
          <ParentAIReportModal
            assignment={reportAssignment}
            colors={colors}
            onClose={() => setReportAssignment(null)}
          />
        )}

        {detailAssignment && (
          <AssignmentDetailModal
            assignment={detailAssignment}
            colors={colors}
            childName={child?.name ?? ''}
            onClose={() => setDetailAssignment(null)}
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

                  {/* Title */}
                  <Text style={styles.fieldLabel}>Title *</Text>
                  <TextInput
                    style={[styles.input, formError && !title.trim() && { borderColor: colors.accentRed }]}
                    placeholder="e.g. Practice fractions worksheet"
                    placeholderTextColor={colors.textDim}
                    value={title}
                    onChangeText={t => { setTitle(t); if (t.trim()) setFormError(''); }}
                  />

                  {/* Subject */}
                  <Text style={styles.fieldLabel}>Subject</Text>
                  <View style={styles.chipRow}>
                    {IB_PYP_SUBJECTS.map(s => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.chip, subject === s && { backgroundColor: colors.accentYellow + '18', borderColor: colors.accentYellow }]}
                        onPress={() => setSubject(s)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.chipText, subject === s && { color: colors.accentYellow }]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Chapter / Topic */}
                  <Text style={styles.fieldLabel}>Chapter / Topic</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Chapter 5 — Fractions"
                    placeholderTextColor={colors.textDim}
                    value={chapter}
                    onChangeText={setChapter}
                  />

                  {/* Topic quick-picker from IB PYP curriculum */}
                  {curriculumTopics.filter(t => t.subject === subject).length > 0 && (
                    <View>
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}
                        onPress={() => setShowTopicPicker(p => !p)}
                        activeOpacity={0.75}
                      >
                        <Feather name="list" size={13} color={colors.accentYellow} />
                        <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.accentYellow, fontWeight: '700' }}>
                          {showTopicPicker ? 'Hide' : 'Pick from IB PYP topics'}
                        </Text>
                      </TouchableOpacity>
                      {showTopicPicker && (
                        <View style={styles.topicGrid}>
                          {curriculumTopics
                            .filter(t => t.subject === subject)
                            .map((t, i) => (
                              <TouchableOpacity
                                key={i}
                                style={[styles.topicChip, chapter === t.topic && { borderColor: colors.accentYellow, backgroundColor: colors.accentYellow + '18' }]}
                                onPress={() => { setChapter(t.topic); setShowTopicPicker(false); }}
                                activeOpacity={0.75}
                              >
                                <Text style={[styles.topicChipText, chapter === t.topic && { color: colors.accentYellow }]} numberOfLines={2}>
                                  {t.topic}
                                </Text>
                              </TouchableOpacity>
                            ))
                          }
                        </View>
                      )}
                    </View>
                  )}

                  {/* Due Date — themed gold calendar (matches the app theme) */}
                  <Text style={styles.fieldLabel}>Due Date *</Text>
                  <DatePicker
                    value={dueDate}
                    onChange={t => { setDueDate(t); if (t.trim()) setFormError(''); }}
                    placeholder="Select a due date"
                    minDate={new Date().toISOString().split('T')[0]}
                  />

                  {/* Type */}
                  <Text style={styles.fieldLabel}>Type</Text>
                  <View style={styles.chipRow}>
                    {TYPES.map(t => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.chip, type === t && { backgroundColor: colors.accentYellow + '18', borderColor: colors.accentYellow }]}
                        onPress={() => setType(t)}
                        activeOpacity={0.75}
                      >
                        <Feather name={t === 'quiz' ? 'help-circle' : 'file-text'} size={13} color={type === t ? colors.accentYellow : colors.textMuted} />
                        <Text style={[styles.chipText, type === t && { color: colors.accentYellow }]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* ── AI Generate panel (inline, like teacher) ── */}
                  <View style={styles.aiPanel}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Feather name="cpu" size={16} color={colors.accentYellow} />
                      <Text style={styles.aiPanelTitle}>Generate with AI</Text>
                      {aiGenerated && (
                        <View style={{ marginLeft: 'auto' as any, backgroundColor: colors.accentGreen + '20', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={{ fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: colors.accentGreen }}>Generated</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.aiPanelSub}>
                      Describe what {child?.name ?? 'your child'} needs to practice — AI will fill title, topic, and questions automatically.
                    </Text>

                    <TextInput
                      style={[styles.input, styles.inputMulti, { marginTop: 10 }]}
                      placeholder={`e.g. "Give 5 multiplication word problems for Grade 3" or "Food chain questions in IB PYP standard"`}
                      placeholderTextColor={colors.textDim}
                      value={aiPrompt}
                      onChangeText={setAiPrompt}
                      multiline
                      numberOfLines={3}
                    />

                    {/* Question count (for quiz) */}
                    {type === 'quiz' && (
                      <View style={{ marginTop: 10 }}>
                        <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>Number of Questions</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {[3, 5, 8, 10].map(n => (
                            <TouchableOpacity key={n} onPress={() => setQuizCount(n)} activeOpacity={0.75}
                              style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1.5,
                                borderColor: quizCount === n ? colors.accentYellow : colors.borderColor,
                                backgroundColor: quizCount === n ? colors.accentYellow + '18' : 'transparent' }}>
                              <Text style={{ fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: quizCount === n ? colors.accentYellow : colors.textMuted }}>{n}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}

                    <TouchableOpacity
                      style={[styles.aiGenerateBtn, { backgroundColor: aiPrompt.trim() ? colors.accentYellow : colors.borderColor }]}
                      onPress={generateWithAI}
                      activeOpacity={0.85}
                      disabled={aiGenerating || !aiPrompt.trim()}
                    >
                      {aiGenerating ? (
                        <ActivityIndicator color="#0B0B0B" size="small" />
                      ) : (
                        <>
                          <Feather name="zap" size={15} color="#0B0B0B" />
                          <Text style={styles.submitBtnText}>Generate Assignment</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Questions preview (after AI generate or manual) */}
                  {questions.filter(q => q.trim()).length > 0 && (
                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={styles.fieldLabel}>Questions</Text>
                        {questions.length < 10 && (
                          <TouchableOpacity onPress={() => setQuestions(prev => [...prev, ''])} activeOpacity={0.75} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Feather name="plus-circle" size={14} color={colors.accentYellow} />
                            <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.accentYellow, fontWeight: '600' }}>Add</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {questions.map((q, i) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accentYellow, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontFamily: fonts.serif, fontSize: 10, fontWeight: '800', color: '#0B0B0B' }}>{i + 1}</Text>
                          </View>
                          <TextInput
                            style={[styles.input, { flex: 1 }]}
                            placeholder={`Question ${i + 1}...`}
                            placeholderTextColor={colors.textDim}
                            value={q}
                            onChangeText={t => setQuestions(prev => prev.map((x, j) => j === i ? t : x))}
                          />
                          <TouchableOpacity onPress={() => setQuestions(prev => prev.filter((_, j) => j !== i))} activeOpacity={0.75}>
                            <Feather name="trash-2" size={16} color={colors.accentRed} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Note */}
                  <Text style={styles.fieldLabel}>Note to child (optional)</Text>
                  <TextInput
                    style={[styles.input, styles.inputMulti]}
                    placeholder="Instructions or encouragement for your child..."
                    placeholderTextColor={colors.textDim}
                    value={note}
                    onChangeText={setNote}
                    multiline
                    numberOfLines={3}
                  />

                  <View style={styles.infoNote}>
                    <Feather name="user" size={13} color={colors.accentGreen} />
                    <Text style={styles.infoNoteText}>
                      This assignment will appear in {child?.name ?? 'your child'}'s Assignments screen.
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
                      <ActivityIndicator color="#0B0B0B" size="small" />
                    ) : (
                      <>
                        <Feather name="send" size={15} color="#0B0B0B" />
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
  childTabActive: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
  childTabName: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700' },
  childTabGrade: { fontFamily: fonts.serif, fontSize: 10, color: c.textDim, marginTop: 2 },

  glanceCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.xl,
  },
  glanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xl },
  glanceTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: c.textMain },
  glanceSub: { fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, marginTop: 2 },
  childBadge: { backgroundColor: c.accentYellow + '18', borderWidth: 1, borderColor: c.accentYellow + '40', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  childBadgeText: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '600', color: c.accentYellow },
  glanceStats: { flexDirection: 'row' },
  glanceStat: { flex: 1, paddingHorizontal: spacing.md },
  glanceDivider: { width: 1, backgroundColor: c.borderColor },
  glanceStatLabel: { fontFamily: fonts.serif, fontSize: 11, color: c.textMuted, marginBottom: 4 },
  glanceStatValue: { fontFamily: fonts.serif, fontSize: 26, fontWeight: '700', color: c.textMain },
  glanceStatTotal: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '400', color: c.textMuted },
  glanceStatNote: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '600', marginTop: 4 },

  filterRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl, gap: spacing.md },
  filterTab: {
    paddingHorizontal: spacing.lg, paddingVertical: 10, marginRight: spacing.sm,
    borderRadius: radius.md, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
  },
  filterTabActive: { backgroundColor: c.accentYellow, borderColor: c.accentYellow },
  filterText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '500', color: c.textMuted },
  filterTextActive: { color: '#0B0B0B' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accentYellow, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: 999 },
  newBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },

  sectionLabel: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, letterSpacing: 0.8, marginBottom: spacing.md, textTransform: 'uppercase' },

  assignmentList: {
    gap: 6,
  },
  assignmentRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14,
  },
  assignmentIconSm: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  assignmentTitle: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: c.textMain },
  statusPill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '600' },
  assignmentMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  assignmentDue: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '500', marginRight: 8 },
  assignmentTime: { fontFamily: fonts.serif, fontSize: 11, color: c.textMuted },

  emptyState: { alignItems: 'center', paddingVertical: 48, gap: spacing.md },
  emptyText: { fontFamily: fonts.serif, fontSize: 14, color: c.textDim },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  emptyAddText: { fontFamily: fonts.serif, fontSize: 13, color: c.accentYellow, fontWeight: '600' },

  // Modal
  // Centered, width-capped modal — compact like the Teacher Assignment modal
  // (was a full-width bottom sheet that sprawled across desktop).
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  modalSheet: {
    backgroundColor: c.cardDark, borderRadius: 24,
    maxHeight: '90%', borderWidth: 1, borderColor: c.borderColor,
    width: '100%', maxWidth: 560, alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  modalTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '800', color: c.textMain },
  modalSub: { fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, marginTop: 2 },
  modalContent: { padding: spacing.xl, gap: spacing.md, paddingBottom: 40 },

  fieldLabel: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
    color: c.textMain, fontFamily: fonts.serif, fontSize: 14,
  },
  inputMulti: { height: 80, textAlignVertical: 'top', paddingTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  chipText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: c.textMuted },
  infoNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentGreen + '12', borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: c.accentGreen + '30',
  },
  infoNoteText: { fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, flex: 1 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.accentRed + '14', borderWidth: 1, borderColor: c.accentRed + '40',
    borderRadius: radius.sm, padding: spacing.md,
  },
  errorText: { fontFamily: fonts.serif, fontSize: 12, color: c.accentRed, flex: 1 },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.accentYellow, padding: 16, borderRadius: 999, marginTop: spacing.sm,
  },
  submitBtnText: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: '#0B0B0B' },

  // Topic picker grid
  topicGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  topicChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
    maxWidth: '48%',
  },
  topicChipText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '500', color: c.textMuted },

  // AI inline panel (teacher-style)
  aiPanel: {
    padding: 14, borderRadius: 14, borderWidth: 1.5,
    borderColor: c.accentYellow + '40', backgroundColor: c.accentYellow + '18', gap: 2,
  },
  aiPanelTitle: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: c.accentYellow },
  aiPanelSub: { fontFamily: fonts.serif, fontSize: 11, color: c.textDim, lineHeight: 17 },
  aiGenerateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: 14, borderRadius: 12, marginTop: 10,
  },
});

function AssignmentDetailModal({ assignment, colors, childName, onClose }: { assignment: Assignment; colors: AppColors; childName: string; onClose: () => void }) {
  const a = assignment;
  const isCompleted = a.status === 'completed';
  const due = isCompleted
    ? { label: a.score != null ? `Score: ${a.score}%` : 'Completed', isOverdue: false }
    : formatDue(a.dueDate);

  let feedback: any = {};
  let perQuestion: any[] = [];
  if (a.aiFeedback) {
    try {
      feedback = JSON.parse(a.aiFeedback);
      perQuestion = Array.isArray(feedback.perQuestion) ? feedback.perQuestion : [];
    } catch {
      feedback = { text: a.aiFeedback };
    }
  }

  const allQuestions: string[] = a.questions?.length ? a.questions : [];
  const taskSteps: any[] = a.taskSteps?.length ? a.taskSteps : [];
  const quizQuestions: any[] = a.quizQuestions?.length ? a.quizQuestions : [];
  const hasContent = allQuestions.length > 0 || taskSteps.length > 0 || quizQuestions.length > 0;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.cardDark, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', borderWidth: 1, borderBottomWidth: 0, borderColor: colors.borderColor }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.borderColor, gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accentYellow + '18', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="book-open" size={20} color={colors.accentYellow} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: colors.textMain }} numberOfLines={2}>{a.title}</Text>
              <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {a.subject}{a.chapter ? ` · ${a.chapter}` : ''} · {childName}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}>

            {/* Status + Due info */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, alignItems: 'center' }}>
                <Feather name={isCompleted ? 'check-circle' : 'clock'} size={22} color={isCompleted ? colors.accentGreen : colors.accentYellow} />
                <Text style={{ fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: isCompleted ? colors.accentGreen : colors.accentYellow, marginTop: 6 }}>
                  {isCompleted ? 'Completed' : 'Pending'}
                </Text>
                <Text style={{ fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 2 }}>{due.label}</Text>
              </View>
              {isCompleted && a.score != null && (
                <View style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: colors.accentYellow + '18', borderWidth: 1, borderColor: colors.accentYellow + '30', alignItems: 'center' }}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 36, fontWeight: '900', color: colors.accentYellow, letterSpacing: -1 }}>{a.score}%</Text>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', color: colors.accentYellow, marginTop: 2 }}>Score</Text>
                </View>
              )}
              {isCompleted && (a as any).scoreHidden && (
                <View style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="lock" size={20} color={colors.textMuted} />
                  <Text style={{ fontFamily: fonts.serif, fontSize: 11, color: colors.textMuted, marginTop: 6, textAlign: 'center', lineHeight: 15 }}>
                    Score hidden — the teacher has turned off progress sharing.
                  </Text>
                </View>
              )}
              {isCompleted && feedback.stamp && (
                <View style={{ flex: 1, padding: 16, borderRadius: 14, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="award" size={22} color={colors.accentYellow} />
                  <Text style={{ fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.accentYellow, textAlign: 'center', marginTop: 6 }}>{feedback.stamp}</Text>
                </View>
              )}
            </View>

            {/* Note from parent/teacher */}
            {a.note ? (
              <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 12, backgroundColor: colors.accentYellow + '18', borderWidth: 1, borderColor: colors.accentYellow + '30' }}>
                <Feather name="message-circle" size={14} color={colors.accentYellow} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentYellow, textTransform: 'uppercase', letterSpacing: 0.5 }}>Note</Text>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, marginTop: 4, lineHeight: 20 }}>{a.note}</Text>
                </View>
              </View>
            ) : null}

            {/* Overall AI Feedback (completed only) */}
            {isCompleted && feedback.text ? (
              <View style={{ padding: 14, borderRadius: 12, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, gap: 6 }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 }}>AI Feedback</Text>
                <Text style={{ fontFamily: fonts.serif, fontSize: 14, color: colors.textMain, lineHeight: 22 }}>{feedback.text}</Text>
              </View>
            ) : null}

            {/* Strengths & Improvement */}
            {isCompleted && (feedback.wellDone || feedback.improve) ? (
              <View style={{ gap: 10 }}>
                {feedback.wellDone ? (
                  <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '08' }}>
                    <Feather name="check-circle" size={15} color={colors.accentGreen} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentGreen, textTransform: 'uppercase' }}>Strength</Text>
                      <Text style={{ fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{feedback.wellDone}</Text>
                    </View>
                  </View>
                ) : null}
                {feedback.improve ? (
                  <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '08' }}>
                    <Feather name="target" size={15} color={colors.accentYellow} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentYellow, textTransform: 'uppercase' }}>Needs Improvement</Text>
                      <Text style={{ fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{feedback.improve}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Questions Section */}
            {hasContent && (
              <View style={{ gap: 10 }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {isCompleted ? 'Questions & Answers' : 'Questions'}
                </Text>

                {/* Regular questions */}
                {allQuestions.map((q, idx) => {
                  const pq = perQuestion.find((p: any) => (p.number ?? p.index) === idx + 1) || perQuestion[idx];
                  const qColor = !pq ? colors.textDim
                    : !pq.answered ? colors.textDim
                    : pq.correct ? colors.accentGreen
                    : (pq.score ?? 0) >= 50 ? colors.accentYellow
                    : colors.accentRed;
                  const qIcon = !pq ? 'circle'
                    : !pq.answered ? 'minus-circle'
                    : pq.correct ? 'check-circle'
                    : (pq.score ?? 0) >= 50 ? 'alert-circle'
                    : 'x-circle';

                  return (
                    <View key={idx} style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: (isCompleted && pq) ? qColor + '40' : colors.borderColor, backgroundColor: (isCompleted && pq) ? qColor + '06' : colors.bgDark, gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: isCompleted && pq ? qColor + '20' : colors.accentYellow + '18', alignItems: 'center', justifyContent: 'center' }}>
                          {isCompleted && pq ? (
                            <Feather name={qIcon as any} size={14} color={qColor} />
                          ) : (
                            <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '800', color: colors.accentYellow }}>{idx + 1}</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', color: colors.textMain, lineHeight: 20 }}>{q}</Text>
                          {isCompleted && pq && (
                            <View style={{ marginTop: 8, gap: 6 }}>
                              {pq.studentAnswer && (
                                <View style={{ flexDirection: 'row', gap: 6 }}>
                                  <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim }}>Answer:</Text>
                                  <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMain, flex: 1 }}>{pq.studentAnswer}</Text>
                                </View>
                              )}
                              {pq.correctAnswer && !pq.correct && (
                                <View style={{ flexDirection: 'row', gap: 6 }}>
                                  <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentGreen }}>Correct:</Text>
                                  <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.accentGreen, flex: 1 }}>{pq.correctAnswer}</Text>
                                </View>
                              )}
                              {pq.comment && (
                                <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, lineHeight: 18, fontStyle: 'italic' }}>{pq.comment}</Text>
                              )}
                              {pq.explanation && (
                                <View style={{ padding: 10, borderRadius: 8, backgroundColor: colors.accentYellow + '18', marginTop: 2 }}>
                                  <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentYellow, marginBottom: 2 }}>Explanation</Text>
                                  <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMain, lineHeight: 18 }}>{pq.explanation}</Text>
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                        {isCompleted && pq && pq.score != null && (
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: qColor + '20' }}>
                            <Text style={{ fontFamily: fonts.serif, fontSize: 12, fontWeight: '800', color: qColor }}>{pq.answered ? `${pq.score}%` : '--'}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}

                {/* Quiz questions (MCQ) */}
                {quizQuestions.map((qq: any, idx: number) => {
                  const pq = perQuestion.find((p: any) => (p.number ?? p.index) === idx + 1) || perQuestion[idx];
                  const qColor = !pq ? colors.textDim
                    : pq.correct ? colors.accentGreen
                    : colors.accentRed;

                  return (
                    <View key={`quiz-${idx}`} style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: (isCompleted && pq) ? qColor + '40' : colors.borderColor, backgroundColor: (isCompleted && pq) ? qColor + '06' : colors.bgDark, gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: isCompleted && pq ? qColor + '20' : colors.accentYellow + '18', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '800', color: isCompleted && pq ? qColor : colors.accentYellow }}>{idx + 1}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', color: colors.textMain, lineHeight: 20 }}>{qq.question}</Text>
                          {Array.isArray(qq.options) && (
                            <View style={{ marginTop: 8, gap: 4 }}>
                              {qq.options.map((opt: string, oi: number) => {
                                const isCorrectOpt = opt === qq.correctAnswer || opt === qq.answer;
                                const isStudentOpt = isCompleted && pq && opt === pq.studentAnswer;
                                return (
                                  <View key={oi} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: isStudentOpt ? (isCorrectOpt ? colors.accentGreen + '12' : colors.accentRed + '12') : isCompleted && isCorrectOpt ? colors.accentGreen + '08' : 'transparent' }}>
                                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: isStudentOpt ? (isCorrectOpt ? colors.accentGreen : colors.accentRed) : colors.borderColor, alignItems: 'center', justifyContent: 'center', backgroundColor: isStudentOpt ? (isCorrectOpt ? colors.accentGreen : colors.accentRed) : 'transparent' }}>
                                      {isStudentOpt && <Feather name={isCorrectOpt ? 'check' : 'x'} size={10} color="#fff" />}
                                    </View>
                                    <Text style={{ fontFamily: fonts.serif, fontSize: 13, color: isStudentOpt ? (isCorrectOpt ? colors.accentGreen : colors.accentRed) : colors.textMain, fontWeight: isStudentOpt || (isCompleted && isCorrectOpt) ? '600' : '400' }}>{opt}</Text>
                                    {isCompleted && isCorrectOpt && !isStudentOpt && (
                                      <Feather name="check" size={12} color={colors.accentGreen} />
                                    )}
                                  </View>
                                );
                              })}
                            </View>
                          )}
                          {isCompleted && pq?.comment && (
                            <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, lineHeight: 18, fontStyle: 'italic', marginTop: 6 }}>{pq.comment}</Text>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}

                {/* Scaffolded task steps */}
                {taskSteps.map((step: any, idx: number) => (
                  <View key={`step-${idx}`} style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accentYellow + '18', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '800', color: colors.accentYellow }}>{idx + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: colors.textMain }}>{step.label || step.title || `Step ${idx + 1}`}</Text>
                        {step.type && (
                          <Text style={{ fontFamily: fonts.serif, fontSize: 10, fontWeight: '600', color: colors.accentYellow, textTransform: 'uppercase', marginTop: 2 }}>{step.type.replace(/_/g, ' ')}</Text>
                        )}
                      </View>
                    </View>
                    {(step.instructions || step.instruction) && (
                      <Text style={{ fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, lineHeight: 20, marginLeft: 36 }}>{step.instructions || step.instruction}</Text>
                    )}
                    {step.provocation && (
                      <View style={{ marginLeft: 36, padding: 10, borderRadius: 8, backgroundColor: colors.accentYellow + '18', borderWidth: 1, borderColor: colors.accentYellow + '30' }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentYellow, marginBottom: 2 }}>Provocation</Text>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMain, lineHeight: 18 }}>{step.provocation}</Text>
                      </View>
                    )}
                    {Array.isArray(step.problems) && step.problems.length > 0 && (
                      <View style={{ marginLeft: 36, gap: 6 }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase' }}>Problems</Text>
                        {step.problems.map((p: string, pi: number) => (
                          <View key={pi} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                            <Text style={{ fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.accentYellow }}>{pi + 1}.</Text>
                            <Text style={{ fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, flex: 1, lineHeight: 20 }}>{p}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {Array.isArray(step.sections) && step.sections.length > 0 && (
                      <View style={{ marginLeft: 36, gap: 4 }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase' }}>Sections</Text>
                        {step.sections.map((s: string, si: number) => (
                          <View key={si} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accentYellow }} />
                            <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted }}>{s}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {Array.isArray(step.reflectionPrompts) && step.reflectionPrompts.length > 0 && (
                      <View style={{ marginLeft: 36, gap: 6 }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase' }}>Reflection Prompts</Text>
                        {step.reflectionPrompts.map((r: string, ri: number) => (
                          <Text key={ri} style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>{ri + 1}. {r}</Text>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* No content fallback */}
            {!hasContent && (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Feather name="file-text" size={32} color={colors.textDim} />
                <Text style={{ fontFamily: fonts.serif, fontSize: 14, color: colors.textDim, marginTop: 8 }}>
                  {isCompleted ? 'No detailed questions recorded' : 'No questions added yet'}
                </Text>
              </View>
            )}

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const REPORT_SUBJECT_COLORS: Record<string, string> = {
  Mathematics: '#818CF8',
  Science: '#34D399',
  English: '#FBBF24',
  'Social Studies': '#22D3EE',
};

function ParentAIReportModal({ assignment, colors, onClose }: { assignment: Assignment; colors: AppColors; onClose: () => void }) {
  const color = REPORT_SUBJECT_COLORS[assignment.subject] || colors.accentYellow;

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
              <Text style={{ fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: colors.textMain }} numberOfLines={1}>{assignment.title}</Text>
              <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted }}>AI Score & Feedback</Text>
            </View>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, alignItems: 'center', padding: 20, borderRadius: 14, backgroundColor: color + '12', borderWidth: 1, borderColor: color + '30' }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 42, fontWeight: '900', color, letterSpacing: -1 }}>
                  {assignment.score != null ? `${assignment.score}%` : '--'}
                </Text>
                <Text style={{ fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color, marginTop: 4 }}>Overall Score</Text>
              </View>
              {stamp ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 14, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Feather name="award" size={24} color={color} />
                  <Text style={{ fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color, textAlign: 'center', marginTop: 8 }}>{stamp}</Text>
                </View>
              ) : null}
            </View>

            {feedbackText ? (
              <View style={{ backgroundColor: colors.bgDark, borderRadius: 12, padding: 16, gap: 6 }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Overall Feedback</Text>
                <Text style={{ fontFamily: fonts.serif, fontSize: 14, color: colors.textMain, lineHeight: 22 }}>{feedbackText}</Text>
              </View>
            ) : null}

            {wellDone ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '08' }}>
                <Feather name="check-circle" size={16} color={colors.accentGreen} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentGreen, textTransform: 'uppercase' }}>Strength</Text>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{wellDone}</Text>
                </View>
              </View>
            ) : null}
            {improve ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '08' }}>
                <Feather name="target" size={16} color={colors.accentYellow} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentYellow, textTransform: 'uppercase' }}>Needs Improvement</Text>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{improve}</Text>
                </View>
              </View>
            ) : null}

            {perQuestion.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Question Analysis</Text>
                {perQuestion.map((q: any, idx: number) => {
                  const qColor = !q.answered ? colors.textDim : q.correct ? colors.accentGreen : q.score >= 50 ? colors.accentYellow : colors.accentRed;
                  const qIcon = !q.answered ? 'minus-circle' : q.correct ? 'check-circle' : q.score >= 50 ? 'alert-circle' : 'x-circle';
                  return (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: qColor + '40', backgroundColor: qColor + '08' }}>
                      <Feather name={qIcon as any} size={16} color={qColor} style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 11, fontWeight: '800', color: qColor }}>Q{q.number ?? idx + 1}</Text>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textMain, lineHeight: 18, marginBottom: 3 }} numberOfLines={2}>{q.question}</Text>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: q.answered ? colors.textMuted : qColor, lineHeight: 17 }}>{q.comment}</Text>
                      </View>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: qColor + '20' }}>
                        <Text style={{ fontFamily: fonts.serif, fontSize: 13, fontWeight: '800', color: qColor }}>{q.answered ? `${q.score}%` : '--'}</Text>
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
              <Text style={{ fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: '#fff' }}>Close Report</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}



