import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, Alert, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

// ── Helpers ───────────────────────────────────────────────────────────────────
const GRADES = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
const SECTIONS = ['A','B','C','D','E','F'];
const CURRICULA = ['IB PYP','CBSE','ICSE','Cambridge'];

function getAdminHeaders(email: string) {
  return { 'Content-Type': 'application/json', 'x-admin-email': email };
}

function daysSince(dateStr?: string) {
  if (!dateStr) return null;
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff}d ago`;
}

// ── Bulk Add Modal ─────────────────────────────────────────────────────────────
function BulkAddModal({ visible, onClose, onCreated, adminEmail, colors, styles }: any) {
  const [grade, setGrade] = useState('Grade 3');
  const [section, setSection] = useState('A');
  const [school, setSchool] = useState('');
  const [curriculum, setCurriculum] = useState('IB PYP');
  const [mode, setMode] = useState<'count' | 'names'>('count');
  const [count, setCount] = useState('5');
  const [namesText, setNamesText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: any[]; errors: any[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => { setResult(null); setNamesText(''); setCount('5'); setCopied(false); };

  const handleCreate = async () => {
    let nameList: string[] = [];
    if (mode === 'count') {
      const n = parseInt(count) || 0;
      if (n < 1 || n > 100) return Alert.alert('Error', 'Enter a count between 1 and 100');
      nameList = Array.from({ length: n }, (_, i) => `Student ${String(i + 1).padStart(2, '0')}`);
    } else {
      nameList = namesText.split('\n').map(s => s.trim()).filter(Boolean);
      if (nameList.length === 0) return Alert.alert('Error', 'Enter at least one student name');
    }
    if (!school.trim()) return Alert.alert('Error', 'School name is required');

    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/admin/students/bulk-create`, {
        method: 'POST',
        headers: getAdminHeaders(adminEmail),
        body: JSON.stringify({ students: nameList, grade, section, school: school.trim(), curriculum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setResult(data);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const credentialsText = useMemo(() => {
    if (!result) return '';
    return result.created.map(s =>
      `${s.name} | ${s.email} | ${s.password} | ${s.grade} ${s.section ? `Sec ${s.section}` : ''}`
    ).join('\n');
  }, [result]);

  const handleCopy = () => {
    if (Platform.OS === 'web') {
      navigator.clipboard?.writeText(credentialsText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.textMain }]}>Bulk Add Students</Text>
            <TouchableOpacity onPress={() => { onClose(); reset(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          {result ? (
            // ── Results view ──
            <ScrollView style={{ maxHeight: 420 }}>
              <View style={[styles.resultBanner, { backgroundColor: colors.accentGreen + '18', borderColor: colors.accentGreen + '40' }]}>
                <Feather name="check-circle" size={16} color={colors.accentGreen} />
                <Text style={[styles.resultBannerTxt, { color: colors.accentGreen }]}>
                  {result.created.length} student{result.created.length !== 1 ? 's' : ''} created successfully
                  {result.errors.length > 0 ? ` · ${result.errors.length} failed` : ''}
                </Text>
              </View>

              <View style={[styles.credBox, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}>
                <Text style={[styles.credHint, { color: colors.textMuted }]}>Name · Login Email · Password · Grade/Section</Text>
                {result.created.map((s, i) => (
                  <Text key={i} style={[styles.credRow, { color: colors.textMain }]}>
                    {s.name}  ·  {s.email}  ·  {s.password}
                  </Text>
                ))}
              </View>

              <View style={styles.resultActions}>
                <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={handleCopy}>
                  <Feather name={copied ? 'check' : 'copy'} size={14} color="#fff" />
                  <Text style={styles.btnTxt}>{copied ? 'Copied!' : 'Copy All'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, { backgroundColor: colors.cardHover, borderColor: colors.borderColor, borderWidth: 1 }]}
                  onPress={() => { reset(); onCreated(); onClose(); }}>
                  <Text style={[styles.btnTxt, { color: colors.textMain }]}>Done</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            // ── Form view ──
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              {/* School */}
              <Text style={[styles.label, { color: colors.textMuted }]}>School Name *</Text>
              <TextInput
                style={[styles.input, { color: colors.textMain, backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}
                value={school} onChangeText={setSchool} placeholder="e.g. TASARA International"
                placeholderTextColor={colors.textDim}
              />

              {/* Grade */}
              <Text style={[styles.label, { color: colors.textMuted }]}>Grade / Class</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {GRADES.map(g => (
                  <TouchableOpacity key={g} style={[styles.chip, grade === g && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => setGrade(g)}>
                    <Text style={[styles.chipTxt, { color: grade === g ? '#fff' : colors.textMuted }]}>{g.replace('Grade ', '')}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Section */}
              <Text style={[styles.label, { color: colors.textMuted }]}>Section</Text>
              <View style={styles.chipRow}>
                {SECTIONS.map(s => (
                  <TouchableOpacity key={s} style={[styles.chip, section === s && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => setSection(s)}>
                    <Text style={[styles.chipTxt, { color: section === s ? '#fff' : colors.textMuted }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Curriculum */}
              <Text style={[styles.label, { color: colors.textMuted }]}>Curriculum</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {CURRICULA.map(c => (
                  <TouchableOpacity key={c} style={[styles.chip, curriculum === c && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={() => setCurriculum(c)}>
                    <Text style={[styles.chipTxt, { color: curriculum === c ? '#fff' : colors.textMuted }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Mode toggle */}
              <Text style={[styles.label, { color: colors.textMuted }]}>Add Students By</Text>
              <View style={[styles.modeRow, { backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}>
                {(['count', 'names'] as const).map(m => (
                  <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && { backgroundColor: colors.primary }]}
                    onPress={() => setMode(m)}>
                    <Text style={[styles.modeTxt, { color: mode === m ? '#fff' : colors.textMuted }]}>
                      {m === 'count' ? 'Count (auto-name)' : 'Enter Names'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {mode === 'count' ? (
                <>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Number of Students</Text>
                  <TextInput
                    style={[styles.input, { color: colors.textMain, backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}
                    value={count} onChangeText={setCount} keyboardType="number-pad" placeholder="5"
                    placeholderTextColor={colors.textDim}
                  />
                </>
              ) : (
                <>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Student Names (one per line)</Text>
                  <TextInput
                    style={[styles.input, styles.multiInput, { color: colors.textMain, backgroundColor: colors.bgDark, borderColor: colors.borderColor }]}
                    value={namesText} onChangeText={setNamesText} multiline numberOfLines={6}
                    placeholder={"Aanya Sharma\nRohan Verma\nPriya Nair"}
                    placeholderTextColor={colors.textDim} textAlignVertical="top"
                  />
                </>
              )}

              <TouchableOpacity style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.primary }]}
                onPress={handleCreate} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="users" size={15} color="#fff" />}
                <Text style={styles.btnTxt}>{loading ? 'Creating...' : 'Create Students'}</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function SuperAdminStudentsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const adminEmail = user?.email || '';

  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterGrade, setFilterGrade] = useState('All');
  const [filterSection, setFilterSection] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignEmail, setAssignEmail] = useState('');
  const [assigning, setAssigning] = useState(false);
  // Single-student assign modal
  const [assignStudent, setAssignStudent] = useState<any>(null);
  const [singleAssignEmail, setSingleAssignEmail] = useState('');
  const [singleAssigning, setSingleAssigning] = useState(false);
  // Map by Section modal
  const [showSectionMap, setShowSectionMap] = useState(false);
  const [allTeachers, setAllTeachers] = useState<any[]>([]);
  const [mapGrade, setMapGrade] = useState('');
  const [mapSection, setMapSection] = useState('');
  const [mapSubject, setMapSubject] = useState('');
  const [mapTeacher, setMapTeacher] = useState<any>(null);
  const [mapAssigning, setMapAssigning] = useState(false);
  const [mapError, setMapError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/admin/students`, {
        headers: getAdminHeaders(adminEmail),
      });
      const data = await res.json();
      setStudents(data.students || []);
    } catch { setStudents([]); }
    setLoading(false);
  }, [adminEmail]);

  useEffect(() => { load(); }, [load]);

  const grades = useMemo(() => ['All', ...Array.from(new Set(students.map(s => s.grade).filter(Boolean))).sort()], [students]);
  const sections = useMemo(() => ['All', ...Array.from(new Set(students.map(s => s.section).filter(Boolean))).sort()], [students]);

  const filtered = useMemo(() => {
    let list = students;
    if (filterGrade !== 'All') list = list.filter(s => s.grade === filterGrade);
    if (filterSection !== 'All') list = list.filter(s => s.section === filterSection);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q));
    }
    return list;
  }, [students, filterGrade, filterSection, search]);

  const toggleSelect = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleAssign = async () => {
    if (!assignEmail.trim() || selected.size === 0) return;
    setAssigning(true);
    try {
      const res = await fetch(`${SERVER_URL}/admin/students/assign-teacher`, {
        method: 'POST',
        headers: getAdminHeaders(adminEmail),
        body: JSON.stringify({ studentIds: [...selected], teacherEmail: assignEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Alert.alert('Success', `${data.assigned} student(s) assigned to teacher`);
      setSelected(new Set()); setAssignEmail('');
      load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    setAssigning(false);
  };

  const handleSingleAssign = async () => {
    if (!singleAssignEmail.trim() || !assignStudent) return;
    setSingleAssigning(true);
    try {
      const res = await fetch(`${SERVER_URL}/admin/students/assign-teacher`, {
        method: 'POST',
        headers: getAdminHeaders(adminEmail),
        body: JSON.stringify({ studentIds: [assignStudent.id], teacherEmail: singleAssignEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssignStudent(null); setSingleAssignEmail('');
      load();
    } catch (e: any) { Alert.alert('Error', e.message); }
    setSingleAssigning(false);
  };

  const loadTeachers = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/admin/teachers`, { headers: getAdminHeaders(adminEmail) });
      if (res.ok) setAllTeachers(await res.json());
    } catch {}
  }, [adminEmail]);

  function openSectionMap() {
    const existingGrades = Array.from(new Set(students.map(s => s.grade).filter(Boolean))).sort();
    const existingSections = Array.from(new Set(students.map(s => s.section).filter(Boolean))).sort();
    setMapGrade(existingGrades[0] || '');
    setMapSection(existingSections[0] || '');
    setMapSubject('');
    setMapTeacher(null);
    setMapError('');
    loadTeachers();
    setShowSectionMap(true);
  }

  // Students matching the current Grade+Section selection
  const sectionPreview = useMemo(() => {
    if (!mapGrade || !mapSection) return [];
    return students.filter(s => s.grade === mapGrade && s.section === mapSection);
  }, [students, mapGrade, mapSection]);

  // Teachers who teach the selected grade+subject
  const matchedTeachers = useMemo(() => {
    if (!mapGrade) return allTeachers;
    return allTeachers.filter(t => {
      if (!t.teaches?.length) return true; // no prefs yet — show anyway
      return t.teaches.some((teach: any) => {
        const gradeMatch = teach.grade === mapGrade;
        const subjectMatch = !mapSubject || (teach.subjects || []).some((s: string) => s.toLowerCase() === mapSubject.toLowerCase());
        return gradeMatch && subjectMatch;
      });
    });
  }, [allTeachers, mapGrade, mapSubject]);

  const handleSectionMap = async () => {
    if (!mapTeacher || sectionPreview.length === 0) return;
    setMapAssigning(true); setMapError('');
    try {
      const res = await fetch(`${SERVER_URL}/admin/students/assign-teacher`, {
        method: 'POST',
        headers: getAdminHeaders(adminEmail),
        body: JSON.stringify({
          studentIds: sectionPreview.map(s => s.id),
          teacherEmail: mapTeacher.email,
          subject: mapSubject || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowSectionMap(false);
      load();
    } catch (e: any) { setMapError(e.message); }
    setMapAssigning(false);
  };

  const unassigned = students.filter(s => !s.teacher_student?.length).length;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Student Manager"
          subtitle={`${students.length} students · ${unassigned} unassigned`}
          showSearch={false}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Stats row */}
          <View style={styles.statsRow}>
            {[
              { label: 'Total', val: students.length, color: colors.primary },
              { label: 'Unassigned', val: unassigned, color: colors.accentYellow },
              { label: 'Active Today', val: students.filter(s => daysSince(s.student_stats?.last_active_date) === 'Today').length, color: colors.accentGreen },
              { label: 'Grades', val: grades.length - 1, color: colors.accentBlue },
            ].map(stat => (
              <View key={stat.label} style={[styles.statCard, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
                <Text style={[styles.statVal, { color: stat.color }]}>{stat.val}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* Search + Add */}
          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
              <Feather name="search" size={15} color={colors.textDim} />
              <TextInput
                style={[styles.searchInput, { color: colors.textMain }]}
                value={search} onChangeText={setSearch}
                placeholder="Search students..." placeholderTextColor={colors.textDim}
              />
            </View>
            <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]} onPress={() => setShowModal(true)}>
              <Feather name="user-plus" size={15} color="#fff" />
              <Text style={styles.addBtnTxt}>Bulk Add</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.accentGreen }]} onPress={openSectionMap}>
              <Feather name="link" size={15} color="#fff" />
              <Text style={styles.addBtnTxt}>Map Section</Text>
            </TouchableOpacity>
          </View>

          {/* Filters */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Text style={[styles.filterLabel, { color: colors.textMuted }]}>Grade:</Text>
            {grades.map(g => (
              <TouchableOpacity key={g} style={[styles.filterChip, filterGrade === g && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={() => setFilterGrade(g)}>
                <Text style={[styles.filterChipTxt, { color: filterGrade === g ? '#fff' : colors.textMuted }]}>{g}</Text>
              </TouchableOpacity>
            ))}
            {sections.length > 1 && <>
              <Text style={[styles.filterLabel, { color: colors.textMuted, marginLeft: 8 }]}>Sec:</Text>
              {sections.map(s => (
                <TouchableOpacity key={s} style={[styles.filterChip, filterSection === s && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  onPress={() => setFilterSection(s)}>
                  <Text style={[styles.filterChipTxt, { color: filterSection === s ? '#fff' : colors.textMuted }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </>}
          </ScrollView>

          {/* Assign to teacher bar (shows when students selected) */}
          {selected.size > 0 && (
            <View style={[styles.assignBar, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '40' }]}>
              <Text style={[styles.assignBarTxt, { color: colors.primary }]}>{selected.size} selected</Text>
              <TextInput
                style={[styles.assignInput, { color: colors.textMain, backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}
                value={assignEmail} onChangeText={setAssignEmail}
                placeholder="Teacher email to assign" placeholderTextColor={colors.textDim}
              />
              <TouchableOpacity style={[styles.assignBtn, { backgroundColor: colors.primary }]} onPress={handleAssign} disabled={assigning}>
                {assigning ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.assignBtnTxt}>Assign</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSelected(new Set())} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={16} color={colors.textDim} />
              </TouchableOpacity>
            </View>
          )}

          {/* Student list */}
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          ) : filtered.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
              <Feather name="users" size={28} color={colors.textDim} />
              <Text style={[styles.emptyTxt, { color: colors.textMuted }]}>No students found.{'\n'}Use "Bulk Add" to create student accounts.</Text>
            </View>
          ) : (
            <View style={[styles.table, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
              {/* Table header */}
              <View style={[styles.tableHeader, { borderBottomColor: colors.borderColor }]}>
                <View style={styles.colCheck} />
                <Text style={[styles.colHead, styles.colName, { color: colors.textMuted }]}>Name</Text>
                <Text style={[styles.colHead, styles.colGrade, { color: colors.textMuted }]}>Grade · Sec</Text>
                <Text style={[styles.colHead, styles.colCurr, { color: colors.textMuted }]}>Curriculum</Text>
                <Text style={[styles.colHead, styles.colTeacher, { color: colors.textMuted }]}>Teacher</Text>
                <Text style={[styles.colHead, styles.colActive, { color: colors.textMuted }]}>Last Active</Text>
              </View>

              {filtered.map((s, idx) => {
                const isSelected = selected.has(s.id);
                const teacher = s.teacher_student?.[0]?.['users!teacher_student_teacher_id_fkey'];
                const stats = s.student_stats;
                const lastActive = daysSince(stats?.last_active_date);
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.tableRow,
                      idx % 2 === 1 && { backgroundColor: colors.cardHover },
                      isSelected && { backgroundColor: colors.primary + '18' },
                      idx < filtered.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderColor },
                    ]}
                    onPress={() => toggleSelect(s.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.colCheck}>
                      <View style={[styles.checkbox, { borderColor: isSelected ? colors.primary : colors.borderColor, backgroundColor: isSelected ? colors.primary : 'transparent' }]}>
                        {isSelected && <Feather name="check" size={10} color="#fff" />}
                      </View>
                    </View>
                    <View style={styles.colName}>
                      <View style={[styles.avatar, { backgroundColor: colors.primary + '20' }]}>
                        <Text style={[styles.avatarTxt, { color: colors.primary }]}>{s.name?.[0]?.toUpperCase() || '?'}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.studentName, { color: colors.textMain }]} numberOfLines={1}>{s.name}</Text>
                        <Text style={[styles.studentEmail, { color: colors.textDim }]} numberOfLines={1}>{s.email}</Text>
                      </View>
                    </View>
                    <Text style={[styles.colGrade, styles.cellTxt, { color: colors.textMain }]}>
                      {s.grade?.replace('Grade ', 'G') || '—'}{s.section ? ` · ${s.section}` : ''}
                    </Text>
                    <Text style={[styles.colCurr, styles.cellTxt, { color: colors.textMuted }]} numberOfLines={1}>{s.curriculum || '—'}</Text>
                    <TouchableOpacity
                      style={[styles.colTeacher, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
                      onPress={(e) => { e.stopPropagation?.(); setAssignStudent(s); setSingleAssignEmail(teacher?.email || ''); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.cellTxt, { color: teacher ? colors.accentGreen : colors.accentYellow }]} numberOfLines={1}>
                        {teacher ? teacher.name : 'Unassigned'}
                      </Text>
                      <Feather name="edit-2" size={11} color={teacher ? colors.accentGreen : colors.accentYellow} />
                    </TouchableOpacity>
                    <Text style={[styles.colActive, styles.cellTxt, { color: lastActive === 'Today' ? colors.accentGreen : colors.textDim }]}>
                      {lastActive || '—'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Map by Section modal */}
        <Modal visible={showSectionMap} transparent animationType="fade" onRequestClose={() => setShowSectionMap(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <View style={{ backgroundColor: colors.cardDark, borderRadius: radius.lg, padding: 22, width: '100%', maxWidth: 480, gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textMain }}>Map Section to Teacher</Text>
                <TouchableOpacity onPress={() => setShowSectionMap(false)}>
                  <Feather name="x" size={18} color={colors.textDim} />
                </TouchableOpacity>
              </View>

              {/* Grade picker */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }}>GRADE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {Array.from(new Set(students.map(s => s.grade).filter(Boolean))).sort().map(g => (
                    <TouchableOpacity key={g} onPress={() => { setMapGrade(g); setMapTeacher(null); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                        borderColor: mapGrade === g ? colors.primary : colors.borderColor,
                        backgroundColor: mapGrade === g ? colors.primaryGlow : 'transparent' }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: mapGrade === g ? colors.primary : colors.textMuted }}>{g}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Section picker */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }}>SECTION</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {Array.from(new Set(students.filter(s => s.grade === mapGrade).map(s => s.section).filter(Boolean))).sort().map(sec => (
                    <TouchableOpacity key={sec} onPress={() => setMapSection(sec)}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                        borderColor: mapSection === sec ? colors.primary : colors.borderColor,
                        backgroundColor: mapSection === sec ? colors.primaryGlow : 'transparent' }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: mapSection === sec ? colors.primary : colors.textMuted }}>Section {sec}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Subject input */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }}>SUBJECT <Text style={{ fontWeight: '400' }}>(optional — filters teachers)</Text></Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {['Maths', 'Science', 'English', 'Social Studies', 'Hindi'].map(sub => (
                    <TouchableOpacity key={sub} onPress={() => { setMapSubject(mapSubject === sub ? '' : sub); setMapTeacher(null); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                        borderColor: mapSubject === sub ? colors.accentGreen : colors.borderColor,
                        backgroundColor: mapSubject === sub ? colors.accentGreen + '20' : 'transparent' }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: mapSubject === sub ? colors.accentGreen : colors.textMuted }}>{sub}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Teacher list */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }}>
                  SELECT TEACHER {mapSubject ? `(teaches ${mapSubject} · ${mapGrade})` : ''}
                </Text>
                {matchedTeachers.length === 0 ? (
                  <Text style={{ fontSize: 12, color: colors.textDim, fontStyle: 'italic' }}>No teachers found for this grade/subject.</Text>
                ) : (
                  <ScrollView style={{ maxHeight: 150 }} showsVerticalScrollIndicator={false}>
                    {matchedTeachers.map(t => {
                      const isChosen = mapTeacher?.id === t.id;
                      return (
                        <TouchableOpacity key={t.id} onPress={() => setMapTeacher(t)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 9, borderRadius: radius.sm, marginBottom: 4,
                            backgroundColor: isChosen ? colors.primaryGlow : 'transparent',
                            borderWidth: 1, borderColor: isChosen ? colors.primary : colors.borderColor }}>
                          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary + '20', alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>{t.name?.[0]?.toUpperCase() || '?'}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain }}>{t.name}</Text>
                            <Text style={{ fontSize: 11, color: colors.textDim }}>
                              {t.email}
                              {t.teaches?.length > 0 ? ` · ${t.teaches.map((x: any) => x.subjects?.join(', ')).filter(Boolean).join(' | ')}` : ''}
                            </Text>
                          </View>
                          {isChosen && <Feather name="check-circle" size={16} color={colors.primary} />}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              {/* Preview count */}
              {sectionPreview.length > 0 && mapTeacher && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: radius.sm, backgroundColor: colors.accentGreen + '15' }}>
                  <Feather name="users" size={13} color={colors.accentGreen} />
                  <Text style={{ fontSize: 12, color: colors.accentGreen, fontWeight: '600' }}>
                    {sectionPreview.length} students in {mapGrade} · Sec {mapSection} will be assigned to {mapTeacher.name}
                    {mapSubject ? ` for ${mapSubject}` : ''}
                  </Text>
                </View>
              )}

              {mapError ? <Text style={{ fontSize: 12, color: colors.accentRed }}>{mapError}</Text> : null}

              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
                <TouchableOpacity onPress={() => setShowSectionMap(false)}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Text style={{ color: colors.textDim, fontSize: 13 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSectionMap}
                  disabled={mapAssigning || !mapTeacher || sectionPreview.length === 0}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.accentGreen,
                    opacity: mapAssigning || !mapTeacher || sectionPreview.length === 0 ? 0.5 : 1 }}>
                  {mapAssigning
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Assign {sectionPreview.length > 0 ? `${sectionPreview.length} Students` : ''}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Single-student assign modal */}
        <Modal visible={!!assignStudent} transparent animationType="fade" onRequestClose={() => setAssignStudent(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <View style={{ backgroundColor: colors.cardDark, borderRadius: radius.lg, padding: 24, width: '100%', maxWidth: 400, gap: 14 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textMain }}>Assign Teacher</Text>
              <Text style={{ fontSize: 13, color: colors.textDim }}>
                Student: <Text style={{ color: colors.textMain, fontWeight: '600' }}>{assignStudent?.name}</Text>
              </Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, color: colors.textMain, backgroundColor: colors.cardDark, fontSize: 13 }}
                value={singleAssignEmail}
                onChangeText={setSingleAssignEmail}
                placeholder="Teacher email"
                placeholderTextColor={colors.textDim}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
                <TouchableOpacity onPress={() => setAssignStudent(null)} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Text style={{ color: colors.textDim, fontSize: 13 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSingleAssign}
                  disabled={singleAssigning || !singleAssignEmail.trim()}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: colors.primary, opacity: singleAssigning || !singleAssignEmail.trim() ? 0.5 : 1 }}
                >
                  {singleAssigning
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Assign</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <BulkAddModal
          visible={showModal}
          onClose={() => setShowModal(false)}
          onCreated={load}
          adminEmail={adminEmail}
          colors={colors}
          styles={styles}
        />
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:   { flex: 1, backgroundColor: c.bgDark },
  scroll:   { flex: 1 },
  content:  { padding: spacing.xl, paddingBottom: 48, gap: spacing.md },

  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 12, alignItems: 'center', gap: 4 },
  statVal:  { fontSize: 22, fontWeight: '800' },
  statLabel:{ fontSize: 11, fontWeight: '600' },

  searchRow:  { flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchBox:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, height: 40 },
  searchInput:{ flex: 1, fontSize: 14 },
  addBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 40, borderRadius: radius.md },
  addBtnTxt:  { color: '#fff', fontWeight: '700', fontSize: 14 },

  filterRow:    { gap: 6, alignItems: 'center' },
  filterLabel:  { fontSize: 12, fontWeight: '600' },
  filterChip:   { borderWidth: 1, borderColor: 'transparent', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  filterChipTxt:{ fontSize: 12, fontWeight: '600' },

  assignBar:    { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 10 },
  assignBarTxt: { fontWeight: '700', fontSize: 13 },
  assignInput:  { flex: 1, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, height: 34, fontSize: 13 },
  assignBtn:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm },
  assignBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  emptyCard: { borderWidth: 1, borderRadius: radius.md, padding: 32, alignItems: 'center', gap: 12 },
  emptyTxt:  { textAlign: 'center', fontSize: 14 },

  table:       { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingVertical: 10, paddingHorizontal: 12 },
  tableRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  colHead:     { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cellTxt:     { fontSize: 13 },
  colCheck:    { width: 32 },
  colName:     { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  colGrade:    { width: 80 },
  colCurr:     { flex: 1 },
  colTeacher:  { flex: 1 },
  colActive:   { width: 90, textAlign: 'right' },

  avatar:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 13, fontWeight: '800' },
  studentName:  { fontSize: 13, fontWeight: '600' },
  studentEmail: { fontSize: 11 },
  checkbox:  { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  // Modal styles
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal:    { width: '100%', maxWidth: 520, borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalTitle:  { fontSize: 18, fontWeight: '800' },

  label:      { fontSize: 12, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  input:      { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, height: 40, fontSize: 14 },
  multiInput: { height: 120 },
  chipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip:       { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  chipTxt:    { fontSize: 13, fontWeight: '600' },
  modeRow:    { flexDirection: 'row', borderWidth: 1, borderRadius: radius.sm, overflow: 'hidden', marginBottom: 4 },
  modeBtn:    { flex: 1, paddingVertical: 8, alignItems: 'center' },
  modeTxt:    { fontSize: 13, fontWeight: '600' },
  btn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.sm, marginTop: 8 },
  btnPrimary: { marginTop: 16 },
  btnTxt:     { color: '#fff', fontWeight: '700', fontSize: 14 },

  resultBanner:    { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.sm, padding: 10, marginBottom: 12 },
  resultBannerTxt: { fontWeight: '600', fontSize: 13 },
  credBox:         { borderWidth: 1, borderRadius: radius.sm, padding: 12, gap: 4, marginBottom: 12 },
  credHint:        { fontSize: 11, marginBottom: 6 },
  credRow:         { fontSize: 12, fontFamily: 'monospace' },
  resultActions:   { flexDirection: 'row', gap: 10 },
});
