/**
 * OnboardingStudentBoxes.tsx
 * Student onboarding — all sections shown as cards on a single page
 * (About You, Curriculum, School & Grade, Your Avatar, Learning Style).
 * Everything is visible and editable at once; "Complete Setup" saves
 * the profile and finishes onboarding.
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SERVER_URL from '../../config/serverUrl';
import { AVATAR_STYLES } from '../../constants/avatarStyles';
import {
  DatePickerInput, CURRICULA, getGradesForCurriculum, GENDERS, LEARNING_STYLES, TEAL,
} from './OnboardingScreen';
import {
  AutocompleteField, CardHeader, BBox, fetchCitySuggestions, fetchSchoolSuggestions, locateCity,
} from './OnboardingSharedFields';

function getAge(dobStr: string): number | null {
  const parts = dobStr.split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map(Number);
  if (!dd || !mm || !yyyy || yyyy < 1900) return null;
  const birth = new Date(yyyy, mm - 1, dd);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export default function OnboardingStudentBoxes() {
  const { user, updateUser } = useAuth();
  const { colors } = useTheme();
  const styles = useStyles(colors);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [locating, setLocating] = useState(false);
  const cityBBoxCache = useRef<Map<string, BBox | null>>(new Map());

  // Form state
  const [fullName, setFullName] = useState(user?.name || '');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [curriculum, setCurriculum] = useState((user as any)?.curriculum || '');
  const [school, setSchool] = useState((user as any)?.school || '');
  const [city, setCity] = useState((user as any)?.location || '');
  const [grade, setGrade] = useState((user as any)?.grade || '');
  const [avatarStyle, setAvatarStyle] = useState('default');
  const [learningStyle, setLearningStyle] = useState('');

  // ── Per-card completion ────────────────────────────
  const aboutYouDone = fullName.trim().length >= 2 && getAge(dob) !== null && getAge(dob)! >= 14;
  const curriculumDone = curriculum.length > 0;
  const schoolGradeDone = school.trim().length >= 2 && grade.length > 0;
  const avatarDone = avatarStyle.length > 0;
  const learningStyleDone = learningStyle.length > 0;

  const requiredDone = aboutYouDone && curriculumDone && schoolGradeDone;
  const doneCount = [aboutYouDone, curriculumDone, schoolGradeDone, avatarDone, learningStyleDone].filter(Boolean).length;
  const completionPct = Math.round((doneCount / 5) * 100);

  const underAge = dob.length >= 10 && getAge(dob) !== null && getAge(dob)! < 14;

  async function handleFinish() {
    if (!requiredDone) {
      setSaveError('Please complete About You, Curriculum, and School & Grade before continuing.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const email = user?.email || '';

      const body = {
        email,
        role: 'student',
        name: fullName.trim(),
        school,
        location: city,
        complete: true,
        grade: grade.trim(),
        curriculum: curriculum.trim(),
      };

      const profileRes = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!profileRes.ok) {
        const errText = await profileRes.text().catch(() => '');
        throw new Error(`Profile save failed (${profileRes.status}): ${errText.slice(0, 200)}`);
      }
      const saved = await profileRes.json().catch(() => ({}));
      if (!saved.grade || !saved.curriculum) {
        throw new Error('Your profile could not be saved correctly. Please try again.');
      }

      fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: fullName.trim(),
          role: 'student',
          grade: grade.trim(),
          curriculum: curriculum.trim(),
          school,
          location: city,
          avatarStyle,
          learningStyle: learningStyle || undefined,
          gender: gender || undefined,
        }),
      }).catch(() => {});

      updateUser({
        name: fullName.trim(),
        school,
        location: city,
        onboardingComplete: true,
        avatarStyle,
        grade: saved.grade,
        curriculum: saved.curriculum,
      } as any);
    } catch (err: any) {
      console.error('Onboarding save error:', err);
      setSaveError(err?.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.topbar}>
          <View style={styles.logoRow}>
            <View style={styles.logoMark}><Feather name="zap" size={14} color="#fff" /></View>
            <Text style={styles.logoTxt}>Aivorah</Text>
          </View>
          <View style={styles.completionRow}>
            <Text style={styles.completionLbl}>Profile Completion</Text>
            <View style={styles.completionRing}>
              <Text style={styles.completionPct}>{completionPct}%</Text>
            </View>
          </View>
        </View>

        <View style={styles.greetWrap}>
          <Text style={styles.greetMain}>Nice — let's personalise your learning experience</Text>
          <Text style={styles.greetSub}>Fill in each box to help us tailor stories, examples and explanations just for you.</Text>
        </View>

        {/* ── Row 1: About You / Curriculum / School & Grade ── */}
        <View style={styles.rowWrap}>
          {/* About You */}
          <View style={[styles.card, styles.card3]}>
            <CardHeader icon="user" title="About You" subtitle="Let's get to know you better." done={aboutYouDone} styles={styles} />
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Name</Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
                placeholder="Your name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Gender</Text>
              <View style={styles.chipRow}>
                {GENDERS.map(g => (
                  <TouchableOpacity key={g} style={[styles.chip, gender === g && styles.chipActive]}
                    onPress={() => setGender(g)} activeOpacity={0.8}>
                    <Text style={[styles.chipTxt, gender === g && styles.chipTxtActive]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Date of Birth</Text>
              {Platform.OS === 'web' ? (
                <DatePickerInput value={dob} onChange={setDob} colors={colors} />
              ) : (
                <TextInput style={styles.input} value={dob} onChangeText={setDob}
                  placeholder="DD/MM/YYYY" placeholderTextColor={colors.textDim} keyboardType="numeric" />
              )}
              {underAge && (
                <Text style={styles.warnTxt}>Students under 14 must have a parent or teacher create the account.</Text>
              )}
            </View>
          </View>

          {/* Curriculum */}
          <View style={[styles.card, styles.card3]}>
            <CardHeader icon="book-open" title="Curriculum" subtitle="Which curriculum do you follow?" done={curriculumDone} styles={styles} />
            <View style={styles.radioGrid}>
              {CURRICULA.map(c => (
                <TouchableOpacity key={c}
                  style={[styles.radioTile, curriculum === c && styles.radioTileActive]}
                  onPress={() => { setCurriculum(c); setGrade(''); }} activeOpacity={0.8}>
                  <Text style={[styles.chipTxt, curriculum === c && styles.chipTxtActive]}>{c}</Text>
                  <View style={[styles.radio, curriculum === c && { borderColor: TEAL }]}>
                    {curriculum === c && <View style={styles.radioDot} />}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.infoBox}>
              <Feather name="info" size={14} color={TEAL} />
              <Text style={styles.infoTxt}>You can change this anytime in settings.</Text>
            </View>
          </View>

          {/* School & Grade */}
          <View style={[styles.card, styles.card3]}>
            <CardHeader icon="award" title="School & Grade" subtitle="Tell us about your school and grade." done={schoolGradeDone} styles={styles} />
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>School Name</Text>
              <AutocompleteField
                value={school}
                onChange={setSchool}
                fetchSuggestions={(q) => fetchSchoolSuggestions(q, city, cityBBoxCache.current)}
                placeholder="Type your school name (e.g. Senthil Public School)"
                colors={colors}
                styles={styles}
                disabledMessage={city.trim().length < 3 ? 'Enter your city below to search nearby schools.' : undefined}
              />
            </View>
            <View style={styles.fieldGroup}>
              <View style={styles.lblRow}>
                <Text style={styles.lbl}>City</Text>
                {Platform.OS === 'web' && (
                  <TouchableOpacity style={styles.locateBtn} onPress={() => locateCity(setCity, setLocating)} disabled={locating} activeOpacity={0.8}>
                    <Feather name="crosshair" size={12} color={TEAL} />
                    <Text style={styles.locateTxt}>{locating ? 'Locating...' : 'Use my location'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <AutocompleteField
                value={city}
                onChange={setCity}
                fetchSuggestions={fetchCitySuggestions}
                placeholder="Search for your city"
                colors={colors}
                styles={styles}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Grade</Text>
              <View style={styles.chipRow}>
                {getGradesForCurriculum(curriculum).map(g => (
                  <TouchableOpacity key={g} style={[styles.chip, grade === g && styles.chipActive]}
                    onPress={() => setGrade(g)} activeOpacity={0.8}>
                    <Text style={[styles.chipTxt, grade === g && styles.chipTxtActive]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* ── Row 2: Your Avatar / Learning Style ── */}
        <View style={styles.rowWrap}>
          <View style={[styles.card, styles.card3Wide]}>
            <CardHeader icon="smile" title="Your Avatar" subtitle="Choose an avatar that represents you." done={avatarDone} styles={styles} />
            <View style={styles.avatarGrid}>
              {AVATAR_STYLES.map(av => (
                <TouchableOpacity key={av.id}
                  style={[styles.avatarTile, avatarStyle === av.id && styles.avatarTileActive]}
                  onPress={() => setAvatarStyle(av.id)} activeOpacity={0.8}>
                  <LinearGradient colors={av.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatarCircle}>
                    <Feather name={av.icon as any} size={20} color="#fff" />
                  </LinearGradient>
                  <Text style={[styles.avatarLbl, avatarStyle === av.id && { color: TEAL }]}>{av.label}</Text>
                  {avatarStyle === av.id && (
                    <View style={styles.tileCheck}><Feather name="check" size={10} color="#fff" /></View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.card, styles.card2]}>
            <CardHeader icon="zap" title="Learning Style" subtitle="How do you learn best?" done={learningStyleDone} styles={styles} />
            <View style={styles.lsGrid}>
              {LEARNING_STYLES.map(ls => (
                <TouchableOpacity key={ls.id}
                  style={[styles.lsTile, learningStyle === ls.id && styles.lsTileActive]}
                  onPress={() => setLearningStyle(ls.id)} activeOpacity={0.8}>
                  <View style={styles.lsRow}>
                    <Feather name={ls.icon as any} size={16} color={learningStyle === ls.id ? TEAL : colors.textMuted} />
                    {learningStyle === ls.id && <Feather name="check-circle" size={14} color={TEAL} />}
                  </View>
                  <Text style={[styles.lsLabel, learningStyle === ls.id && { color: TEAL }]}>{ls.label}</Text>
                  <Text style={styles.lsDesc}>{ls.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {saveError ? <Text style={styles.errorTxt}>{saveError}</Text> : null}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.secureRow}>
            <View style={styles.secureIcon}><Feather name="shield" size={14} color={TEAL} /></View>
            <Text style={styles.secureTxt}>Your data is secure and never shared.</Text>
          </View>
          <View style={styles.footerBtns}>
            {!requiredDone && (
              <Text style={styles.requiredHint}>Complete About You, Curriculum and School & Grade to continue</Text>
            )}
            <TouchableOpacity
              style={[styles.completeBtn, !requiredDone && { opacity: 0.4 }]}
              disabled={!requiredDone || saving}
              onPress={handleFinish} activeOpacity={0.85}>
              <Text style={styles.completeTxt}>{saving ? 'Saving...' : 'Complete Setup'}</Text>
              {!saving && <Feather name="arrow-right" size={16} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function useStyles(colors: any) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, maxWidth: 1280, width: '100%', alignSelf: 'center' },

    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logoMark: { width: 28, height: 28, borderRadius: 8, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
    logoTxt: { fontSize: 16, fontWeight: '800', color: colors.textMain },
    completionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    completionLbl: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    completionRing: {
      width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: TEAL,
      alignItems: 'center', justifyContent: 'center',
    },
    completionPct: { fontSize: 11, fontWeight: '800', color: TEAL },

    greetWrap: { marginBottom: 24 },
    greetMain: { fontSize: 24, fontWeight: '800', color: colors.textMain },
    greetSub: { fontSize: 14, color: colors.textMuted, marginTop: 4 },

    rowWrap: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginBottom: 16 },
    card: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 16, padding: 20, gap: 16,
    },
    card3: { flexGrow: 1, flexBasis: 320, minWidth: 280 },
    card3Wide: { flexGrow: 2, flexBasis: 460, minWidth: 320 },
    card2: { flexGrow: 1.5, flexBasis: 360, minWidth: 300 },

    cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    cardIcon: {
      width: 38, height: 38, borderRadius: 10, backgroundColor: TEAL + '18',
      alignItems: 'center', justifyContent: 'center',
    },
    cardTitle: { fontSize: 16, fontWeight: '800', color: colors.textMain },
    cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    cardCheck: {
      width: 18, height: 18, borderRadius: 9, backgroundColor: TEAL,
      alignItems: 'center', justifyContent: 'center',
    },

    fieldGroup: { gap: 8 },
    lbl: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    lblRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    locateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    locateTxt: { fontSize: 11, fontWeight: '700', color: TEAL },
    input: {
      height: 44, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 10, paddingHorizontal: 14, fontSize: 14, color: colors.textMain,
    },
    hintTxt: { fontSize: 11, color: colors.textDim },
    dropdown: {
      marginTop: 6,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 10, overflow: 'hidden',
    },
    dropdownItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    dropdownTxt: { fontSize: 13, color: colors.textMain },
    dropdownHint: { fontSize: 12, color: colors.textMuted, paddingHorizontal: 14, paddingVertical: 10 },
    warnTxt: { color: '#ef4444', fontSize: 12, lineHeight: 17, marginTop: 4 },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark },
    chipActive: { backgroundColor: TEAL + '20', borderColor: TEAL },
    chipTxt: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    chipTxtActive: { color: TEAL },

    radioGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    radioTile: {
      flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark,
    },
    radioTileActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
    radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.borderColor, alignItems: 'center', justifyContent: 'center' },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TEAL },

    infoBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12,
      borderRadius: 10, backgroundColor: TEAL + '10', borderWidth: 1, borderColor: TEAL + '30',
    },
    infoTxt: { fontSize: 12, color: colors.textMuted },

    avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    avatarTile: {
      flexBasis: '21%', flexGrow: 1, minWidth: 76, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 12,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, position: 'relative',
    },
    avatarTileActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
    avatarCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarLbl: { fontSize: 11, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
    tileCheck: {
      position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
      backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
    },

    lsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    lsTile: {
      flexBasis: '47%', flexGrow: 1, padding: 14, borderRadius: 12,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, gap: 6,
    },
    lsTileActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
    lsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    lsLabel: { fontSize: 13, fontWeight: '700', color: colors.textMain },
    lsDesc: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },

    errorTxt: { color: '#ef4444', fontSize: 13, textAlign: 'center', marginBottom: 12 },

    footer: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 16, marginTop: 8,
    },
    secureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    secureIcon: {
      width: 28, height: 28, borderRadius: 8, backgroundColor: TEAL + '18',
      alignItems: 'center', justifyContent: 'center',
    },
    secureTxt: { fontSize: 13, color: colors.textMuted },
    footerBtns: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    requiredHint: { fontSize: 12, color: colors.textMuted, maxWidth: 220, textAlign: 'right' },
    completeBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: TEAL, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 12,
    },
    completeTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },
  });
}
