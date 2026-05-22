/**
 * OnboardingDemo.tsx — Journey boxes flow
 * 4 boxes left to right. Active box expands with editorial left panel.
 * Completed boxes collapse to data strips. Locked boxes are ghosted.
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, Platform, LayoutAnimation, UIManager,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BRAND    = '#5F8A86';
const BRAND20  = '#5F8A8620';
const BRAND40  = '#5F8A8640';
const OFF      = '#0F1A19';

const GRADES    = ['Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9'];
const CURRICULA = ['IB PYP','NCERT','CBSE','Cambridge','State Board'];
const AVATARS   = ['🧑‍🚀','🧑‍💻','🧑‍🎨','🧑‍🔬','🧑‍🏫','🦸'];
const AVATAR_LABELS = ['Explorer','Scholar','Artist','Scientist','Mentor','Hero'];

const STEPS = [
  { num: '01', title: 'About\nYou',    tag: 'Identity',   icon: 'user',      tagline: 'A great journey starts\nwith a name.' },
  { num: '02', title: 'Your\nSchool',  tag: 'School',     icon: 'home',      tagline: "We'll match content\nto your grade." },
  { num: '03', title: 'Curriculum',    tag: 'Curriculum', icon: 'book-open', tagline: 'Personalised learning\nstarts here.' },
  { num: '04', title: 'Your\nAvatar',  tag: 'Avatar',     icon: 'smile',     tagline: 'This is you\nin Aivorah.' },
];

export default function OnboardingDemo() {
  const { colors } = useTheme();
  const [active, setActive]   = useState(0);
  const [done, setDone]       = useState<number[]>([]);

  const [name, setName]             = useState('');
  const [dob, setDob]               = useState('');
  const [gender, setGender]         = useState('');
  const [school, setSchool]         = useState('');
  const [grade, setGrade]           = useState('');
  const [curriculum, setCurriculum] = useState('');
  const [avatar, setAvatar]         = useState('');
  const [avatarLabel, setAvatarLabel] = useState('');

  function next(s: number) {
    LayoutAnimation.configureNext({
      duration: 340,
      update: { type: 'spring', springDamping: 0.82 },
      create: { type: 'easeInEaseOut', property: 'opacity' },
    });
    setDone(p => [...p, s]);
    if (s < STEPS.length - 1) setActive(s + 1);
  }
  function edit(s: number) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setActive(s);
    setDone(p => p.filter(x => x !== s));
  }

  const canGo = (s: number) => {
    if (s === 0) return name.trim().length >= 2 && dob.trim().length >= 6;
    if (s === 1) return school.trim().length >= 2 && grade.length > 0;
    if (s === 2) return curriculum.length > 0;
    return avatar.length > 0;
  };

  const chips = (s: number) => {
    if (s === 0) return [name, gender, dob].filter(Boolean);
    if (s === 1) return [school, grade].filter(Boolean);
    if (s === 2) return [curriculum].filter(Boolean);
    if (s === 3) return avatarLabel ? [`${avatar} ${avatarLabel}`] : [];
    return [];
  };

  const progress  = done.length / STEPS.length;
  const allDone   = done.length === STEPS.length;
  const firstName = name.split(' ')[0];

  const inputStyle = [styles.input, { backgroundColor: colors.bgDark, borderColor: colors.borderColor + '70', color: colors.textMain }];

  function renderForm(s: number) {
    if (s === 0) return (
      <View style={styles.fields}>
        <View style={styles.twoCol}>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[styles.lbl, { color: colors.textMuted }]}>FULL NAME</Text>
            <TextInput style={inputStyle} placeholder="e.g. Ela Reddy"
              placeholderTextColor={colors.textDim} value={name} onChangeText={setName} />
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[styles.lbl, { color: colors.textMuted }]}>DATE OF BIRTH</Text>
            <TextInput style={inputStyle} placeholder="DD / MM / YYYY"
              placeholderTextColor={colors.textDim} value={dob} onChangeText={setDob} keyboardType="numeric" />
          </View>
        </View>
        <View style={{ gap: 5 }}>
          <Text style={[styles.lbl, { color: colors.textMuted }]}>GENDER</Text>
          <View style={styles.chipRow}>
            {['Male','Female','Prefer not to say'].map(g => (
              <TouchableOpacity key={g}
                style={[styles.chip, { borderColor: colors.borderColor + '80', backgroundColor: colors.bgDark },
                  gender === g && { borderColor: BRAND, backgroundColor: BRAND20 }]}
                onPress={() => setGender(g)} activeOpacity={0.75}>
                <Text style={[styles.chipTxt, { color: colors.textMuted }, gender === g && { color: BRAND }]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );

    if (s === 1) return (
      <View style={styles.fields}>
        <View style={{ gap: 5 }}>
          <Text style={[styles.lbl, { color: colors.textMuted }]}>SCHOOL NAME</Text>
          <TextInput style={inputStyle} placeholder="e.g. Delhi Public School"
            placeholderTextColor={colors.textDim} value={school} onChangeText={setSchool} />
        </View>
        <View style={{ gap: 5 }}>
          <Text style={[styles.lbl, { color: colors.textMuted }]}>GRADE</Text>
          <View style={styles.chipRow}>
            {GRADES.map(g => (
              <TouchableOpacity key={g}
                style={[styles.chip, { borderColor: colors.borderColor + '80', backgroundColor: colors.bgDark },
                  grade === g && { borderColor: BRAND, backgroundColor: BRAND20 }]}
                onPress={() => setGrade(g)} activeOpacity={0.75}>
                <Text style={[styles.chipTxt, { color: colors.textMuted }, grade === g && { color: BRAND }]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );

    if (s === 2) return (
      <View style={styles.fields}>
        <Text style={[styles.lbl, { color: colors.textMuted }]}>SELECT CURRICULUM</Text>
        <View style={styles.currGrid}>
          {CURRICULA.map(c => (
            <TouchableOpacity key={c}
              style={[styles.currTile, { borderColor: colors.borderColor + '70', backgroundColor: colors.bgDark },
                curriculum === c && { borderColor: BRAND, backgroundColor: BRAND20 }]}
              onPress={() => setCurriculum(c)} activeOpacity={0.75}>
              <View style={[styles.radio, { borderColor: curriculum === c ? BRAND : colors.borderColor + '80' }]}>
                {curriculum === c && <View style={[styles.radioDot, { backgroundColor: BRAND }]} />}
              </View>
              <Text style={[styles.chipTxt, { color: curriculum === c ? BRAND : colors.textMuted }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );

    if (s === 3) return (
      <View style={styles.fields}>
        <Text style={[styles.lbl, { color: colors.textMuted }]}>PICK YOUR AVATAR</Text>
        <View style={styles.avatarGrid}>
          {AVATARS.map((em, i) => (
            <TouchableOpacity key={i}
              style={[styles.avatarTile, { borderColor: colors.borderColor + '70', backgroundColor: colors.bgDark },
                avatarLabel === AVATAR_LABELS[i] && { borderColor: BRAND, backgroundColor: BRAND20 }]}
              onPress={() => { setAvatar(em); setAvatarLabel(AVATAR_LABELS[i]); }} activeOpacity={0.8}>
              <Text style={{ fontSize: 28 }}>{em}</Text>
              <Text style={[styles.avatarLbl, { color: avatarLabel === AVATAR_LABELS[i] ? BRAND : colors.textDim }]}>
                {AVATAR_LABELS[i]}
              </Text>
              {avatarLabel === AVATAR_LABELS[i] && (
                <View style={[styles.tileCheck, { backgroundColor: BRAND }]}>
                  <Feather name="check" size={8} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgDark }]}>

      {/* ── Topbar ── */}
      <View style={styles.topbar}>
        <View style={styles.logoRow}>
          <View style={[styles.logoMark, { backgroundColor: BRAND }]}>
            <Feather name="zap" size={12} color="#fff" />
          </View>
          <Text style={[styles.logoTxt, { color: colors.textMain }]}>Aivorah</Text>
        </View>

        {/* 4-segment progress */}
        <View style={styles.segRow}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.seg, { backgroundColor: colors.borderColor + '40' }]}>
              <View style={[styles.segFill, {
                width: done.includes(i) ? '100%' : active === i ? '55%' : '0%',
                backgroundColor: done.includes(i) ? BRAND : BRAND + '70',
              }]} />
            </View>
          ))}
        </View>

        <Text style={[styles.topMeta, { color: colors.textMuted }]}>
          {allDone ? 'Complete' : `${done.length} / ${STEPS.length}`}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Greeting ── */}
        {!allDone && (
          <View style={styles.greetWrap}>
            <Text style={[styles.greetMain, { color: colors.textMain }]}>
              {done.length === 0 && "Let's get you started."}
              {done.length === 1 && (firstName ? `Nice, ${firstName}.` : 'Step two.')}
              {done.length === 2 && (firstName ? `Almost there, ${firstName}.` : 'Step three.')}
              {done.length === 3 && 'Last one.'}
            </Text>
            <Text style={[styles.greetSub, { color: colors.textMuted }]}>
              {STEPS[active]?.tagline.replace('\n', ' ')}
            </Text>
          </View>
        )}

        {/* ── Journey boxes ── */}
        <View style={styles.boxRow}>
          {STEPS.map((step, i) => {
            const isDone   = done.includes(i);
            const isActive = active === i && !isDone;
            const isLocked = !isDone && !isActive;

            /* ── ACTIVE ── */
            if (isActive) return (
              <View key={i} style={[styles.activeBox, {
                backgroundColor: colors.cardDark,
                borderColor: BRAND + '70',
                flex: 3,
              }]}>
                {/* Left editorial panel */}
                <View style={[styles.leftPanel, { backgroundColor: OFF }]}>
                  {/* Big step number */}
                  <Text style={[styles.bigNum, { color: BRAND }]}>{step.num}</Text>

                  {/* Step title */}
                  <Text style={[styles.panelTitle, { color: BRAND }]}>{step.title}</Text>

                  {/* Rotated tag */}
                  <View style={styles.rotatedTagWrap}>
                    <Text style={[styles.rotatedTag, { color: BRAND40 }]}>{step.tag.toUpperCase()}</Text>
                  </View>

                  {/* Mini progress arc using border trick */}
                  <View style={[styles.miniRing, { borderColor: BRAND + '30' }]}>
                    <Text style={[styles.miniRingPct, { color: BRAND }]}>{Math.round(progress * 100)}%</Text>
                  </View>
                </View>

                {/* Right: form + CTA */}
                <View style={styles.rightPanel}>
                  {renderForm(i)}
                  <TouchableOpacity
                    style={[styles.ctaBtn, { backgroundColor: BRAND }, !canGo(i) && { opacity: 0.3 }]}
                    onPress={() => canGo(i) && next(i)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.ctaTxt}>
                      {i === STEPS.length - 1 ? 'Start Learning' : 'Continue'}
                    </Text>
                    <Feather name={i === STEPS.length - 1 ? 'zap' : 'arrow-right'} size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            );

            /* ── DONE ── */
            if (isDone) return (
              <TouchableOpacity key={i} onPress={() => edit(i)} activeOpacity={0.8}
                style={[styles.doneBox, { backgroundColor: BRAND + '0D', borderColor: BRAND + '45', flex: 1 }]}>
                <View style={[styles.doneCheck, { backgroundColor: BRAND }]}>
                  <Feather name="check" size={11} color="#fff" />
                </View>
                <Text style={[styles.sideNum, { color: BRAND + '60' }]}>{step.num}</Text>
                <Text style={[styles.sideTitle, { color: BRAND }]}>{step.tag}</Text>

                {/* Collected data chips */}
                <View style={styles.sideChips}>
                  {chips(i).map((c, ci) => (
                    <View key={ci} style={[styles.sideChip, { backgroundColor: BRAND + '12', borderColor: BRAND + '35' }]}>
                      <Text style={[styles.sideChipTxt, { color: BRAND }]} numberOfLines={1}>{c}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.editDot, { backgroundColor: BRAND + '25' }]}>
                  <Feather name="edit-2" size={10} color={BRAND} />
                </View>
              </TouchableOpacity>
            );

            /* ── LOCKED ── */
            return (
              <View key={i} style={[styles.lockedBox, {
                backgroundColor: colors.cardDark,
                borderColor: colors.borderColor + '35',
                flex: 1, opacity: 0.42,
              }]}>
                <Text style={[styles.sideNum, { color: colors.borderColor }]}>{step.num}</Text>
                <Text style={[styles.sideTitle, { color: colors.textDim }]}>{step.tag}</Text>
                <View style={[styles.lockDot, { backgroundColor: colors.borderColor + '40' }]}>
                  <Feather name="lock" size={10} color={colors.textDim} />
                </View>
              </View>
            );
          })}
        </View>

        {/* ── All done ── */}
        {allDone && (
          <View style={[styles.celebWrap, { backgroundColor: BRAND20, borderColor: BRAND40 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={[styles.celebIcon, { backgroundColor: BRAND }]}>
                <Feather name="zap" size={20} color="#fff" />
              </View>
              <View>
                <Text style={[styles.celebTitle, { color: colors.textMain }]}>
                  {firstName ? `You're ready, ${firstName}!` : "You're all set!"}
                </Text>
                <Text style={[styles.celebSub, { color: colors.textMuted }]}>
                  Your personalised learning path is waiting.
                </Text>
              </View>
            </View>
            <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: BRAND, marginTop: 18 }]} activeOpacity={0.85}>
              <Text style={styles.ctaTxt}>Enter Aivorah</Text>
              <Feather name="arrow-right" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  topbar: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 28, paddingTop: Platform.OS === 'web' ? 20 : 48, paddingBottom: 12,
  },
  logoRow:  { flexDirection: 'row', alignItems: 'center', gap: 7 },
  logoMark: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  logoTxt:  { fontSize: 14, fontWeight: '700' },
  segRow:   { flex: 1, flexDirection: 'row', gap: 5 },
  seg:      { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  segFill:  { height: '100%', borderRadius: 2 },
  topMeta:  { fontSize: 11, fontWeight: '600', minWidth: 56, textAlign: 'right' },

  scroll: {
    flexGrow: 1, justifyContent: 'center',
    paddingHorizontal: 28, paddingVertical: 28, gap: 20,
  },

  greetWrap: { gap: 4 },
  greetMain: { fontSize: 30, fontWeight: '800', letterSpacing: -0.8, lineHeight: 36 },
  greetSub:  { fontSize: 14, fontWeight: '400' },

  /* Journey row */
  boxRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },

  /* Active box */
  activeBox: {
    flexDirection: 'row',
    borderWidth: 1.5, borderRadius: 22, overflow: 'hidden',
    shadowColor: BRAND, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2, shadowRadius: 22, elevation: 10,
  },

  leftPanel: {
    width: 82, paddingVertical: 22, paddingHorizontal: 12,
    alignItems: 'center', justifyContent: 'space-between',
  },
  bigNum:    { fontSize: 38, fontWeight: '900', letterSpacing: -2, lineHeight: 42, color: BRAND },
  panelTitle: { fontSize: 10, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5, lineHeight: 15, textTransform: 'uppercase' },
  rotatedTagWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  rotatedTag: { fontSize: 8, fontWeight: '700', letterSpacing: 2, transform: [{ rotate: '90deg' }] },
  miniRing: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  miniRingPct: { fontSize: 9, fontWeight: '800' },

  rightPanel: { flex: 1, padding: 18, gap: 14 },

  /* Done box */
  doneBox: {
    borderWidth: 1.5, borderRadius: 22,
    paddingVertical: 18, paddingHorizontal: 12,
    alignItems: 'center', gap: 8, position: 'relative',
  },
  doneCheck: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  editDot: {
    position: 'absolute', top: 10, right: 10,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },

  /* Locked box */
  lockedBox: {
    borderWidth: 1.5, borderRadius: 22,
    paddingVertical: 18, paddingHorizontal: 12,
    alignItems: 'center', gap: 10,
  },
  lockDot: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },

  sideNum:   { fontSize: 12, fontWeight: '900', letterSpacing: -0.5 },
  sideTitle: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'center' },
  sideChips: { gap: 4, width: '100%', alignItems: 'center' },
  sideChip:  { borderWidth: 1, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, maxWidth: '100%' },
  sideChipTxt: { fontSize: 9, fontWeight: '600' },

  /* Celebration */
  celebWrap: {
    borderWidth: 1.5, borderRadius: 22, padding: 24,
  },
  celebIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  celebTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  celebSub:   { fontSize: 13, fontWeight: '400', marginTop: 2 },

  /* CTA */
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14,
  },
  ctaTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },

  /* Form */
  fields: { gap: 14 },
  twoCol: { flexDirection: 'row', gap: 10 },
  lbl:    { fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  input:  { height: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 13 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5 },
  chipTxt: { fontSize: 12, fontWeight: '600' },

  currGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  currTile: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1.5,
  },
  radio:    { width: 16, height: 16, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 7, height: 7, borderRadius: 4 },

  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  avatarTile: {
    alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 14, borderWidth: 1.5, minWidth: 72,
    position: 'relative', gap: 3,
  },
  avatarLbl: { fontSize: 10, fontWeight: '700' },
  tileCheck: {
    position: 'absolute', top: 5, right: 5,
    width: 14, height: 14, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
});
