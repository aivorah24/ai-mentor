/**
 * OnboardingTeacherBoxes.tsx
 * Teacher onboarding — all sections shown as cards on a single page
 * (Personal Info, School Details, Teaching Info, Your Avatar).
 * Everything is visible and editable at once; "Complete Setup" saves
 * the profile and finishes onboarding.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, Platform, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SERVER_URL from '../../config/serverUrl';
import { AVATAR_STYLES } from '../../constants/avatarStyles';
import { CURRICULA, getGradesForCurriculum, SUBJECTS, TEAL, DatePickerInput } from './OnboardingScreen';
import { getSubjectsForEntry } from '../school-admin/TeachingEntriesEditor';
import {
  AutocompleteField, CardHeader, BBox, fetchCitySuggestions, fetchSchoolSuggestions, locateCity, locateFull,
  SelectField, COUNTRIES, INDIA_STATES, INDIA_CITIES, PhoneCodeSelect,
} from './OnboardingSharedFields';
import { PhoneOtpModal } from './phoneOtpVerification';
import { useMobileOtpVerification } from './mobileOtpVerification';

const TEACHER_ROLES = ['Teacher', 'Coordinator', 'Principal'];
const EXPERIENCE_RANGES = ['0 - 2 years', '3 - 5 years', '5 - 10 years', '10+ years'];
const GRADE_GROUPS = [
  { label: 'Early Years', grades: ['Nursery', 'LKG', 'UKG'] },
  { label: 'Primary', grades: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'] },
  { label: 'Middle School', grades: ['Grade 6', 'Grade 7', 'Grade 8'] },
  { label: 'Senior School', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
];

export default function OnboardingTeacherBoxes() {
  const { user, updateUser, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useStyles(colors);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [locating, setLocating] = useState(false);
  const cityBBoxCache = useRef<Map<string, BBox | null>>(new Map());

  // Web: trap the browser Back button for the whole teacher onboarding flow (#171 —
  // previously this screen had no back-button handling at all, so pressing browser
  // Back silently navigated away with no confirmation). Routes through the same
  // "Return to home page?" confirm the in-page back button already uses.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    window.history.pushState(null, '', window.location.href);
    const onPop = () => {
      window.history.pushState(null, '', window.location.href);
      setShowLeaveConfirm(true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Form state
  const [fullName, setFullName] = useState(user?.name || '');
  const [dob, setDob] = useState('');
  const [mobile, setMobile] = useState('');
  const [mobileCode, setMobileCode] = useState('+91');
  const mobileOtp = useMobileOtpVerification(mobile, setMobile, mobileCode);
  const onMobileChange = (v: string) => {
    setMobile(v);
    if (mobileOtp.mobileVerified) mobileOtp.setMobileVerified(false);
  };
  const [school, setSchool] = useState((user as any)?.school || '');
  const [city, setCity] = useState((user as any)?.location || '');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('India');
  const [teacherRole, setTeacherRole] = useState('Teacher');
  const [experience, setExperience] = useState('');
  const [curriculum, setCurriculum] = useState((user as any)?.curriculum || '');
  const [teachGrades, setTeachGrades] = useState<string[]>([]);
  const [teachSubjects, setTeachSubjects] = useState<string[]>([]);
  const [avatarStyle, setAvatarStyle] = useState('default');

  // Hydrate fields that aren't carried on the `user` object (dob, mobile, state,
  // country, professional info, teach grades/subjects, avatar) from previously
  // saved preferences — otherwise reopening onboarding after a partial/complete
  // save shows these as blank even though the data exists server-side.
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(user.email)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) return;
        if (p.dob) setDob(p.dob);
        if (p.phone) {
          const m = String(p.phone).match(/^(\+\d+)\s*(.*)$/);
          if (m) { setMobileCode(m[1]); setMobile(m[2]); } else setMobile(String(p.phone));
        }
        if (p.state) setState(p.state);
        if (p.country) setCountry(p.country);
        if (p.teacherRole) setTeacherRole(p.teacherRole);
        if (p.experience) setExperience(p.experience);
        if (p.avatarStyle) setAvatarStyle(p.avatarStyle);
        if (Array.isArray(p.teaches) && p.teaches.length > 0) {
          setTeachGrades([...new Set(p.teaches.map((t: any) => t.grade).filter(Boolean))] as string[]);
          setTeachSubjects([...new Set(p.teaches.flatMap((t: any) => t.subjects || []))] as string[]);
        }
      })
      .catch(() => {});
  }, [user?.email]);

  // ── Per-card completion ────────────────────────────
  const personalDone = fullName.trim().length >= 2 && dob.trim().length >= 6 && mobile.trim().length >= 7;
  const schoolDone = school.trim().length >= 2 && city.trim().length >= 2 && state.trim().length >= 2;
  const professionalDone = teacherRole.length > 0 && experience.length > 0;
  const teachingDone = curriculum.length > 0 && teachGrades.length > 0 && teachSubjects.length > 0;
  const avatarDone = avatarStyle.length > 0;

  const requiredDone = personalDone && schoolDone && professionalDone && teachingDone;
  const doneCount = [personalDone, schoolDone, professionalDone, teachingDone, avatarDone].filter(Boolean).length;
  const completionPct = Math.round((doneCount / 5) * 100);

  function toggleGrade(g: string) {
    setTeachGrades(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }

  function toggleGradeGroup(groupGrades: string[]) {
    const allSelected = groupGrades.every(g => teachGrades.includes(g));
    setTeachGrades(prev => allSelected
      ? prev.filter(x => !groupGrades.includes(x))
      : [...prev, ...groupGrades.filter(g => !prev.includes(g))]);
  }

  function toggleSubject(s: string) {
    setTeachSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  // Saves whatever fields are filled in so far WITHOUT marking onboarding complete —
  // used by the "Save & Exit" leave-confirm path so partial progress isn't lost just
  // because the teacher hasn't finished every required field yet.
  async function saveProgress() {
    try {
      const email = user?.email || '';
      const teaches = teachGrades.map(g => ({ grade: g, curriculum: curriculum.trim(), subjects: teachSubjects }));
      await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, role: 'teacher',
          name: fullName.trim() || undefined,
          school: school || undefined,
          location: city || undefined,
          dob: dob || undefined,
          phone: mobile ? `${mobileCode} ${mobile}` : undefined,
          state: state || undefined,
          country: country || undefined,
          curriculum: curriculum.trim() || undefined,
          teaches,
        }),
      });
      await fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, name: fullName.trim() || undefined, role: 'teacher',
          school: school || undefined, location: city || undefined,
          dob: dob || undefined, mobile: mobile ? `${mobileCode} ${mobile}` : undefined,
          state: state || undefined, country: country || undefined,
          teacherRole, experience, curriculum: curriculum.trim() || undefined, avatarStyle,
        }),
      }).catch(() => {});
    } catch (e) {
      console.error('[saveProgress] failed:', e);
    }
  }

  async function handleFinish() {
    if (!requiredDone) {
      setSaveError('Please complete all required fields including State / Province.');
      return;
    }
    if (!state.trim()) {
      setSaveError('State / Province is required.');
      return;
    }
    if (!dob.trim()) {
      setSaveError('Date of Birth is required.');
      return;
    }
    if (!mobile.trim()) {
      setSaveError('Mobile Number is required.');
      return;
    }
    if (mobile.trim()) {
      const digits = mobile.replace(/\D/g, '');
      const minDigits = mobileCode === '+91' ? 10 : 7;
      if (digits.length < minDigits) {
        setSaveError(`Mobile number must have at least ${minDigits} digits.`);
        return;
      }
    }
    setSaving(true);
    setSaveError('');
    try {
      const email = user?.email || '';

      const body = {
        email,
        role: 'teacher',
        name: fullName.trim(),
        school,
        location: city,
        dob: dob || undefined,
        phone: mobile ? `${mobileCode} ${mobile}` : undefined,
        state: state || undefined,
        country: country || undefined,
        complete: true,
        curriculum: curriculum.trim(),
        teaches: teachGrades.map(g => ({ grade: g, curriculum: curriculum.trim(), subjects: teachSubjects })),
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

      await fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: fullName.trim(),
          role: 'teacher',
          school,
          location: city,
          dob: dob || undefined,
          mobile: mobile ? `${mobileCode} ${mobile}` : undefined,
          state: state || undefined,
          country: country || undefined,
          teacherRole,
          experience,
          curriculum: curriculum.trim(),
          avatarStyle,
        }),
      }).catch(() => {});

      updateUser({
        name: fullName.trim(),
        school,
        location: city,
        onboardingComplete: true,
        avatarStyle,
        curriculum: saved.curriculum || curriculum.trim(),
        grade: teachGrades[0],
        teaches: teachGrades.map(g => ({ grade: g, curriculum: curriculum.trim(), subjects: teachSubjects })),
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
            <TouchableOpacity
              onPress={() => setShowLeaveConfirm(true)}
              style={styles.backBtn}
              activeOpacity={0.7}
              accessibilityLabel="Back to home page"
            >
              <Feather name="arrow-left" size={18} color={colors.textMuted} />
              <Text style={styles.backTxt}>Back</Text>
            </TouchableOpacity>
            <View style={styles.logoMark}><Feather name="zap" size={14} color="#fff" /></View>
            <Text style={styles.logoTxt}>Aivorah</Text>
            <View style={[styles.roleBadge, styles.roleBadgeTeacher]}>
              <Text style={[styles.roleBadgeText, styles.roleBadgeTextTeacher]}>Teacher</Text>
            </View>
          </View>
          <View style={styles.completionRow}>
            <Text style={styles.completionLbl}>Profile Completion</Text>
            <View style={styles.completionRing}>
              <Text style={styles.completionPct}>{completionPct}%</Text>
            </View>
          </View>
        </View>

        <View style={styles.greetWrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={{ backgroundColor: TEAL + '18', borderColor: TEAL + '40', borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: TEAL, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' }}>Teacher Onboarding</Text>
            </View>
          </View>
          <Text style={styles.greetMain}>Welcome — let's set up your teaching profile</Text>
          <Text style={styles.greetSub}>Fill in each box so we can tailor your class view and content recommendations.</Text>
        </View>

        {/* ── Row 1: Personal Info / School Details / Teaching Info ── */}
        <View style={[styles.rowWrap, styles.rowWrapStretch, { zIndex: 20 }]}>
          {/* Personal Info */}
          <View style={[styles.card, styles.card3]}>
            <CardHeader icon="user" title="Personal Info" subtitle="Tell us about yourself." done={personalDone} styles={styles} />
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Name</Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
                placeholder="Your name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Date of Birth <Text style={{ color: '#ef4444', fontSize: 13 }}>*</Text></Text>
              {Platform.OS === 'web' ? (
                <DatePickerInput value={dob} onChange={setDob} colors={colors} />
              ) : (
                <TextInput style={styles.input} value={dob} onChangeText={setDob}
                  placeholder="DD/MM/YYYY" placeholderTextColor={colors.textDim} keyboardType="numeric" />
              )}
            </View>
            <View style={[styles.fieldGroup, { zIndex: 6 }]}>
              <Text style={styles.lbl}>Mobile Number <Text style={{ color: '#ef4444', fontSize: 13 }}>*</Text></Text>
              <View style={styles.phoneRow}>
                <PhoneCodeSelect value={mobileCode} onChange={setMobileCode} colors={colors} styles={styles} />
                <TextInput style={[styles.input, styles.phoneInput]} value={mobile} onChangeText={onMobileChange}
                  placeholder="98765 43210" placeholderTextColor={colors.textDim} keyboardType="phone-pad" />
                {mobileOtp.mobileVerified && mobile === mobileOtp.verifiedMobile ? (
                  <View style={styles.verifiedBadge}>
                    <Feather name="check-circle" size={14} color={TEAL} />
                    <Text style={styles.verifiedTxt}>Verified</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.verifyBtn}
                    onPress={mobileOtp.handleSendOtp}
                    disabled={mobileOtp.otpSending || !mobile.trim()}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.verifyBtnTxt}>{mobileOtp.otpSending ? 'Sending...' : 'Verify'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {mobileOtp.otpError ? <Text style={styles.warnTxt}>{mobileOtp.otpError}</Text> : null}
            </View>
          </View>

          {/* School Details */}
          <View style={[styles.card, styles.card3, { zIndex: 10 }]}>
            <CardHeader icon="home" title="School Details" subtitle="Where do you teach?" done={schoolDone} styles={styles} />
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
            {Platform.OS === 'web' && (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 }}>
                <TouchableOpacity style={styles.locateBtn} onPress={() => locateFull(({ city: c, state: s, country: co }) => { if (co) setCountry(co); if (s) setState(s); if (c) setCity(c); }, setLocating)} disabled={locating} activeOpacity={0.8}>
                  <Feather name="crosshair" size={12} color={TEAL} />
                  <Text style={styles.locateTxt}>{locating ? 'Locating...' : 'Use my location'}</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={[styles.fieldRow, { zIndex: 10 }]}>
              <View style={[styles.fieldGroup, { flex: 1, zIndex: 20 }]}>
                <Text style={styles.lbl}>Country</Text>
                <SelectField
                  value={country}
                  onChange={(c) => { setCountry(c); if (c !== 'India') setState(''); setCity(''); }}
                  options={COUNTRIES}
                  placeholder="Select your country"
                  searchPlaceholder="Search country..."
                  colors={colors}
                  styles={styles}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1, zIndex: 15 }]}>
                <Text style={styles.lbl}>State / Province <Text style={{ color: '#ef4444', fontSize: 13 }}>*</Text></Text>
                <SelectField
                  value={state}
                  onChange={(s) => { setState(s); setCity(''); }}
                  options={country === 'India' ? INDIA_STATES : []}
                  placeholder="Select your state"
                  searchPlaceholder="Search state..."
                  colors={colors}
                  styles={styles}
                />
              </View>
            </View>
            <View style={[styles.fieldGroup, { zIndex: 5 }]}>
              <Text style={styles.lbl}>City</Text>
              {country === 'India' && INDIA_CITIES[state] ? (
                <SelectField
                  value={city}
                  onChange={setCity}
                  options={[...INDIA_CITIES[state]].sort()}
                  placeholder="Select your city"
                  searchPlaceholder="Search city..."
                  colors={colors}
                  styles={styles}
                />
              ) : (
                <AutocompleteField
                  value={city}
                  onChange={setCity}
                  fetchSuggestions={(q) => fetchCitySuggestions(q, { state, country })}
                  placeholder={state || country ? 'Search for your city' : 'Select country & state first'}
                  colors={colors}
                  styles={styles}
                />
              )}
            </View>
          </View>

          {/* Professional Info */}
          <View style={[styles.card, styles.card3]}>
            <CardHeader icon="briefcase" title="Professional Info" subtitle="Your role and experience." done={professionalDone} styles={styles} />
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Your Role</Text>
              <View style={styles.chipRow}>
                {TEACHER_ROLES.map(r => (
                  <TouchableOpacity key={r} style={[styles.chip, teacherRole === r && styles.chipActive]}
                    onPress={() => setTeacherRole(r)} activeOpacity={0.8}>
                    <Text style={[styles.chipTxt, teacherRole === r && styles.chipTxtActive]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Teaching Experience</Text>
              <View style={styles.chipRow}>
                {EXPERIENCE_RANGES.map(e => (
                  <TouchableOpacity key={e} style={[styles.chip, experience === e && styles.chipActive]}
                    onPress={() => setExperience(e)} activeOpacity={0.8}>
                    <Text style={[styles.chipTxt, experience === e && styles.chipTxtActive]}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* ── Row 2: Teaching Info ── */}
        <View style={styles.rowWrap}>
          <View style={[styles.card, styles.cardFull]}>
            <CardHeader icon="book-open" title="Teaching Info" subtitle="What do you teach?" done={teachingDone} styles={styles} />
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Curriculum</Text>
              <View style={styles.fieldBox}>
                <View style={styles.chipRow}>
                  {CURRICULA.map(c => (
                    <TouchableOpacity key={c} style={[styles.chip, curriculum === c && styles.chipActive]}
                      onPress={() => { setCurriculum(c); setTeachGrades([]); }} activeOpacity={0.8}>
                      <Text style={[styles.chipTxt, curriculum === c && styles.chipTxtActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Grades You Teach</Text>
              <View style={styles.gradeGroupsWrap}>
                {GRADE_GROUPS.map(group => {
                  const available = group.grades.filter(g => getGradesForCurriculum(curriculum).includes(g));
                  if (available.length === 0) return null;
                  const allSelected = available.every(g => teachGrades.includes(g));
                  return (
                    <View key={group.label} style={styles.gradeGroup}>
                      <View style={styles.gradeGroupHead}>
                        <View style={styles.gradeGroupDot} />
                        <Text style={styles.gradeGroupLbl}>{group.label}</Text>
                        <TouchableOpacity onPress={() => toggleGradeGroup(available)} activeOpacity={0.7}>
                          <Text style={styles.gradeGroupSelectAll}>{allSelected ? 'Clear' : 'Select all'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.chipRow}>
                        {available.map(g => (
                          <TouchableOpacity key={g} style={[styles.chip, teachGrades.includes(g) && styles.chipActive]}
                            onPress={() => toggleGrade(g)} activeOpacity={0.8}>
                            <Text style={[styles.chipTxt, teachGrades.includes(g) && styles.chipTxtActive]}>{g}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Subjects</Text>
              <View style={styles.fieldBox}>
                <View style={styles.chipRow}>
                  {(teachGrades.length > 0
                    ? [...new Set(teachGrades.flatMap(g => getSubjectsForEntry(curriculum, g)))]
                    : SUBJECTS
                  ).map(s => (
                    <TouchableOpacity key={s} style={[styles.chip, teachSubjects.includes(s) && styles.chipActive]}
                      onPress={() => toggleSubject(s)} activeOpacity={0.8}>
                      <Text style={[styles.chipTxt, teachSubjects.includes(s) && styles.chipTxtActive]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* ── Row 3: Your Avatar ── */}
        <View style={styles.rowWrap}>
          <View style={[styles.card, styles.cardFull]}>
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
              <Text style={styles.requiredHint}>Complete all sections above to continue</Text>
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

      {/* ── Leave-to-home confirmation ── */}
      <Modal transparent visible={showLeaveConfirm} animationType="fade" onRequestClose={() => setShowLeaveConfirm(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIcon}>
              <Feather name="log-out" size={22} color={TEAL} />
            </View>
            <Text style={styles.confirmTitle}>Return to the home page?</Text>
            <Text style={styles.confirmBody}>
              You'll be signed out and taken back to the Aivorah home page. We can save what
              you've entered so far so it's still here next time you sign in.
            </Text>
            <TouchableOpacity
              style={styles.confirmPrimary}
              activeOpacity={0.85}
              disabled={saving}
              onPress={async () => { setSaving(true); await saveProgress(); setSaving(false); setShowLeaveConfirm(false); logout(); }}
            >
              <Text style={styles.confirmPrimaryTxt}>{saving ? 'Saving...' : 'Save & go to home page'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmSecondary}
              activeOpacity={0.7}
              disabled={saving}
              onPress={() => { setShowLeaveConfirm(false); logout(); }}
            >
              <Text style={styles.confirmSecondaryTxt}>Leave without saving</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={saving}
              onPress={() => setShowLeaveConfirm(false)}
              style={{ marginTop: 4 }}
            >
              <Text style={[styles.confirmSecondaryTxt, { textDecorationLine: 'underline' }]}>Stay here</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <PhoneOtpModal
        mobile={mobile}
        mobileCode={mobileCode}
        otpModalVisible={mobileOtp.otpModalVisible}
        otpCode={mobileOtp.otpCode}
        setOtpCode={mobileOtp.setOtpCode}
        otpError={mobileOtp.otpError}
        otpVerifying={mobileOtp.otpVerifying}
        handleVerifyOtp={mobileOtp.handleVerifyOtp}
        handleCancelOtp={mobileOtp.handleCancelOtp}
        colors={colors}
        styles={styles}
      />
    </View>
  );
}

function useStyles(colors: any) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, maxWidth: 1280, width: '100%', alignSelf: 'center' },

    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    backBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
      borderWidth: 1, borderColor: colors.borderColor, marginRight: 4,
    },
    backTxt: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    confirmBox: {
      width: 360, maxWidth: '95%', borderRadius: 20, padding: 28, alignItems: 'center',
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
    },
    confirmIcon: {
      width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
      backgroundColor: TEAL + '22', marginBottom: 16,
    },
    confirmTitle: { fontSize: 19, fontWeight: '800', color: colors.textMain, marginBottom: 10, textAlign: 'center' },
    confirmBody: { fontSize: 14, color: colors.textMuted, lineHeight: 21, textAlign: 'center', marginBottom: 24 },
    confirmPrimary: { width: '100%', backgroundColor: TEAL, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
    confirmPrimaryTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
    confirmSecondary: { width: '100%', paddingVertical: 12, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.borderColor },
    confirmSecondaryTxt: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
    logoMark: { width: 28, height: 28, borderRadius: 8, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
    logoTxt: { fontSize: 16, fontWeight: '800', color: colors.textMain },
    roleBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2.5,
      borderRadius: 12,
      borderWidth: 1,
      alignSelf: 'center',
      marginLeft: 4,
    },
    roleBadgeTeacher: {
      backgroundColor: TEAL + '18',
      borderColor: TEAL + '40',
    },
    roleBadgeText: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    roleBadgeTextTeacher: {
      color: TEAL,
    },
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

    rowWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 },
    rowWrapStretch: { alignItems: 'stretch' },
    card: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 16, padding: 20, gap: 16,
    },
    card3: { flexGrow: 1, flexBasis: 320, minWidth: 280 },
    cardFull: { flexGrow: 1, flexBasis: '100%', minWidth: 280 },

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
    fieldRow: { flexDirection: 'row', gap: 12 },
    phoneRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, alignItems: 'center', width: '100%', overflow: 'hidden' },
    phoneCode: {
      height: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.borderColor,
      backgroundColor: colors.bgDark, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    phoneCodeTxt: { fontSize: 14, fontWeight: '700', color: colors.textMain },
    phoneInput: { flex: 1, flexBasis: 0, minWidth: 0, flexShrink: 1 },
    warnTxt: { color: '#ef4444', fontSize: 12, lineHeight: 17, marginTop: 4 },
    verifyBtn: {
      height: 44, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center',
      borderRadius: 10, borderWidth: 1, borderColor: TEAL, flexShrink: 0,
    },
    verifyBtnTxt: { fontSize: 12, fontWeight: '700', color: TEAL },
    verifiedBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 6, height: 44,
      paddingHorizontal: 12, justifyContent: 'center', flexShrink: 0,
      borderRadius: 10, borderWidth: 1, borderColor: TEAL + '40', backgroundColor: TEAL + '12',
    },
    verifiedTxt: { fontSize: 12, fontWeight: '700', color: TEAL },
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20,
    },
    modalBox: {
      backgroundColor: colors.cardDark, borderRadius: 16, padding: 20, gap: 14,
      width: '100%', maxWidth: 440, borderWidth: 1, borderColor: colors.borderColor,
    },
    modalTitle: { fontSize: 16, fontWeight: '800', color: colors.textMain },
    modalText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    modalBtn: {
      backgroundColor: TEAL, borderRadius: 10, paddingVertical: 14, alignItems: 'center',
    },
    modalBtnText: { fontSize: 14, fontWeight: '800', color: '#0B0B0B' },
    lbl: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    lblRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    locateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    locateTxt: { fontSize: 11, fontWeight: '700', color: TEAL },
    input: {
      height: 44, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 10, paddingHorizontal: 14, fontSize: 14, color: colors.textMain,
    },
    dropdown: {
      marginTop: 6,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 10, overflow: 'hidden',
    },
    dropdownItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    dropdownTxt: { fontSize: 13, color: colors.textMain },

    fieldBox: {
      backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 12, padding: 12,
    },
    gradeGroupsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    gradeGroup: {
      flexBasis: '48%', flexGrow: 1, minWidth: 260,
      backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 12, padding: 12, gap: 10,
    },
    gradeGroupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    gradeGroupDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: TEAL },
    gradeGroupLbl: { flex: 1, fontSize: 12, fontWeight: '800', color: colors.textMain, textTransform: 'uppercase', letterSpacing: 0.5 },
    gradeGroupSelectAll: { fontSize: 11, fontWeight: '700', color: TEAL },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark },
    chipActive: { backgroundColor: TEAL + '20', borderColor: TEAL },
    chipTxt: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    chipTxtActive: { color: TEAL },

    avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    avatarTile: {
      flexBasis: '11%', flexGrow: 1, minWidth: 90, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 12,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, position: 'relative',
    },
    avatarTileActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
    avatarCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarLbl: { fontSize: 11, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
    tileCheck: {
      position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
      backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
    },

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
