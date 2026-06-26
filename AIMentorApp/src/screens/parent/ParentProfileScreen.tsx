import React, { useMemo, useState, useEffect, useCallback } from 'react';
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
  Switch,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { getAuth, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const INFO_ICONS: Record<string, any> = {
  'First Name': 'user', 'Last Name': 'user', 'Email Address': 'mail',
  'Contact Number': 'phone', 'City': 'map-pin',
};

function InfoRow({ icon, label, value, styles, isLast }: { icon: string; label: string; value: string; styles: any; isLast?: boolean }) {
  return (
    <View style={[styles.infoRow, !isLast && styles.infoRowBorder]}>
      <View style={styles.infoRowLeft}>
        <Feather name={icon as any} size={14} color="#BAA467" style={{ opacity: 0.7 }} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function ParentProfileScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user, updateUser } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [children, setChildren] = useState<any[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(true);
  const [weeklyActivity, setWeeklyActivity] = useState<number[]>([0,0,0,0,0,0,0]);

  // Edit profile modal
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCity, setEditCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);

  async function pickPhoto() {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (file) setPhotoUri(URL.createObjectURL(file));
      };
      input.click();
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  }
  const [passModalVisible, setPassModalVisible] = useState(false);
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passError, setPassError] = useState('');
  const [passSuccess, setPassSuccess] = useState(false);
  const [passLoading, setPassLoading] = useState(false);

  function openPassModal() {
    setCurrentPass(''); setNewPass(''); setConfirmPass('');
    setPassError(''); setPassSuccess(false);
    setPassModalVisible(true);
  }

  async function handleChangePassword() {
    // Strip all whitespace to match the login screen (pass.replace(/\s+/g,'')),
    // so a copy-pasted current password with a stray space still re-authenticates. (#154)
    const curPw = (currentPass || '').replace(/\s+/g, '');
    const newPw = (newPass || '').replace(/\s+/g, '');
    const confirmPw = (confirmPass || '').replace(/\s+/g, '');
    if (!newPw || newPw.length < 6) { setPassError('New password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw) { setPassError('Passwords do not match.'); return; }
    setPassLoading(true); setPassError('');
    try {
      const firebaseAuth = getAuth();
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) throw new Error('Not logged in');
      const credential = EmailAuthProvider.credential(email, curPw);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPw);
      setPassSuccess(true);
      setTimeout(() => setPassModalVisible(false), 1500);
    } catch (err: any) {
      const msg = err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential'
        ? 'Current password is incorrect.'
        : 'Could not update password. Please try again.';
      setPassError(msg);
    }
    setPassLoading(false);
  }
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');

  const parentEmail = user?.email || '';
  const email = user?.email ?? '';

  // Load persisted phone + city from server on mount
  useEffect(() => {
    if (!email) return;
    fetch(`${SERVER_URL}/user/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
      .then(r => r.json())
      .then(d => {
        if (d?.phone) setPhone(d.phone);
        if (d?.location) setCity(d.location);
      })
      .catch(() => {});
  }, [email]);

  const loadActivity = useCallback(() => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setChildren(data);
          // Sum weekly activity across all children
          if (data.length > 0) {
            Promise.all(
              data.map(c =>
                fetch(`${SERVER_URL}/student/${c.id}/weekly`)
                  .then(r => r.json())
                  .catch(() => ({ days: [] }))
              )
            ).then(results => {
              const combined = [0,0,0,0,0,0,0];
              results.forEach(res => {
                if (res?.days) {
                  const actMap: Record<string,number> = {};
                  res.days.forEach((d: any) => { actMap[d.day] = d.studyMinutes ?? 0; });
                  WEEK_DAYS.forEach((d, i) => { combined[i] += actMap[d] ?? 0; });
                }
              });
              setWeeklyActivity(combined);
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setChildrenLoading(false));
  }, [parentEmail]);

  // Initial load + auto-refresh every 15s (study time is logged each minute
  // server-side), so the parent never has to manually refresh.
  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, 15 * 1000);
    return () => clearInterval(interval);
  }, [loadActivity]);

  // Refresh instantly when the screen regains focus.
  useFocusEffect(useCallback(() => { loadActivity(); }, [loadActivity]));

  const nameParts = (user?.name ?? '').split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  function openEdit() {
    setEditName(user?.name ?? '');
    setEditPhone(phone);
    setEditCity(city);
    setEditVisible(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: editName.trim(), location: editCity.trim(), phone: editPhone.trim(), role: 'parent' }),
      });
      setPhone(editPhone.trim());
      setCity(editCity.trim());
      updateUser({ name: editName.trim(), location: editCity.trim() } as any);
      setEditVisible(false);
    } catch {}
    setSaving(false);
  }

  // Each bar is scaled to a fixed 4-hour (240 min) reference: a full bar means
  // 4h of usage that day, capped at 100%. (Previously normalized to the week's
  // own max, so a single active day always looked full no matter how few mins.)
  const FULL_BAR_MINUTES = 240;
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const totalStudyMins = weeklyActivity.reduce((a,b) => a+b, 0);
  // Format as m / h / h m: 39m, 60m→1h, 90m→1h 30m, 119m→1h 59m, 120m→2h
  const totalStudyDisplay = (() => {
    const h = Math.floor(totalStudyMins / 60);
    const m = totalStudyMins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  })();
  const activeDays = weeklyActivity.filter(m => m > 0).length;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Profile"
          subtitle="Manage your account"
          searchPlaceholder="Search parent settings..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── Hero Card ── */}
          <View style={styles.heroCard}>
            {/* Avatar + name */}
            <View style={styles.heroLeft}>
              <TouchableOpacity style={styles.heroAvatar} onPress={pickPhoto} activeOpacity={0.8}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={{ width: 80, height: 80, borderRadius: 40 }} />
                ) : (
                  <Text style={styles.heroAvatarText}>{firstName[0] || 'P'}</Text>
                )}
                <View style={styles.avatarEditBadge}>
                  <Feather name="camera" size={10} color="#fff" />
                </View>
              </TouchableOpacity>
              <View style={{ gap: 4 }}>
                <Text style={styles.heroWelcome}>Welcome back,</Text>
                <Text style={styles.heroName}>{user?.name ?? 'Parent'}</Text>
                <View style={styles.heroTags}>
                  <View style={styles.heroTag}>
                    <Feather name="check-circle" size={11} color={colors.accentGreen} />
                    <Text style={[styles.heroTagText, { color: colors.accentGreen }]}>Verified Account</Text>
                  </View>
                  <View style={[styles.heroTag, { borderColor: colors.accentYellow + '40' }]}>
                    <Feather name="star" size={11} color={colors.accentYellow} />
                    <Text style={[styles.heroTagText, { color: colors.accentYellow }]}>Premium Member</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Quote panel */}
            <View style={styles.heroQuote}>
              <Text style={styles.quoteGlyph}>"</Text>
              <Text style={styles.quoteText}>
                Every step today,{'\n'}a <Text style={styles.quoteHighlight}>brighter</Text> tomorrow.
              </Text>
              <View style={styles.sparkleRow}>
                <View style={styles.sparkleDot} /><View style={[styles.sparkleDot, { width: 4, height: 4 }]} /><View style={styles.sparkleDot} />
              </View>
            </View>

            {/* Edit button */}
            <TouchableOpacity style={styles.editBtn} activeOpacity={0.8} onPress={openEdit}>
              <Feather name="edit-2" size={13} color="#0B0B0B" />
              <Text style={styles.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>

          {/* ── Two Column ── */}
          <View style={styles.twoCol}>
            {/* Profile Info */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Feather name="user" size={16} color={colors.accentYellow} />
                <Text style={styles.cardTitle}>Profile Information</Text>
              </View>
              <InfoRow icon="user"     label="First Name"      value={firstName || '—'} styles={styles} />
              <InfoRow icon="user"     label="Last Name"       value={lastName || '—'}  styles={styles} />
              <InfoRow icon="mail"     label="Email Address"   value={email || '—'}     styles={styles} />
              <InfoRow icon="phone"    label="Contact Number"  value={phone || '—'}     styles={styles} />
              <InfoRow icon="map-pin"  label="City"            value={city || '—'}      styles={styles} isLast />
            </View>

            {/* Activity Overview */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Feather name="activity" size={16} color={colors.accentYellow} />
                <Text style={styles.cardTitle}>Activity Overview</Text>
                <View style={styles.weekBadge}>
                  <Text style={styles.weekBadgeText}>This Week</Text>
                </View>
              </View>

              {/* Stats row */}
              <View style={styles.statsGrid}>
                <View style={styles.statCell}>
                  <Text style={[styles.statBig, { color: colors.accentYellow }]}>{activeDays}<Text style={{ fontSize: 14, fontWeight: '600' }}>/7</Text></Text>
                  <Text style={styles.statSmallLabel}>ACTIVE DAYS</Text>
                </View>
                <View style={styles.statDividerV} />
                <View style={styles.statCell}>
                  <Text style={styles.statBig}>{totalStudyDisplay}</Text>
                  <Text style={styles.statSmallLabel}>TOTAL LEARNING TIME</Text>
                </View>
                <View style={styles.statDividerV} />
                <View style={styles.statCell}>
                  <Text style={[styles.statBig, { color: colors.accentYellow }]}>{children.length} kids</Text>
                  <Text style={styles.statSmallLabel}>LINKED</Text>
                </View>
              </View>

            </View>
          </View>

          {/* ── Security & Account ── */}
          <View style={[styles.card, { marginTop: spacing.lg }]}>
            <View style={styles.secHeader}>
              <View style={styles.cardHeader}>
                <Feather name="lock" size={16} color={colors.accentYellow} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Security & Account</Text>
                  <Text style={styles.secSub}>Keep your account secure</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.changePassBtn} onPress={openPassModal}>
                <Feather name="lock" size={12} color={colors.accentYellow} />
                <Text style={styles.changePassText}>Change Password</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.secTilesRow}>
              {[
                { icon: 'user',   title: 'Personal Information',  sub: 'Update your personal details',  action: openEdit },
                { icon: 'bell',   title: 'Notification Settings', sub: 'Manage your alerts & emails',   action: () => navigation.navigate('ParentSettings') },
                { icon: 'shield', title: 'Privacy & Security',    sub: 'Control your data & privacy',   action: () => navigation.navigate('ParentSettings') },
                { icon: 'award',  title: 'Subscription',          sub: 'View your plan & billing',      action: () => navigation.navigate('ParentSubscription') },
              ].map((tile) => (
                <TouchableOpacity key={tile.title} style={styles.secTile} activeOpacity={0.75} onPress={tile.action}>
                  <View style={styles.secTileIcon}>
                    <Feather name={tile.icon as any} size={16} color={colors.accentYellow} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.secTileTitle}>{tile.title}</Text>
                    <Text style={styles.secTileSub}>{tile.sub}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textDim} />
                </TouchableOpacity>
              ))}
            </View>
          </View>

        </ScrollView>
      </View>

      {/* Change Password Modal */}
      <Modal visible={passModalVisible} transparent animationType="fade" onRequestClose={() => setPassModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <TouchableOpacity onPress={() => setPassModalVisible(false)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {passSuccess ? (
              <View style={{ alignItems: 'center', paddingVertical: 24, gap: 12 }}>
                <Feather name="check-circle" size={48} color={colors.accentGreen} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textMain }}>Password Updated!</Text>
                <Text style={{ fontSize: 13, color: colors.textMuted }}>Your password has been changed successfully.</Text>
              </View>
            ) : (
              <>
                <Text style={styles.modalLabel}>Current Password</Text>
                <TextInput style={styles.modalInput} value={currentPass} onChangeText={setCurrentPass}
                  placeholder="Enter current password" placeholderTextColor={colors.textDim} secureTextEntry />
                <Text style={styles.modalLabel}>New Password</Text>
                <TextInput style={styles.modalInput} value={newPass} onChangeText={setNewPass}
                  placeholder="At least 6 characters" placeholderTextColor={colors.textDim} secureTextEntry />
                <Text style={styles.modalLabel}>Confirm New Password</Text>
                <TextInput style={styles.modalInput} value={confirmPass} onChangeText={setConfirmPass}
                  placeholder="Re-enter new password" placeholderTextColor={colors.textDim} secureTextEntry />
                {passError ? <Text style={{ color: '#ef4444', fontSize: 13 }}>{passError}</Text> : null}
                <TouchableOpacity style={styles.saveBtn} onPress={handleChangePassword} disabled={passLoading} activeOpacity={0.85}>
                  <Text style={styles.saveBtnText}>{passLoading ? 'Updating...' : 'Update Password'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>Full Name</Text>
            <TextInput style={styles.modalInput} value={editName} onChangeText={setEditName}
              placeholder="Your full name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
            <Text style={styles.modalLabel}>Email Address</Text>
            <View style={[styles.modalInput, { justifyContent: 'center', opacity: 0.5 }]}>
              <Text style={{ fontSize: 14, color: colors.textMain }}>{email}</Text>
            </View>
            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: -8 }}>Email cannot be changed</Text>
            <Text style={styles.modalLabel}>Contact Number</Text>
            <TextInput style={styles.modalInput} value={editPhone} onChangeText={setEditPhone}
              placeholder="e.g. +91 98765 43210" placeholderTextColor={colors.textDim} keyboardType="phone-pad" />
            <Text style={styles.modalLabel}>City</Text>
            <TextInput style={styles.modalInput} value={editCity} onChangeText={setEditCity}
              placeholder="e.g. Hyderabad" placeholderTextColor={colors.textDim} />
            <TouchableOpacity style={styles.saveBtn} onPress={saveEdit} disabled={saving} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },

  // ── Hero ──
  heroCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.lg, gap: 16, flexWrap: 'wrap',
  },
  heroLeft: { flexDirection: 'row', alignItems: 'center', gap: 18, flexShrink: 1 },
  heroAvatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: c.accentYellow + '18', borderWidth: 3, borderColor: c.accentYellow,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  heroAvatarText: { fontSize: 32, fontWeight: '700', fontFamily: fonts.serif, color: c.accentYellow },
  avatarEditBadge: {
    position: 'absolute', bottom: 2, right: 2, width: 24, height: 24, borderRadius: 12,
    backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.cardDark,
  },
  heroWelcome: { fontSize: 13, fontFamily: fonts.sans, color: c.textMuted },
  heroName: { fontSize: 26, fontWeight: '700', fontFamily: fonts.serif, color: c.textMain },
  heroTags: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  heroTag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: c.accentGreen + '40', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  heroTagText: { fontSize: 11, fontWeight: '600', fontFamily: fonts.sans },

  // Quote panel
  heroQuote: {
    flex: 1, minWidth: 180, backgroundColor: c.cardDark, borderRadius: 14,
    borderWidth: 1, borderColor: c.accentYellow + '30',
    padding: 18, gap: 4, justifyContent: 'center',
  },
  quoteGlyph: { fontSize: 28, color: c.accentYellow, lineHeight: 28, fontFamily: fonts.serif },
  quoteText: { fontSize: 15, color: c.textMain, lineHeight: 22, fontFamily: fonts.serif },
  quoteHighlight: { color: c.accentYellow, fontWeight: '700', fontFamily: fonts.serif },
  sparkleRow: { flexDirection: 'row', gap: 6, marginTop: 6, alignItems: 'center' },
  sparkleDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.accentYellow + '70' },

  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: c.accentYellow, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 999, flexShrink: 0,
  },
  editBtnText: { fontSize: 14, fontWeight: '700', fontFamily: fonts.sans, color: '#0B0B0B' },

  // ── Two-col layout ──
  twoCol: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  card: {
    flex: 1, minWidth: 280,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '700', fontFamily: fonts.serif, color: c.textMain },
  weekBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  weekBadgeText: { fontSize: 11, fontWeight: '600', fontFamily: fonts.sans, color: c.textMuted },

  // Profile info rows
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 140, flexShrink: 0 },
  infoLabel: { fontSize: 13, fontFamily: fonts.sans, color: c.textMuted },
  infoValue: { flex: 1, fontSize: 14, fontFamily: fonts.sans, color: c.textMain, fontWeight: '500' },

  // Stats grid in activity
  statsGrid: {
    flexDirection: 'row', borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.lg,
  },
  statCell: { flex: 1, padding: 14, alignItems: 'center', gap: 4 },
  statDividerV: { width: 1, backgroundColor: c.borderColor },
  statBig: { fontSize: 22, fontWeight: '800', fontFamily: fonts.serif, color: c.textMain },
  statSmallLabel: { fontSize: 9, fontFamily: fonts.sans, color: c.textDim, fontWeight: '700', letterSpacing: 0.6, textAlign: 'center' },

  chartLabel: { fontSize: 12, fontFamily: fonts.sans, color: c.textMuted, marginBottom: 12 },
  miniChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 130 },
  miniBarWrap: { flex: 1, alignItems: 'center', gap: 6 },
  miniBarTrack: { width: 22, height: 100, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 11, justifyContent: 'flex-end', overflow: 'hidden' },
  miniBarFill: { width: '100%', borderRadius: 11 },
  miniBarLabel: { fontSize: 10, fontFamily: fonts.sans, color: c.textDim },

  // Security section
  secHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.lg },
  secSub: { fontSize: 11, fontFamily: fonts.sans, color: c.textMuted, marginTop: 2 },
  changePassBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: c.accentYellow + '50', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: 4,
  },
  changePassText: { fontSize: 12, fontWeight: '600', fontFamily: fonts.sans, color: c.accentYellow },

  secTilesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  secTile: {
    flex: 1, minWidth: 180, flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 14, padding: 14,
  },
  secTileIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: c.accentYellow + '15', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  secTileTitle: { fontSize: 13, fontWeight: '700', fontFamily: fonts.sans, color: c.textMain },
  secTileSub: { fontSize: 11, fontFamily: fonts.sans, color: c.textMuted },

  // Children list
  childRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.borderColor },
  childDot: { width: 8, height: 8, borderRadius: 4 },
  childRowName: { fontSize: 13, fontWeight: '600', fontFamily: fonts.sans, color: c.textMain },
  childRowGrade: { fontSize: 11, fontFamily: fonts.sans, color: c.textMuted },
  childStatus: { fontSize: 11, fontWeight: '600', fontFamily: fonts.sans },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: {
    width: '100%', maxWidth: 440,
    backgroundColor: c.cardDark, borderRadius: 20, borderWidth: 1,
    borderColor: c.accentYellow + '30', padding: spacing.xl, gap: spacing.md,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  modalTitle: { fontSize: 17, fontWeight: '700', fontFamily: fonts.serif, color: c.textMain },
  modalLabel: { fontSize: 11, fontWeight: '700', fontFamily: fonts.sans, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: {
    height: 46, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.accentYellow + '25',
    borderRadius: 12, paddingHorizontal: spacing.md, fontSize: 14, fontFamily: fonts.sans, color: c.textMain,
  },
  saveBtn: { backgroundColor: c.accentYellow, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { fontSize: 15, fontWeight: '700', fontFamily: fonts.sans, color: '#0B0B0B' },
});
