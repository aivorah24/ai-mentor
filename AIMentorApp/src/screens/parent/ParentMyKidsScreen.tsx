import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';
import firebaseApp from '../../config/firebase';

function formatStudyTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function generateStudentId(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 4) || 'STU';
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `STU-${initials}-${suffix}`;
}

function ChildCard({ child, colors, styles, navigation, onRemove, onEdit, onManageTasks, onViewCreds }: any) {
  const totalTopics = child.totalTopics || 0;
  const progressPct = totalTopics > 0
    ? Math.round(((child.completedTopics?.length ?? 0) / totalTopics) * 100)
    : 0;
  const isNewStudent = (child.xpPoints ?? 0) === 0 && (child.studyTime ?? 0) === 0 && progressPct === 0;
  const hasActivity = (child.xpPoints ?? 0) > 0 || (child.studyTime ?? 0) > 0 || progressPct > 0;
  const isOnTrack = hasActivity && (child.currentStreak ?? 0) >= 1;
  const badgeColor = !hasActivity ? colors.accentBlue : isOnTrack ? colors.accentGreen : colors.accentYellow;
  const badgeLabel = !hasActivity ? 'Getting Started' : isOnTrack ? 'On Track' : 'Needs Attention';

  return (
    <TouchableOpacity
      style={styles.childCard}
      activeOpacity={0.9}
      onPress={() => navigation.navigate('ParentDashboard', { childId: child.id })}
    >
      <View style={styles.childCardHeader}>
        <View style={[styles.avatar, { backgroundColor: badgeColor + '20' }]}>
          <Text style={[styles.avatarText, { color: badgeColor }]}>
            {child.name[0].toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.childName} numberOfLines={1}>{child.name}</Text>
          <Text style={styles.childSub} numberOfLines={1}>{child.grade}{child.curriculum ? ` · ${child.curriculum}` : ''}{child.school ? ` · ${child.school}` : ''}</Text>
        </View>
        <View style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => onEdit(child)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="edit-2" size={15} color={colors.textDim} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onRemove(child)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={16} color={colors.textDim} />
            </TouchableOpacity>
          </View>
          <View style={[styles.badge, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '33' }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>{badgeLabel}</Text>
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Study Time</Text>
          <Text style={styles.statValue}>{formatStudyTime(child.studyTimeMinutes ?? 0)}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Chapters Done</Text>
          <Text style={[styles.statValue, { color: totalTopics > 0 && progressPct >= 50 ? colors.accentGreen : colors.textMain }]}>
            {totalTopics > 0 ? `${child.completedTopics?.length ?? 0}/${totalTopics}` : 'Coming Soon'}
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Streak</Text>
          <Text style={[styles.statValue, { color: (child.currentStreak ?? 0) >= 3 ? colors.accentGreen : colors.accentYellow }]}>
            {child.currentStreak ?? 0}d
          </Text>
        </View>
      </View>

      <View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={styles.statLabel}>Chapter Progress</Text>
          <Text style={[styles.statLabel, { color: colors.primary }]}>{progressPct}%</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
          <View style={[styles.progressFill, { width: `${progressPct}%` as any, backgroundColor: colors.primary }]} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity
          style={[styles.quickBtn, { flex: 1, backgroundColor: '#B8860B18', borderColor: '#B8860B40' }]}
          onPress={() => onManageTasks(child)}
          activeOpacity={0.7}
        >
          <Feather name="check-square" size={14} color="#B8860B" />
          <Text style={[styles.quickBtnText, { color: '#B8860B' }]}>Daily Tasks</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.quickBtn, { flex: 1, backgroundColor: '#5F8A8618', borderColor: '#5F8A8640' }]}
          onPress={() => onViewCreds(child)}
          activeOpacity={0.7}
        >
          <Feather name="key" size={14} color="#5F8A86" />
          <Text style={[styles.quickBtnText, { color: '#5F8A86' }]}>Login Info</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.quickNav}>
        {[
          { icon: 'grid', label: 'Dashboard', screen: 'ParentDashboard' },
          { icon: 'book-open', label: 'Learning', screen: 'ParentLearning' },
          { icon: 'bar-chart-2', label: 'Progress', screen: 'ParentProgress' },
          { icon: 'calendar', label: 'Schedule', screen: 'ParentSchedule' },
        ].map((btn) => (
          <TouchableOpacity
            key={btn.label}
            style={styles.quickBtn}
            onPress={() => navigation.navigate(btn.screen, { childId: child.id })}
            activeOpacity={0.7}
          >
            <Feather name={btn.icon as any} size={14} color={colors.primary} />
            <Text style={[styles.quickBtnText, { color: colors.primary }]}>{btn.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.recentSection}>
        <View style={styles.activityRow}>
          <Feather name="zap" size={13} color={colors.accentYellow} />
          <Text style={styles.activityText}>{child.xpPoints ?? 0} XP earned · Level {child.level ?? 1}</Text>
        </View>
        {child.lastLesson ? (
          <View style={styles.activityRow}>
            <Feather name="check-circle" size={13} color={colors.accentGreen} />
            <Text style={styles.activityText}>Last lesson: {child.lastLesson}</Text>
          </View>
        ) : null}
        {(child.assignmentsDone ?? 0) > 0 && (
          <View style={styles.activityRow}>
            <Feather name="clipboard" size={13} color={colors.accentBlue} />
            <Text style={styles.activityText}>{child.assignmentsDone} assignment{child.assignmentsDone > 1 ? 's' : ''} completed</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ParentMyKidsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [children, setChildren] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add child modal
  const [showModal, setShowModal]   = useState(false);
  const [modalTab, setModalTab]     = useState<'create' | 'link'>('create');

  // Create new student
  const [newName,       setNewName]       = useState('');
  const [newEmail,      setNewEmail]      = useState('');
  const [newGrade,      setNewGrade]      = useState('Grade 3');
  const [newCurriculum, setNewCurriculum] = useState('IB PYP');
  const [newSchool,     setNewSchool]     = useState('');
  const [creating,      setCreating]      = useState(false);
  const [createError,   setCreateError]   = useState('');

  // Link existing
  const [childEmail, setChildEmail] = useState('');
  const [linking,    setLinking]    = useState(false);
  const [linkError,  setLinkError]  = useState('');

  // Credentials display after auto-create
  const [credsModal,    setCredsModal]    = useState(false);
  const [credsEmail,    setCredsEmail]    = useState('');
  const [credsPassword, setCredsPassword] = useState('');
  const [credsStudentId, setCredsStudentId] = useState('');
  const [credsName,     setCredsName]     = useState('');
  const [credsVerificationRequired, setCredsVerificationRequired] = useState(false);

  // Remove child confirmation
  const [removeConfirmChild, setRemoveConfirmChild] = useState<any>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');

  // View credentials for existing child
  const [viewCredsChild, setViewCredsChild] = useState<any>(null);
  const [viewCreds, setViewCreds] = useState<any>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [resendingCreds, setResendingCreds] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState(false);
  const [showCredsPassword, setShowCredsPassword] = useState(false);
  const [showViewPassword, setShowViewPassword] = useState(false);

  // Edit child modal
  const [editChild,      setEditChild]      = useState<any>(null);
  const [editName,       setEditName]       = useState('');
  const [editGrade,      setEditGrade]      = useState('Grade 3');
  const [editCurriculum, setEditCurriculum] = useState('IB PYP');
  const [editSchool,     setEditSchool]     = useState('');
  const [saving,         setSaving]         = useState(false);
  const [editError,      setEditError]      = useState('');

  // Daily tasks modal
  const [taskModalChild,  setTaskModalChild]  = useState<any>(null);
  const [showTaskModal,   setShowTaskModal]   = useState(false);
  const [childTasks,      setChildTasks]      = useState<any[]>([]);
  const [taskLabel,       setTaskLabel]       = useState('');
  const [taskCoins,       setTaskCoins]       = useState('5');
  const [taskIcon,        setTaskIcon]        = useState('check-circle');
  const [savingTask,      setSavingTask]      = useState(false);
  const [taskError,       setTaskError]       = useState('');

  function copyToClipboard(text: string, field: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 1500);
  }

  async function fetchChildCreds(child: any) {
    setViewCredsChild(child);
    setViewCreds(null);
    setLoadingCreds(true);
    setResendSuccess(false);
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${child.id}/credentials`);
      if (res.ok) {
        setViewCreds(await res.json());
      } else {
        setViewCreds({ loginId: child.email, studentId: null, initialPassword: null });
      }
    } catch {
      setViewCreds({ loginId: child.email, studentId: null, initialPassword: null });
    } finally {
      setLoadingCreds(false);
    }
  }

  async function resendCredsEmail(child: any) {
    setResendingCreds(true);
    setResendSuccess(false);
    try {
      const res = await fetch(
        `${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${child.id}/resend-credentials`,
        { method: 'POST' }
      );
      if (res.ok) {
        setResendSuccess(true);
        setTimeout(() => setResendSuccess(false), 4000);
      }
    } catch { /* ignore */ }
    finally { setResendingCreds(false); }
  }

  async function resetChildPassword(child: any) {
    setResettingPassword(true);
    setResetPasswordSuccess(false);
    try {
      const frontendOrigin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://aivorah.ai';
      const res = await fetch(
        `${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${child.id}/reset-password`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frontendOrigin }) }
      );
      if (res.ok) {
        setResetPasswordSuccess(true);
        setTimeout(() => setResetPasswordSuccess(false), 5000);
      } else {
        Alert.alert('Error', 'Could not send reset email. Please try again.');
      }
    } catch { Alert.alert('Error', 'Network error. Please try again.'); }
    finally { setResettingPassword(false); }
  }

  function openModal(tab: 'create' | 'link' = 'create') {
    setModalTab(tab);
    setNewName(''); setNewEmail(''); setNewGrade('Grade 3');
    setNewCurriculum('IB PYP'); setNewSchool(''); setCreateError('');
    setChildEmail(''); setLinkError('');
    setShowModal(true);
  }

  const parentEmail = user?.email || 'parent@demo.com';

  const DEMO_PARENT_EMAILS = new Set([
    'suresh@test.ai', 'deepa@test.ai', 'fatima@test.ai', 'prakash@test.ai', 'parent@demo.com',
  ]);
  const isDemo = DEMO_PARENT_EMAILS.has(parentEmail.toLowerCase());

  const DEMO_STATS: Record<string, object> = {
    'aanya@test.ai':  { xpPoints: 850,  currentStreak: 5, completedTopics: ['Number Sense', 'Addition', 'Shapes'],   studyTimeMinutes: 120, grade: 'Grade 3', school: 'Hyderabad International School' },
    'ishaan@test.ai': { xpPoints: 1050, currentStreak: 3, completedTopics: ['Fractions', 'Multiplication', 'Time'],  studyTimeMinutes: 180, grade: 'Grade 4', school: 'Hyderabad International School' },
    'rohan@test.ai':  { xpPoints: 1200, currentStreak: 2, completedTopics: ['Decimals', 'Area & Perimeter'],          studyTimeMinutes: 150, grade: 'Grade 5', school: 'Hyderabad International School' },
    'diya@test.ai':   { xpPoints: 780,  currentStreak: 7, completedTopics: ['Patterns', 'Counting', 'Measurement'],  studyTimeMinutes: 100, grade: 'Grade 3', school: 'Hyderabad International School' },
  };

  const fetchChildren = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setChildren(data);
        } else if (isDemo) {
          const derived = (user?.children ?? []).map((c: any, i: number) => ({
            id: c.email || `child-${i}`, name: c.name, email: c.email, grade: c.grade,
            ...(DEMO_STATS[c.email] ?? {}),
          }));
          setChildren(derived);
        } else {
          setChildren([]);
        }
      } else if (isDemo) {
        const derived = (user?.children ?? []).map((c: any, i: number) => ({
          id: c.email || `child-${i}`, name: c.name, email: c.email, grade: c.grade,
          ...(DEMO_STATS[c.email] ?? {}),
        }));
        setChildren(derived);
      } else {
        setChildren([]);
      }
    } catch {
      if (isDemo) {
        const derived = (user?.children ?? []).map((c: any, i: number) => ({
          id: c.email || `child-${i}`, name: c.name, email: c.email, grade: c.grade,
          ...(DEMO_STATS[c.email] ?? {}),
        }));
        setChildren(derived);
      } else {
        setChildren([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [parentEmail, isDemo, user]);

  useEffect(() => { fetchChildren(); }, [fetchChildren]);

  async function createStudent() {
    if (!newName.trim()) { setCreateError('Child\'s name is required.'); return; }
    if (newEmail.trim() && !/^\S+@\S+\.\S+$/.test(newEmail.trim())) {
      setCreateError('Please enter a valid child email address.'); return;
    }
    setCreating(true); setCreateError('');
    const childName = newName.trim();
    const studentId = generateStudentId(childName);
    try {
      const initRes = await fetch(
        `${SERVER_URL}/parent/children/init-auth`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: childName,
            email: newEmail.trim().toLowerCase() || undefined,
            studentId,
          }) }
      );
      const init = await initRes.json().catch(() => ({}));
      if (!initRes.ok) { setCreateError(init.error || 'Could not prepare child account.'); return; }
      const childEmail = String(init.email || '').toLowerCase();
      const childPassword = String(init.password || '');
      const finalStudentId = init.studentId || studentId;
      const emailProvided = Boolean(init.emailProvided); // real Gmail supplied?

      // Create child in Firebase Auth (same provider used by login screen).
      const secondaryName = `mykids-child-${Date.now()}`;
      const childApp = initializeApp((firebaseApp as any).options, secondaryName);
      const childAuth = getAuth(childApp);
      let firebaseUid = '';
      try {
        const childCred = await createUserWithEmailAndPassword(childAuth, childEmail, childPassword);
        firebaseUid = childCred.user.uid;
        await updateProfile(childCred.user, { displayName: `${childName}|student` }).catch(() => {});

      } finally {
        await signOut(childAuth).catch(() => {});
        await deleteApp(childApp).catch(() => {});
      }

      const res = await fetch(
        `${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/link-created`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firebaseUid,
            studentId: finalStudentId,
            name: childName,
            email: childEmail,
            grade: newGrade,
            curriculum: newCurriculum,
            school: newSchool.trim(),
            verificationRequired: false,
            initialPassword: childPassword,
          }) }
      );
      const data = await res.json();
      if (!res.ok) {
        setCreateError(res.status === 409
          ? (data.error || 'A child with this name and grade is already linked to your account.')
          : (data.error || 'Could not create account.'));
        return;
      }
      setShowModal(false);
      fetchChildren();
      // Always show login credentials once, right after account creation.
      if (data.child) {
        setCredsName(data.child.name);
        setCredsEmail(data.child.email);
        setCredsPassword(childPassword);
        setCredsStudentId(data.child.studentId || finalStudentId);
        setCredsVerificationRequired(emailProvided); // show Gmail note if real email provided
        setCredsModal(true);
      }
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        setCreateError('This email is already in use. Try another email or leave it blank for auto-generated login.');
      } else {
        setCreateError(err?.message || 'Network error. Please try again.');
      }
    }
    finally { setCreating(false); }
  }

  function openEdit(child: any) {
    setEditChild(child);
    setEditName(child.name || '');
    setEditGrade(child.grade || 'Grade 3');
    setEditCurriculum(child.curriculum || 'IB PYP');
    setEditSchool(child.school || '');
    setEditError('');
  }

  async function saveEdit() {
    if (!editChild || !editName.trim()) { setEditError('Name is required.'); return; }
    setSaving(true); setEditError('');
    try {
      const res = await fetch(
        `${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${editChild.id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName.trim(), grade: editGrade, curriculum: editCurriculum, school: editSchool.trim() }) }
      );
      const data = await res.json();
      if (!res.ok) { setEditError(data.error || 'Could not update.'); return; }
      setChildren(prev => prev.map(c => c.id === editChild.id ? { ...c, ...data.child } : c));
      setEditChild(null);
    } catch { setEditError('Network error. Please try again.'); }
    finally { setSaving(false); }
  }

  async function addChild() {
    if (!childEmail.trim()) return;
    setLinking(true); setLinkError('');
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childEmail: childEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setLinkError(data.error || 'Could not link child.'); return; }
      setChildEmail(''); setShowModal(false); setLoading(true); fetchChildren();
    } catch { setLinkError('Network error. Please try again.'); }
    finally { setLinking(false); }
  }

  function confirmRemove(child: any) {
    setRemoveError('');
    setRemoveConfirmChild(child);
  }

  async function removeChild() {
    if (!removeConfirmChild) return;
    setRemoving(true);
    setRemoveError('');
    try {
      const res = await fetch(
        `${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${removeConfirmChild.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRemoveError(err?.error || 'Could not remove child. Please try again.');
        return;
      }
      setChildren(prev => prev.filter(c => c.id !== removeConfirmChild.id));
      setRemoveConfirmChild(null);
    } catch {
      setRemoveError('Network error. Please try again.');
    } finally {
      setRemoving(false);
    }
  }

  async function openTaskModal(child: any) {
    setTaskModalChild(child);
    setTaskLabel(''); setTaskCoins('5'); setTaskIcon('check-circle'); setTaskError('');
    setShowTaskModal(true);
    try {
      const res = await fetch(`${SERVER_URL}/habits/parent-tasks?childId=${child.id}`);
      if (res.ok) setChildTasks(await res.json());
    } catch { setChildTasks([]); }
  }

  async function createTask() {
    if (!taskLabel.trim()) { setTaskError('Task label is required.'); return; }
    setSavingTask(true); setTaskError('');
    try {
      const res = await fetch(`${SERVER_URL}/habits/parent-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentEmail,
          childId: taskModalChild?.id,
          label: taskLabel.trim(),
          icon: taskIcon,
          coins: parseInt(taskCoins) || 5,
        }),
      });
      if (!res.ok) { const d = await res.json(); setTaskError(d.error || 'Could not save task.'); return; }
      const newTask = await res.json();
      setChildTasks(prev => [newTask, ...prev]);
      setTaskLabel(''); setTaskCoins('5');
    } catch { setTaskError('Network error.'); }
    finally { setSavingTask(false); }
  }

  async function deleteTask(taskId: string) {
    try {
      await fetch(`${SERVER_URL}/habits/parent-tasks/${taskId}`, { method: 'DELETE' });
      setChildTasks(prev => prev.filter(t => t.id !== taskId));
    } catch { /* ignore */ }
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="My Kids"
          subtitle="Managed Accounts"
          searchPlaceholder="Search kids..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchChildren(); }} tintColor={colors.primary} />}
        >
          <View style={{ marginBottom: spacing.xl }}>
            <Text style={styles.pageTitle}>Managed Accounts</Text>
            <Text style={styles.pageSubtitle}>View progress, manage controls, and update settings for your children.</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 48 }} />
          ) : (
            <View style={styles.cardsRow}>
              {children.map((child) => (
                <ChildCard
                  key={child.id}
                  child={child}
                  colors={colors}
                  styles={styles}
                  navigation={navigation}
                  onRemove={confirmRemove}
                  onEdit={openEdit}
                  onManageTasks={openTaskModal}
                  onViewCreds={fetchChildCreds}
                />
              ))}

              {children.length === 0 && (
                <View style={styles.emptyState}>
                  <Feather name="users" size={40} color={colors.textDim} />
                  <Text style={styles.emptyTitle}>No children linked yet</Text>
                  <Text style={styles.emptySub}>Add your child's account using their registered email address.</Text>
                </View>
              )}

              <TouchableOpacity style={styles.addChildCard} activeOpacity={0.7} onPress={() => openModal('create')}>
                <Feather name="user-plus" size={28} color={colors.textDim} />
                <Text style={styles.addChildTitle}>Add {children.length > 0 ? 'Another' : 'a'} Child</Text>
                <Text style={styles.addChildSub}>Create a new account or link an existing one.</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Daily Tasks Modal */}
      <Modal visible={showTaskModal} transparent animationType="fade" onRequestClose={() => setShowTaskModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Daily Tasks</Text>
                <Text style={[styles.modalDesc, { marginBottom: 0 }]}>{taskModalChild?.name}'s tasks</Text>
              </View>
              <TouchableOpacity onPress={() => setShowTaskModal(false)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Existing tasks */}
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
              {childTasks.length === 0 ? (
                <Text style={[styles.modalDesc, { textAlign: 'center', paddingVertical: 16 }]}>No tasks assigned yet.</Text>
              ) : childTasks.map(task => (
                <View key={task.id} style={styles.taskRow}>
                  <View style={styles.taskIconCircle}>
                    <Feather name={(task.icon as any) || 'check-circle'} size={14} color="#B8860B" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskLabel}>{task.label}</Text>
                    <Text style={styles.taskCoinsText}>{task.coins} coins</Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteTask(task.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name="trash-2" size={15} color={colors.accentRed} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            {/* Divider */}
            <View style={{ height: 1, backgroundColor: colors.borderColor }} />

            {/* Add new task */}
            <Text style={[styles.modalTitle, { fontSize: 14 }]}>Add New Task</Text>

            <TextInput
              style={styles.input}
              placeholder="Task description (e.g. Read for 20 mins)"
              placeholderTextColor={colors.textMuted}
              value={taskLabel}
              onChangeText={t => { setTaskLabel(t); setTaskError(''); }}
            />

            {/* Icon picker */}
            <View>
              <Text style={[styles.modalDesc, { marginBottom: 8 }]}>Icon</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(['check-circle','book-open','sun','moon','droplet','activity','shield','smile','star','coffee'] as const).map(ic => (
                  <TouchableOpacity
                    key={ic}
                    onPress={() => setTaskIcon(ic)}
                    style={[styles.iconChip, taskIcon === ic && { backgroundColor: '#B8860B20', borderColor: '#B8860B' }]}
                    activeOpacity={0.7}
                  >
                    <Feather name={ic} size={16} color={taskIcon === ic ? '#B8860B' : colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Coins */}
            <View>
              <Text style={[styles.modalDesc, { marginBottom: 8 }]}>Coins reward</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {['5','10','15','20'].map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setTaskCoins(c)}
                    style={[styles.coinChip, taskCoins === c && { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: taskCoins === c ? colors.primary : colors.textMuted }}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {taskError ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={13} color={colors.accentRed} />
                <Text style={[styles.errorText, { color: colors.accentRed }]}>{taskError}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.linkBtn, { backgroundColor: '#B8860B' }, (!taskLabel.trim() || savingTask) && { opacity: 0.5 }]}
              onPress={createTask}
              disabled={!taskLabel.trim() || savingTask}
              activeOpacity={0.8}
            >
              {savingTask
                ? <ActivityIndicator color="white" size="small" />
                : <><Feather name="plus" size={15} color="#fff" /><Text style={styles.linkBtnText}>Add Task</Text></>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Child Modal */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Child Account</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Tab switcher */}
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tab, modalTab === 'create' && styles.tabActive]}
                onPress={() => { setModalTab('create'); setCreateError(''); }}
                activeOpacity={0.8}>
                <Feather name="user-plus" size={14} color={modalTab === 'create' ? colors.primary : colors.textMuted} />
                <Text style={[styles.tabText, modalTab === 'create' && { color: colors.primary, fontWeight: '700' }]}>Create New</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, modalTab === 'link' && styles.tabActive]}
                onPress={() => { setModalTab('link'); setLinkError(''); }}
                activeOpacity={0.8}>
                <Feather name="link" size={14} color={modalTab === 'link' ? colors.primary : colors.textMuted} />
                <Text style={[styles.tabText, modalTab === 'link' && { color: colors.primary, fontWeight: '700' }]}>Link Existing</Text>
              </TouchableOpacity>
            </View>

            {/* ── CREATE NEW ── */}
            {modalTab === 'create' && (
              <View style={{ gap: 10 }}>
                <Text style={styles.modalDesc}>
                  Create a student account for your child. Only name and grade are required.
                </Text>

                <TextInput style={styles.input} placeholder="Child's full name *" placeholderTextColor={colors.textMuted}
                  value={newName} onChangeText={t => { setNewName(t); setCreateError(''); }} autoCapitalize="words" />

                {/* Email — optional */}
                <View>
                  <TextInput style={styles.input} placeholder="Email address (optional)" placeholderTextColor={colors.textMuted}
                    value={newEmail} onChangeText={t => { setNewEmail(t); setCreateError(''); }}
                    keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
                  <Text style={[styles.modalDesc, { marginTop: 3, fontSize: 11, opacity: 0.7 }]}>
                    Leave blank — we'll auto-generate a login ID
                  </Text>
                </View>

                {/* Password — optional */}
                <Text style={[styles.modalDesc, { marginTop: -4, fontSize: 11, opacity: 0.8 }]}>
                  Aivorah generates the child password securely. Real email accounts must be verified before login.
                </Text>

                <View style={styles.rowInputs}>
                  {/* Grade picker */}
                  <View style={[styles.input, styles.pickerWrap, { flex: 1 }]}>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>Grade</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {['Grade 3','Grade 4','Grade 5'].map(g => (
                        <TouchableOpacity key={g} onPress={() => setNewGrade(g)} activeOpacity={0.8}
                          style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
                            backgroundColor: newGrade === g ? colors.primary + '20' : colors.cardDark,
                            borderWidth: 1, borderColor: newGrade === g ? colors.primary : colors.borderColor }}>
                          <Text style={{ fontSize: 12, color: newGrade === g ? colors.primary : colors.textMuted, fontWeight: newGrade === g ? '700' : '400' }}>{g}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>

                <View style={styles.rowInputs}>
                  {/* Curriculum picker */}
                  <View style={[styles.input, styles.pickerWrap, { flex: 1 }]}>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>Curriculum</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {['IB PYP','CBSE','NCERT'].map(c => (
                        <TouchableOpacity key={c} onPress={() => setNewCurriculum(c)} activeOpacity={0.8}
                          style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
                            backgroundColor: newCurriculum === c ? colors.primary + '20' : colors.cardDark,
                            borderWidth: 1, borderColor: newCurriculum === c ? colors.primary : colors.borderColor }}>
                          <Text style={{ fontSize: 12, color: newCurriculum === c ? colors.primary : colors.textMuted, fontWeight: newCurriculum === c ? '700' : '400' }}>{c}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>

                <TextInput style={styles.input} placeholder="School name (optional)" placeholderTextColor={colors.textMuted}
                  value={newSchool} onChangeText={setNewSchool} autoCapitalize="words" />

                {createError ? (
                  <View style={styles.errorRow}>
                    <Feather name="alert-circle" size={13} color={colors.accentRed} />
                    <Text style={[styles.errorText, { color: colors.accentRed }]}>{createError}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.linkBtn, (!newName.trim() || creating) && { opacity: 0.5 }]}
                  onPress={createStudent}
                  disabled={!newName.trim() || creating}
                  activeOpacity={0.8}>
                  {creating
                    ? <ActivityIndicator color="white" size="small" />
                    : <><Feather name="user-plus" size={15} color="#fff" /><Text style={styles.linkBtnText}>Create Student Account</Text></>}
                </TouchableOpacity>
              </View>
            )}

            {/* ── LINK EXISTING ── */}
            {modalTab === 'link' && (
              <View style={{ gap: 10 }}>
                <Text style={styles.modalDesc}>
                  If your child already has an Aivorah account, enter their registered email to link it.
                </Text>

                <TextInput
                  style={[styles.input, linkError ? { borderColor: colors.accentRed } : {}]}
                  placeholder="child@example.com"
                  placeholderTextColor={colors.textMuted}
                  value={childEmail}
                  onChangeText={t => { setChildEmail(t); setLinkError(''); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {linkError ? (
                  <View style={styles.errorRow}>
                    <Feather name="alert-circle" size={13} color={colors.accentRed} />
                    <Text style={[styles.errorText, { color: colors.accentRed }]}>{linkError}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.linkBtn, (!childEmail.trim() || linking) && { opacity: 0.5 }]}
                  onPress={addChild}
                  disabled={!childEmail.trim() || linking}
                  activeOpacity={0.8}>
                  {linking
                    ? <ActivityIndicator color="white" size="small" />
                    : <><Feather name="link" size={15} color="#fff" /><Text style={styles.linkBtnText}>Link Account</Text></>}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
      {/* ── Auto-generated Credentials Modal ── */}
      <Modal visible={credsModal} transparent animationType="fade" onRequestClose={() => setCredsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentGreen + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="key" size={17} color={colors.accentGreen} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Account Created</Text>
                  <Text style={styles.modalDesc}>{credsName}'s login details</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setCredsModal(false)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={{ backgroundColor: colors.bgDark, borderRadius: 12, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.borderColor }}>
              <Text style={[styles.modalDesc, { textAlign: 'center', lineHeight: 20 }]}>
                Save these — your child uses them to log in as a Student on any device.
              </Text>

              {/* Show login email only — password sent securely to parent's email */}
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Login ID (Email)</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: copiedField === 'cemail' ? colors.accentGreen : colors.borderColor, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8, backgroundColor: colors.cardDark }}>
                  <Text style={{ flex: 1, color: colors.textMain, fontSize: 13, fontFamily: 'monospace' }} selectable>{credsEmail}</Text>
                  <TouchableOpacity onPress={() => copyToClipboard(credsEmail, 'cemail')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name={copiedField === 'cemail' ? 'check' : 'copy'} size={14} color={copiedField === 'cemail' ? colors.accentGreen : colors.textDim} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={{ backgroundColor: colors.accentGreen + '15', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: colors.accentGreen + '30' }}>
                <Text style={{ fontSize: 12, color: colors.accentGreen, fontWeight: '700', marginBottom: 2 }}>Credentials sent to your email</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                  The full login details (including password) have been sent to your email for security. Use "Resend" below if needed.
                </Text>
              </View>

              {credsVerificationRequired && (
                <View style={{ backgroundColor: '#5F8A8612', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#5F8A8630', gap: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#5F8A86' }}>Your child can log in right away.</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                    A verification link was sent to <Text style={{ fontWeight: '700', color: colors.textMain }}>{credsEmail}</Text>. You (the parent) can open that inbox and click it — this enables "Forgot Password" for your child in the future.
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.linkBtn, { backgroundColor: colors.accentGreen }]}
              onPress={() => setCredsModal(false)} activeOpacity={0.8}
            >
              <Feather name="check" size={15} color="#fff" />
              <Text style={styles.linkBtnText}>Got it, I've saved these</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Remove Child Confirmation Modal ── */}
      <Modal visible={!!removeConfirmChild} transparent animationType="fade" onRequestClose={() => { setRemoveConfirmChild(null); setRemoveError(''); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxWidth: 360 }]}>
            <View style={{ alignItems: 'center', gap: 12 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#ef444420', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="user-x" size={22} color="#ef4444" />
              </View>
              <Text style={[styles.modalTitle, { textAlign: 'center' }]}>Remove {removeConfirmChild?.name}?</Text>
              <Text style={[styles.modalDesc, { textAlign: 'center' }]}>
                This unlinks {removeConfirmChild?.name} from your account. Their learning progress and data will not be deleted.
              </Text>
            </View>

            {removeError ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={13} color={colors.accentRed} />
                <Text style={[styles.errorText, { color: colors.accentRed }]}>{removeError}</Text>
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.linkBtn, { flex: 1, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor }]}
                onPress={() => { setRemoveConfirmChild(null); setRemoveError(''); }}
                activeOpacity={0.8}
              >
                <Text style={[styles.linkBtnText, { color: colors.textMain }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.linkBtn, { flex: 1, backgroundColor: '#ef4444' }, removing && { opacity: 0.6 }]}
                onPress={removeChild}
                disabled={removing}
                activeOpacity={0.8}
              >
                {removing
                  ? <ActivityIndicator color="white" size="small" />
                  : <><Feather name="user-x" size={15} color="#fff" /><Text style={styles.linkBtnText}>Remove</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Edit Child Modal ── */}
      <Modal visible={!!editChild} transparent animationType="fade" onRequestClose={() => setEditChild(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Edit Child</Text>
                <Text style={styles.modalDesc}>{editChild?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setEditChild(null)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={{ gap: 10 }}>
              <Text style={[styles.modalDesc, { marginBottom: 0, fontWeight: '600', color: colors.textMuted }]}>Full Name</Text>
              <TextInput style={styles.input} value={editName} onChangeText={t => { setEditName(t); setEditError(''); }}
                placeholder="Child's name" placeholderTextColor={colors.textMuted} autoCapitalize="words" />

              <Text style={[styles.modalDesc, { marginBottom: 0, fontWeight: '600', color: colors.textMuted }]}>Grade</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {['Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8'].map(g => (
                  <TouchableOpacity key={g} onPress={() => setEditGrade(g)} activeOpacity={0.8}
                    style={[styles.chip, editGrade === g && { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}
                  >
                    <Text style={[styles.chipText, editGrade === g && { color: colors.primary }]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.modalDesc, { marginBottom: 0, fontWeight: '600', color: colors.textMuted }]}>Curriculum</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {['IB PYP','NCERT','CBSE'].map(c => (
                  <TouchableOpacity key={c} onPress={() => setEditCurriculum(c)} activeOpacity={0.8}
                    style={[styles.chip, editCurriculum === c && { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}
                  >
                    <Text style={[styles.chipText, editCurriculum === c && { color: colors.primary }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.modalDesc, { marginBottom: 0, fontWeight: '600', color: colors.textMuted }]}>School (optional)</Text>
              <TextInput style={styles.input} value={editSchool} onChangeText={setEditSchool}
                placeholder="School name" placeholderTextColor={colors.textMuted} />

              {editError ? (
                <View style={styles.errorRow}>
                  <Feather name="alert-circle" size={13} color={colors.accentRed} />
                  <Text style={[styles.errorText, { color: colors.accentRed }]}>{editError}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.linkBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.6 }]}
                onPress={saveEdit} disabled={saving} activeOpacity={0.8}
              >
                {saving
                  ? <ActivityIndicator color="white" size="small" />
                  : <><Feather name="check" size={15} color="#fff" /><Text style={styles.linkBtnText}>Save Changes</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* ── View Login Info Modal ── */}
      <Modal visible={!!viewCredsChild} transparent animationType="fade" onRequestClose={() => { setViewCredsChild(null); setViewCreds(null); setResetPasswordSuccess(false); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#5F8A8620', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="key" size={17} color="#5F8A86" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Login Info</Text>
                  <Text style={styles.modalDesc}>{viewCredsChild?.name}'s credentials</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => { setViewCredsChild(null); setViewCreds(null); setResetPasswordSuccess(false); }}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {loadingCreds ? (
              <ActivityIndicator color="#5F8A86" style={{ paddingVertical: 24 }} />
            ) : (
              <View style={{ backgroundColor: colors.bgDark, borderRadius: 12, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.borderColor }}>
                <Text style={[styles.modalDesc, { textAlign: 'center' }]}>
                  Your child uses these to log in as a Student.
                </Text>

                {/* Show login email only — password not displayed for security */}
                {viewCreds?.loginId && (
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Login ID (Email)</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: copiedField === 'vlogin' ? '#5F8A86' : colors.borderColor, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8, backgroundColor: colors.cardDark }}>
                      <Text style={{ flex: 1, color: colors.textMain, fontSize: 13, fontFamily: 'monospace' }} selectable>{viewCreds.loginId}</Text>
                      <TouchableOpacity onPress={() => copyToClipboard(viewCreds.loginId, 'vlogin')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Feather name={copiedField === 'vlogin' ? 'check' : 'copy'} size={14} color={copiedField === 'vlogin' ? '#5F8A86' : colors.textDim} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                <View style={{ backgroundColor: '#5F8A8612', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#5F8A8630' }}>
                  <Text style={{ fontSize: 12, color: '#5F8A86', fontWeight: '700', marginBottom: 2 }}>Password not shown for security</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                    Use the button below to send the full login credentials to your email.
                  </Text>
                </View>

              </View>
            )}

            {viewCreds?.initialPassword && (
              <TouchableOpacity
                style={[styles.linkBtn, { backgroundColor: resendSuccess ? colors.accentGreen : colors.primary }, resendingCreds && { opacity: 0.6 }]}
                onPress={() => resendCredsEmail(viewCredsChild)}
                disabled={resendingCreds || resendSuccess}
                activeOpacity={0.8}
              >
                {resendingCreds
                  ? <ActivityIndicator color="white" size="small" />
                  : resendSuccess
                    ? <><Feather name="check" size={15} color="#fff" /><Text style={styles.linkBtnText}>Email Sent!</Text></>
                    : <><Feather name="send" size={15} color="#fff" /><Text style={styles.linkBtnText}>Resend Login Info to My Email</Text></>}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.linkBtn, { backgroundColor: resetPasswordSuccess ? colors.accentGreen : colors.accentRed + 'CC' }, resettingPassword && { opacity: 0.6 }]}
              onPress={() => resetChildPassword(viewCredsChild)}
              disabled={resettingPassword || resetPasswordSuccess}
              activeOpacity={0.8}
            >
              {resettingPassword
                ? <ActivityIndicator color="white" size="small" />
                : resetPasswordSuccess
                  ? <><Feather name="check" size={15} color="#fff" /><Text style={styles.linkBtnText}>Reset Link Sent to Your Email!</Text></>
                  : <><Feather name="lock" size={15} color="#fff" /><Text style={styles.linkBtnText}>Reset Child's Password</Text></>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.linkBtn, { backgroundColor: '#5F8A86' }]}
              onPress={() => { setViewCredsChild(null); setViewCreds(null); setResetPasswordSuccess(false); }}
              activeOpacity={0.8}
            >
              <Text style={styles.linkBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },

  pageTitle: { fontSize: 22, fontWeight: '700', color: c.textMain, marginBottom: 6 },
  pageSubtitle: { fontSize: 13, color: c.textMuted },

  cardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'flex-start' },

  childCard: {
    flex: 1, minWidth: 280, maxWidth: 380,
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl,
    padding: spacing.xl, gap: spacing.lg,
  },
  childCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 22, fontWeight: '700' },
  childName: { fontSize: 16, fontWeight: '700', color: c.textMain },
  childSub: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0 },
  badgeText: { fontSize: 11, fontWeight: '600' },

  statsRow: {
    flexDirection: 'row', backgroundColor: c.bgDark,
    borderRadius: radius.lg, borderWidth: 1, borderColor: c.borderColor, overflow: 'hidden',
  },
  statBox: { flex: 1, padding: spacing.md, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: c.borderColor },
  statLabel: { fontSize: 11, color: c.textMuted, marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: '700', color: c.textMain },

  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  quickNav: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.primaryGlow, borderWidth: 1,
    borderColor: c.primary + '40', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  quickBtnText: { fontSize: 12, fontWeight: '600' },

  recentSection: { gap: 8, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.borderColor },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activityText: { fontSize: 12, color: c.textMuted, flex: 1 },

  emptyState: { flex: 1, minWidth: 280, alignItems: 'center', paddingVertical: 48, gap: spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  emptySub: { fontSize: 13, color: c.textMuted, textAlign: 'center', maxWidth: 260 },

  addChildCard: {
    flex: 1, minWidth: 200,
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderStyle: 'dashed',
    borderRadius: radius.xl, padding: spacing.xxl,
    alignItems: 'center', justifyContent: 'center', gap: spacing.md,
  },
  addChildTitle: { fontSize: 16, fontWeight: '700', color: c.textMain, textAlign: 'center' },
  addChildSub: { fontSize: 12, color: c.textMuted, textAlign: 'center' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: {
    width: '100%', maxWidth: 420,
    backgroundColor: c.cardDark, borderRadius: radius.xl,
    borderWidth: 1, borderColor: c.borderColor, padding: spacing.xl, gap: spacing.lg,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalDesc: { fontSize: 13, color: c.textMuted, lineHeight: 20 },
  input: {
    borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md,
    padding: spacing.md, fontSize: 14, color: c.textMain,
    backgroundColor: c.bgDark,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { fontSize: 12, flex: 1 },
  linkBtn: {
    backgroundColor: c.primary, borderRadius: radius.md,
    paddingVertical: 13, paddingHorizontal: spacing.md,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  linkBtnText: { fontSize: 15, fontWeight: '700', color: 'white' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
  chipText: { fontSize: 12, fontWeight: '600', color: c.textMuted },

  // Tab switcher
  tabRow: { flexDirection: 'row', backgroundColor: c.bgDark, borderRadius: radius.md, padding: 3, gap: 3 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: radius.sm - 2 },
  tabActive: { backgroundColor: c.cardDark },
  tabText: { fontSize: 13, color: c.textMuted, fontWeight: '500' },

  // Inline picker sections
  rowInputs: { flexDirection: 'row', gap: 10 },
  pickerWrap: { paddingVertical: 10 },

  // Task modal
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  taskIconCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#B8860B15', alignItems: 'center', justifyContent: 'center',
  },
  taskLabel: { fontSize: 13, fontWeight: '600', color: c.textMain },
  taskCoinsText: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  iconChip: {
    width: 36, height: 36, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  coinChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
});
