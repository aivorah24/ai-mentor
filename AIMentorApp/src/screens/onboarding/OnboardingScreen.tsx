/**
 * OnboardingScreen.tsx
 * Multi-step onboarding for Student, Teacher, Parent
 * Collects role-specific data, saves to backend, marks onboardingComplete
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { AVATAR_STYLES } from '../../constants/avatarStyles';
import SERVER_URL from '../../config/serverUrl';

// ── Constants ──────────────────────────────────────────────
const CURRICULA = ['IB PYP', 'NCERT', 'CBSE', 'ICSE', 'Cambridge', 'State Board'];
const GRADES = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];
const SUBJECTS = ['Mathematics','Science','English','Social Studies','Hindi','ICT','Art','Music','Physical Education'];
const GENDERS = ['Male', 'Female', 'Prefer not to say'];
const LEARNING_STYLES: { id: string; label: string; icon: string; desc: string }[] = [
  { id: 'visual', label: 'Visual', icon: 'eye', desc: 'I learn best with pictures and diagrams' },
  { id: 'reading', label: 'Reading', icon: 'book', desc: 'I learn best by reading and writing' },
  { id: 'hands-on', label: 'Hands-on', icon: 'tool', desc: 'I learn best by doing and experimenting' },
  { id: 'auditory', label: 'Auditory', icon: 'headphones', desc: 'I learn best by listening' },
];

const TEAL = '#5F8A86';
const FOREST = '#5A8A70';

// ── Step definitions per role ──────────────────────────────
function getSteps(role: string) {
  if (role === 'teacher') return [
    { title: 'Personal Info', icon: 'user', subtitle: 'Tell us about yourself' },
    { title: 'School Details', icon: 'home', subtitle: 'Where do you teach?' },
    { title: 'Teaching Info', icon: 'book-open', subtitle: 'What do you teach?' },
    { title: 'Your Avatar', icon: 'smile', subtitle: 'Pick your look' },
  ];
  if (role === 'parent') return [
    { title: 'Personal Info', icon: 'user', subtitle: 'Tell us about yourself' },
    { title: 'Your Child', icon: 'users', subtitle: "Your child's details" },
    { title: 'School Info', icon: 'home', subtitle: "Your child's school" },
    { title: 'Your Avatar', icon: 'smile', subtitle: 'Pick your look' },
  ];
  // Student
  return [
    { title: 'Personal Info', icon: 'user', subtitle: 'Tell us about yourself' },
    { title: 'School & Grade', icon: 'home', subtitle: 'Your school details' },
    { title: 'Curriculum', icon: 'book-open', subtitle: 'What do you study?' },
    { title: 'Your Avatar', icon: 'smile', subtitle: 'Pick your look' },
    { title: 'Learning Style', icon: 'zap', subtitle: 'How do you learn best?' },
  ];
}

export default function OnboardingScreen() {
  const { user, updateUser, saveProfile } = useAuth();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const role = user?.role || 'student';
  const steps = getSteps(role);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // ── Shared fields ─────────────────────────────────
  const [fullName, setFullName] = useState(user?.name || '');
  const [dob, setDob] = useState(''); // DD/MM/YYYY — only for students
  const [gender, setGender] = useState('');
  const [school, setSchool] = useState((user as any)?.school || '');
  const [city, setCity] = useState((user as any)?.location || '');
  const [avatarStyle, setAvatarStyle] = useState('default');

  // Calculate age from DD/MM/YYYY
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

  // ── Student fields ────────────────────────────────
  const [grade, setGrade] = useState((user as any)?.grade || '');
  const [curriculum, setCurriculum] = useState((user as any)?.curriculum || '');
  const [learningStyle, setLearningStyle] = useState('');

  // ── Teacher fields ────────────────────────────────
  const [teachGrades, setTeachGrades] = useState<string[]>([]);
  const [teachSubjects, setTeachSubjects] = useState<string[]>([]);
  const [teachCurriculum, setTeachCurriculum] = useState('');

  // ── Parent fields ─────────────────────────────────
  const [childName, setChildName] = useState('');
  const [childGrade, setChildGrade] = useState('');
  const [childSchool, setChildSchool] = useState('');
  const [childCurriculum, setChildCurriculum] = useState('');
  const [childEmail, setChildEmail] = useState('');

  const progress = (step + 1) / steps.length;

  function toggleArrayItem(arr: string[], item: string, setter: (v: string[]) => void) {
    setter(arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]);
  }

  const canProceed = useCallback(() => {
    if (role === 'student') {
      if (step === 0) {
        if (fullName.trim().length < 2) return false;
        const age = getAge(dob);
        return age !== null && age >= 14;
      }
      if (step === 1) return school.trim().length >= 2 && grade.length > 0;
      if (step === 2) return curriculum.length > 0;
      if (step === 3) return true; // avatar optional
      if (step === 4) return true; // learning style optional
    }
    if (role === 'teacher') {
      if (step === 0) return fullName.trim().length >= 2;
      if (step === 1) return school.trim().length >= 2;
      if (step === 2) return teachGrades.length > 0 && teachCurriculum.length > 0;
      if (step === 3) return true;
    }
    if (role === 'parent') {
      if (step === 0) return fullName.trim().length >= 2;
      if (step === 1) return childName.trim().length >= 2 && childGrade.length > 0;
      if (step === 2) return true; // school optional
      if (step === 3) return true;
    }
    return true;
  }, [step, role, fullName, dob, school, grade, curriculum, teachGrades, teachCurriculum, childName, childGrade]);

  async function handleFinish() {
    setSaving(true);
    try {
      const email = user?.email || '';
      const body: any = { email, name: fullName.trim(), school, location: city, complete: true };

      if (role === 'student') {
        body.grade = grade;
        body.curriculum = curriculum;
      } else if (role === 'teacher') {
        body.curriculum = teachCurriculum;
        body.teaches = teachGrades.map(g => ({
          grade: g,
          curriculum: teachCurriculum,
          subjects: teachSubjects,
        }));
      } else if (role === 'parent') {
        body.children = [{
          name: childName.trim(),
          grade: childGrade,
          school: childSchool || school,
          curriculum: childCurriculum,
          email: childEmail.trim().toLowerCase() || undefined,
        }];
      }

      // Save profile to Supabase — must succeed before marking onboarding complete
      const profileRes = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!profileRes.ok) {
        const errText = await profileRes.text().catch(() => '');
        throw new Error(`Profile save failed (${profileRes.status}): ${errText.slice(0, 200)}`);
      }

      // Save preferences (avatar, learning style)
      await fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: fullName.trim(),
          role,
          grade: role === 'student' ? grade : undefined,
          curriculum: role === 'student' ? curriculum : teachCurriculum || undefined,
          school,
          location: city,
          avatarStyle,
          learningStyle: learningStyle || undefined,
          gender: gender || undefined,
        }),
      });

      // Update local auth state
      updateUser({
        name: fullName.trim(),
        school,
        location: city,
        onboardingComplete: true,
        avatarStyle,
        ...(role === 'student' ? { grade, curriculum } : {}),
        ...(role === 'teacher' ? {
          curriculum: teachCurriculum,
          teaches: teachGrades.map(g => ({ grade: g, curriculum: teachCurriculum })),
        } : {}),
      } as any);
    } catch (err) {
      console.error('Onboarding save error:', err);
    } finally {
      setSaving(false);
    }
  }

  function handleNext() {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      handleFinish();
    }
  }

  function handleBack() {
    if (step > 0) setStep(s => s - 1);
  }

  // ── Render step content ───────────────────────────
  function renderStepContent() {
    // ── STUDENT STEPS ─────────────────────────────
    if (role === 'student') {
      if (step === 0) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
            placeholder="Enter your full name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
          
          <Text style={styles.fieldLabel}>Date of Birth (DD/MM/YYYY)</Text>
          <TextInput style={styles.input} value={dob} onChangeText={setDob}
            placeholder="e.g. 15/04/2010" placeholderTextColor={colors.textDim} keyboardType="numeric" />
          
          {dob.length >= 10 && getAge(dob) !== null && getAge(dob)! < 14 && (
            <View style={{ backgroundColor: '#ef444415', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ef444430' }}>
              <Text style={{ color: '#ef4444', fontSize: 13, lineHeight: 18 }}>
                Students under 14 must have a parent or teacher create the account.
              </Text>
            </View>
          )}

          <Text style={styles.fieldLabel}>Gender</Text>
          <View style={styles.chipRow}>
            {GENDERS.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, gender === g && styles.chipActive]}
                onPress={() => setGender(g)} activeOpacity={0.8}>
                <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 1) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>School Name</Text>
          <TextInput style={styles.input} value={school} onChangeText={setSchool}
            placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>City</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity}
            placeholder="e.g. Hyderabad" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>Grade</Text>
          <View style={styles.chipRow}>
            {GRADES.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, grade === g && styles.chipActive]}
                onPress={() => setGrade(g)} activeOpacity={0.8}>
                <Text style={[styles.chipText, grade === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 2) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Curriculum</Text>
          <View style={styles.chipRow}>
            {CURRICULA.map(c => (
              <TouchableOpacity key={c} style={[styles.chip, curriculum === c && styles.chipActive]}
                onPress={() => setCurriculum(c)} activeOpacity={0.8}>
                <Text style={[styles.chipText, curriculum === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 3) return renderAvatarStep();
      if (step === 4) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>How do you learn best?</Text>
          {LEARNING_STYLES.map(ls => (
            <TouchableOpacity key={ls.id}
              style={[styles.lsCard, learningStyle === ls.id && styles.lsCardActive]}
              onPress={() => setLearningStyle(ls.id)} activeOpacity={0.8}>
              <View style={[styles.lsIcon, learningStyle === ls.id && { backgroundColor: TEAL + '30' }]}>
                <Feather name={ls.icon as any} size={20} color={learningStyle === ls.id ? TEAL : colors.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.lsLabel, learningStyle === ls.id && { color: TEAL }]}>{ls.label}</Text>
                <Text style={[styles.lsDesc, learningStyle === ls.id && { color: colors.textMain }]}>{ls.desc}</Text>
              </View>
              {learningStyle === ls.id && <Feather name="check-circle" size={18} color={TEAL} />}
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    // ── TEACHER STEPS ─────────────────────────────
    if (role === 'teacher') {
      if (step === 0) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
            placeholder="Enter your full name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
        </View>
      );
      if (step === 1) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>School Name</Text>
          <TextInput style={styles.input} value={school} onChangeText={setSchool}
            placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>City</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity}
            placeholder="e.g. Hyderabad" placeholderTextColor={colors.textDim} />
        </View>
      );
      if (step === 2) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Curriculum</Text>
          <View style={styles.chipRow}>
            {CURRICULA.map(c => (
              <TouchableOpacity key={c} style={[styles.chip, teachCurriculum === c && styles.chipActive]}
                onPress={() => setTeachCurriculum(c)} activeOpacity={0.8}>
                <Text style={[styles.chipText, teachCurriculum === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Grades You Teach (select multiple)</Text>
          <View style={styles.chipRow}>
            {GRADES.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, teachGrades.includes(g) && styles.chipActive]}
                onPress={() => toggleArrayItem(teachGrades, g, setTeachGrades)} activeOpacity={0.8}>
                <Text style={[styles.chipText, teachGrades.includes(g) && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Subjects (select multiple)</Text>
          <View style={styles.chipRow}>
            {SUBJECTS.map(s => (
              <TouchableOpacity key={s} style={[styles.chip, teachSubjects.includes(s) && styles.chipActive]}
                onPress={() => toggleArrayItem(teachSubjects, s, setTeachSubjects)} activeOpacity={0.8}>
                <Text style={[styles.chipText, teachSubjects.includes(s) && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 3) return renderAvatarStep();
    }

    // ── PARENT STEPS ──────────────────────────────
    if (role === 'parent') {
      if (step === 0) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
            placeholder="Enter your full name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
          <Text style={styles.fieldLabel}>City</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity}
            placeholder="e.g. Hyderabad" placeholderTextColor={colors.textDim} />
        </View>
      );
      if (step === 1) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Child's Full Name</Text>
          <TextInput style={styles.input} value={childName} onChangeText={setChildName}
            placeholder="Enter your child's name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
          <Text style={styles.fieldLabel}>Child's Grade</Text>
          <View style={styles.chipRow}>
            {GRADES.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, childGrade === g && styles.chipActive]}
                onPress={() => setChildGrade(g)} activeOpacity={0.8}>
                <Text style={[styles.chipText, childGrade === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Child's Curriculum</Text>
          <View style={styles.chipRow}>
            {CURRICULA.map(c => (
              <TouchableOpacity key={c} style={[styles.chip, childCurriculum === c && styles.chipActive]}
                onPress={() => setChildCurriculum(c)} activeOpacity={0.8}>
                <Text style={[styles.chipText, childCurriculum === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 2) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Child's School</Text>
          <TextInput style={styles.input} value={childSchool} onChangeText={setChildSchool}
            placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>Child's Email (optional — to link accounts)</Text>
          <TextInput style={styles.input} value={childEmail} onChangeText={setChildEmail}
            placeholder="child@email.com" placeholderTextColor={colors.textDim}
            keyboardType="email-address" autoCapitalize="none" />
        </View>
      );
      if (step === 3) return renderAvatarStep();
    }

    return null;
  }

  function renderAvatarStep() {
    return (
      <View style={styles.stepContent}>
        <Text style={styles.fieldLabel}>Choose your avatar style</Text>
        <View style={styles.avatarGrid}>
          {AVATAR_STYLES.map(av => (
            <TouchableOpacity key={av.id}
              style={[styles.avatarCard, avatarStyle === av.id && styles.avatarCardActive]}
              onPress={() => setAvatarStyle(av.id)} activeOpacity={0.8}>
              <LinearGradient colors={av.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.avatarCircle}>
                <Feather name={av.icon as any} size={22} color="#fff" />
              </LinearGradient>
              <Text style={[styles.avatarLabel, avatarStyle === av.id && { color: TEAL }]}>{av.label}</Text>
              {avatarStyle === av.id && (
                <View style={styles.avatarCheck}>
                  <Feather name="check" size={10} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  const isLastStep = step === steps.length - 1;

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.logoMark}>
              <Feather name="zap" size={16} color="#fff" />
            </View>
            <Text style={styles.logoText}>Aivorah</Text>
          </View>
          <Text style={styles.stepCounter}>Step {step + 1} of {steps.length}</Text>
        </View>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>

        {/* Step title */}
        <View style={styles.stepHeaderWrap}>
          <View style={styles.stepHeader}>
            <View style={styles.stepIconCircle}>
              <Feather name={steps[step].icon as any} size={20} color={TEAL} />
            </View>
            <View>
              <Text style={styles.stepTitle}>{steps[step].title}</Text>
              <Text style={styles.stepSubtitle}>{steps[step].subtitle}</Text>
            </View>
          </View>
        </View>

        {/* Content */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.centeredCard}>
            {renderStepContent()}
          </View>
        </ScrollView>

        {/* Navigation buttons */}
        <View style={styles.navRow}>
          {step > 0 ? (
            <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.8}>
              <Feather name="arrow-left" size={16} color={colors.textMuted} />
              <Text style={[styles.backBtnText, { color: colors.textMuted }]}>Back</Text>
            </TouchableOpacity>
          ) : <View />}

          <TouchableOpacity
            style={[styles.nextBtn, !canProceed() && styles.nextBtnDisabled]}
            onPress={handleNext}
            disabled={!canProceed() || saving}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>
              {saving ? 'Saving...' : isLastStep ? 'Get Started' : 'Continue'}
            </Text>
            {!isLastStep && <Feather name="arrow-right" size={16} color="#fff" />}
            {isLastStep && <Feather name="check" size={16} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: 40, paddingBottom: spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
  },
  logoText: { fontSize: 18, fontWeight: '700', color: c.textMain, letterSpacing: -0.3 },
  stepCounter: { fontSize: 13, color: c.textMuted, fontWeight: '600' },

  progressTrack: {
    height: 4, backgroundColor: c.borderColor,
    marginHorizontal: spacing.xl, borderRadius: 2, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: TEAL, borderRadius: 2 },

  stepHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    width: '100%', maxWidth: 520,
    paddingTop: 28, paddingBottom: spacing.md,
  },
  stepIconCircle: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: TEAL + '18', alignItems: 'center', justifyContent: 'center',
  },
  stepTitle: { fontSize: 20, fontWeight: '800', color: c.textMain },
  stepSubtitle: { fontSize: 13, color: c.textMuted, marginTop: 2 },

  scrollContent: { flexGrow: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: spacing.md, paddingBottom: 32 },
  centeredCard: { width: '100%', maxWidth: 520, gap: spacing.lg },
  stepContent: { gap: spacing.lg },

  stepHeaderWrap: { alignItems: 'center', paddingHorizontal: spacing.xl },
  fieldLabel: {
    fontSize: 13, fontWeight: '700', color: c.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    height: 48, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md,
    fontSize: 15, color: c.textMain,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  chipActive: { backgroundColor: TEAL + '20', borderColor: TEAL },
  chipText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  chipTextActive: { color: TEAL },

  // Learning style cards
  lsCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark,
  },
  lsCardActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
  lsIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: c.borderColor + '60', alignItems: 'center', justifyContent: 'center',
  },
  lsLabel: { fontSize: 15, fontWeight: '700', color: c.textMain },
  lsDesc: { fontSize: 12, color: c.textMuted, marginTop: 2 },

  // Avatar grid
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  avatarCard: {
    width: 100, alignItems: 'center', gap: 8,
    padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark,
  },
  avatarCardActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
  avatarCircle: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  avatarCheck: {
    position: 'absolute', top: 6, right: 6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
  },

  // Navigation
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
    borderTopWidth: 1, borderTopColor: c.borderColor,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm },
  backBtnText: { fontSize: 14, fontWeight: '600' },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: TEAL, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: radius.md,
  },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
