import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';
import { useToast } from '../../components/common/Toast';

// ── Constants ──────────────────────────────────────────────────────────────────
const GRADES = [
  'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5',
  'Grade 6','Grade 7','Grade 8','Grade 9','Grade 10',
  'Grade 11','Grade 12',
];
const CURRICULA = ['IB PYP','CBSE','ICSE','Cambridge'];
const SUBJECTS = [
  'Mathematics','Science','English','Social Studies',
  'Hindi','ICT','Art','Music','Physical Education',
];

type TeachesEntry = {
  grade: string;
  curriculum: string;
  subjects: string[];
};

type Teacher = {
  id: string;
  name: string;
  email: string;
  school?: string;
  curriculum?: string;
  teaches: TeachesEntry[];
};

function getAdminHeaders(email: string) {
  return { 'Content-Type': 'application/json', 'x-admin-email': email };
}

// ── Edit Modal ─────────────────────────────────────────────────────────────────
function EditTeacherModal({
  visible, teacher, onClose, onSaved, colors,
}: {
  visible: boolean;
  teacher: Teacher | null;
  onClose: () => void;
  onSaved: (name: string) => void;
  colors: AppColors;
}) {
  const gold = colors.accentYellow;
  const [entries, setEntries] = useState<TeachesEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (teacher) {
      setEntries(teacher.teaches.length > 0 ? teacher.teaches.map(e => ({ ...e, subjects: [...e.subjects] })) : []);
      setError('');
    }
  }, [teacher]);

  const addEntry = () => {
    setEntries(prev => [...prev, { grade: 'Grade 3', curriculum: 'IB PYP', subjects: [] }]);
  };

  const removeEntry = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const setGrade = (idx: number, grade: string) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, grade } : e));
  };

  const setCurriculum = (idx: number, curriculum: string) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, curriculum } : e));
  };

  const toggleSubject = (idx: number, subject: string) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== idx) return e;
      const has = e.subjects.includes(subject);
      return { ...e, subjects: has ? e.subjects.filter(s => s !== subject) : [...e.subjects, subject] };
    }));
  };

  const handleSave = async () => {
    if (!teacher) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: teacher.email, teaches: entries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(teacher.name || teacher.email);
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  };

  const s = makeModalStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.modal}>
          {/* Header */}
          <View style={s.modalHeader}>
            <View>
              <Text style={s.modalTitle}>{teacher?.name || 'Teacher'}</Text>
              <Text style={s.modalSub}>{teacher?.email}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
            {entries.length === 0 && (
              <View style={s.emptyHint}>
                <Feather name="info" size={14} color={colors.textMuted} />
                <Text style={s.emptyHintTxt}>No subject assignments yet. Add a grade entry below.</Text>
              </View>
            )}

            {entries.map((entry, idx) => (
              <View key={idx} style={s.entryCard}>
                {/* Remove */}
                <TouchableOpacity style={s.removeBtn} onPress={() => removeEntry(idx)}>
                  <Feather name="trash-2" size={14} color={colors.accentRed || '#F87171'} />
                </TouchableOpacity>

                {/* Grade */}
                <Text style={s.label}>Grade</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                  {GRADES.map(g => (
                    <TouchableOpacity
                      key={g}
                      style={[s.chip, entry.grade === g && { backgroundColor: gold, borderColor: gold }]}
                      onPress={() => setGrade(idx, g)}
                    >
                      <Text style={[s.chipTxt, { color: entry.grade === g ? '#fff' : colors.textMuted }]}>
                        {g.replace('Grade ', '')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Curriculum */}
                <Text style={s.label}>Curriculum</Text>
                <View style={s.chipRow}>
                  {CURRICULA.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[s.chip, entry.curriculum === c && { backgroundColor: gold, borderColor: gold }]}
                      onPress={() => setCurriculum(idx, c)}
                    >
                      <Text style={[s.chipTxt, { color: entry.curriculum === c ? '#fff' : colors.textMuted }]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Subjects */}
                <Text style={s.label}>Subjects</Text>
                <View style={s.subjectGrid}>
                  {SUBJECTS.map(subject => {
                    const active = entry.subjects.includes(subject);
                    return (
                      <TouchableOpacity
                        key={subject}
                        style={[s.subjectChip, active && { backgroundColor: gold + '22', borderColor: gold }]}
                        onPress={() => toggleSubject(idx, subject)}
                      >
                        {active && <Feather name="check" size={11} color={gold} style={{ marginRight: 4 }} />}
                        <Text style={[s.subjectTxt, active && { color: gold }]}>{subject}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}

            <TouchableOpacity style={s.addEntryBtn} onPress={addEntry}>
              <Feather name="plus" size={14} color={gold} />
              <Text style={s.addEntryTxt}>Add Grade Entry</Text>
            </TouchableOpacity>
          </ScrollView>

          {!!error && (
            <View style={s.errorRow}>
              <Feather name="alert-circle" size={13} color="#F87171" />
              <Text style={s.errorTxt}>{error}</Text>
            </View>
          )}

          <View style={s.footerRow}>
            <TouchableOpacity style={[s.btn, s.cancelBtn]} onPress={onClose}>
              <Text style={[s.btnTxt, { color: colors.textMain }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: gold }]} onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="save" size={14} color="#fff" />
                  <Text style={s.btnTxt}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function StaffSubjectMappingScreen({ navigation }: any) {
  const { colors } = useTheme();
  const gold = colors.accentYellow;
  const { user } = useAuth();
  const adminEmail = user?.email || '';
  const { showToast, ToastComponent } = useToast();

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editTeacher, setEditTeacher] = useState<Teacher | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/admin/teachers`, {
        headers: getAdminHeaders(adminEmail),
      });
      if (res.ok) {
        const data: Teacher[] = await res.json();
        setTeachers(data);
      }
    } catch {}
    setLoading(false);
  }, [adminEmail]);

  useEffect(() => { load(); }, [load]);

  const filtered = teachers.filter(t => {
    const q = search.toLowerCase();
    return !q || t.name?.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q) || t.school?.toLowerCase().includes(q);
  });

  const styles = makeStyles(colors);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Staff Subject Mapping"
          subtitle={`${teachers.length} teacher${teachers.length !== 1 ? 's' : ''}`}
          showSearch={false}
          onMenuPress={() => navigation?.openDrawer?.()}
        />

        <View style={styles.searchBar}>
          <Feather name="search" size={15} color={colors.textDim} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, email or school..."
            placeholderTextColor={colors.textDim}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={15} color={colors.textDim} />
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accentYellow} />
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {filtered.length === 0 && (
              <View style={styles.center}>
                <Feather name="users" size={28} color={colors.textDim} />
                <Text style={styles.emptyTxt}>{search ? 'No teachers match your search.' : 'No teachers found.'}</Text>
              </View>
            )}

            {filtered.map(t => {
              const totalSubjects = t.teaches.reduce((sum, e) => sum + e.subjects.length, 0);
              const gradeList = t.teaches.map(e => e.grade.replace('Grade ', 'G')).join(', ');

              return (
                <View key={t.id} style={styles.card}>
                  <View style={styles.cardLeft}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarTxt}>
                        {(t.name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.info}>
                      <Text style={styles.name}>{t.name || 'Unnamed Teacher'}</Text>
                      <Text style={styles.email}>{t.email}</Text>
                      {!!t.school && <Text style={styles.school}>{t.school}</Text>}
                    </View>
                  </View>

                  <View style={styles.cardRight}>
                    <View style={styles.statsRow}>
                      <View style={styles.statBadge}>
                        <Text style={styles.statVal}>{t.teaches.length}</Text>
                        <Text style={styles.statLbl}>Grades</Text>
                      </View>
                      <View style={styles.statBadge}>
                        <Text style={styles.statVal}>{totalSubjects}</Text>
                        <Text style={styles.statLbl}>Subjects</Text>
                      </View>
                    </View>
                    {!!gradeList && (
                      <Text style={styles.gradeTags} numberOfLines={1}>{gradeList}</Text>
                    )}
                    {t.teaches.length > 0 && (
                      <View style={styles.subjectTagRow}>
                        {Array.from(new Set(t.teaches.flatMap(e => e.subjects))).slice(0, 4).map(sub => (
                          <View key={sub} style={[styles.subjectTag, { borderColor: gold + '60' }]}>
                            <Text style={[styles.subjectTagTxt, { color: gold }]}>{sub}</Text>
                          </View>
                        ))}
                        {Array.from(new Set(t.teaches.flatMap(e => e.subjects))).length > 4 && (
                          <Text style={styles.moreSubjects}>
                            +{Array.from(new Set(t.teaches.flatMap(e => e.subjects))).length - 4} more
                          </Text>
                        )}
                      </View>
                    )}
                    {t.teaches.length === 0 && (
                      <Text style={styles.unmapped}>Not mapped yet</Text>
                    )}
                  </View>

                  <TouchableOpacity style={styles.editBtn} onPress={() => setEditTeacher(t)}>
                    <Feather name="edit-2" size={15} color={gold} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      <EditTeacherModal
        visible={!!editTeacher}
        teacher={editTeacher}
        onClose={() => setEditTeacher(null)}
        onSaved={(name: string) => {
          load();
          showToast({
            title: 'Subjects assigned',
            subtitle: `${name}'s subject mapping saved successfully.`,
            type: 'success',
          });
        }}
        colors={colors}
      />
      {ToastComponent}
    </ScreenLayout>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
function makeStyles(colors: AppColors) {
  const gold = colors.accentYellow;
  return StyleSheet.create({
    screen: { flex: 1 },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: spacing.md,
      marginBottom: 12,
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    searchInput: {
      flex: 1,
      color: colors.textMain,
      fontSize: 14,
    },
    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.md, paddingBottom: 32, gap: 10 },
    center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 10 },
    emptyTxt: { color: colors.textMuted, fontSize: 14 },
    card: {
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: radius.lg,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    cardLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1 },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: gold + '22',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarTxt: { color: gold, fontSize: 14, fontWeight: '700' },
    info: { flex: 1 },
    name: { color: colors.textMain, fontSize: 14, fontWeight: '600' },
    email: { color: colors.textDim, fontSize: 12, marginTop: 2 },
    school: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    cardRight: { alignItems: 'flex-end', gap: 5, minWidth: 120 },
    statsRow: { flexDirection: 'row', gap: 8 },
    statBadge: {
      alignItems: 'center',
      backgroundColor: colors.bgDark,
      borderRadius: radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    statVal: { color: colors.textMain, fontSize: 16, fontWeight: '700' },
    statLbl: { color: colors.textMuted, fontSize: 10 },
    gradeTags: { color: colors.textDim, fontSize: 11 },
    subjectTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' },
    subjectTag: {
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    subjectTagTxt: { fontSize: 10, fontWeight: '500' },
    moreSubjects: { color: colors.textMuted, fontSize: 10, alignSelf: 'center' },
    unmapped: { color: colors.textDim, fontSize: 11, fontStyle: 'italic' },
    editBtn: {
      padding: 8,
      marginTop: -2,
    },
  });
}

function makeModalStyles(colors: AppColors) {
  const gold = colors.accentYellow;
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.65)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    modal: {
      width: '100%',
      maxWidth: 560,
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: radius.xl || 16,
      padding: 20,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 16,
    },
    modalTitle: { color: colors.textMain, fontSize: 18, fontWeight: '700' },
    modalSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
    emptyHint: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      backgroundColor: colors.bgDark,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 12,
    },
    emptyHintTxt: { color: colors.textMuted, fontSize: 13, flex: 1 },
    entryCard: {
      backgroundColor: colors.bgDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 12,
    },
    removeBtn: { alignSelf: 'flex-end', padding: 4, marginBottom: 4 },
    label: { color: colors.textMuted, fontSize: 12, marginBottom: 6, marginTop: 6 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
    chip: {
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    chipTxt: { fontSize: 12, fontWeight: '500' },
    subjectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    subjectChip: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    subjectTxt: { color: colors.textMuted, fontSize: 12 },
    addEntryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: gold + '60',
      borderRadius: radius.md,
      borderStyle: 'dashed' as const,
      marginBottom: 4,
    },
    addEntryTxt: { color: gold, fontSize: 13, fontWeight: '600' },
    errorRow: {
      flexDirection: 'row',
      gap: 6,
      alignItems: 'center',
      backgroundColor: 'rgba(248,113,113,0.12)',
      borderRadius: radius.sm,
      padding: 10,
      marginTop: 10,
    },
    errorTxt: { color: '#F87171', fontSize: 13, flex: 1 },
    footerRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
      justifyContent: 'flex-end',
    },
    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.md,
    },
    cancelBtn: {
      backgroundColor: colors.cardHover || colors.bgDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
    },
    btnTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },
  });
}
