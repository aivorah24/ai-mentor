import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import SERVER_URL from '../../config/serverUrl';

// ── Types ──────────────────────────────────────────────────────────────
interface Question {
  question: string;
  options: string[];   // ["A. ...", "B. ...", "C. ...", "D. ..."]
  correct: number;     // 0-indexed
  explanation: string;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  grade: string;
  curriculum: string;
  subject: string;
  topic: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  xpReward: number;
  questionCount: number;
  timeLimitMinutes: number;
  type: string;
  category: string;
  thumbnailUrl?: string | null;
}

interface ChallengeWithQuestions extends Challenge {
  questions: Question[];
}

const GRADES = ['Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
const SUBJECTS = ['Mathematics', 'Science', 'English', 'Social Studies', 'Mixed'];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const TYPES = ['school_challenge', 'olympiad', 'advanced_practice', 'chapter_quiz'];
const TYPE_LABELS: Record<string, string> = {
  school_challenge: 'School Challenge',
  olympiad: 'Olympiad',
  advanced_practice: 'Advanced Practice',
  chapter_quiz: 'Chapter Quiz',
};
const TYPE_ICONS: Record<string, string> = {
  school_challenge: 'book',
  olympiad: 'award',
  advanced_practice: 'trending-up',
  chapter_quiz: 'file-text',
};
const CATEGORIES = ['School Challenge', 'Olympiad', 'Advanced Practice', 'Chapter Quiz'];
const QUESTION_COUNTS = ['5', '8', '10', '12', '15'];
const CURRICULA = ['IB PYP', 'NCERT', 'CBSE', 'Cambridge', 'General'];

const DIFF_COLOR = (d: string, c: AppColors) =>
  d === 'Easy' ? c.accentGreen : d === 'Hard' ? c.accentRed : c.accentYellow;

// ── Main Component ────────────────────────────────────────────────────
export default function ChallengeManagerScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [gradeFilter, setGradeFilter] = useState<string>('All');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Challenge | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Challenge | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchChallenges = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/super-admin/challenges`);
      const data = await res.json();
      setChallenges(data);
    } catch (e) {
      console.error('Failed to fetch challenges', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchChallenges(); }, [fetchChallenges]);

  const displayed = useMemo(() =>
    gradeFilter === 'All' ? challenges : challenges.filter(c => c.grade === gradeFilter),
    [challenges, gradeFilter]
  );

  const handleDelete = async (c: Challenge) => {
    setDeleting(true);
    try {
      const res = await fetch(`${SERVER_URL}/super-admin/challenges/${c.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeleteConfirm(null);
      fetchChallenges();
    } catch {
      Alert.alert('Error', 'Could not delete challenge. Try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ScreenLayout>
      <Header title="Challenge Manager" />
      <View style={styles.container}>
        {/* Grade filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
          {['All', ...GRADES].map(g => (
            <TouchableOpacity key={g} style={[styles.chip, gradeFilter === g && styles.chipActive]} onPress={() => setGradeFilter(g)}>
              <Text style={[styles.chipText, gradeFilter === g && styles.chipTextActive]}>{g}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Create button */}
        <TouchableOpacity style={styles.createBtn} onPress={() => { setEditTarget(null); setShowCreateModal(true); }}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.createBtnText}>New Challenge</Text>
        </TouchableOpacity>

        {/* List */}
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {displayed.length === 0 ? (
              <Text style={styles.emptyText}>No challenges for this grade.</Text>
            ) : (
            <View style={styles.grid}>
            {displayed.map(c => {
              return (
              <View key={c.id} style={styles.card}>
                {Platform.OS === 'web' && !!c.thumbnailUrl && (
                  <img
                    src={c.thumbnailUrl}
                    alt={c.title}
                    onError={(e: any) => { e.target.style.display = 'none'; }}
                    style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: '10px 10px 0 0', marginTop: -14, marginLeft: -14, marginRight: -14, marginBottom: 10, display: 'block', width: 'calc(100% + 28px)' } as any}
                  />
                )}
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.title}</Text>
                    <Text style={styles.cardMeta}>{c.grade} · {c.subject} · {c.curriculum}</Text>
                  </View>
                  <View style={[styles.diffBadge, { backgroundColor: DIFF_COLOR(c.difficulty, colors) + '33' }]}>
                    <Text style={[styles.diffText, { color: DIFF_COLOR(c.difficulty, colors) }]}>{c.difficulty}</Text>
                  </View>
                </View>
                <Text style={styles.cardDesc} numberOfLines={2}>{c.description}</Text>
                <View style={styles.cardStats}>
                  <StatPill icon="help-circle" label={`${c.questionCount} Qs`} colors={colors} />
                  <StatPill icon="clock" label={`${c.timeLimitMinutes} min`} colors={colors} />
                  <StatPill icon="zap" label={`${c.xpReward} XP`} colors={colors} />
                  <StatPill icon="tag" label={c.category} colors={colors} />
                </View>
                <View style={styles.cardActions}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => { setEditTarget(c); setShowCreateModal(true); }}>
                    <Feather name="edit-2" size={14} color={colors.primary} />
                    <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => setDeleteConfirm(c)}>
                    <Feather name="trash-2" size={14} color={colors.accentRed} />
                    <Text style={[styles.actionText, { color: colors.accentRed }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
            })}
            </View>)}
          </ScrollView>
        )}
      </View>

      {/* Create / Edit modal */}
      {showCreateModal && (
        <ChallengeFormModal
          colors={colors}
          editTarget={editTarget}
          onClose={() => setShowCreateModal(false)}
          onSaved={() => { setShowCreateModal(false); fetchChallenges(); }}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <Modal transparent animationType="fade" visible>
          <View style={styles.overlay}>
            <View style={[styles.confirmBox, { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor }]}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentRed + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Feather name="trash-2" size={24} color={colors.accentRed} />
              </View>
              <Text style={[styles.confirmTitle, { color: colors.textMain }]}>Delete Challenge?</Text>
              <Text style={[styles.confirmBody, { color: colors.textMuted }]}>
                <Text style={{ color: colors.textMain, fontWeight: '600' }}>"{deleteConfirm.title}"</Text> will be permanently removed for all students.
              </Text>
              <View style={styles.confirmBtns}>
                <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.borderColor }]} onPress={() => setDeleteConfirm(null)}>
                  <Text style={{ color: colors.textMain, fontWeight: '600', fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.accentRed }]} onPress={() => handleDelete(deleteConfirm)} disabled={deleting}>
                  {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Delete</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </ScreenLayout>
  );
}

// ── Stat Pill ────────────────────────────────────────────────────────
function StatPill({ icon, label, colors }: { icon: any; label: string; colors: AppColors }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.borderColor, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginRight: 6 }}>
      <Feather name={icon} size={11} color={colors.textMuted} />
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{label}</Text>
    </View>
  );
}

// ── Challenge Form Modal ──────────────────────────────────────────────
function ChallengeFormModal({
  colors, editTarget, onClose, onSaved,
}: {
  colors: AppColors;
  editTarget: Challenge | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const scrollRef = React.useRef<ScrollView>(null);
  const [tab, setTab] = useState<'ai' | 'manual'>(editTarget ? 'manual' : 'ai');
  const [saving, setSaving] = useState(false);

  const defaultCurriculum = editTarget?.curriculum ?? user?.curriculum ?? 'IB PYP';

  // Shared fields
  const [title, setTitle] = useState(editTarget?.title ?? '');
  const [description, setDescription] = useState(editTarget?.description ?? '');
  const [grade, setGrade] = useState(editTarget?.grade ?? 'Grade 4');
  const [curriculum, setCurriculum] = useState(defaultCurriculum);
  const [subject, setSubject] = useState(editTarget?.subject ?? 'Mathematics');
  const [topic, setTopic] = useState(editTarget?.topic ?? '');
  const [difficulty, setDifficulty] = useState<'Easy'|'Medium'|'Hard'>(editTarget?.difficulty ?? 'Medium');
  const [xpReward, setXpReward] = useState(String(editTarget?.xpReward ?? 500));
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(String(editTarget?.timeLimitMinutes ?? 20));
  const [type, setType] = useState(editTarget?.type ?? 'school_challenge');
  const [category, setCategory] = useState(editTarget?.category ?? 'School Challenge');
  const [questionCount, setQuestionCount] = useState(String(editTarget?.questionCount ?? 10));
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(editTarget?.thumbnailUrl ?? null);
  const [uploadingThumb, setUploadingThumb] = useState(false);

  // AI tab state
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiQuestions, setAiQuestions] = useState<Question[]>([]);
  const [aiError, setAiError] = useState('');

  // Manual tab state — pre-loaded with existing questions on edit
  const [manualQuestions, setManualQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  const isEdit = !!editTarget;
  const defaultThumbSrc = isEdit ? `${SERVER_URL}/data/images/challenges/${editTarget!.id}.png` : null;
  const questions = tab === 'ai' ? aiQuestions : manualQuestions;

  // Load existing questions when editing
  useEffect(() => {
    if (!isEdit) return;
    setLoadingQuestions(true);
    fetch(`${SERVER_URL}/super-admin/challenges/${editTarget!.id}/questions`)
      .then(r => r.json())
      .then((data: any[]) => {
        const qs: Question[] = (data || []).map(q => ({
          question: q.question,
          options: q.options,
          correct: q.correct,
          explanation: q.explanation || '',
        }));
        setManualQuestions(qs);
      })
      .catch(() => {})
      .finally(() => setLoadingQuestions(false));
  }, []);

  // For new challenges, hold the file and upload after save
  const [pendingThumbFile, setPendingThumbFile] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(editTarget?.thumbnailUrl ?? defaultThumbSrc ?? null);

  const handleThumbnailPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingThumbFile(file);
    setThumbPreview(URL.createObjectURL(file));
  };

  const uploadThumbnail = async (challengeId: string, file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = async () => {
        // Resize to max 800px wide to keep payload small
        const MAX = 800;
        const scale = Math.min(1, MAX / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objectUrl);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        try {
          const res = await fetch(`${SERVER_URL}/super-admin/challenges/${challengeId}/thumbnail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl }),
          });
          const data = await res.json();
          resolve(data.thumbnailUrl ?? null);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = objectUrl;
    });
  };

  // ── AI generate ──────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!topic.trim()) { setAiError('Enter a topic before generating.'); return; }
    setAiError('');
    setAiGenerating(true);
    try {
      const res = await fetch(`${SERVER_URL}/super-admin/challenges/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, subject, topic, difficulty, questionCount: parseInt(questionCount), curriculum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setAiQuestions(data.questions);
      if (!title) setTitle(data.suggestedTitle || '');
      if (!description) setDescription(data.suggestedDescription || '');
      // Scroll to show generated questions
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      setAiError(e.message || 'AI generation failed. Try again.');
    } finally {
      setAiGenerating(false);
    }
  };

  // ── Save ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!title.trim()) { Alert.alert('Validation', 'Title is required.'); return; }
    if (!topic.trim()) { Alert.alert('Validation', 'Topic is required.'); return; }
    if (questions.length === 0) { Alert.alert('Validation', 'Add or generate at least one question.'); return; }

    const payload: ChallengeWithQuestions = {
      id: editTarget?.id ?? '',
      title: title.trim(),
      description: description.trim(),
      grade, curriculum, subject, topic: topic.trim(),
      difficulty,
      xpReward: parseInt(xpReward) || 500,
      questionCount: questions.length,
      timeLimitMinutes: parseInt(timeLimitMinutes) || 20,
      type, category,
      questions,
    };

    setSaving(true);
    try {
      const url = isEdit
        ? `${SERVER_URL}/super-admin/challenges/${editTarget!.id}`
        : `${SERVER_URL}/super-admin/challenges`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = await res.json();
      // Upload thumbnail if a file was picked
      if (pendingThumbFile) {
        const newId = isEdit ? editTarget!.id : saved.id;
        if (newId) {
          const thumbUrl = await uploadThumbnail(newId, pendingThumbFile);
          console.log('[save] thumbnail uploaded:', thumbUrl);
        }
      }
      // Small delay so DB write is reflected before list refresh
      await new Promise(r => setTimeout(r, 300));
      onSaved();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const s = useMemo(() => makeModalStyles(colors), [colors]);

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheet}>
          {/* Header */}
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{isEdit ? 'Edit Challenge' : 'New Challenge'}</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={colors.textMain} /></TouchableOpacity>
          </View>

          <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>

            {/* ── Section: Basic Info ── */}
            <View style={s.formCard}>
              <Text style={s.formCardTitle}>Basic Info</Text>
              <FieldRow label="Challenge Title" colors={colors}>
                <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="e.g. Term 1 Brain Blitz" placeholderTextColor={colors.textMuted} />
              </FieldRow>
              <FieldRow label="Description" colors={colors}>
                <TextInput style={[s.input, { height: 72, textAlignVertical: 'top', paddingTop: 10 }]} value={description} onChangeText={setDescription} placeholder="Briefly describe what students will test themselves on..." placeholderTextColor={colors.textMuted} multiline />
              </FieldRow>

              {/* Thumbnail upload (web only) */}
              {Platform.OS === 'web' && (
                <FieldRow label="Thumbnail Image" colors={colors}>
                  {thumbPreview ? (
                    <View style={{ marginBottom: 10, borderRadius: 10, overflow: 'hidden', height: 120 }}>
                      <img src={thumbPreview} alt="thumbnail" onError={(e: any) => { e.target.parentElement.style.display='none'; }} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 10 }} />
                    </View>
                  ) : null}
                  <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, backgroundColor: colors.cardDark, border: `1px dashed ${colors.borderColor}`, borderRadius: 8, padding: '9px 16px', color: colors.textMuted, fontSize: 12 }}>
                    <span style={{ fontSize: 14 }}>🖼</span>
                    {thumbPreview ? 'Change Thumbnail' : 'Upload Thumbnail'}
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleThumbnailPick as any} />
                  </label>
                  {!isEdit && thumbPreview && <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>Image will be saved when you publish.</Text>}
                </FieldRow>
              )}

              {/* Type selector as cards */}
              <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Challenge Type</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {TYPES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[s.typeCard, type === t && { borderColor: colors.primary, backgroundColor: colors.primary + '18' }]}
                    onPress={() => {
                      setType(t);
                      setCategory(TYPE_LABELS[t] || t);
                    }}
                  >
                    <Feather name={TYPE_ICONS[t] as any} size={16} color={type === t ? colors.primary : colors.textMuted} />
                    <Text style={[s.typeCardText, type === t && { color: colors.primary, fontWeight: '700' }]}>{TYPE_LABELS[t]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* ── Section: Classification ── */}
            <View style={s.formCard}>
              <Text style={s.formCardTitle}>Classification</Text>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <FieldRow label="Grade" colors={colors}>
                    <SelectPicker value={grade} options={GRADES} onChange={setGrade} colors={colors} />
                  </FieldRow>
                </View>
                <View style={{ flex: 1 }}>
                  <FieldRow label="Curriculum" colors={colors}>
                    <SelectPicker value={curriculum} options={CURRICULA} onChange={setCurriculum} colors={colors} />
                  </FieldRow>
                </View>
              </View>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <FieldRow label="Subject" colors={colors}>
                    <SelectPicker value={subject} options={SUBJECTS} onChange={setSubject} colors={colors} />
                  </FieldRow>
                </View>
                <View style={{ flex: 1 }}>
                  <FieldRow label="Difficulty" colors={colors}>
                    <SelectPicker value={difficulty} options={DIFFICULTIES} onChange={(v) => setDifficulty(v as any)} colors={colors} />
                  </FieldRow>
                </View>
              </View>
              <FieldRow label="Topic" colors={colors}>
                <TextInput style={s.input} value={topic} onChangeText={setTopic} placeholder="e.g. Fractions, Ecosystems, Grammar..." placeholderTextColor={colors.textMuted} />
              </FieldRow>
            </View>

            {/* ── Section: Settings ── */}
            <View style={s.formCard}>
              <Text style={s.formCardTitle}>Settings</Text>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <FieldRow label="XP Reward" colors={colors}>
                    <TextInput style={s.input} value={xpReward} onChangeText={setXpReward} keyboardType="numeric" placeholderTextColor={colors.textMuted} />
                  </FieldRow>
                </View>
                <View style={{ flex: 1 }}>
                  <FieldRow label="Time Limit (min)" colors={colors}>
                    <TextInput style={s.input} value={timeLimitMinutes} onChangeText={setTimeLimitMinutes} keyboardType="numeric" placeholderTextColor={colors.textMuted} />
                  </FieldRow>
                </View>
              </View>
            </View>

            {/* ── Section: Questions ── */}
            <View style={s.formCard}>
              <Text style={s.formCardTitle}>Questions</Text>

            {!isEdit && (
              <View style={s.tabRow}>
                <TouchableOpacity style={[s.tabBtn, tab === 'ai' && s.tabBtnActive]} onPress={() => setTab('ai')}>
                  <Feather name="cpu" size={14} color={tab === 'ai' ? '#fff' : colors.textMuted} />
                  <Text style={[s.tabBtnText, tab === 'ai' && s.tabBtnTextActive]}>AI Generate</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.tabBtn, tab === 'manual' && s.tabBtnActive]} onPress={() => setTab('manual')}>
                  <Feather name="edit-3" size={14} color={tab === 'manual' ? '#fff' : colors.textMuted} />
                  <Text style={[s.tabBtnText, tab === 'manual' && s.tabBtnTextActive]}>Manual</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* AI Tab */}
            {tab === 'ai' && !isEdit && (
              <View style={s.aiBox}>
                <FieldRow label="No. of Questions" colors={colors}>
                  <SelectPicker value={questionCount} options={QUESTION_COUNTS} onChange={setQuestionCount} colors={colors} />
                </FieldRow>
                {aiError ? <Text style={s.errorText}>{aiError}</Text> : null}
                <TouchableOpacity style={[s.generateBtn, aiGenerating && { opacity: 0.6 }]} onPress={handleGenerate} disabled={aiGenerating}>
                  {aiGenerating
                    ? <><ActivityIndicator color="#fff" size="small" /><Text style={s.generateBtnText}>Generating...</Text></>
                    : <><Feather name="zap" size={15} color="#fff" /><Text style={s.generateBtnText}>Generate Questions</Text></>
                  }
                </TouchableOpacity>
                {aiGenerating && <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 8 }}>AI is writing questions, this takes ~10 seconds...</Text>}
                {aiQuestions.length > 0 && (
                  <QuestionPreviewList questions={aiQuestions} onChange={setAiQuestions} colors={colors} />
                )}
              </View>
            )}

            {/* Manual Tab */}
            {(tab === 'manual' || isEdit) && (
              loadingQuestions
                ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
                : <ManualQuestionsEditor questions={manualQuestions} onChange={setManualQuestions} colors={colors} />
            )}

            <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="check" size={16} color="#fff" /><Text style={s.saveBtnText}>{isEdit ? 'Save Changes' : 'Publish Challenge'}</Text></>
              }
            </TouchableOpacity>
            </View>{/* end formCard Questions */}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Question Preview (AI generated, editable) ─────────────────────────
function QuestionPreviewList({ questions, onChange, colors }: { questions: Question[]; onChange: (q: Question[]) => void; colors: AppColors }) {
  const s = useMemo(() => makeModalStyles(colors), [colors]);
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={[s.sectionLabel, { marginBottom: 8 }]}>{questions.length} Questions Generated</Text>
      {questions.map((q, i) => (
        <View key={i} style={[s.qCard, { backgroundColor: colors.cardDark }]}>
          <Text style={[s.qNum, { color: colors.primary }]}>Q{i + 1}</Text>
          <TextInput
            style={[s.qInput, { color: colors.textMain }]}
            value={q.question}
            onChangeText={text => {
              const updated = [...questions];
              updated[i] = { ...updated[i], question: text };
              onChange(updated);
            }}
            multiline
            placeholderTextColor={colors.textMuted}
          />
          {q.options.map((opt, oi) => (
            <View key={oi} style={[s.optRow, q.correct === oi && { backgroundColor: colors.accentGreen + '22' }]}>
              <TouchableOpacity onPress={() => {
                const updated = [...questions];
                updated[i] = { ...updated[i], correct: oi };
                onChange(updated);
              }}>
                <View style={[s.optDot, { borderColor: q.correct === oi ? colors.accentGreen : colors.borderColor }, q.correct === oi && { backgroundColor: colors.accentGreen }]} />
              </TouchableOpacity>
              <TextInput
                style={[s.optInput, { color: colors.textMain }]}
                value={opt}
                onChangeText={text => {
                  const updated = [...questions];
                  const opts = [...updated[i].options];
                  opts[oi] = text;
                  updated[i] = { ...updated[i], options: opts };
                  onChange(updated);
                }}
              />
            </View>
          ))}
          <Text style={[s.explanationLabel, { color: colors.textMuted }]}>Explanation</Text>
          <TextInput
            style={[s.qInput, { color: colors.textMain, fontSize: 12 }]}
            value={q.explanation}
            onChangeText={text => {
              const updated = [...questions];
              updated[i] = { ...updated[i], explanation: text };
              onChange(updated);
            }}
            multiline
            placeholderTextColor={colors.textMuted}
          />
        </View>
      ))}
    </View>
  );
}

// ── Manual Questions Editor ───────────────────────────────────────────
function ManualQuestionsEditor({ questions, onChange, colors }: { questions: Question[]; onChange: (q: Question[]) => void; colors: AppColors }) {
  const s = useMemo(() => makeModalStyles(colors), [colors]);

  const addQuestion = () => {
    onChange([...questions, {
      question: '',
      options: ['A. ', 'B. ', 'C. ', 'D. '],
      correct: 0,
      explanation: '',
    }]);
  };

  const removeQuestion = (i: number) => {
    onChange(questions.filter((_, idx) => idx !== i));
  };

  return (
    <View style={{ marginTop: 8 }}>
      {questions.map((q, i) => (
        <View key={i} style={[s.qCard, { backgroundColor: colors.cardDark }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={[s.qNum, { color: colors.primary }]}>Q{i + 1}</Text>
            <TouchableOpacity onPress={() => removeQuestion(i)}>
              <Feather name="trash-2" size={14} color={colors.accentRed} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={[s.qInput, { color: colors.textMain }]}
            value={q.question}
            onChangeText={text => {
              const updated = [...questions];
              updated[i] = { ...updated[i], question: text };
              onChange(updated);
            }}
            placeholder="Enter question..."
            placeholderTextColor={colors.textMuted}
            multiline
          />
          {['A', 'B', 'C', 'D'].map((letter, oi) => (
            <View key={oi} style={[s.optRow, q.correct === oi && { backgroundColor: colors.accentGreen + '22' }]}>
              <TouchableOpacity onPress={() => {
                const updated = [...questions];
                updated[i] = { ...updated[i], correct: oi };
                onChange(updated);
              }}>
                <View style={[s.optDot, { borderColor: q.correct === oi ? colors.accentGreen : colors.borderColor }, q.correct === oi && { backgroundColor: colors.accentGreen }]} />
              </TouchableOpacity>
              <TextInput
                style={[s.optInput, { color: colors.textMain }]}
                value={q.options[oi] ?? `${letter}. `}
                onChangeText={text => {
                  const updated = [...questions];
                  const opts = [...updated[i].options];
                  opts[oi] = text;
                  updated[i] = { ...updated[i], options: opts };
                  onChange(updated);
                }}
                placeholder={`${letter}. Option ${oi + 1}`}
                placeholderTextColor={colors.textMuted}
              />
            </View>
          ))}
          <Text style={[s.explanationLabel, { color: colors.textMuted }]}>Explanation (optional)</Text>
          <TextInput
            style={[s.qInput, { color: colors.textMain, fontSize: 12 }]}
            value={q.explanation}
            onChangeText={text => {
              const updated = [...questions];
              updated[i] = { ...updated[i], explanation: text };
              onChange(updated);
            }}
            placeholder="Why is this the correct answer?"
            placeholderTextColor={colors.textMuted}
            multiline
          />
        </View>
      ))}
      <TouchableOpacity style={s.addQBtn} onPress={addQuestion}>
        <Feather name="plus" size={14} color={colors.primary} />
        <Text style={[s.addQBtnText, { color: colors.primary }]}>Add Question</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Helper sub-components ────────────────────────────────────────────
function SectionLabel({ label, colors }: { label: string; colors: AppColors }) {
  return <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 16, marginBottom: 4 }}>{label}</Text>;
}

function FieldRow({ label, children, colors }: { label: string; children: React.ReactNode; colors: AppColors }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
      {children}
    </View>
  );
}

function SelectPicker({ value, options, onChange, colors, labelMap }: { value: string; options: string[]; onChange: (v: string) => void; colors: AppColors; labelMap?: Record<string, string> }) {
  if (Platform.OS === 'web') {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', backgroundColor: colors.cardDark, color: colors.textMain,
          border: `1px solid ${colors.borderColor}`, borderRadius: 8,
          padding: '9px 12px', fontSize: 13, outline: 'none', cursor: 'pointer',
          appearance: 'auto',
        } as any}
      >
        {options.map(opt => (
          <option key={opt} value={opt} style={{ backgroundColor: colors.bgDark }}>
            {labelMap?.[opt] ?? opt}
          </option>
        ))}
      </select>
    );
  }
  // Native fallback
  const [open, setOpen] = useState(false);
  return (
    <View style={{ zIndex: open ? 100 : 1 }}>
      <TouchableOpacity
        style={{ backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        onPress={() => setOpen(!open)}
      >
        <Text style={{ color: colors.textMain, fontSize: 13 }}>{labelMap?.[value] ?? value}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
      </TouchableOpacity>
      {open && (
        <View style={{ backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: 8, marginTop: 2, zIndex: 100, position: 'absolute', top: 40, left: 0, right: 0, elevation: 20 }}>
          {options.map(opt => (
            <TouchableOpacity key={opt} style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: opt === options[options.length - 1] ? 0 : 1, borderBottomColor: colors.borderColor }} onPress={() => { onChange(opt); setOpen(false); }}>
              <Text style={{ color: opt === value ? colors.primary : colors.textMain, fontSize: 13, fontWeight: opt === value ? '700' : '400' }}>{labelMap?.[opt] ?? opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: 8 },
    filterRow: { maxHeight: 44, marginBottom: 12 },
    filterContent: { paddingVertical: 4, gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
    chipTextActive: { color: '#fff', fontWeight: '700' },
    createBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignSelf: 'flex-end', marginBottom: 14 },
    createBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    list: { flex: 1 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
    card: { backgroundColor: colors.cardDark, borderRadius: 14, borderWidth: 1, borderColor: colors.borderColor, padding: 14, flexBasis: '48%', flexGrow: 0, maxWidth: '48%', minWidth: 280 },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textMain },
    cardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    diffBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    diffText: { fontSize: 11, fontWeight: '700' },
    cardDesc: { fontSize: 13, color: colors.textMuted, marginBottom: 10, lineHeight: 18 },
    cardStats: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
    cardActions: { flexDirection: 'row', gap: 12, borderTopWidth: 1, borderTopColor: colors.borderColor, paddingTop: 10 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    actionText: { fontSize: 13, fontWeight: '600' },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
    confirmBox: { width: 360, maxWidth: '90%', borderRadius: 16, padding: 28, alignItems: 'center' },
    confirmTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
    confirmBody: { fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
    confirmBtns: { flexDirection: 'row', gap: 10, width: '100%' },
    confirmBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  });
}

function makeModalStyles(colors: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end', alignItems: Platform.OS === 'web' ? 'center' : 'stretch' },
    sheet: { backgroundColor: colors.bgDark, borderRadius: Platform.OS === 'web' ? 16 : 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%', padding: 20, ...(Platform.OS === 'web' ? { width: '100%', maxWidth: 640, alignSelf: 'center' } : {}) },
    sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textMain },
    row: { flexDirection: 'row', gap: 12 },
    input: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: colors.textMain, fontSize: 13 },
    sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 16, marginBottom: 4 },
    tabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor },
    tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabBtnText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    tabBtnTextActive: { color: '#fff' },
    aiBox: { marginTop: 4 },
    errorText: { color: colors.accentRed, fontSize: 12, marginBottom: 8 },
    generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 28, marginTop: 4, alignSelf: 'center' as const },
    generateBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, marginTop: 20, marginBottom: 8, alignSelf: 'center' as const },
    saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    qCard: { borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.borderColor },
    qNum: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
    qInput: { fontSize: 13, borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingBottom: 4, marginBottom: 8 },
    optRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, marginBottom: 4 },
    optDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
    optInput: { flex: 1, fontSize: 12 },
    explanationLabel: { fontSize: 11, fontWeight: '600', marginTop: 6, marginBottom: 2 },
    addQBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, paddingVertical: 10, marginBottom: 4, borderStyle: 'dashed' },
    addQBtnText: { fontWeight: '600', fontSize: 13 },
    formCard: { backgroundColor: colors.cardDark, borderRadius: 14, borderWidth: 1, borderColor: colors.borderColor, padding: 16, marginBottom: 14 },
    formCardTitle: { fontSize: 11, fontWeight: '800', color: colors.textMain, marginBottom: 14, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
    typeCard: { flex: 1, alignItems: 'center' as const, gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1.5, borderColor: colors.borderColor, backgroundColor: colors.bgDark },
    typeCardText: { fontSize: 10, fontWeight: '600' as const, color: colors.textMuted, textAlign: 'center' as const },
  });
}
