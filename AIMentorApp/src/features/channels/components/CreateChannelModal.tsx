/**
 * CreateChannelModal — teachers/admins create either:
 *  - a class/broadcast channel, with grade+section auto-add (pre-filled from
 *    the caller's own homeroom when they're a class teacher, per Toddle), or
 *  - a "Family of <Student>" room (Toddle-style): student + teacher + all
 *    linked parents, everyone can post.
 * Grade/section/student are always picked from real data, never typed, so
 * auto-add can never silently no-op on a typo or a blank field.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, TextInput, Switch, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import { createChannel, createFamilyChannel, fetchGradesSections, fetchMyStudents, searchPeople, GradeSections, Homeroom, MyStudent, Person } from '../api/channelsApi';
import { initials, pastelBg, pastelText } from '../utils/avatar';
import { GROUP_ICONS, GroupIconName } from '../utils/icons';

type Mode = 'class' | 'family' | 'group';

export default function CreateChannelModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void; }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';
  const [mode, setMode] = useState<Mode>('class');

  // Class channel state
  const [name, setName] = useState('');
  // Scope: 'class' = one grade/section (or picked members); 'staff' = every
  // teacher + admin at the school, internal only. No school-wide broadcast
  // option here — that's what Announcements already covers.
  const [scope, setScope] = useState<'class' | 'staff'>('class');
  const [staffOnly, setStaffOnly] = useState(true);
  const [gradesSections, setGradesSections] = useState<GradeSections[]>([]);
  const [myHomerooms, setMyHomerooms] = useState<Homeroom[]>([]);
  const [autoGrade, setAutoGrade] = useState('');
  const [autoSection, setAutoSection] = useState('');
  const [gradePickerOpen, setGradePickerOpen] = useState(false);
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);

  // Family room state
  const [myStudents, setMyStudents] = useState<MyStudent[]>([]);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<MyStudent | null>(null);

  // Create group state — WhatsApp-style: narrow by grade/section (optional),
  // then search + tap-to-add students AND their parents together.
  const [groupName, setGroupName] = useState('');
  const [groupGrade, setGroupGrade] = useState('');
  const [groupSection, setGroupSection] = useState('');
  const [groupGradePickerOpen, setGroupGradePickerOpen] = useState(false);
  const [groupSectionPickerOpen, setGroupSectionPickerOpen] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState<Person[]>([]);
  const [pickedPeople, setPickedPeople] = useState<Person[]>([]);

  // Group "DP" — a picked icon on a pastel background, shown in the inbox row
  // and thread header instead of the generic people icon.
  const [icon, setIcon] = useState<GroupIconName>('users');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setMode('class'); setName(''); setScope('class'); setStaffOnly(true); setAutoGrade(''); setAutoSection('');
    setSelectedStudent(null); setError(''); setIcon('users');
    setGroupName(''); setGroupGrade(''); setGroupSection(''); setPeopleQuery(''); setPeopleResults([]); setPickedPeople([]);
    fetchGradesSections(email).then(({ grades, myHomerooms: hr }) => {
      setGradesSections(grades); setMyHomerooms(hr);
      // Pre-fill from the caller's own homeroom, matching Toddle — a class
      // teacher shouldn't have to re-type a grade/section we already know.
      if (hr.length === 1) { setAutoGrade(hr[0].grade); setAutoSection(hr[0].section); setGroupGrade(hr[0].grade); setGroupSection(hr[0].section); }
    }).catch(() => { setGradesSections([]); setMyHomerooms([]); });
    fetchMyStudents(email).then(setMyStudents).catch(() => setMyStudents([]));
  }, [visible]);

  const groupSectionsForGrade = gradesSections.find((g) => g.name === groupGrade)?.sections || [];

  useEffect(() => {
    if (mode !== 'group' || !groupGrade) { setPeopleResults([]); return; }
    const t = setTimeout(() => {
      searchPeople(email, { grade: groupGrade, section: groupSection || undefined, q: peopleQuery.trim() || undefined })
        .then(setPeopleResults).catch(() => setPeopleResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [mode, groupGrade, groupSection, peopleQuery]);

  const togglePerson = (p: Person) => {
    setPickedPeople((prev) => prev.some((x) => x.email === p.email) ? prev.filter((x) => x.email !== p.email) : [...prev, p]);
  };

  const sectionsForGrade = gradesSections.find((g) => g.name === autoGrade)?.sections || [];

  const submitClass = async () => {
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      if (scope === 'staff') {
        await createChannel({ email, name: name.trim(), category: 'staff', posting: 'members', iconLabel: icon, autoAddAllStaff: true });
      } else {
        await createChannel({
          email, name: name.trim(), posting: staffOnly ? 'staff_only' : 'members',
          grade: autoGrade || undefined, section: autoSection || undefined,
          autoAddParentsOfGrade: autoGrade || undefined,
          autoAddParentsOfSection: autoSection || undefined,
          iconLabel: icon,
        });
      }
      onCreated();
    } catch (e: any) { setError(e?.message || 'Failed to create channel'); }
    finally { setBusy(false); }
  };

  const submitGroup = async () => {
    if (!groupName.trim() || !pickedPeople.length) return;
    setBusy(true); setError('');
    try {
      await createChannel({
        email, name: groupName.trim(), posting: 'members',
        iconLabel: icon,
        members: pickedPeople.map((p) => ({ email: p.email, roleLabel: p.roleLabel })),
      });
      onCreated();
    } catch (e: any) { setError(e?.message || 'Failed to create group'); }
    finally { setBusy(false); }
  };

  const submitFamily = async () => {
    if (!selectedStudent) return;
    setBusy(true); setError('');
    try {
      await createFamilyChannel(email, selectedStudent.id);
      onCreated();
    } catch (e: any) { setError(e?.message || 'Failed to create family room'); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.head}><Text style={styles.title}>New channel</Text><TouchableOpacity onPress={onClose}><Feather name="x" size={18} color={colors.textMuted} /></TouchableOpacity></View>

          <ScrollView style={styles.cardScroll} contentContainerStyle={styles.cardScrollContent} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <View style={styles.modeRow}>
            <TouchableOpacity style={[styles.modeBtn, mode === 'class' && styles.modeBtnActive]} onPress={() => setMode('class')}>
              <Text style={[styles.modeText, mode === 'class' && styles.modeTextActive]}>Class channel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, mode === 'family' && styles.modeBtnActive]} onPress={() => setMode('family')}>
              <Text style={[styles.modeText, mode === 'family' && styles.modeTextActive]}>Family room</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, mode === 'group' && styles.modeBtnActive]} onPress={() => setMode('group')}>
              <Text style={[styles.modeText, mode === 'group' && styles.modeTextActive]}>Create group</Text>
            </TouchableOpacity>
          </View>

          {mode === 'class' && (
            <>
              <Text style={styles.label}>Channel name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. PYP 5 Parents - 2026-27" placeholderTextColor={colors.textDim} autoFocus />

              <Text style={styles.label}>Icon</Text>
              <View style={styles.iconRow}>
                {GROUP_ICONS.map((ic) => (
                  <TouchableOpacity key={ic} onPress={() => setIcon(ic)} style={[styles.iconOption, { backgroundColor: pastelBg(ic) }, icon === ic && styles.iconOptionActive]}>
                    <Feather name={ic as any} size={16} color={pastelText(ic)} />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Scope</Text>
              <View style={styles.modeRow}>
                <TouchableOpacity style={[styles.scopeBtn, scope === 'class' && styles.modeBtnActive]} onPress={() => setScope('class')}>
                  <Text style={[styles.modeText, scope === 'class' && styles.modeTextActive]}>Class</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.scopeBtn, scope === 'staff' && styles.modeBtnActive]} onPress={() => setScope('staff')}>
                  <Text style={[styles.modeText, scope === 'staff' && styles.modeTextActive]}>Staff Room</Text>
                </TouchableOpacity>
              </View>

              {scope === 'staff' && (
                <Text style={styles.hint}>Internal room — every teacher and school admin auto-added, no parents. Everyone can post.</Text>
              )}

              {scope === 'class' && (
                <>
                  <View style={styles.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Broadcast (staff-only posting)</Text>
                      <Text style={styles.hint}>Parents can read but only teachers/admins post.</Text>
                    </View>
                    <Switch value={staffOnly} onValueChange={setStaffOnly} />
                  </View>

                  <Text style={styles.label}>Auto-add parents of grade &amp; section (optional)</Text>
                  {!!myHomerooms.length && (
                    <Text style={styles.hint}>Pre-filled from your homeroom{myHomerooms.length > 1 ? 's' : ''} — change if you're creating this for a different class.</Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <TouchableOpacity style={styles.selectBtn} onPress={() => setGradePickerOpen((v) => !v)}>
                        <Text style={autoGrade ? styles.selectText : styles.selectPlaceholder}>{autoGrade || 'Grade'}</Text>
                        <Feather name="chevron-down" size={14} color={colors.textDim} />
                      </TouchableOpacity>
                      {gradePickerOpen && (
                        <View style={styles.dropdown}>
                          <ScrollView style={{ maxHeight: 160 }}>
                            {gradesSections.map((g) => (
                              <TouchableOpacity key={g.name} style={styles.dropdownItem} onPress={() => { setAutoGrade(g.name); setAutoSection(''); setGradePickerOpen(false); }}>
                                <Text style={styles.dropdownText}>{g.name}</Text>
                              </TouchableOpacity>
                            ))}
                            {!gradesSections.length && <Text style={styles.dropdownEmpty}>No grades found</Text>}
                          </ScrollView>
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <TouchableOpacity
                        style={[styles.selectBtn, !autoGrade && { opacity: 0.5 }]}
                        disabled={!autoGrade}
                        onPress={() => setSectionPickerOpen((v) => !v)}
                      >
                        <Text style={autoSection ? styles.selectText : styles.selectPlaceholder}>{autoSection || 'Section (all)'}</Text>
                        <Feather name="chevron-down" size={14} color={colors.textDim} />
                      </TouchableOpacity>
                      {sectionPickerOpen && (
                        <View style={styles.dropdown}>
                          <ScrollView style={{ maxHeight: 160 }}>
                            <TouchableOpacity style={styles.dropdownItem} onPress={() => { setAutoSection(''); setSectionPickerOpen(false); }}>
                              <Text style={styles.dropdownText}>All sections</Text>
                            </TouchableOpacity>
                            {sectionsForGrade.map((s) => (
                              <TouchableOpacity key={s} style={styles.dropdownItem} onPress={() => { setAutoSection(s); setSectionPickerOpen(false); }}>
                                <Text style={styles.dropdownText}>Section {s}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                    </View>
                  </View>
                  {!!autoGrade && (
                    <Text style={styles.hint}>
                      Every parent of {autoSection ? `Grade ${autoGrade} · Section ${autoSection}` : `Grade ${autoGrade} (all sections)`} will be added automatically.
                    </Text>
                  )}
                </>
              )}

              {!!error && <Text style={styles.error}>{error}</Text>}
              <TouchableOpacity style={[styles.createBtn, (!name.trim() || busy) && { opacity: 0.6 }]} disabled={!name.trim() || busy} onPress={submitClass}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create channel</Text>}
              </TouchableOpacity>
            </>
          )}

          {mode === 'family' && (
            <>
              <Text style={styles.label}>Student</Text>
              <TouchableOpacity style={styles.selectBtn} onPress={() => setStudentPickerOpen((v) => !v)}>
                <Text style={selectedStudent ? styles.selectText : styles.selectPlaceholder}>
                  {selectedStudent ? `${selectedStudent.name}${selectedStudent.grade ? ` · ${selectedStudent.grade}${selectedStudent.section ? ' ' + selectedStudent.section : ''}` : ''}` : 'Pick a student from your class'}
                </Text>
                <Feather name="chevron-down" size={14} color={colors.textDim} />
              </TouchableOpacity>
              {studentPickerOpen && (
                <View style={styles.dropdown}>
                  <ScrollView style={{ maxHeight: 200 }}>
                    {myStudents.map((s) => (
                      <TouchableOpacity key={s.id} style={styles.dropdownItem} onPress={() => { setSelectedStudent(s); setStudentPickerOpen(false); }}>
                        <Text style={styles.dropdownText}>{s.name}{s.grade ? ` · ${s.grade}${s.section ? ' ' + s.section : ''}` : ''}</Text>
                      </TouchableOpacity>
                    ))}
                    {!myStudents.length && <Text style={styles.dropdownEmpty}>No students linked to you yet</Text>}
                  </ScrollView>
                </View>
              )}
              {!!selectedStudent && (
                <Text style={styles.hint}>
                  Creates "Family of {selectedStudent.name}" with you and all of {selectedStudent.name}'s linked parents — everyone can post.
                </Text>
              )}

              {!!error && <Text style={styles.error}>{error}</Text>}
              <TouchableOpacity style={[styles.createBtn, (!selectedStudent || busy) && { opacity: 0.6 }]} disabled={!selectedStudent || busy} onPress={submitFamily}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create family room</Text>}
              </TouchableOpacity>
            </>
          )}

          {mode === 'group' && (
            <>
              <Text style={styles.label}>Group name</Text>
              <TextInput style={styles.input} value={groupName} onChangeText={setGroupName} placeholder="e.g. Grade 3 A Parents Group" placeholderTextColor={colors.textDim} autoFocus />

              <Text style={styles.label}>Icon</Text>
              <View style={styles.iconRow}>
                {GROUP_ICONS.map((ic) => (
                  <TouchableOpacity key={ic} onPress={() => setIcon(ic)} style={[styles.iconOption, { backgroundColor: pastelBg(ic) }, icon === ic && styles.iconOptionActive]}>
                    <Feather name={ic as any} size={16} color={pastelText(ic)} />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Class to pick people from</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <TouchableOpacity style={styles.selectBtn} onPress={() => setGroupGradePickerOpen((v) => !v)}>
                    <Text style={groupGrade ? styles.selectText : styles.selectPlaceholder}>{groupGrade || 'Grade'}</Text>
                    <Feather name="chevron-down" size={14} color={colors.textDim} />
                  </TouchableOpacity>
                  {groupGradePickerOpen && (
                    <View style={styles.dropdown}>
                      <ScrollView style={{ maxHeight: 160 }}>
                        {gradesSections.map((g) => (
                          <TouchableOpacity key={g.name} style={styles.dropdownItem} onPress={() => { setGroupGrade(g.name); setGroupSection(''); setGroupGradePickerOpen(false); }}>
                            <Text style={styles.dropdownText}>{g.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <TouchableOpacity
                    style={[styles.selectBtn, !groupGrade && { opacity: 0.5 }]}
                    disabled={!groupGrade}
                    onPress={() => setGroupSectionPickerOpen((v) => !v)}
                  >
                    <Text style={groupSection ? styles.selectText : styles.selectPlaceholder}>{groupSection || 'Section'}</Text>
                    <Feather name="chevron-down" size={14} color={colors.textDim} />
                  </TouchableOpacity>
                  {groupSectionPickerOpen && (
                    <View style={styles.dropdown}>
                      <ScrollView style={{ maxHeight: 160 }}>
                        {groupSectionsForGrade.map((s) => (
                          <TouchableOpacity key={s} style={styles.dropdownItem} onPress={() => { setGroupSection(s); setGroupSectionPickerOpen(false); }}>
                            <Text style={styles.dropdownText}>Section {s}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              </View>

              {!!groupGrade && (
                <>
                  <Text style={styles.label}>Add people</Text>
                  <View style={styles.searchInputWrap}>
                    <Feather name="search" size={14} color={colors.textDim} />
                    <TextInput style={styles.searchInputInline} value={peopleQuery} onChangeText={setPeopleQuery} placeholder="Search students or parents…" placeholderTextColor={colors.textDim} />
                  </View>
                  <ScrollView style={styles.peopleList} nestedScrollEnabled>
                    {peopleResults.map((p) => {
                      const picked = pickedPeople.some((x) => x.email === p.email);
                      return (
                        <TouchableOpacity key={p.email} style={styles.personRow} onPress={() => togglePerson(p)}>
                          <View style={[styles.personAvatar, { backgroundColor: pastelBg(p.name) }, picked && { borderWidth: 2, borderColor: colors.accentYellow }]}>
                            <Text style={[styles.personAvatarText, { color: pastelText(p.name) }]}>{initials(p.name)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.personName} numberOfLines={1}>{p.name}</Text>
                            <Text style={styles.personRole} numberOfLines={1}>{p.roleLabel}</Text>
                          </View>
                          <Feather name={picked ? 'check-circle' : 'circle'} size={18} color={picked ? colors.accentYellow : colors.borderColor} />
                        </TouchableOpacity>
                      );
                    })}
                    {!peopleResults.length && <Text style={styles.dropdownEmpty}>No matches in this class</Text>}
                  </ScrollView>
                </>
              )}

              {!!pickedPeople.length && (
                <>
                  <Text style={styles.label}>Selected ({pickedPeople.length})</Text>
                  <View style={styles.chipsWrap}>
                    {pickedPeople.map((p) => (
                      <TouchableOpacity key={p.email} style={styles.chip} onPress={() => togglePerson(p)}>
                        <Text style={styles.chipText} numberOfLines={1}>{p.name}</Text>
                        <Feather name="x" size={11} color={colors.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {!!error && <Text style={styles.error}>{error}</Text>}
              <TouchableOpacity style={[styles.createBtn, (!groupName.trim() || !pickedPeople.length || busy) && { opacity: 0.6 }]} disabled={!groupName.trim() || !pickedPeople.length || busy} onPress={submitGroup}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create group</Text>}
              </TouchableOpacity>
            </>
          )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { backgroundColor: c.cardDark, borderRadius: 16, borderWidth: 1, borderColor: c.borderColor, padding: 20, width: '100%', maxWidth: 420, maxHeight: '88%', gap: 10 },
    cardScroll: { flexGrow: 0 },
    cardScrollContent: { gap: 10, paddingBottom: 4 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: c.textHeading },
    modeRow: { flexDirection: 'row', gap: 8, backgroundColor: c.bgDark, borderRadius: radius.sm, padding: 4, marginTop: 2 },
    modeBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.sm - 2, alignItems: 'center' },
    scopeBtn: { flex: 1, paddingVertical: 7, borderRadius: radius.sm - 2, alignItems: 'center' },
    modeBtnActive: { backgroundColor: c.accentYellow },
    modeText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: c.textMuted },
    modeTextActive: { color: '#fff' },
    label: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6 },
    input: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.serif, fontSize: 14, color: c.textHeading, backgroundColor: c.bgDark, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
    hint: { fontFamily: fonts.serif, fontSize: 11.5, color: c.textDim, marginTop: 2 },
    error: { fontFamily: fonts.serif, fontSize: 12.5, color: c.accentRed },
    createBtn: { backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
    createBtnText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: '#fff' },
    selectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.bgDark },
    selectText: { fontFamily: fonts.serif, fontSize: 14, color: c.textHeading },
    selectPlaceholder: { fontFamily: fonts.serif, fontSize: 14, color: c.textDim },
    dropdown: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, backgroundColor: c.bgDark, marginTop: -4 },
    dropdownItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderColor },
    dropdownText: { fontFamily: fonts.serif, fontSize: 13.5, color: c.textHeading },
    dropdownEmpty: { fontFamily: fonts.serif, fontSize: 12.5, color: c.textDim, padding: 12 },
    searchInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: c.bgDark },
    searchInputInline: { flex: 1, fontFamily: fonts.serif, fontSize: 14, color: c.textHeading, padding: 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 160, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    chipText: { flexShrink: 1, fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: c.textHeading },
    iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
    iconOption: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    iconOptionActive: { borderColor: c.accentYellow },
    peopleList: { maxHeight: 220, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, backgroundColor: c.bgDark },
    personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: c.borderColor },
    personAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.cardDark, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    personAvatarText: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '800', color: c.textHeading },
    personName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: c.textHeading },
    personRole: { fontFamily: fonts.serif, fontSize: 11.5, color: c.textDim, marginTop: 1 },
  });
}
