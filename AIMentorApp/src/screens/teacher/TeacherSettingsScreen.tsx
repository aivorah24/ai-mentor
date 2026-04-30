import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Switch, Modal, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { auth } from '../../config/firebase';
import SERVER_URL from '../../config/serverUrl';

type ModalType = 'name' | 'email' | 'password' | 'school' | 'curriculum' | null;

export default function TeacherSettingsScreen({ navigation }: any) {
  const { user, updateUser, logout, switchRole } = useAuth();
  const { colors, themeMode, setThemeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Notifications
  const [submissionAlerts,  setSubmissionAlerts]  = useState(true);
  const [parentMessages,    setParentMessages]    = useState(true);
  const [weeklyReport,      setWeeklyReport]      = useState(true);
  const [aiInsights,        setAiInsights]        = useState(true);
  const [challengeAlerts,   setChallengeAlerts]   = useState(false);

  // Teaching prefs
  const [autoGrading,       setAutoGrading]       = useState(true);
  const [shareProgress,     setShareProgress]     = useState(true);

  const isDualRole = (user?.roles?.length ?? 0) > 1;

  // Parent onboarding modal state
  const [parentModal,   setParentModal]   = useState(false);
  const [parentStep,    setParentStep]    = useState<'choose' | 'create' | 'link'>('choose');
  const [parentLoading, setParentLoading] = useState(false);
  const [parentError,   setParentError]   = useState('');
  const [childName,       setChildName]       = useState('');
  const [childEmail,      setChildEmail]      = useState('');
  const [childPassword,   setChildPassword]   = useState('');
  const [childGrade,      setChildGrade]      = useState('Grade 3');
  const [childCurriculum, setChildCurriculum] = useState('IB PYP');
  const [linkEmail, setLinkEmail] = useState('');

  // Edit modals
  const [activeModal,   setActiveModal]   = useState<ModalType>(null);
  const [modalLoading,  setModalLoading]  = useState(false);
  const [modalError,    setModalError]    = useState('');
  const [newName,       setNewName]       = useState(user?.name || '');
  const [newEmail,      setNewEmail]      = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPw,     setCurrentPw]    = useState('');
  const [newPw,         setNewPw]        = useState('');
  const [confirmPw,     setConfirmPw]    = useState('');
  const [showCurrent,   setShowCurrent]  = useState(false);
  const [showNew,       setShowNew]      = useState(false);
  const [newSchool,     setNewSchool]    = useState(user?.school || '');
  const [editCurriculum, setEditCurriculum] = useState(user?.curriculum || 'IB PYP');
  const [editGrade,     setEditGrade]    = useState(user?.grade || 'Grade 3');

  // Feedback + sign-out confirm (replaces Alert.alert on web)
  const [feedback,       setFeedback]       = useState<{ title: string; message: string } | null>(null);
  const [signOutConfirm, setSignOutConfirm] = useState(false);

  function openModal(type: ModalType) {
    setNewName(user?.name || '');
    setNewEmail(''); setEmailPassword('');
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    setNewSchool(user?.school || '');
    setEditCurriculum(user?.curriculum || 'IB PYP');
    setEditGrade(user?.grade || 'Grade 3');
    setModalError('');
    setActiveModal(type);
  }
  function closeModal() { setActiveModal(null); setModalLoading(false); setModalError(''); }

  async function handleSaveName() {
    if (!newName.trim()) { setModalError('Please enter a name.'); return; }
    setModalLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, name: newName.trim() }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save'); }
      updateUser({ name: newName.trim() });
      closeModal();
      setFeedback({ title: 'Updated', message: 'Your display name has been updated.' });
    } catch (e: any) {
      setModalError(e.message || 'Failed to update name.');
    } finally { setModalLoading(false); }
  }

  async function handleSaveSchool() {
    setModalLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, school: newSchool.trim() }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save'); }
      updateUser({ school: newSchool.trim() });
      closeModal();
      setFeedback({ title: 'Updated', message: 'School / Institution has been saved.' });
    } catch (e: any) {
      setModalError(e.message || 'Failed to update school.');
    } finally { setModalLoading(false); }
  }

  async function handleSaveCurriculum() {
    setModalLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, curriculum: editCurriculum, grade: editGrade }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save'); }
      updateUser({ curriculum: editCurriculum, grade: editGrade });
      closeModal();
      setFeedback({ title: 'Updated', message: 'Curriculum and grade have been saved.' });
    } catch (e: any) {
      setModalError(e.message || 'Failed to update curriculum.');
    } finally { setModalLoading(false); }
  }

  async function handleChangePassword() {
    if (!currentPw) { setModalError('Enter your current password.'); return; }
    if (newPw.length < 6) { setModalError('New password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw) { setModalError('Passwords do not match.'); return; }
    setModalLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, currentPw);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updatePassword(firebaseUser, newPw);
      }
      closeModal();
      setFeedback({ title: 'Password Changed', message: 'Your password has been updated successfully.' });
    } catch (e: any) {
      setModalError(e.message || 'Failed to change password.');
    } finally { setModalLoading(false); }
  }

  function openParentOnboarding() {
    setParentStep('choose');
    setParentError('');
    setChildName(''); setChildEmail(''); setChildPassword('');
    setChildGrade('Grade 3'); setChildCurriculum('IB PYP');
    setLinkEmail('');
    setParentModal(true);
  }

  async function submitParentOnboarding() {
    if (!user?.email) return;
    setParentLoading(true);
    setParentError('');
    try {
      const roleRes = await fetch(`${SERVER_URL}/user/add-role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, role: 'parent' }),
      });
      if (!roleRes.ok) throw new Error('Failed to add parent role');
      const roleData = await roleRes.json();

      if (parentStep === 'create') {
        if (!childName.trim()) {
          setParentError('Child\'s name is required.'); setParentLoading(false); return;
        }
        const r = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children/create-student`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: childName.trim(), email: childEmail.trim() || undefined, password: childPassword.trim() || undefined, grade: childGrade, curriculum: childCurriculum, school: user.school || '' }),
        });
        const d = await r.json();
        if (!r.ok) { setParentError(d.error || 'Could not create student account.'); setParentLoading(false); return; }
      } else if (parentStep === 'link') {
        if (!linkEmail.trim()) { setParentError('Please enter the student email.'); setParentLoading(false); return; }
        const r = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ childEmail: linkEmail.trim() }),
        });
        const d = await r.json();
        if (!r.ok) { setParentError(d.error || 'Could not link student.'); setParentLoading(false); return; }
      }

      updateUser({ roles: roleData.roles as any });
      setParentModal(false);
      setFeedback({ title: 'Parent Profile Ready', message: "Switch to your Parent profile from the sidebar to view your child's progress and assign work." });
    } catch (e: any) {
      setParentError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setParentLoading(false);
    }
  }

  function handleSignOut() {
    setSignOutConfirm(true);
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Settings"
          subtitle="Manage your preferences and account"
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── Profile ── */}
          <SectionHeader icon="user" label="Profile & Account" color={colors.primary} styles={styles} />
          <View style={styles.card}>
            <View style={styles.profileRow}>
              <View style={styles.avatarBig}>
                <Text style={styles.avatarInitial}>{user?.name ? user.name[0].toUpperCase() : 'T'}</Text>
                <View style={styles.avatarCam}>
                  <Feather name="camera" size={11} color="white" />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{user?.name || 'Teacher'}</Text>
                <Text style={styles.profileSub}>{user?.email || ''}</Text>
                <View style={styles.profileMeta}>
                  <View style={styles.roleBadge}>
                    <Feather name="briefcase" size={10} color={colors.primary} />
                    <Text style={styles.roleBadgeText}>Teacher</Text>
                  </View>
                  {user?.school ? (
                    <View style={[styles.roleBadge, { backgroundColor: colors.accentGreen + '15', borderColor: colors.accentGreen + '30' }]}>
                      <Feather name="home" size={10} color={colors.accentGreen} />
                      <Text style={[styles.roleBadgeText, { color: colors.accentGreen }]}>{user.school}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
            <View style={styles.divider} />
            <FieldRow label="Display Name" sub={user?.name || '—'} btnLabel="Change" onPress={() => openModal('name')} styles={styles} />
            <View style={styles.divider} />
            <FieldRow label="Email Address" sub={user?.email || '—'} btnLabel="Change" onPress={() => openModal('email')} styles={styles} />
            <View style={styles.divider} />
            <FieldRow label="School / Institution" sub={user?.school || 'Not set'} btnLabel="Update" onPress={() => openModal('school')} styles={styles} />
            <View style={styles.divider} />
            {/* Add Parent Profile */}
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Parent Profile</Text>
                <Text style={styles.fieldSub}>
                  {isDualRole
                    ? 'You have a parent profile — switch from the sidebar'
                    : 'Add a parent profile to monitor your child\'s learning'}
                </Text>
              </View>
              {isDualRole ? (
                <View style={[styles.comingSoonBadge, { backgroundColor: colors.accentGreen + '18', borderColor: colors.accentGreen + '40' }]}>
                  <Text style={[styles.comingSoonText, { color: colors.accentGreen }]}>Active</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.changeBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40', borderWidth: 1 }]}
                  onPress={openParentOnboarding}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.changeBtnText, { color: colors.primary }]}>Add</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── Security ── */}
          <SectionHeader icon="shield" label="Security" color={colors.accentGreen} styles={styles} />
          <View style={styles.card}>
            <FieldRow label="Password" sub="Change your account password" btnLabel="Change" onPress={() => openModal('password')} styles={styles} />
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Two-Factor Auth</Text>
                <Text style={styles.fieldSub}>Add an extra layer of security</Text>
              </View>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>Soon</Text>
              </View>
            </View>
          </View>

          {/* ── Teaching Preferences ── */}
          <SectionHeader icon="settings" label="Teaching Preferences" color={colors.accentBlue} styles={styles} />
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>AI Auto-Grading</Text>
                <Text style={styles.fieldSub}>Let AI grade assignments automatically</Text>
              </View>
              <Switch value={autoGrading} onValueChange={setAutoGrading} trackColor={{ false: colors.borderColor, true: colors.primary }} thumbColor="white" />
            </View>
            <View style={styles.divider} />
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Share Progress with Parents</Text>
                <Text style={styles.fieldSub}>Parents can see their child's scores and activity</Text>
              </View>
              <Switch value={shareProgress} onValueChange={setShareProgress} trackColor={{ false: colors.borderColor, true: colors.primary }} thumbColor="white" />
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Curriculum</Text>
                <Text style={styles.fieldSub}>{user?.curriculum || 'IB PYP'} · Grade {user?.grade?.replace('Grade ', '') || '3'}</Text>
              </View>
              <TouchableOpacity style={styles.changeBtn} onPress={() => openModal('curriculum')} activeOpacity={0.7}>
                <Text style={styles.changeBtnText}>Update</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Notifications ── */}
          <SectionHeader icon="bell" label="Notifications" color={colors.accentYellow} styles={styles} />
          <View style={styles.card}>
            {[
              { label: 'Assignment Submissions', sub: 'When a student submits work', val: submissionAlerts, set: setSubmissionAlerts },
              { label: 'Parent Messages', sub: 'New messages from parents', val: parentMessages, set: setParentMessages },
              { label: 'Weekly Class Report', sub: 'Summary of class activity each week', val: weeklyReport, set: setWeeklyReport },
              { label: 'AI Class Insights', sub: 'Smart suggestions for your class', val: aiInsights, set: setAiInsights },
              { label: 'Challenge Activity', sub: 'Student challenge completions and rankings', val: challengeAlerts, set: setChallengeAlerts },
            ].map((item, i) => (
              <View key={item.label}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{item.label}</Text>
                    <Text style={styles.fieldSub}>{item.sub}</Text>
                  </View>
                  <Switch value={item.val} onValueChange={item.set} trackColor={{ false: colors.borderColor, true: colors.primary }} thumbColor="white" />
                </View>
              </View>
            ))}
          </View>

          {/* ── Appearance ── */}
          <SectionHeader icon="moon" label="Appearance" color={colors.accentPurple} styles={styles} />
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Theme</Text>
            <View style={styles.themeRow}>
              {([
                { id: 'dark', icon: 'moon', label: 'Dark' },
                { id: 'light', icon: 'sun', label: 'Light' },
                { id: 'auto', icon: 'monitor', label: 'Auto' },
              ] as const).map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.themeOption, themeMode === t.id && styles.themeOptionActive]}
                  onPress={() => setThemeMode(t.id)}
                  activeOpacity={0.7}
                >
                  <Feather name={t.icon} size={16} color={themeMode === t.id ? colors.primary : colors.textMuted} />
                  <Text style={[styles.themeLabel, themeMode === t.id && { color: colors.primary }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Account Actions ── */}
          <SectionHeader icon="alert-triangle" label="Account Actions" color={colors.accentRed} styles={styles} />
          <View style={styles.card}>
            <TouchableOpacity style={styles.dangerRow} onPress={handleSignOut} activeOpacity={0.7}>
              <Feather name="log-out" size={16} color={colors.accentRed} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: colors.accentRed }]}>Sign Out</Text>
                <Text style={styles.fieldSub}>You will be returned to the login screen</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.accentRed} />
            </TouchableOpacity>
          </View>

          <Text style={styles.versionText}>Aivorah v1.0.0 · NuShift</Text>
        </ScrollView>
      </View>

      {/* Change Name Modal */}
      <AppModal visible={activeModal === 'name'} title="Change Display Name" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>New Name</Text>
        <View style={styles.modalInput}>
          <Feather name="user" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={newName} onChangeText={setNewName}
            placeholder="Your name" placeholderTextColor={colors.textDim}
            autoCapitalize="words" autoFocus
          />
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleSaveName} loading={modalLoading} styles={styles} />
      </AppModal>

      {/* Change Email Modal */}
      <AppModal visible={activeModal === 'email'} title="Change Email Address" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalNote}>Enter your new email and current password to confirm.</Text>
        <Text style={styles.modalFieldLabel}>New Email</Text>
        <View style={styles.modalInput}>
          <Feather name="mail" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={newEmail} onChangeText={setNewEmail}
            placeholder="new@example.com" placeholderTextColor={colors.textDim}
            keyboardType="email-address" autoCapitalize="none" autoFocus
          />
        </View>
        <Text style={styles.modalFieldLabel}>Current Password</Text>
        <View style={styles.modalInput}>
          <Feather name="lock" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={emailPassword} onChangeText={setEmailPassword}
            placeholder="••••••••" placeholderTextColor={colors.textDim} secureTextEntry
          />
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons
          onCancel={closeModal}
          onSave={async () => {
            if (!newEmail.trim() || !emailPassword) { setModalError('Fill in all fields.'); return; }
            setModalLoading(true);
            try {
              const fu = auth.currentUser;
              if (fu && fu.email) {
                const cred = EmailAuthProvider.credential(fu.email, emailPassword);
                await reauthenticateWithCredential(fu, cred);
              }
              updateUser({ email: newEmail.trim() });
              closeModal();
              setFeedback({ title: 'Email Updated', message: 'Your email address has been changed.' });
            } catch (e: any) {
              setModalError(e.message || 'Failed to update email.');
            } finally { setModalLoading(false); }
          }}
          loading={modalLoading} saveLabel="Update Email" styles={styles}
        />
      </AppModal>

      {/* Change Password Modal */}
      <AppModal visible={activeModal === 'password'} title="Change Password" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>Current Password</Text>
        <View style={styles.modalInput}>
          <Feather name="lock" size={15} color={colors.textDim} />
          <TextInput
            style={[styles.modalTextInput, { flex: 1 }]} value={currentPw} onChangeText={setCurrentPw}
            placeholder="••••••••" placeholderTextColor={colors.textDim} secureTextEntry={!showCurrent} autoFocus
          />
          <TouchableOpacity onPress={() => setShowCurrent(!showCurrent)}>
            <Feather name={showCurrent ? 'eye-off' : 'eye'} size={15} color={colors.textDim} />
          </TouchableOpacity>
        </View>
        <Text style={styles.modalFieldLabel}>New Password</Text>
        <View style={styles.modalInput}>
          <Feather name="lock" size={15} color={colors.textDim} />
          <TextInput
            style={[styles.modalTextInput, { flex: 1 }]} value={newPw} onChangeText={setNewPw}
            placeholder="Min. 6 characters" placeholderTextColor={colors.textDim} secureTextEntry={!showNew}
          />
          <TouchableOpacity onPress={() => setShowNew(!showNew)}>
            <Feather name={showNew ? 'eye-off' : 'eye'} size={15} color={colors.textDim} />
          </TouchableOpacity>
        </View>
        <Text style={styles.modalFieldLabel}>Confirm New Password</Text>
        <View style={styles.modalInput}>
          <Feather name="check" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={confirmPw} onChangeText={setConfirmPw}
            placeholder="Repeat new password" placeholderTextColor={colors.textDim} secureTextEntry
          />
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleChangePassword} loading={modalLoading} saveLabel="Change Password" styles={styles} />
      </AppModal>

      {/* School Modal */}
      <AppModal visible={activeModal === 'school'} title="School / Institution" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>School Name</Text>
        <View style={styles.modalInput}>
          <Feather name="home" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={newSchool} onChangeText={setNewSchool}
            placeholder="e.g. DPS Hyderabad" placeholderTextColor={colors.textDim}
            autoCapitalize="words" autoFocus
          />
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleSaveSchool} loading={modalLoading} saveLabel="Save" styles={styles} />
      </AppModal>

      {/* Curriculum Modal */}
      <AppModal visible={activeModal === 'curriculum'} title="Curriculum & Grade" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>Curriculum</Text>
        {(['IB PYP', 'NCERT', 'CBSE'] as const).map(c => (
          <TouchableOpacity
            key={c} activeOpacity={0.8}
            style={[styles.modalInput, { height: 46, marginBottom: 6, justifyContent: 'space-between', borderColor: editCurriculum === c ? colors.primary : colors.borderColor, backgroundColor: editCurriculum === c ? colors.primaryGlow : colors.bgDark }]}
            onPress={() => setEditCurriculum(c)}
          >
            <Text style={[styles.modalTextInput, { flex: 0, color: editCurriculum === c ? colors.primary : colors.textMuted }]}>{c}</Text>
            {editCurriculum === c && <Feather name="check" size={15} color={colors.primary} />}
          </TouchableOpacity>
        ))}
        <Text style={[styles.modalFieldLabel, { marginTop: 12 }]}>Grade</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          {(['Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'] as const).map(g => (
            <TouchableOpacity
              key={g} activeOpacity={0.8}
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: editGrade === g ? colors.primary : colors.borderColor, backgroundColor: editGrade === g ? colors.primaryGlow : 'transparent' }}
              onPress={() => setEditGrade(g)}
            >
              <Text style={{ fontSize: 13, color: editGrade === g ? colors.primary : colors.textMuted, fontWeight: '600' }}>{g}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleSaveCurriculum} loading={modalLoading} saveLabel="Save" styles={styles} />
      </AppModal>

      {/* ── Parent Profile Onboarding Modal ── */}
      <Modal visible={parentModal} transparent animationType="fade" onRequestClose={() => setParentModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxWidth: 480 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accentGreen + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="home" size={16} color={colors.accentGreen} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Add Parent Profile</Text>
                  <Text style={[styles.fieldSub, { marginTop: 0 }]}>Monitor your child's learning on Aivorah</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setParentModal(false)}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
            </View>

            {parentStep === 'choose' && (
              <View style={{ gap: 12, marginTop: 8 }}>
                <Text style={[styles.fieldLabel, { marginBottom: 4 }]}>How would you like to add your child?</Text>
                <TouchableOpacity
                  style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }]}
                  onPress={() => setParentStep('create')} activeOpacity={0.8}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '20', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="user-plus" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Create new student account</Text>
                    <Text style={styles.fieldSub}>My child doesn't have an Aivorah account yet</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textDim} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }]}
                  onPress={() => setParentStep('link')} activeOpacity={0.8}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentBlue + '20', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="link" size={18} color={colors.accentBlue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Link existing account</Text>
                    <Text style={styles.fieldSub}>My child already has an Aivorah student account</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textDim} />
                </TouchableOpacity>
              </View>
            )}

            {parentStep === 'create' && (
              <View style={{ gap: 10, marginTop: 8 }}>
                <TouchableOpacity onPress={() => setParentStep('choose')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Feather name="arrow-left" size={14} color={colors.textMuted} />
                  <Text style={[styles.fieldSub, { color: colors.textMuted }]}>Back</Text>
                </TouchableOpacity>
                <Text style={styles.fieldLabel}>Child's Full Name *</Text>
                <TextInput style={styles.modalTextInput} value={childName} onChangeText={setChildName} placeholder="e.g. Arjun" placeholderTextColor={colors.textDim} autoCapitalize="words" />
                <Text style={styles.fieldLabel}>Child's Email <Text style={{ fontWeight: '400', color: colors.textDim }}>(optional)</Text></Text>
                <TextInput style={styles.modalTextInput} value={childEmail} onChangeText={setChildEmail} placeholder="Leave blank to auto-generate" placeholderTextColor={colors.textDim} keyboardType="email-address" autoCapitalize="none" />
                <Text style={styles.fieldLabel}>Password <Text style={{ fontWeight: '400', color: colors.textDim }}>(optional)</Text></Text>
                <TextInput style={styles.modalTextInput} value={childPassword} onChangeText={setChildPassword} placeholder="Leave blank to auto-generate" placeholderTextColor={colors.textDim} secureTextEntry />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Grade</Text>
                    {(['Grade 3','Grade 4','Grade 5','Grade 6'] as const).map(g => (
                      <TouchableOpacity key={g} onPress={() => setChildGrade(g)} activeOpacity={0.8}
                        style={[styles.modalTextInput, { marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderColor: childGrade === g ? colors.primary : colors.borderColor }]}
                      >
                        <Text style={[styles.fieldSub, { color: childGrade === g ? colors.primary : colors.textMuted }]}>{g}</Text>
                        {childGrade === g && <Feather name="check" size={13} color={colors.primary} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Curriculum</Text>
                    {(['IB PYP','NCERT','CBSE'] as const).map(c => (
                      <TouchableOpacity key={c} onPress={() => setChildCurriculum(c)} activeOpacity={0.8}
                        style={[styles.modalTextInput, { marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderColor: childCurriculum === c ? colors.primary : colors.borderColor }]}
                      >
                        <Text style={[styles.fieldSub, { color: childCurriculum === c ? colors.primary : colors.textMuted }]}>{c}</Text>
                        {childCurriculum === c && <Feather name="check" size={13} color={colors.primary} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                {parentError ? <Text style={{ color: colors.accentRed, fontSize: 13 }}>{parentError}</Text> : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setParentModal(false)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalSaveBtn} onPress={submitParentOnboarding} disabled={parentLoading}>
                    {parentLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>Create & Link</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {parentStep === 'link' && (
              <View style={{ gap: 10, marginTop: 8 }}>
                <TouchableOpacity onPress={() => setParentStep('choose')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Feather name="arrow-left" size={14} color={colors.textMuted} />
                  <Text style={[styles.fieldSub, { color: colors.textMuted }]}>Back</Text>
                </TouchableOpacity>
                <Text style={styles.fieldLabel}>Child's Aivorah Email</Text>
                <Text style={styles.fieldSub}>Enter the email address your child uses to log into Aivorah</Text>
                <TextInput style={styles.modalTextInput} value={linkEmail} onChangeText={setLinkEmail} placeholder="child@example.com" placeholderTextColor={colors.textDim} keyboardType="email-address" autoCapitalize="none" />
                {parentError ? <Text style={{ color: colors.accentRed, fontSize: 13 }}>{parentError}</Text> : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setParentModal(false)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalSaveBtn} onPress={submitParentOnboarding} disabled={parentLoading}>
                    {parentLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>Link Child</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Sign Out Confirmation */}
      <Modal visible={signOutConfirm} transparent animationType="fade" onRequestClose={() => setSignOutConfirm(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxWidth: 360 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sign Out</Text>
              <TouchableOpacity onPress={() => setSignOutConfirm(false)}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.modalNote}>Are you sure you want to sign out?</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setSignOutConfirm(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: colors.accentRed }]} onPress={() => { setSignOutConfirm(false); logout(); }}>
                <Text style={styles.modalSaveText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Feedback Modal */}
      <Modal visible={!!feedback} transparent animationType="fade" onRequestClose={() => setFeedback(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxWidth: 360 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{feedback?.title}</Text>
              <TouchableOpacity onPress={() => setFeedback(null)}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.modalNote}>{feedback?.message}</Text>
            <TouchableOpacity style={styles.modalSaveBtn} onPress={() => setFeedback(null)}>
              <Text style={styles.modalSaveText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

// ── Sub-components ──

function SectionHeader({ icon, label, color, styles }: { icon: any; label: string; color: string; styles: any }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Feather name={icon} size={15} color={color} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function FieldRow({ label, sub, btnLabel, onPress, styles }: { label: string; sub: string; btnLabel: string; onPress: () => void; styles: any }) {
  return (
    <View style={styles.fieldRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldSub} numberOfLines={1}>{sub}</Text>
      </View>
      <TouchableOpacity style={styles.changeBtn} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.changeBtnText}>{btnLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function AppModal({ visible, title, onClose, children, styles, colors }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; styles: any; colors: AppColors }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function ModalButtons({ onCancel, onSave, loading, saveLabel = 'Save Changes', styles }: { onCancel: () => void; onSave: () => void; loading: boolean; saveLabel?: string; styles: any }) {
  return (
    <View style={styles.modalBtns}>
      <TouchableOpacity style={styles.modalCancelBtn} onPress={onCancel}>
        <Text style={styles.modalCancelText}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.modalSaveBtn} onPress={onSave} disabled={loading}>
        {loading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>{saveLabel}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.md },

  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  card: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl },

  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  avatarBig: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  avatarCam: {
    position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.cardDark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.borderColor,
  },
  avatarInitial: { fontSize: 24, fontWeight: '800', color: '#fff' },
  profileName: { fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: 2 },
  profileSub: { fontSize: 12, color: c.textMuted, marginBottom: 6 },
  profileMeta: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: c.primaryGlow, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: c.primary + '30',
  },
  roleBadgeText: { fontSize: 11, fontWeight: '600', color: c.primary },

  divider: { height: 1, backgroundColor: c.borderColor, marginVertical: spacing.lg },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: c.textMain, marginBottom: 2 },
  fieldSub: { fontSize: 12, color: c.textMuted, maxWidth: 220 },
  changeBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm,
    borderWidth: 1, borderColor: c.primary + '40', backgroundColor: c.primaryGlow,
  },
  changeBtnText: { fontSize: 12, fontWeight: '600', color: c.primary },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  comingSoonBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: c.primaryGlow, borderWidth: 1, borderColor: c.primary + '30' },
  comingSoonText: { fontSize: 11, color: c.primary, fontWeight: '600' },

  themeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  themeOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1,
    borderColor: c.borderColor, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  themeOptionActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  themeLabel: { fontSize: 13, fontWeight: '600', color: c.textMuted },

  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 2 },
  versionText: { textAlign: 'center', fontSize: 12, color: c.textDim, marginTop: spacing.xl },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, width: '100%', maxWidth: 440 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalNote: { fontSize: 13, color: c.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  modalFieldLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 6, marginTop: spacing.md },
  modalInput: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, height: 46, paddingHorizontal: spacing.lg,
  },
  modalTextInput: { flex: 1, fontSize: 14, color: c.textMain },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },
});
