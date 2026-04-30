import React, { useMemo, useState, useEffect } from 'react';
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
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function InfoField({ label, value, styles }: { label: string; value: string; styles: any }) {
  return (
    <View style={styles.infoField}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValueBox}>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
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
    if (!newPass || newPass.length < 6) { setPassError('New password must be at least 6 characters.'); return; }
    if (newPass !== confirmPass) { setPassError('Passwords do not match.'); return; }
    setPassLoading(true); setPassError('');
    try {
      const firebaseAuth = getAuth();
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) throw new Error('Not logged in');
      const credential = EmailAuthProvider.credential(email, currentPass);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPass);
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

  useEffect(() => {
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

  const maxActivity = Math.max(...weeklyActivity, 1);
  const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const totalStudyH = (weeklyActivity.reduce((a,b) => a+b, 0) / 60).toFixed(1);
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

          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.heroLeft}>
              <TouchableOpacity style={styles.heroAvatar} onPress={pickPhoto} activeOpacity={0.8}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={{ width: 72, height: 72, borderRadius: 36 }} />
                ) : (
                  <Text style={styles.heroAvatarText}>{firstName[0] || 'P'}</Text>
                )}
                <View style={styles.avatarEditBadge}>
                  <Feather name="camera" size={10} color="#fff" />
                </View>
              </TouchableOpacity>
              <View>
                <Text style={styles.heroWelcome}>Welcome,</Text>
                <Text style={styles.heroName}>{user?.name ?? 'Sarah Richardson'}</Text>
                <View style={styles.heroTags}>
                  <View style={[styles.heroTag, { backgroundColor: colors.accentGreen + '18', borderColor: colors.accentGreen + '33' }]}>
                    <Feather name="check-circle" size={11} color={colors.accentGreen} />
                    <Text style={[styles.heroTagText, { color: colors.accentGreen }]}>Verified Account</Text>
                  </View>
                  <View style={[styles.heroTag, { backgroundColor: colors.accentYellow + '18', borderColor: colors.accentYellow + '33' }]}>
                    <Feather name="star" size={11} color={colors.accentYellow} />
                    <Text style={[styles.heroTagText, { color: colors.accentYellow }]}>Premium Member</Text>
                  </View>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.editBtn} activeOpacity={0.8} onPress={openEdit}>
              <Feather name="edit-2" size={13} color="white" />
              <Text style={styles.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.twoCol}>
            {/* Profile Info */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Feather name="user" size={16} color={colors.primary} />
                <Text style={styles.cardTitle}>Profile Information</Text>
              </View>
              <View style={styles.infoGrid}>
                <InfoField label="First Name" value={firstName || '—'} styles={styles} />
                <InfoField label="Last Name" value={lastName || '—'} styles={styles} />
                <InfoField label="Email Address" value={email || '—'} styles={styles} />
                <InfoField label="Contact Number" value={phone || '—'} styles={styles} />
                <InfoField label="City" value={city || '—'} styles={styles} />
              </View>
            </View>

            {/* Activity Overview */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Feather name="activity" size={16} color={colors.accentGreen} />
                <Text style={styles.cardTitle}>Activity Overview</Text>
                <View style={styles.weekBadge}><Text style={styles.weekBadgeText}>This Week</Text></View>
              </View>
              <View style={styles.overviewStats}>
                <View style={styles.overviewStat}>
                  <Text style={[styles.overviewValue, { color: colors.primary }]}>{Math.round((activeDays / 7) * 100)}%</Text>
                  <Text style={styles.overviewLabel}>ACTIVE DAYS</Text>
                </View>
                <View style={styles.overviewStat}>
                  <Text style={[styles.overviewValue, { color: colors.textMain }]}>{totalStudyH}h</Text>
                  <Text style={styles.overviewLabel}>TOTAL LEARNING</Text>
                </View>
                <View style={styles.overviewStat}>
                  <Text style={[styles.overviewValue, { color: colors.accentGreen }]}>{children.length} kids</Text>
                  <Text style={styles.overviewLabel}>LINKED</Text>
                </View>
              </View>
              <Text style={styles.chartLabel}>Day-wise Time Spent</Text>
              <View style={styles.miniChart}>
                {WEEK_DAYS.map((d, i) => {
                  const h = maxActivity > 0 ? Math.max(4, (weeklyActivity[i] / maxActivity) * 64) : 4;
                  const isToday = i === todayIdx;
                  return (
                    <View key={d} style={styles.miniBarWrap}>
                      <View style={styles.miniBarTrack}>
                        <View style={[styles.miniBarFill, { height: h, backgroundColor: isToday ? colors.primary : colors.textDim + '40' }]} />
                      </View>
                      <Text style={[styles.miniBarLabel, isToday && { color: colors.primary, fontWeight: '700' }]}>{d}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Security */}
          <View style={[styles.card, { marginTop: spacing.lg }]}>
            <View style={styles.cardHeader}>
              <Feather name="lock" size={16} color={colors.accentRed} />
              <Text style={styles.cardTitle}>Security & Account</Text>
              <TouchableOpacity style={styles.changePassBtn} onPress={openPassModal}>
                <Text style={styles.changePassText}>Change Password</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.securityRow, { opacity: 0.5 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.secTitle}>Two-Factor Authentication</Text>
                <Text style={styles.secSub}>Coming soon</Text>
              </View>
              <View style={[styles.comingSoonBadge, { backgroundColor: '#F59E0B22' }]}>
                <Text style={[styles.comingSoonText, { color: '#F59E0B' }]}>Soon</Text>
              </View>
            </View>
          </View>

          {/* Linked Children */}
          <View style={[styles.card, { marginTop: spacing.lg }]}>
            <View style={styles.cardHeader}>
              <Feather name="users" size={16} color={colors.accentBlue} />
              <Text style={styles.cardTitle}>Linked Children</Text>
              <TouchableOpacity onPress={() => navigation.navigate('ParentMyKids')}>
                <Text style={[styles.changePassText, { color: colors.accentGreen }]}>+ Add Child</Text>
              </TouchableOpacity>
            </View>
            {childrenLoading ? (
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
            ) : children.length === 0 ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: colors.textMuted }}>No children linked yet.</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                {children.map(ch => {
                  const isOnTrack = (ch.currentStreak ?? 0) >= 3;
                  const statusLabel = isOnTrack ? 'Active' : 'Needs Attention';
                  const dotColor = isOnTrack ? colors.accentGreen : colors.accentYellow;
                  return (
                    <View key={ch.id} style={styles.childRow}>
                      <View style={[styles.childDot, { backgroundColor: dotColor }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.childRowName}>{ch.name}</Text>
                        <Text style={styles.childRowGrade}>{ch.grade} · {ch.xpPoints ?? 0} XP</Text>
                      </View>
                      <Text style={[styles.childStatus, { color: dotColor }]}>{statusLabel}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
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

  heroCard: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: c.primary + '30',
    borderWidth: 3,
    borderColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarText: { fontSize: 28, fontWeight: '700', color: c.primary },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.cardDark },
  heroWelcome: { fontSize: 13, color: c.textMuted },
  heroName: { fontSize: 22, fontWeight: '700', color: c.textMain, marginBottom: 8 },
  heroTags: { flexDirection: 'row', gap: spacing.sm },
  heroTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  heroTagText: { fontSize: 10, fontWeight: '600' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.md },
  editBtnText: { fontSize: 13, fontWeight: '700', color: 'white' },

  twoCol: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  card: {
    flex: 1,
    minWidth: 280,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: c.textMain },
  weekBadge: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  weekBadgeText: { fontSize: 10, fontWeight: '600', color: c.textMuted },

  infoGrid: { gap: spacing.md },
  infoField: {},
  infoLabel: { fontSize: 11, color: c.textMuted, marginBottom: 4 },
  infoValueBox: { backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  infoValue: { fontSize: 14, color: c.textMain },

  overviewStats: { flexDirection: 'row', marginBottom: spacing.xl },
  overviewStat: { flex: 1 },
  overviewValue: { fontSize: 22, fontWeight: '700' },
  overviewLabel: { fontSize: 9, color: c.textDim, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  chartLabel: { fontSize: 11, color: c.textMuted, marginBottom: spacing.md },
  miniChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 80 },
  miniBarWrap: { flex: 1, alignItems: 'center', gap: 4 },
  miniBarTrack: { width: 18, height: 64, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 9, justifyContent: 'flex-end', overflow: 'hidden' },
  miniBarFill: { width: '100%', borderRadius: 9 },
  miniBarLabel: { fontSize: 9, color: c.textDim },

  changePassBtn: { backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5 },
  changePassText: { fontSize: 11, fontWeight: '600', color: c.textMuted },
  securityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  comingSoonBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  comingSoonText: { fontSize: 11, fontWeight: '600' },
  secTitle: { fontSize: 14, fontWeight: '600', color: c.textMain },
  secSub: { fontSize: 11, color: c.textMuted, marginTop: 2 },

  childRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.borderColor, flexShrink: 0 },
  childDot: { width: 8, height: 8, borderRadius: 4 },
  childRowName: { fontSize: 13, fontWeight: '600', color: c.textMain },
  childRowGrade: { fontSize: 11, color: c.textMuted },
  childStatus: { fontSize: 11, fontWeight: '600' },

  // Edit modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 440, backgroundColor: c.cardDark, borderRadius: radius.xl, borderWidth: 1, borderColor: c.borderColor, padding: spacing.xl, gap: spacing.md },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalLabel: { fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: { height: 46, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 14, color: c.textMain },
  saveBtn: { backgroundColor: c.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
