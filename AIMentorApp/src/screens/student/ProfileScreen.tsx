import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, Image, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SERVER_URL from '../../config/serverUrl';
import { AVATAR_STYLES } from '../../constants/avatarStyles';

// ── Avatars — Enchanting Forest palette ─────────────────────────────────────
const AVATARS = AVATAR_STYLES;

// ── Learning styles — palette colors ─────────────────────────────────────────
const LEARNING_STYLES = [
  { id: 'visual',    label: 'Visual',    desc: 'I learn best through diagrams & images',  icon: 'eye'      as const, color: '#5F8A86' },
  { id: 'auditory',  label: 'Auditory',  desc: 'I learn best by listening & discussing',  icon: 'volume-2' as const, color: '#93B0AC' },
  { id: 'reading',   label: 'Reading',   desc: 'I learn best through reading & writing',  icon: 'book'     as const, color: '#8A8358' },
  { id: 'handson',   label: 'Hands-On', desc: 'I learn best by doing & experimenting',   icon: 'tool'     as const, color: '#B8797E' },
];

// ── Subject interests — Enchanting Forest palette ─────────────────────────────
const SUBJECT_OPTIONS = [
  { id: 'maths',   label: 'Mathematics', color: '#5F8A86' },  // slate teal
  { id: 'science', label: 'Science',     color: '#5A8A70' },  // forest green
  { id: 'english', label: 'English',     color: '#8A8358' },  // khaki gold
  { id: 'art',     label: 'Art',         color: '#B8797E' },  // muted rose
  { id: 'music',   label: 'Music',       color: '#93B0AC' },  // sage
  { id: 'coding',  label: 'Coding',      color: '#7AADA8' },  // mint teal
  { id: 'history', label: 'History',     color: '#C49098' },  // blush
  { id: 'sports',  label: 'Sports',      color: '#9A9898' },  // silver
];

const CARTOON_OPTIONS = ['Naruto', 'Doraemon', 'Shinchan', 'Spider-Man', 'Iron Man', 'Custom...'];

// ────────────────────────────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }: any) {
  const { user, updateUser } = useAuth();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // State
  const [photoUrl,       setPhotoUrl]       = useState<string | null>((user as any)?.photoUrl ?? null);
  const [uploading,      setUploading]      = useState(false);
  const initialAvatar =  (user as any)?.avatarStyle ?? 'default';
  const [selAvatar,      setSelAvatar]      = useState(initialAvatar);
  const [learningStyle,  setLearningStyle]  = useState<string>((user as any)?.learningStyle ?? '');
  const [interests,      setInterests]      = useState<string[]>((user as any)?.interests ?? []);
  const [cartoon,        setCartoon]        = useState('');
  const [customCartoon,  setCustomCartoon]  = useState('');
  const [showCustom,     setShowCustom]     = useState(false);
  const [editVisible,    setEditVisible]    = useState(false);
  const [editName,       setEditName]       = useState(user?.name || '');
  const [editGrade,      setEditGrade]      = useState(user?.grade || '');
  const [editLocation,   setEditLocation]   = useState(user?.location || '');
  const [editBio,        setEditBio]        = useState((user as any)?.bio || '');

  const currentAvatar = AVATARS.find(a => a.id === selAvatar) || AVATARS[0];

  function toggleInterest(id: string) {
    const next = interests.includes(id) ? interests.filter(i => i !== id) : [...interests, id];
    setInterests(next);
    updateUser({ interests: next } as any);
  }

  function handleSelectAvatar(id: string) {
    setSelAvatar(id);
    setPhotoUrl(null);
    updateUser({ avatarStyle: id, photoUrl: undefined } as any);
  }

  function handleSaveProfile() {
    if (!editName.trim()) { Alert.alert('Required', 'Please enter your name.'); return; }
    updateUser({ name: editName.trim(), grade: editGrade.trim() || undefined, location: editLocation.trim() || undefined, bio: editBio.trim() || undefined } as any);
    setEditVisible(false);
  }

  function handleCartoonSelect(c: string) {
    if (c === 'Custom...') { setShowCustom(true); setCartoon(''); }
    else { setCartoon(c); setShowCustom(false); }
  }

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow access to your photo library.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1,1], quality: 0.7, base64: true });
    if (result.canceled || !result.assets?.[0]) return;
    setUploading(true);
    try {
      const res  = await fetch(`${SERVER_URL}/user/upload-photo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: result.assets[0].base64, mimeType: result.assets[0].mimeType ?? 'image/jpeg' }) });
      const data = await res.json();
      if (data.url) { setPhotoUrl(data.url); updateUser({ photoUrl: data.url } as any); }
    } catch { Alert.alert('Upload failed', 'Could not upload photo. Please try again.'); }
    finally { setUploading(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="My Profile" />

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── HERO ── */}
          <View style={styles.heroCard}>
            <LinearGradient colors={isDark ? ['#111111','#1C2420','#152220'] : ['#F9F3F4','#EFD1D4','#C3DCD8']} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.heroBg} />

            {/* Edit button top-right */}
            <TouchableOpacity style={styles.editCornerBtn} onPress={() => setEditVisible(true)}>
              <Feather name="edit-2" size={13} color={colors.primary} />
              <Text style={styles.editCornerText}>Edit</Text>
            </TouchableOpacity>

            {/* Centered avatar */}
            <TouchableOpacity style={styles.avatarWrap} onPress={handlePickPhoto} activeOpacity={0.85}>
              {photoUrl
                ? <Image source={{ uri: photoUrl }} style={styles.avatarPhoto} />
                : <LinearGradient colors={currentAvatar.gradient} style={styles.avatarGrad}>
                    <Feather name={currentAvatar.icon as any} size={36} color="white" />
                  </LinearGradient>}
              <View style={styles.cameraRing}>
                {uploading ? <ActivityIndicator size="small" color="white" /> : <Feather name="camera" size={11} color="white" />}
              </View>
            </TouchableOpacity>

            {/* Name + bio */}
            <Text style={styles.heroName}>{user?.name || 'Student'}</Text>
            {(user as any)?.bio ? <Text style={styles.heroBio}>{(user as any).bio}</Text> : null}

            {/* Tags */}
            <View style={styles.heroTags}>
              <View style={[styles.tag, { backgroundColor: isDark ? 'rgba(147,176,172,0.18)' : 'rgba(147,176,172,0.22)', borderColor: isDark ? 'rgba(147,176,172,0.35)' : 'rgba(95,138,134,0.4)' }]}>
                <Feather name="book-open" size={10} color={colors.primary} />
                <Text style={[styles.tagText, { color: colors.primary }]}>{user?.grade || 'Grade 3'}</Text>
              </View>
              <View style={[styles.tag, { backgroundColor: isDark ? 'rgba(195,220,216,0.15)' : 'rgba(195,220,216,0.35)', borderColor: isDark ? 'rgba(195,220,216,0.3)' : 'rgba(147,176,172,0.5)' }]}>
                <Feather name="globe" size={10} color={colors.accentBlue} />
                <Text style={[styles.tagText, { color: colors.accentBlue }]}>IB PYP</Text>
              </View>
              {user?.location && (
                <View style={[styles.tag, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderColor: colors.borderColor }]}>
                  <Feather name="map-pin" size={10} color={colors.textDim} />
                  <Text style={[styles.tagText, { color: colors.textDim }]}>{user.location}</Text>
                </View>
              )}
              {/* Plan badge */}
              <TouchableOpacity
                style={[styles.tag, (user as any)?.isPro
                  ? { backgroundColor: '#C5A56A22', borderColor: '#C5A56A55' }
                  : { backgroundColor: isDark ? 'rgba(147,176,172,0.18)' : 'rgba(147,176,172,0.22)', borderColor: isDark ? 'rgba(147,176,172,0.35)' : 'rgba(95,138,134,0.4)' }
                ]}
                onPress={() => navigation.navigate('Subscription')}
                activeOpacity={0.7}
              >
                <Feather name={(user as any)?.isPro ? 'sun' : 'feather'} size={10} color={(user as any)?.isPro ? '#C5A56A' : colors.primary} />
                <Text style={[styles.tagText, { color: (user as any)?.isPro ? '#C5A56A' : colors.primary }]}>
                  {(user as any)?.isPro ? 'Pro Plan' : 'Free Plan'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── CHOOSE YOUR LOOK ── */}
          <View style={styles.card}>
            <SectionHead icon="user" iconBg={isDark ? 'rgba(147,176,172,0.18)' : 'rgba(195,220,216,0.35)'} iconColor={colors.primary} title="Choose Your Look" sub="Pick an avatar style" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {AVATARS.map(av => {
                const active = selAvatar === av.id;
                return (
                  <TouchableOpacity key={av.id} onPress={() => handleSelectAvatar(av.id)} style={styles.avOption} activeOpacity={0.8}>
                    <View style={[styles.avRing, active && { borderColor: colors.primary }]}>
                      <LinearGradient colors={av.gradient} style={styles.avCircle}>
                        <Feather name={av.icon as any} size={26} color="white" />
                      </LinearGradient>
                      {active && <View style={[styles.avCheck, { backgroundColor: colors.primary }]}><Feather name="check" size={9} color="white" /></View>}
                    </View>
                    <Text style={[styles.avLabel, active && { color: colors.primary, fontWeight: '700' }]}>{av.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* ── LEARNING STYLE ── */}
          <View style={styles.card}>
            <SectionHead icon="cpu" iconBg={isDark ? 'rgba(197,189,150,0.18)' : 'rgba(197,189,150,0.35)'} iconColor={colors.accentYellow} title="How I Learn Best" sub="Personalises your AI Coach experience" />
            <View style={styles.styleGrid}>
              {LEARNING_STYLES.map(s => {
                const active = learningStyle === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.styleCard, active && { borderColor: s.color, backgroundColor: isDark ? `${s.color}18` : `${s.color}10` }]}
                    onPress={() => { setLearningStyle(s.id); updateUser({ learningStyle: s.id } as any); }}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.styleIconWrap, { backgroundColor: `${s.color}20` }]}>
                      <Feather name={s.icon} size={18} color={s.color} />
                    </View>
                    <Text style={[styles.styleLabel, active && { color: s.color }]}>{s.label}</Text>
                    <Text style={styles.styleDesc}>{s.desc}</Text>
                    {active && <View style={[styles.styleCheck, { backgroundColor: s.color }]}><Feather name="check" size={9} color="white" /></View>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── SUBJECTS I LOVE ── */}
          <View style={styles.card}>
            <SectionHead icon="heart" iconBg={isDark ? 'rgba(239,209,212,0.18)' : 'rgba(239,209,212,0.45)'} iconColor={colors.accentRed} title="Subjects I Love" sub="We'll recommend content you enjoy" />
            <View style={styles.interestWrap}>
              {SUBJECT_OPTIONS.map(s => {
                const active = interests.includes(s.id);
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.interestChip, active && { borderColor: s.color, backgroundColor: isDark ? `${s.color}18` : `${s.color}10` }]}
                    onPress={() => toggleInterest(s.id)}
                  >
                    {active && <Feather name="check" size={11} color={s.color} />}
                    <Text style={[styles.interestText, active && { color: s.color, fontWeight: '700' }]}>{s.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── LEARNING BUDDY ── */}
          <View style={[styles.card, { overflow: 'hidden' }]}>
            <View style={styles.cardHeadRow}>
              <SectionHead icon="smile" iconBg={isDark ? 'rgba(195,220,216,0.15)' : 'rgba(195,220,216,0.40)'} iconColor={colors.accentCyan} title="Learning Buddy" sub="Who inspires your learning?" />
              <View style={[styles.comingSoonBadge, { backgroundColor: colors.accentCyan + '18', borderColor: colors.accentCyan + '40' }]}>
                <Feather name="clock" size={11} color={colors.accentCyan} />
                <Text style={[styles.comingSoonText, { color: colors.accentCyan }]}>Coming Soon</Text>
              </View>
            </View>
            {/* Content dimmed — not interactive */}
            <View pointerEvents="none" style={{ opacity: 0.35 }}>
              <View style={styles.interestWrap}>
                {CARTOON_OPTIONS.map(opt => (
                  <View key={opt} style={styles.interestChip}>
                    <Text style={styles.interestText}>{opt}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* ── ACCOUNT ── */}
          <View style={styles.card}>
            <SectionHead icon="settings" iconBg={isDark ? 'rgba(168,181,179,0.12)' : 'rgba(168,181,179,0.2)'} iconColor={colors.textMuted} title="Account" />
            {([
              { icon: 'bell',         label: 'Notifications',      sub: 'Alerts and reminders',       cb: () => {},                               danger: false },
              { icon: 'shield',       label: 'Privacy',            sub: 'Password, data settings',    cb: () => {},                               danger: false },
              { icon: 'help-circle',  label: 'Help Center',        sub: 'FAQs and support',           cb: () => navigation?.navigate?.('HelpCenter'), danger: false },
              { icon: 'log-out',      label: 'Sign Out',           sub: 'Sign out of your account',   cb: () => {},                               danger: true  },
            ] as const).map((row, i, arr) => (
              <TouchableOpacity key={row.label} style={[styles.accountRow, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderColor }]} onPress={row.cb} activeOpacity={0.7}>
                <View style={[styles.accountIcon, row.danger && { backgroundColor: 'rgba(239,68,68,0.1)' }]}>
                  <Feather name={row.icon} size={15} color={row.danger ? colors.accentRed : colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.accountLabel, row.danger && { color: colors.accentRed }]}>{row.label}</Text>
                  <Text style={styles.accountSub}>{row.sub}</Text>
                </View>
                {!row.danger && <Feather name="chevron-right" size={14} color={colors.textDim} />}
              </TouchableOpacity>
            ))}
          </View>

        </ScrollView>

        {/* ── EDIT MODAL ── */}
        <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
          <View style={styles.overlay}>
            <View style={styles.modalBox}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>Edit Profile</Text>
                <TouchableOpacity onPress={() => setEditVisible(false)}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
              </View>

              {[
                { label: 'Full Name',   icon: 'user'    as const, val: editName,     set: setEditName,     ph: 'Your name',         cap: 'words' as const },
                { label: 'Grade',       icon: 'book'    as const, val: editGrade,    set: setEditGrade,    ph: 'e.g. Grade 3',      cap: 'none'  as const },
                { label: 'Location',    icon: 'map-pin' as const, val: editLocation, set: setEditLocation, ph: 'e.g. Hyderabad',    cap: 'none'  as const },
                { label: 'Bio',         icon: 'edit-2'  as const, val: editBio,      set: setEditBio,      ph: 'A short tagline…',  cap: 'sentences' as const },
              ].map(f => (
                <View key={f.label}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <View style={styles.inputRow}>
                    <Feather name={f.icon} size={14} color={colors.textDim} />
                    <TextInput style={styles.input} placeholder={f.ph} placeholderTextColor={colors.textDim} value={f.val} onChangeText={f.set} autoCapitalize={f.cap} />
                  </View>
                </View>
              ))}

              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditVisible(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn}   onPress={handleSaveProfile}><Text style={styles.saveText}>Save Changes</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

// ── Reusable section header ──────────────────────────────────────────────────
function SectionHead({ icon, iconBg, iconColor, title, sub }: { icon: string; iconBg: string; iconColor: string; title: string; sub?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name={icon as any} size={15} color={iconColor} />
      </View>
      <View>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.textMain }}>{title}</Text>
        {sub ? <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: c.bgDark },
  scroll:  { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  // Hero
  heroCard: {
    borderRadius: radius.xl, overflow: 'hidden',
    alignItems: 'center', paddingVertical: 32, paddingHorizontal: spacing.xl,
    borderWidth: 1, borderColor: c.borderColor,
    gap: 10,
  },
  heroBg: { ...StyleSheet.absoluteFillObject },
  editCornerBtn: {
    position: 'absolute', top: 14, right: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.sm, borderWidth: 1, borderColor: isDark ? 'rgba(147,176,172,0.4)' : 'rgba(95,138,134,0.4)',
    backgroundColor: isDark ? 'rgba(147,176,172,0.12)' : 'rgba(195,220,216,0.3)',
  },
  editCornerText: { fontSize: 11, fontWeight: '700', color: c.primary },
  avatarWrap:  { position: 'relative', marginBottom: 4 },
  avatarPhoto: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: c.primary },
  avatarGrad:  { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  cameraRing:  {
    position: 'absolute', bottom: 2, right: 2,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: c.primary, borderWidth: 2, borderColor: isDark ? '#111111' : '#F9F3F4',
    alignItems: 'center', justifyContent: 'center',
  },
  heroName: { fontSize: 22, fontWeight: '800', color: c.textMain, letterSpacing: -0.4 },
  heroBio:  { fontSize: 13, color: c.textMuted, textAlign: 'center', marginTop: -4 },
  heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  tagText: { fontSize: 11, fontWeight: '600' },

  // Card
  card: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl,
  },
  cardHeadRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },

  // Avatar picker
  avOption: { alignItems: 'center', marginRight: spacing.xl, gap: 7 },
  avRing:   { width: 72, height: 72, borderRadius: 36, borderWidth: 2.5, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avCheck:  { position: 'absolute', top: 0, right: 0, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.cardDark },
  avLabel:  { fontSize: 11, color: c.textMuted, fontWeight: '500' },

  // Learning style
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  styleCard: {
    width: '48%',
    borderWidth: 1.5, borderColor: c.borderColor, borderRadius: radius.lg,
    padding: spacing.lg, gap: 6, position: 'relative',
    backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
  },
  styleIconWrap: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  styleLabel: { fontSize: 13, fontWeight: '700', color: c.textMain },
  styleDesc:  { fontSize: 11, color: c.textDim, lineHeight: 15 },
  styleCheck: { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },

  // Interests / buddy chips
  interestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  interestChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.lg, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: c.borderColor,
    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
  },
  interestText: { fontSize: 13, color: c.textMuted, fontWeight: '500' },

  comingSoonBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  comingSoonText:  { fontSize: 11, fontWeight: '700' },

  smallBtn:       { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor },
  smallBtnActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  smallBtnText:   { fontSize: 12, fontWeight: '600', color: c.textDim },

  customInput: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md, backgroundColor: c.cardHover, borderWidth: 1, borderColor: c.primary,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 44,
  },
  customInputText: { flex: 1, fontSize: 14, color: c.textMain },

  // Account
  accountRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
  accountIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' },
  accountLabel:{ fontSize: 14, fontWeight: '600', color: c.textMain },
  accountSub:  { fontSize: 11, color: c.textDim, marginTop: 1 },

  // Modal
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox:   { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, width: '100%', maxWidth: 440 },
  modalHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.textMain },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 6, marginTop: spacing.md },
  inputRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, height: 46, paddingHorizontal: spacing.lg },
  input:      { flex: 1, fontSize: 14, color: c.textMain },
  modalBtns:  { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  cancelBtn:  { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  saveBtn:    { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  saveText:   { fontSize: 14, fontWeight: '700', color: 'white' },
});
