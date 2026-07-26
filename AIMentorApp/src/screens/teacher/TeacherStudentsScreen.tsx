import React, { useMemo, useState, useEffect, useCallback, memo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Image, Modal, Platform, Share, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut as firebaseSignOut, updateProfile } from 'firebase/auth';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import SERVER_URL from '../../config/serverUrl';
import firebaseApp from '../../config/firebase';

type Student = {
  id: string;
  name: string;
  email: string;
  grade: string;
  subject: string;
  curriculum: string;
  xpPoints: number;
  level: number;
  currentStreak: number;
  studyTime: number;
  completedTopics: string[];
  progressPct: number;
  assignmentsDone: number;
  lastActive: string;
  needsAttention: boolean;
  photoUrl?: string;
  createdAt?: string | null;
  hasStarted?: boolean;
};

// A student counts as "inactive" only if they have ALREADY engaged at least
// once (a real last-active date) and haven't returned in 3+ days. A freshly
// added student who has never logged in is NOT inactive — otherwise every new
// student shows up under Inactive the moment the teacher adds them. Never-active
// students that linger are surfaced via "Needs Attention" instead (after its own
// grace window), so the two buckets don't both fire on brand-new accounts.
const INACTIVE_DAYS = 3;
function isInactiveStudent(s: Student): boolean {
  if (!s.lastActive) return false; // never engaged yet → not "inactive"
  const days = Math.floor((Date.now() - new Date(s.lastActive).getTime()) / 86400000);
  return days >= INACTIVE_DAYS;
}


const TABS = ['All', 'Grade 3', 'Grade 4', 'Grade 5', 'Needs Attention'];

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function toTitleCase(str: string) {
  if (!str) return str;
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

const StudentAvatar = memo(({ photoUrl, name, grad, styles }: {
  photoUrl?: string; name: string; grad: [string, string]; styles: any;
}) => {
  const [imgErr, setImgErr] = useState(false);
  if (photoUrl && !imgErr) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={styles.avatar}
        onError={() => setImgErr(true)}
      />
    );
  }
  return (
    <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
      <Text style={styles.avatarText}>{initials(name)}</Text>
    </LinearGradient>
  );
});

// ── Demo student registry (only for known demo/test accounts) ─────────────
const DEMO_EMAILS = new Set([
  'anjali@test.ai', 'priya@test.ai', 'vikram@test.ai', 'teacher@demo.com',
]);

const DEMO_STUDENTS: Student[] = [
  {
    id: 'aanya',    name: 'Aanya Kapoor',  email: 'aanya@test.ai',
    grade: 'Grade 3', subject: 'IB PYP',  curriculum: 'IB PYP',
    xpPoints: 850,   level: 4,   currentStreak: 5, studyTime: 12,
    completedTopics: ['Number Sense', 'Addition', 'Shapes'],
    progressPct: 68, assignmentsDone: 8, lastActive: new Date(Date.now() - 86400000).toISOString(),
    needsAttention: false,
  },
  {
    id: 'ishaan',   name: 'Ishaan Mehta',  email: 'ishaan@test.ai',
    grade: 'Grade 4', subject: 'IB PYP',  curriculum: 'IB PYP',
    xpPoints: 1050,  level: 5,   currentStreak: 3, studyTime: 18,
    completedTopics: ['Fractions', 'Multiplication', 'Time'],
    progressPct: 72, assignmentsDone: 11, lastActive: new Date(Date.now() - 172800000).toISOString(),
    needsAttention: false,
  },
  {
    id: 'rohan',    name: 'Rohan Patel',   email: 'rohan@test.ai',
    grade: 'Grade 5', subject: 'IB PYP',  curriculum: 'IB PYP',
    xpPoints: 1200,  level: 6,   currentStreak: 2, studyTime: 15,
    completedTopics: ['Decimals', 'Area & Perimeter'],
    progressPct: 45, assignmentsDone: 6, lastActive: new Date(Date.now() - 259200000).toISOString(),
    needsAttention: true,
  },
  {
    id: 'diya',     name: 'Diya Sharma',   email: 'diya@test.ai',
    grade: 'Grade 3', subject: 'IB PYP',  curriculum: 'IB PYP',
    xpPoints: 780,   level: 4,   currentStreak: 7, studyTime: 10,
    completedTopics: ['Patterns', 'Counting', 'Measurement'],
    progressPct: 82, assignmentsDone: 9, lastActive: new Date().toISOString(),
    needsAttention: false,
  },
];

function deriveStudentsForTeacher(teaches: { grade: string; curriculum: string }[]): Student[] {
  if (!teaches || teaches.length === 0) return [];
  return DEMO_STUDENTS.filter(s =>
    teaches.some(t => t.grade === s.grade && t.curriculum === s.curriculum)
  );
}

// Enchanting Forest palette — matches app theme
const AVATAR_GRADIENTS: [string, string][] = [
  ['#5F8A86', '#7AADA8'],   // slate teal → mint
  ['#5A8A70', '#7AADA8'],   // forest green → mint
  ['#B8797E', '#C4836A'],   // rose → peach
  ['#8A8358', '#C5BD96'],   // gold → khaki
  ['#5F8A86', '#5A8A70'],   // teal → green
  ['#C4836A', '#B8797E'],   // peach → rose
];

function avatarGradient(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[h];
}

function lastActiveLabel(dateStr?: string) {
  if (!dateStr) return 'Never';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export default function TeacherStudentsScreen({ navigation, route }: any) {
  const { colors, isDark } = useTheme();
  const gold = colors.accentYellow;
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Grades + curricula this teacher handles — fetched authoritatively from saved
  // preferences (user.teaches on the cached profile can be stale after onboarding).
  const [fetchedGrades, setFetchedGrades] = useState<string[]>([]);
  const [fetchedCurricula, setFetchedCurricula] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const initialTab = route?.params?.initialTab || 'All';
  const [activeTab, setActiveTab] = useState(initialTab);

  // Re-apply the requested tab whenever navigation passes a new initialTab — the
  // screen instance can be reused (not remounted) when re-navigating from the
  // dashboard, so a useState initializer alone would only apply on first mount.
  useEffect(() => {
    if (route?.params?.initialTab) setActiveTab(route.params.initialTab);
  }, [route?.params?.initialTab]);

  // Add student modal
  const [addModal,    setAddModal]    = useState(false);
  const [addTab,      setAddTab]      = useState<'create' | 'link' | 'bulk'>('create');
  // Create new student fields
  const [newName,       setNewName]       = useState('');
  const [newEmail,      setNewEmail]      = useState('');
  const [newPassword,   setNewPassword]   = useState('');
  const [newGrade,      setNewGrade]      = useState('Grade 3');
  const [newCurriculum, setNewCurriculum] = useState('IB PYP');
  const [creating,      setCreating]      = useState(false);
  const [createError,   setCreateError]   = useState('');
  // Link existing fields
  const [linkEmail,      setLinkEmail]      = useState('');
  const [linking,        setLinking]        = useState(false);
  const [linkError,      setLinkError]      = useState('');
  const [linkSearch,     setLinkSearch]     = useState('');
  const [linkGradeFilter, setLinkGradeFilter] = useState<string>('All');
  const [linkableStudents, setLinkableStudents] = useState<any[]>([]);
  const [linkableLoading,  setLinkableLoading]  = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<any[]>([]);
  // Remove student
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Promote (grade/section move) — mirrors School Admin's bulk-grade flow but
  // scoped server-side to only this teacher's own linked students.
  const [promoteMode, setPromoteMode] = useState(false);
  const [selectedForPromote, setSelectedForPromote] = useState<Set<string>>(new Set());
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  // Credentials popup after creating
  const [credsModal,    setCredsModal]    = useState(false);
  const [credsEmail,    setCredsEmail]    = useState('');
  const [credsPassword, setCredsPassword] = useState('');
  const [credsName,     setCredsName]     = useState('');
  const [credsCopiedField, setCredsCopiedField] = useState('');

  function copyCredsField(text: string, field: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCredsCopiedField(field);
    setTimeout(() => setCredsCopiedField(''), 1500);
  }

  async function shareCredsToStudent(name: string, email: string, password: string) {
    const message = `${name}'s Aivorah login:\nEmail: ${email}\nPassword: ${password}`;
    if (Platform.OS === 'web') {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) {
        try { await nav.share({ text: message }); return; } catch { /* cancelled or unsupported */ }
      }
      copyCredsField(message, 'share');
      Alert.alert('Copied', 'Sharing is not available in this browser — the login details were copied instead, so you can paste them anywhere.');
      return;
    }
    try { await Share.share({ message }); } catch { /* cancelled */ }
  }
  // Bulk import fields
  const [bulkGrade,        setBulkGrade]        = useState('Grade 3');
  const [bulkCurriculum,   setBulkCurriculum]   = useState('IB PYP');
  const [bulkImporting,    setBulkImporting]    = useState(false);
  const [bulkResults,      setBulkResults]      = useState<any[] | null>(null);
  const [bulkSummary,      setBulkSummary]      = useState<any | null>(null);
  const [bulkError,        setBulkError]        = useState('');
  // Two-step flow: uploading a file only ever PREVIEWS it (classifies rows as
  // matched/needs-review/skipped, creates nothing). bulkPreview=true while
  // showing that review screen. The teacher checks off exactly who to import
  // (by row index — stable across the preview→commit resubmission of the same
  // file) and only the explicit "Import Selected" tap actually creates anyone.
  const [bulkPreview,      setBulkPreview]       = useState(false);
  const [selectedRows,     setSelectedRows]      = useState<Set<number>>(new Set());
  const bulkFileRef = useRef<File | null>(null); // kept so the commit step can resubmit the same file
  const fileInputRef = useRef<any>(null);

  const isDemo = DEMO_EMAILS.has(user?.email?.toLowerCase() || '');

  const load = useCallback(async () => {
    try {
      const email = user?.email || '';
      if (!email) { setLoading(false); setRefreshing(false); return; }
      const res = await fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setStudents(data);
        } else if (isDemo) {
          // Demo teacher with no DB students yet — show demo roster
          setStudents(deriveStudentsForTeacher(user?.teaches ?? []));
        } else {
          setStudents([]);
        }
      } else if (isDemo) {
        setStudents(deriveStudentsForTeacher(user?.teaches ?? []));
      } else {
        setStudents([]);
      }
    } catch {
      if (isDemo) setStudents(deriveStudentsForTeacher(user?.teaches ?? []));
      else setStudents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, isDemo]);

  // Initial load + auto-refresh every 15s so a student's name/profile edit shows
  // up here on its own (no manual refresh).
  useEffect(() => {
    load();
    const interval = setInterval(load, 15 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  // Reload the student list on focus and when the browser tab becomes visible.
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  // Fetch the teacher's grades + curricula authoritatively from saved preferences —
  // on every focus, so a change in Settings shows up here instantly (no refresh).
  useFocusEffect(useCallback(() => {
    const email = user?.email;
    if (!email) return;
    fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(email)}`)
      .then(r => r.ok ? r.json() : null)
      .then(p => {
        const teaches = Array.isArray(p?.teaches) ? p.teaches : [];
        const g = [...new Set(teaches.map((t: any) => t.grade).filter(Boolean))] as string[];
        const c = [...new Set(teaches.map((t: any) => t.curriculum).filter(Boolean))] as string[];
        if (g.length > 0) setFetchedGrades(g);
        if (c.length > 0) setFetchedCurricula(c);
      })
      .catch(() => {});
  }, [user?.email]));

  function openAddModal() {
    // Default to the teacher's first taught grade/curriculum so the preselected
    // values are always valid (allowed) options.
    const firstGrade = fetchedGrades[0] || user?.teaches?.[0]?.grade || user?.grade || 'Grade 3';
    const firstCurr  = fetchedCurricula[0] || user?.teaches?.[0]?.curriculum || user?.curriculum || 'IB PYP';
    setAddTab('create');
    setNewName(''); setNewEmail(''); setNewPassword('');
    setNewGrade(firstGrade);
    setNewCurriculum(firstCurr);
    setCreateError('');
    setLinkEmail(''); setLinkError('');
    setLinkSearch(''); setSelectedStudents([]);
    setBulkResults(null); setBulkSummary(null); setBulkError('');
    setBulkGrade(firstGrade);
    setBulkCurriculum(firstCurr);
    loadLinkableStudents();
    setAddModal(true);
  }

  // confirmedMismatches: rowKey ("Name|Grade|Curriculum") → true, for rows the
  // teacher explicitly approved after being warned they're outside the
  // grades/curricula they teach.
  //
  // STEP 1 — preview only: classifies every row (matched / needs review /
  // already exists) with ZERO database writes, no accounts created, no email,
  // no download. Nothing happens just from picking a file.
  async function previewBulkImport(file: File) {
    bulkFileRef.current = file;
    setBulkImporting(true); setBulkError(''); setBulkResults(null); setBulkSummary(null); setBulkPreview(false);
    try {
      const formData = new FormData();
      formData.append('csv', file, file.name);
      formData.append('defaultGrade', bulkGrade);
      formData.append('defaultCurriculum', bulkCurriculum);
      formData.append('previewOnly', 'true');

      const res = await fetch(
        `${SERVER_URL}/teacher/${encodeURIComponent(user?.email || '')}/students/bulk-import`,
        { method: 'POST', body: formData }
      );
      const data = await res.json();
      if (!res.ok) { setBulkError(data.error || 'Could not read this file.'); return; }
      setBulkResults(data.results || []);
      setBulkSummary(data.summary || null);
      setBulkPreview(true);
      // Every importable row (matched or needs-review) starts checked — the
      // teacher can uncheck any of them; nothing is created until they tap
      // "Import Selected".
      setSelectedRows(new Set(
        (data.results || [])
          .filter((r: any) => r.status === 'matched' || r.status === 'needs_confirmation')
          .map((r: any) => r.rowIndex)
      ));
    } catch (e: any) {
      setBulkError(e.message || 'Network error. Please try again.');
    } finally {
      setBulkImporting(false);
    }
  }

  function toggleRow(rowIndex: number) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex); else next.add(rowIndex);
      return next;
    });
  }

  // STEP 2 — the ONLY action that actually creates anyone. Resubmits the same
  // file with exactly the row indexes the teacher left checked (whether they
  // were originally matched or flagged for review) — one single pass, one
  // download, one email, then the modal closes.
  async function commitBulkImport() {
    if (!bulkFileRef.current) return;
    setBulkImporting(true); setBulkError('');
    try {
      const formData = new FormData();
      formData.append('csv', bulkFileRef.current, bulkFileRef.current.name);
      formData.append('defaultGrade', bulkGrade);
      formData.append('defaultCurriculum', bulkCurriculum);
      formData.append('selectedRowIndexes', JSON.stringify(Array.from(selectedRows)));

      const res = await fetch(
        `${SERVER_URL}/teacher/${encodeURIComponent(user?.email || '')}/students/bulk-import`,
        { method: 'POST', body: formData }
      );
      const data = await res.json();
      if (!res.ok) { setBulkError(data.error || 'Bulk import failed.'); return; }
      downloadCredentials(data.results || []);
      load();
      // The commit step is the entire import — nothing is ever left pending
      // after it, so the modal always closes once it succeeds.
      setAddModal(false);
      setBulkResults(null); setBulkSummary(null); setBulkPreview(false); bulkFileRef.current = null;
    } catch (e: any) {
      setBulkError(e.message || 'Network error. Please try again.');
    } finally {
      setBulkImporting(false);
    }
  }

  // Server-rendered templates (same style as the School Admin bulk import):
  // branded header, borders, frozen row, sample rows visually marked, and
  // pre-filled with this teacher's own existing students.
  //
  // Use a same-origin anchor with the `download` attribute rather than
  // window.open — window.open can be popup-blocked or (in this SPA) open a
  // blank/navigating tab that lands on the dashboard instead of saving the
  // file. An <a download> forces a real download without touching app nav.
  // Fetch the file and download it as a blob URL. A plain same-origin anchor
  // gets intercepted by the SPA router (navigates to the dashboard instead of
  // downloading); a blob: URL can't be intercepted, so this reliably saves the
  // file to Downloads without navigating the app.
  async function triggerTemplateDownload(ext: 'csv' | 'xlsx') {
    if (!user?.email || Platform.OS !== 'web') return;
    const url = `${SERVER_URL}/teacher/${encodeURIComponent(user.email)}/students/template.${ext}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `students_template.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (e) {
      console.error('[template download] failed:', e);
    }
  }

  function downloadTemplate() { triggerTemplateDownload('csv'); }
  function downloadTemplateXlsx() { triggerTemplateDownload('xlsx'); }

  // A single sheet with every login/password from this commit batch — the
  // teacher gets the same list by email too. Auto-triggered right after
  // commitBulkImport succeeds instead of requiring a manual click.
  function downloadCredentials(rows: any[]) {
    const created = rows.filter((r: any) => r.status === 'created' && r.password);
    if (created.length === 0) return;
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Name,Role,Login Email,Password,Grade,Curriculum\n';
    const body = created.map((r: any) => {
      const isParent = r.role === 'parent';
      return [
        r.name,
        isParent ? 'Parent' : 'Student',
        r.email,
        r.password,
        isParent ? '' : (r.grade || bulkGrade),
        isParent ? '' : (r.curriculum || bulkCurriculum),
      ].map(esc).join(',');
    }).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `student_logins_${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function handleCreateStudent() {
    if (!newName.trim()) { setCreateError('Name is required.'); return; }
    setCreating(true); setCreateError('');
    try {
      // 1. Get credentials from server
      const initRes = await fetch(`${SERVER_URL}/teacher/students/init-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim() || undefined,
          password: newPassword.trim() || undefined,
          teacherEmail: user?.email || '',
        }),
      });
      const init = await initRes.json();
      if (!initRes.ok) { setCreateError(init.error || 'Failed to generate credentials.'); return; }

      const finalEmail    = init.email as string;
      const finalPassword = init.password as string;

      // 2. Create Firebase account via secondary app instance
      const tempApp  = initializeApp(firebaseApp.options, `teacher-create-${Date.now()}`);
      const tempAuth = getAuth(tempApp);
      const cred     = await createUserWithEmailAndPassword(tempAuth, finalEmail, finalPassword);
      await updateProfile(cred.user, { displayName: newName.trim() });
      await firebaseSignOut(tempAuth);
      await deleteApp(tempApp);

      // 3. Save to Supabase + link to this teacher
      const linkRes = await fetch(
        `${SERVER_URL}/teacher/${encodeURIComponent(user?.email || '')}/students/link-created`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firebaseUid:     cred.user.uid,
            name:            newName.trim(),
            email:           finalEmail,
            grade:           newGrade,
            curriculum:      newCurriculum,
            initialPassword: finalPassword,
          }),
        }
      );
      const linkData = await linkRes.json();
      if (!linkRes.ok) { setCreateError(linkData.error || 'Failed to save student.'); return; }

      // 4. Show credentials popup
      setCredsEmail(finalEmail);
      setCredsPassword(finalPassword);
      setCredsName(newName.trim());
      setAddModal(false);
      setCredsModal(true);
      load();
    } catch (e: any) {
      setCreateError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  // Grades this teacher handles. Prefer the freshly-fetched teaches[] grades;
  // fall back to user.teaches (cached profile); only use a default if neither exists.
  const teacherGrades: string[] = user?.teaches?.map((t: any) => t.grade).filter(Boolean) ?? [];
  const allowedGrades = fetchedGrades.length > 0
    ? fetchedGrades
    : (teacherGrades.length > 0 ? teacherGrades : ['Grade 3', 'Grade 4', 'Grade 5']);
  // Curricula this teacher handles (for the student curriculum picker).
  const teacherCurricula: string[] = [...new Set((user?.teaches?.map((t: any) => t.curriculum).filter(Boolean)) ?? [])] as string[];
  const allowedCurricula = fetchedCurricula.length > 0
    ? fetchedCurricula
    : (teacherCurricula.length > 0 ? teacherCurricula : (user?.curriculum ? [user.curriculum] : ['IB PYP']));

  async function loadLinkableStudents() {
    setLinkableLoading(true);
    try {
      // Use the AUTHORITATIVE grades the teacher teaches (allowedGrades = freshly
      // fetched preferences), not the possibly-stale cached user.teaches — otherwise
      // a teacher who teaches Grade 3 + Grade 5 only saw Grade 3 students to link.
      const gradesToUse = allowedGrades.length > 0 ? allowedGrades : teacherGrades;
      const url = gradesToUse.length > 0
        ? `${SERVER_URL}/student/available-to-link?teacherEmail=${encodeURIComponent(user?.email || '')}&grades=${gradesToUse.map(g => encodeURIComponent(g)).join(',')}`
        : `${SERVER_URL}/student/available-to-link?teacherEmail=${encodeURIComponent(user?.email || '')}`;
      const res = await fetch(url);
      if (res.ok) { const data = await res.json(); setLinkableStudents(data); }
    } catch {}
    setLinkableLoading(false);
  }

  async function handleLinkStudent() {
    const emailsToLink = selectedStudents.map(s => s.email).filter(Boolean);
    if (emailsToLink.length === 0 && !linkEmail.trim()) { setLinkError('Please select at least one student.'); return; }
    if (linkEmail.trim()) emailsToLink.push(linkEmail.trim());
    setLinking(true); setLinkError('');
    try {
      for (const email of emailsToLink) {
        const res = await fetch(
          `${SERVER_URL}/teacher/${encodeURIComponent(user?.email || '')}/students/link-existing`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentEmail: email }),
          }
        );
        const data = await res.json();
        if (!res.ok) { setLinkError(data.error || `Could not link ${email}.`); setLinking(false); return; }
      }
      setAddModal(false);
      setLinkEmail('');
      setSelectedStudents([]);
      load();
    } catch (e: any) {
      setLinkError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setLinking(false);
    }
  }

  async function handleRemoveStudent(studentId: string) {
    setRemovingId(studentId);
    try {
      const res = await fetch(
        `${SERVER_URL}/teacher/${encodeURIComponent(user?.email || '')}/students/${studentId}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setStudents(prev => prev.filter(s => s.id !== studentId));
        // Refresh linkable list so the removed student appears immediately
        loadLinkableStudents();
      }
    } catch {}
    setRemovingId(null);
  }

  function togglePromoteSelect(id: string) {
    setSelectedForPromote((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitPromoteMode() {
    setPromoteMode(false);
    setSelectedForPromote(new Set());
    setPromoteDialogOpen(false);
  }

  // Returns an error string on failure, null on success — mirrors the School
  // Admin promote flow so the dialog can stay open and show the message.
  async function applyPromote(targetGrade: string, targetSection: string): Promise<string | null> {
    if (!user?.email || selectedForPromote.size === 0) return 'Nothing selected';
    try {
      const body: any = { studentIds: Array.from(selectedForPromote), grade: targetGrade };
      if (targetSection.trim()) body.section = targetSection.trim();
      const res = await fetch(`${SERVER_URL}/teacher/${encodeURIComponent(user.email)}/students/promote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data?.error || 'Failed to promote selected students.';
      exitPromoteMode();
      load(); // refetch — the students' new grade/section shows up immediately, same source the student's own dashboard reads from
      return null;
    } catch {
      return 'Failed to promote. Check your connection.';
    }
  }

  const todayISO = new Date().toISOString().split('T')[0];

  const filtered = students.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
    const matchTab =
      activeTab === 'All'             ? true :
      activeTab === 'Needs Attention' ? s.needsAttention :
      activeTab === 'Active Today'    ? s.lastActive?.startsWith(todayISO) :
      activeTab === 'Inactive'        ? isInactiveStudent(s) :
      activeTab === 'Streak Risk'     ? (s.currentStreak || 0) === 1 :
      activeTab === 'Top Performers'  ? (s.progressPct || 0) >= 50 :
      s.grade === activeTab;
    return matchSearch && matchTab;
  });

  // Build grade tabs dynamically from actual student data
  const gradeTabs = ['All', ...Array.from(new Set(students.map(s => s.grade))).sort(), 'Needs Attention', 'Active Today', 'Inactive', 'Streak Risk', 'Top Performers'];

  const stats = {
    total: students.length,
    onTrack: students.filter(s => !s.needsAttention).length,
    attention: students.filter(s => s.needsAttention).length,
    activeToday: students.filter(s => s.lastActive?.startsWith(todayISO)).length,
    inactive: students.filter(isInactiveStudent).length,
    streakRisk: students.filter(s => (s.currentStreak || 0) === 1).length,
    topPerformers: students.filter(s => (s.progressPct || 0) >= 50).length,
    avgProgress: students.length
      ? Math.round(students.reduce((a, s) => a + s.progressPct, 0) / students.length)
      : 0,
  };

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Students"
          subtitle={`${stats.total} enrolled`}
          onMenuPress={() => navigation.openDrawer()}
        />
        {/* Add Student / Promote Students buttons */}
        <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'flex-end', marginHorizontal: spacing.xl, marginBottom: 4 }}>
          <TouchableOpacity style={[styles.addBtn, { marginHorizontal: 0, marginBottom: 0, alignSelf: 'auto' }]} onPress={openAddModal} activeOpacity={0.8}>
            <Feather name="user-plus" size={14} color={gold} />
            <Text style={styles.addBtnText}>Add Student</Text>
          </TouchableOpacity>
          {students.length > 0 && (
            promoteMode ? (
              <TouchableOpacity style={styles.promoteBtnActive} onPress={exitPromoteMode} activeOpacity={0.8}>
                <Feather name="x" size={14} color={colors.textMuted} />
                <Text style={styles.promoteBtnActiveText}>Cancel</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.promoteBtn} onPress={() => setPromoteMode(true)} activeOpacity={0.8}>
                <Feather name="arrow-up-circle" size={14} color={gold} />
                <Text style={styles.promoteBtnText}>Promote Students</Text>
              </TouchableOpacity>
            )
          )}
        </View>

        {promoteMode && (
          <View style={styles.promoteBar}>
            <Text style={styles.promoteBarText}>
              {selectedForPromote.size === 0 ? 'Tap students to select them' : `${selectedForPromote.size} selected`}
            </Text>
            <TouchableOpacity
              style={[styles.promoteConfirmBtn, selectedForPromote.size === 0 && { opacity: 0.5 }]}
              onPress={() => setPromoteDialogOpen(true)}
              disabled={selectedForPromote.size === 0}
              activeOpacity={0.8}
            >
              <Text style={styles.promoteConfirmBtnText}>Promote</Text>
            </TouchableOpacity>
          </View>
        )}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accentYellow} />}
        >
          {/* Stats Row */}
          <View style={styles.statsRow}>
            {[
              { label: 'Total', value: stats.total, color: gold },
              { label: 'On Track', value: stats.onTrack, color: colors.accentGreen },
              { label: 'Need Attention', value: stats.attention, color: colors.accentRed },
              { label: 'Avg Progress', value: `${stats.avgProgress}%`, color: colors.accentCyan },
            ].map((s) => (
              <View key={s.label} style={styles.statCard}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <Feather name="search" size={15} color={colors.textDim} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search students..."
              placeholderTextColor={colors.textDim}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Feather name="x" size={15} color={colors.textDim} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Filter Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs}>
            {gradeTabs.map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.75}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
                {tab === 'Needs Attention' && stats.attention > 0 && (
                  <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{stats.attention}</Text></View>
                )}
                {tab === 'Active Today' && stats.activeToday > 0 && (
                  <View style={[styles.tabBadge, { backgroundColor: '#5A8A70' }]}><Text style={styles.tabBadgeText}>{stats.activeToday}</Text></View>
                )}
                {tab === 'Inactive' && stats.inactive > 0 && (
                  <View style={[styles.tabBadge, { backgroundColor: '#8A8358' }]}><Text style={styles.tabBadgeText}>{stats.inactive}</Text></View>
                )}
                {tab === 'Streak Risk' && stats.streakRisk > 0 && (
                  <View style={[styles.tabBadge, { backgroundColor: '#C4836A' }]}><Text style={styles.tabBadgeText}>{stats.streakRisk}</Text></View>
                )}
                {tab === 'Top Performers' && stats.topPerformers > 0 && (
                  <View style={[styles.tabBadge, { backgroundColor: '#5A8A70' }]}><Text style={styles.tabBadgeText}>{stats.topPerformers}</Text></View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Student List */}
          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="users" size={36} color={colors.textDim} />
              <Text style={styles.emptyText}>
                {students.length === 0 ? 'No students yet' : 'No students match'}
              </Text>
              {students.length === 0 && (
                <TouchableOpacity style={styles.emptyAddBtn} onPress={openAddModal} activeOpacity={0.8}>
                  <Feather name="user-plus" size={14} color="#fff" />
                  <Text style={styles.emptyAddBtnText}>Add your first student</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.studentGrid}>
            {filtered.map((s) => {
              const displayName = toTitleCase(s.name);
              const grad = avatarGradient(displayName);
              const isSelectedForPromote = selectedForPromote.has(s.id);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.studentCard, promoteMode && isSelectedForPromote && styles.studentCardSelected]}
                  activeOpacity={0.85}
                  onPress={() => promoteMode ? togglePromoteSelect(s.id) : navigation.navigate('TeacherProgress' as any, { studentId: s.id })}
                >
                  {/* Top row */}
                  <View style={styles.cardTop}>
                    {promoteMode && (
                      <Feather
                        name={isSelectedForPromote ? 'check-square' : 'square'}
                        size={16}
                        color={isSelectedForPromote ? gold : colors.textDim}
                        style={{ marginRight: 2 }}
                      />
                    )}
                    <StudentAvatar photoUrl={s.photoUrl} name={displayName} grad={grad} styles={styles} />
                    <View style={styles.cardInfo}>
                      <Text style={styles.studentName}>{displayName}</Text>
                      <Text style={styles.studentMeta}>{s.grade} · {s.curriculum}</Text>
                    </View>
                    {s.needsAttention ? (
                      <View style={styles.attentionBadge}>
                        <Feather name="alert-circle" size={11} color="#B8797E" />
                        <Text style={[styles.badgeText, { color: '#B8797E' }]}>Attention</Text>
                      </View>
                    ) : s.hasStarted === false ? (
                      // Brand-new student who hasn't engaged yet — show a neutral
                      // "Getting Started" state instead of "On Track", which would
                      // wrongly imply proven progress on a 0% account.
                      <View style={styles.gettingStartedBadge}>
                        <Feather name="play-circle" size={11} color="#9A7B2E" />
                        <Text style={[styles.badgeText, { color: '#9A7B2E' }]}>Getting Started</Text>
                      </View>
                    ) : (
                      <View style={styles.onTrackBadge}>
                        <Feather name="check-circle" size={11} color="#5A8A70" />
                        <Text style={[styles.badgeText, { color: '#5A8A70' }]}>On Track</Text>
                      </View>
                    )}
                    {!promoteMode && (
                      <TouchableOpacity
                        onPress={() => handleRemoveStudent(s.id)}
                        disabled={removingId === s.id}
                        style={{ padding: 4, marginLeft: 4 }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {removingId === s.id
                          ? <ActivityIndicator size="small" color={colors.accentRed} />
                          : <Feather name="user-minus" size={15} color={colors.accentRed} />}
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Progress bar */}
                  <View style={styles.progressWrap}>
                    <View style={styles.progressBarBg}>
                      <LinearGradient
                        colors={s.needsAttention ? ['#B8797E', '#C4836A'] : ['#5F8A86', '#5A8A70']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.progressBarFill, { width: `${s.progressPct}%` as any }]}
                      />
                    </View>
                    <Text style={styles.progressText}>{s.progressPct}%</Text>
                  </View>

                  {/* Stats row */}
                  <View style={styles.cardStats}>
                    <View style={styles.cardStat}>
                      <Feather name="zap" size={12} color="#C5BD96" />
                      <Text style={styles.cardStatVal}>{s.xpPoints} XP</Text>
                    </View>
                    <View style={styles.cardStat}>
                      <Feather name="activity" size={12} color="#C4836A" />
                      <Text style={styles.cardStatVal}>{s.currentStreak}d streak</Text>
                    </View>
                    <View style={styles.cardStat}>
                      <Feather name="book-open" size={12} color="#7AADA8" />
                      <Text style={styles.cardStatVal}>{s.completedTopics.length} topics</Text>
                    </View>
                    <View style={styles.cardStat}>
                      <Feather name="clock" size={12} color={colors.textDim} />
                      <Text style={styles.cardStatVal}>{lastActiveLabel(s.lastActive)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
            </View>
          )}
        </ScrollView>
      </View>

      {/* ── Add Student Modal ── */}
      <Modal visible={addModal} transparent animationType="fade" onRequestClose={() => setAddModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: gold + '18', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="user-plus" size={16} color={gold} />
                </View>
                <Text style={styles.modalTitle}>Add Student</Text>
              </View>
              <TouchableOpacity onPress={() => {
                setAddModal(false);
                setBulkResults(null); setBulkSummary(null); setBulkPreview(false); setBulkError(''); bulkFileRef.current = null;
              }}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.modalTabs}>
              <TouchableOpacity
                style={[styles.modalTab, addTab === 'create' && styles.modalTabActive]}
                onPress={() => { setAddTab('create'); setCreateError(''); setLinkError(''); }}
                activeOpacity={0.8}
              >
                <Feather name="user-plus" size={13} color={addTab === 'create' ? gold : colors.textMuted} />
                <Text style={[styles.modalTabText, addTab === 'create' && { color: gold }]}>Create New</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalTab, addTab === 'link' && styles.modalTabActive]}
                onPress={() => { setAddTab('link'); setCreateError(''); setLinkError(''); setSelectedStudents([]); setLinkSearch(''); setLinkGradeFilter('All'); loadLinkableStudents(); }}
                activeOpacity={0.8}
              >
                <Feather name="link" size={13} color={addTab === 'link' ? gold : colors.textMuted} />
                <Text style={[styles.modalTabText, addTab === 'link' && { color: gold }]}>Link Existing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalTab, addTab === 'bulk' && styles.modalTabActive]}
                onPress={() => { setAddTab('bulk'); setCreateError(''); setLinkError(''); setBulkResults(null); setBulkSummary(null); setBulkError(''); }}
                activeOpacity={0.8}
              >
                <Feather name="upload" size={13} color={addTab === 'bulk' ? gold : colors.textMuted} />
                <Text style={[styles.modalTabText, addTab === 'bulk' && { color: gold }]}>Bulk Import</Text>
              </TouchableOpacity>
            </View>

            {addTab === 'create' && (
              <View style={{ gap: 10 }}>
                <Text style={styles.modalFieldLabel}>Full Name *</Text>
                <View style={styles.modalInput}>
                  <Feather name="user" size={14} color={colors.textDim} />
                  <TextInput
                    style={styles.modalTextInput}
                    value={newName} onChangeText={setNewName}
                    placeholder="e.g. Aanya Kapoor" placeholderTextColor={colors.textDim}
                    autoCapitalize="words" autoFocus
                  />
                </View>

                <Text style={styles.modalFieldLabel}>Email <Text style={{ fontWeight: '400', color: colors.textDim }}>(optional — auto-generated if blank)</Text></Text>
                <View style={styles.modalInput}>
                  <Feather name="mail" size={14} color={colors.textDim} />
                  <TextInput
                    style={styles.modalTextInput}
                    value={newEmail} onChangeText={setNewEmail}
                    placeholder="Leave blank to auto-generate" placeholderTextColor={colors.textDim}
                    keyboardType="email-address" autoCapitalize="none"
                  />
                </View>

                <Text style={styles.modalFieldLabel}>Password <Text style={{ fontWeight: '400', color: colors.textDim }}>(optional)</Text></Text>
                <View style={styles.modalInput}>
                  <Feather name="lock" size={14} color={colors.textDim} />
                  <TextInput
                    style={styles.modalTextInput}
                    value={newPassword} onChangeText={setNewPassword}
                    placeholder="Leave blank to auto-generate" placeholderTextColor={colors.textDim}
                    secureTextEntry
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalFieldLabel}>Grade</Text>
                    {allowedGrades.map(g => (
                      <TouchableOpacity
                        key={g} activeOpacity={0.8}
                        onPress={() => setNewGrade(g)}
                        style={[styles.modalOption, { borderColor: newGrade === g ? gold : colors.borderColor, backgroundColor: newGrade === g ? gold + '18' : 'transparent' }]}
                      >
                        <Text style={{ fontSize: 12, color: newGrade === g ? gold : colors.textMuted, fontWeight: '600' }}>{g}</Text>
                        {newGrade === g && <Feather name="check" size={12} color={gold} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalFieldLabel}>Curriculum</Text>
                    {allowedCurricula.map(c => (
                      <TouchableOpacity
                        key={c} activeOpacity={0.8}
                        onPress={() => setNewCurriculum(c)}
                        disabled={allowedCurricula.length <= 1}
                        style={[styles.modalOption, { borderColor: newCurriculum === c ? gold : colors.borderColor, backgroundColor: newCurriculum === c ? gold + '18' : 'transparent' }]}
                      >
                        <Text style={{ fontSize: 12, color: newCurriculum === c ? gold : colors.textMuted, fontWeight: '600', flex: 1 }}>{c}</Text>
                        {newCurriculum === c && <Feather name={allowedCurricula.length <= 1 ? 'lock' : 'check'} size={11} color={gold} />}
                      </TouchableOpacity>
                    ))}
                    <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 5, lineHeight: 14 }}>
                      {allowedCurricula.length > 1 ? 'Pick the curriculum for this student.' : 'Matches your curriculum. Contact admin to change.'}
                    </Text>
                  </View>
                </View>

                {createError ? <Text style={{ color: colors.accentRed, fontSize: 13 }}>{createError}</Text> : null}

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setAddModal(false)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalSaveBtn} onPress={handleCreateStudent} disabled={creating}>
                    {creating
                      ? <ActivityIndicator color="white" size="small" />
                      : <Text style={styles.modalSaveText}>Create Account</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {addTab === 'link' && (
              <View style={{ gap: 10 }}>
                <Text style={styles.modalNote}>
                  Select a student from your grade &amp; curriculum to add to your class.
                </Text>

                {/* Search bar */}
                <View style={styles.modalInput}>
                  <Feather name="search" size={14} color={colors.textDim} />
                  <TextInput
                    style={styles.modalTextInput}
                    value={linkSearch} onChangeText={setLinkSearch}
                    placeholder="Search by name or email…" placeholderTextColor={colors.textDim}
                    autoCapitalize="none"
                  />
                  {linkSearch ? (
                    <TouchableOpacity onPress={() => setLinkSearch('')}>
                      <Feather name="x" size={14} color={colors.textDim} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Grade filter pills — show EVERY grade the teacher teaches (so a
                    Grade 3 + Grade 5 teacher gets both chips), unioned with any grades
                    actually present in the returned students. */}
                {!linkableLoading && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                    {['All', ...Array.from(new Set([...allowedGrades, ...linkableStudents.map(s => s.grade)].filter(Boolean))).sort()].map(g => (
                      <TouchableOpacity
                        key={g}
                        onPress={() => setLinkGradeFilter(g)}
                        activeOpacity={0.8}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 5,
                          borderRadius: 999, borderWidth: 1,
                          borderColor: linkGradeFilter === g ? gold : colors.borderColor,
                          backgroundColor: linkGradeFilter === g ? gold + '18' : 'transparent',
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '600', color: linkGradeFilter === g ? gold : colors.textMuted }}>
                          {g}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {/* Student list */}
                {linkableLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <ActivityIndicator size="small" color={colors.accentYellow} />
                    <Text style={{ color: colors.textDim, fontSize: 12, marginTop: 6 }}>Loading students…</Text>
                  </View>
                ) : linkableStudents.length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <Feather name="users" size={24} color={colors.textDim} />
                    <Text style={{ color: colors.textDim, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                      No unlinked students found for your grade &amp; curriculum.
                    </Text>
                  </View>
                ) : (
                  <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    {linkableStudents
                      .filter(s => {
                        const q = linkSearch.toLowerCase();
                        const matchSearch = !q || s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q);
                        const matchGrade = linkGradeFilter === 'All' || s.grade === linkGradeFilter;
                        return matchSearch && matchGrade;
                      })
                      .map(s => {
                        const isSelected = selectedStudents.some(x => x.id === s.id);
                        return (
                          <TouchableOpacity
                            key={s.id}
                            onPress={() => setSelectedStudents(prev =>
                              isSelected ? prev.filter(x => x.id !== s.id) : [...prev, s]
                            )}
                            activeOpacity={0.8}
                            style={{
                              flexDirection: 'row', alignItems: 'center', gap: 10,
                              paddingVertical: 9, paddingHorizontal: 10,
                              borderRadius: 8, marginBottom: 4,
                              backgroundColor: isSelected ? gold + '18' : (isDark ? colors.cardDark : '#F5F5F5'),
                              borderWidth: 1,
                              borderColor: isSelected ? gold : 'transparent',
                            }}
                          >
                            <View style={{
                              width: 32, height: 32, borderRadius: 16,
                              backgroundColor: gold + '18',
                              alignItems: 'center', justifyContent: 'center',
                            }}>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: gold }}>
                                {(s.name || '?').split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain }}>{s.name}</Text>
                              <Text style={{ fontSize: 11, color: colors.textDim }}>{s.email}</Text>
                            </View>
                            {isSelected && <Feather name="check-circle" size={16} color={gold} />}
                          </TouchableOpacity>
                        );
                      })}
                  </ScrollView>
                )}

                {selectedStudents.length > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, backgroundColor: gold + '18', flexWrap: 'wrap' }}>
                    <Feather name="user-check" size={13} color={gold} />
                    <Text style={{ fontSize: 12, color: gold, fontWeight: '600' }}>
                      {selectedStudents.length === 1
                        ? `Selected: ${selectedStudents[0].name}`
                        : `${selectedStudents.length} students selected: ${selectedStudents.map(s => s.name).join(', ')}`}
                    </Text>
                  </View>
                )}

                {linkError ? <Text style={{ color: colors.accentRed, fontSize: 13 }}>{linkError}</Text> : null}

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setAddModal(false)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalSaveBtn, selectedStudents.length === 0 && !linkEmail.trim() && { opacity: 0.5 }]}
                    onPress={handleLinkStudent}
                    disabled={linking || (selectedStudents.length === 0 && !linkEmail.trim())}
                  >
                    {linking
                      ? <ActivityIndicator color="white" size="small" />
                      : <Text style={styles.modalSaveText}>{selectedStudents.length > 1 ? `Link ${selectedStudents.length} Students` : 'Link Student'}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {addTab === 'bulk' && (
              <View style={{ gap: 12 }}>
                {!bulkResults ? (
                  <>
                    <Text style={styles.modalNote}>
                      Upload a CSV or Excel file with columns: <Text style={{ color: colors.textMain, fontWeight: '700' }}>Name</Text>, Email (optional), Grade, Curriculum, School, Parent Name, Parent Email, Parent Phone. When a Parent Name is filled in, the parent gets their own account too. Everyone is asked to set a new password on first sign-in.
                    </Text>

                    {/* Default Grade / Curriculum for rows without those columns */}
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modalFieldLabel}>Default Grade</Text>
                        {allowedGrades.map(g => (
                          <TouchableOpacity key={g} activeOpacity={0.8} onPress={() => setBulkGrade(g)}
                            style={[styles.modalOption, { borderColor: bulkGrade === g ? gold : colors.borderColor, backgroundColor: bulkGrade === g ? gold + '18' : 'transparent' }]}>
                            <Text style={{ fontSize: 12, color: bulkGrade === g ? gold : colors.textMuted, fontWeight: '600' }}>{g}</Text>
                            {bulkGrade === g && <Feather name="check" size={12} color={gold} />}
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.modalFieldLabel}>Default Curriculum</Text>
                        {allowedCurricula.map(c => (
                          <TouchableOpacity
                            key={c} activeOpacity={0.8}
                            onPress={() => setBulkCurriculum(c)}
                            disabled={allowedCurricula.length <= 1}
                            style={[styles.modalOption, { borderColor: bulkCurriculum === c ? gold : colors.borderColor, backgroundColor: bulkCurriculum === c ? gold + '18' : 'transparent' }]}
                          >
                            <Text style={{ fontSize: 12, color: bulkCurriculum === c ? gold : colors.textMuted, fontWeight: '600', flex: 1 }}>{c}</Text>
                            {bulkCurriculum === c && <Feather name={allowedCurricula.length <= 1 ? 'lock' : 'check'} size={11} color={gold} />}
                          </TouchableOpacity>
                        ))}
                        <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 5, lineHeight: 14 }}>
                          {allowedCurricula.length > 1 ? 'Pick the curriculum for imported students.' : 'Matches your curriculum. Contact admin to change.'}
                        </Text>
                      </View>
                    </View>

                    {bulkError ? (
                      <Text style={{ color: colors.accentRed, fontSize: 13 }}>{bulkError}</Text>
                    ) : null}

                    {/* Hidden file input for web */}
                    {Platform.OS === 'web' && (
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                        style={{ display: 'none' }}
                        onChange={(e: any) => {
                          const f = e.target.files?.[0];
                          if (f) previewBulkImport(f);
                          e.target.value = '';
                        }}
                      />
                    )}

                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <TouchableOpacity
                        style={[styles.modalCancelBtn, { flex: 1 }]}
                        onPress={downloadTemplate}
                        activeOpacity={0.8}
                      >
                        <Feather name="download" size={14} color={colors.textMuted} />
                        <Text style={styles.modalCancelText}>Template (CSV)</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.modalCancelBtn, { flex: 1 }]}
                        onPress={downloadTemplateXlsx}
                        activeOpacity={0.8}
                      >
                        <Feather name="file-text" size={14} color={colors.textMuted} />
                        <Text style={styles.modalCancelText}>Template (Excel)</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <TouchableOpacity
                        style={[styles.modalSaveBtn, { flex: 1 }, bulkImporting && { opacity: 0.6 }]}
                        onPress={() => {
                          if (Platform.OS === 'web') fileInputRef.current?.click();
                        }}
                        disabled={bulkImporting}
                        activeOpacity={0.8}
                      >
                        {bulkImporting
                          ? <><ActivityIndicator color="white" size="small" /><Text style={styles.modalSaveText}>Importing...</Text></>
                          : <><Feather name="upload" size={14} color="#fff" /><Text style={styles.modalSaveText}>Choose File</Text></>}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  /* Preview / selection view — NOTHING has been created yet. The
                     only way anyone gets created is the explicit "Import Selected"
                     tap below, which closes this modal itself once it succeeds. */
                  <>
                    {bulkSummary && (
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        {[
                          { label: 'Matches Your Class', value: bulkSummary.matched ?? 0, color: colors.accentGreen },
                          { label: 'Needs Review', value: bulkSummary.needsConfirmation ?? 0, color: '#B8797E' },
                          { label: 'Already Exists', value: bulkSummary.skipped ?? 0, color: colors.accentYellow },
                        ].map(s => (
                          <View key={s.label} style={{ flex: 1, minWidth: 70, backgroundColor: s.color + '15', borderWidth: 1, borderColor: s.color + '30', borderRadius: 8, padding: 10, alignItems: 'center' }}>
                            <Text style={{ fontSize: 20, fontWeight: '800', color: s.color }}>{s.value}</Text>
                            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{s.label}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    <Text style={styles.modalNote}>
                      Nothing has been created yet. Uncheck anyone you don't want to import, then tap "Import Selected".
                    </Text>

                    <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                      {bulkResults.filter((r: any) => r.status !== 'skipped').map((r: any) => {
                        const isChecked = selectedRows.has(r.rowIndex);
                        const dotColor = r.status === 'needs_confirmation' ? '#B8797E' : colors.accentGreen;
                        return (
                          <TouchableOpacity
                            key={r.rowIndex} activeOpacity={0.7} onPress={() => toggleRow(r.rowIndex)}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderColor }}
                          >
                            <View style={{
                              width: 18, height: 18, borderRadius: 4, borderWidth: 2,
                              borderColor: isChecked ? dotColor : colors.borderColor,
                              backgroundColor: isChecked ? dotColor : 'transparent',
                              alignItems: 'center', justifyContent: 'center',
                            }}>
                              {isChecked && <Feather name="check" size={12} color="#fff" />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain }}>{r.name}</Text>
                              <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={1}>
                                {r.grade} · {r.curriculum}{r.email ? ` · ${r.email}` : ''}
                              </Text>
                              {r.parentName ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}>
                                  <Feather name="users" size={10} color={colors.textDim} />
                                  <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1 }} numberOfLines={1}>
                                    {r.parentName}{r.parentEmail ? ` · ${r.parentEmail}` : ''}
                                  </Text>
                                </View>
                              ) : null}
                              {r.error ? <Text style={{ fontSize: 11, color: dotColor }}>{r.error}</Text> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                      {bulkResults.filter((r: any) => r.status === 'skipped').map((r: any) => (
                        <View key={r.rowIndex} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderColor, opacity: 0.6 }}>
                          <Feather name="skip-forward" size={14} color={colors.accentYellow} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain }}>{r.name}</Text>
                            <Text style={{ fontSize: 11, color: colors.accentYellow }}>{r.error}</Text>
                          </View>
                        </View>
                      ))}
                    </ScrollView>

                    {bulkError ? (
                      <Text style={{ color: colors.accentRed, fontSize: 13 }}>{bulkError}</Text>
                    ) : null}

                    <View style={styles.modalBtns}>
                      <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setBulkResults(null); setBulkSummary(null); setBulkPreview(false); setBulkError(''); bulkFileRef.current = null; }}>
                        <Text style={styles.modalCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modalSaveBtn, (bulkImporting || selectedRows.size === 0) && { opacity: 0.6 }]}
                        onPress={commitBulkImport}
                        disabled={bulkImporting || selectedRows.size === 0}
                      >
                        {bulkImporting
                          ? <><ActivityIndicator color="white" size="small" /><Text style={styles.modalSaveText}>Importing...</Text></>
                          : <Text style={styles.modalSaveText}>Import Selected ({selectedRows.size})</Text>}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Credentials Modal (shown after creating a new student) ── */}
      <Modal visible={credsModal} transparent animationType="fade" onRequestClose={() => setCredsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#5A8A7020', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="check-circle" size={16} color={colors.accentGreen} />
                </View>
                <Text style={styles.modalTitle}>Account Created</Text>
              </View>
              <TouchableOpacity onPress={() => setCredsModal(false)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalNote}>{credsName} has been added to your class. Share these credentials with the student.</Text>

            {[
              { label: 'Login Email / ID', value: credsEmail, field: 'cEmail' },
              { label: 'Password', value: credsPassword, field: 'cPass' },
            ].map(item => (
              <View key={item.label} style={{ marginBottom: 10 }}>
                <Text style={styles.modalFieldLabel}>{item.label}</Text>
                <View style={[styles.modalInput, { backgroundColor: colors.bgDark, flexDirection: 'row', alignItems: 'center' }]}>
                  <Text style={[styles.modalTextInput, { flex: 1, color: colors.textMain }]}>{item.value}</Text>
                  <TouchableOpacity onPress={() => copyCredsField(item.value, item.field)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 8 }}>
                    <Feather name={credsCopiedField === item.field ? 'check' : 'copy'} size={15} color={credsCopiedField === item.field ? colors.accentGreen : colors.textDim} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', justifyContent: 'center', gap: 6, backgroundColor: gold + '18', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, marginTop: 2, marginBottom: 4 }}
              onPress={() => shareCredsToStudent(credsName, credsEmail, credsPassword)}
              activeOpacity={0.8}
            >
              <Feather name="share-2" size={13} color={gold} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: gold }}>Share Login Details</Text>
            </TouchableOpacity>

            <View style={{ backgroundColor: gold + '18', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: gold + '30', marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                The student can log in immediately with these credentials. Save them now — the password cannot be retrieved later.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalSaveBtn, { flex: 0, alignSelf: 'center', height: 40, paddingHorizontal: 36 }]}
                onPress={() => setCredsModal(false)}
              >
                <Text style={styles.modalSaveText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <TeacherPromoteDialog
        visible={promoteDialogOpen}
        selectedStudents={students.filter((s) => selectedForPromote.has(s.id))}
        colors={colors}
        onClose={() => setPromoteDialogOpen(false)}
        onConfirm={applyPromote}
      />
    </ScreenLayout>
  );
}

// Pulls the first number out of a grade label ("Grade 4" -> 4) — promotion
// targets are always a move FORWARD, so grades at or below the student's
// current one are dropped from the picker.
function gradeNum(g: string | null | undefined): number | null {
  if (!g) return null;
  const m = String(g).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}
const IB_PROGRAMS = ['IB PYP', 'IB MYP', 'IB DP'];
function gradesForProgram(p: string): string[] {
  if (p === 'IB PYP') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'];
  if (p === 'IB MYP') return ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  if (p === 'IB DP') return ['Grade 11', 'Grade 12'];
  return [];
}

function TeacherPromoteDialog({ visible, selectedStudents, colors, onClose, onConfirm }: {
  visible: boolean; selectedStudents: Student[]; colors: AppColors;
  onClose: () => void; onConfirm: (targetGrade: string, targetSection: string) => Promise<string | null>;
}) {
  const gold = colors.accentYellow;
  const [targetGrade, setTargetGrade] = useState('');
  const [targetProgram, setTargetProgram] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (visible) { setTargetGrade(''); setTargetProgram(''); setErr(''); }
  }, [visible]);

  const currentGrades = useMemo(() => Array.from(new Set(selectedStudents.map((s) => s.grade).filter(Boolean))), [selectedStudents]);
  const maxCurrentGradeNum = useMemo(() => {
    const nums = currentGrades.map(gradeNum).filter((n): n is number => n !== null);
    return nums.length ? Math.max(...nums) : null;
  }, [currentGrades]);
  const isIBSelection = useMemo(
    () => selectedStudents.some((s) => (s.curriculum || '').toUpperCase().startsWith('IB')),
    [selectedStudents]
  );
  const gradeChoices = useMemo(() => {
    const pool = isIBSelection
      ? (targetProgram ? gradesForProgram(targetProgram) : [])
      : ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
    if (maxCurrentGradeNum === null) return pool;
    return pool.filter((g) => {
      const n = gradeNum(g);
      return n === null || n > maxCurrentGradeNum;
    });
  }, [isIBSelection, targetProgram, maxCurrentGradeNum]);

  async function handleConfirm() {
    if (!targetGrade.trim()) { setErr('Pick a target grade.'); return; }
    setErr('');
    setSubmitting(true);
    const error = await onConfirm(targetGrade.trim(), '');
    setSubmitting(false);
    if (error) setErr(error);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={dialogStyles.overlay}>
        <View style={[dialogStyles.card, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
          <View style={dialogStyles.header}>
            <Text style={[dialogStyles.title, { color: colors.textHeading }]}>Promote Students</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={18} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <Text style={[dialogStyles.hint, { color: colors.textDim }]}>
            {selectedStudents.length} student{selectedStudents.length === 1 ? '' : 's'} selected · currently {currentGrades.length > 0 ? currentGrades.join(', ') : 'an unset grade'}
          </Text>

          {isIBSelection && (
            <>
              <Text style={[dialogStyles.label, { color: colors.textMuted }]}>Target programme</Text>
              <View style={dialogStyles.chipRow}>
                {IB_PROGRAMS.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[dialogStyles.chip, { borderColor: colors.borderColor }, targetProgram === p && { borderColor: gold, backgroundColor: gold + '18' }]}
                    onPress={() => { setTargetProgram(p); setTargetGrade(''); }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: targetProgram === p ? gold : colors.textMuted }}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={[dialogStyles.label, { color: colors.textMuted }]}>Target grade</Text>
          {gradeChoices.length > 0 ? (
            <View style={dialogStyles.chipRow}>
              {gradeChoices.map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[dialogStyles.chip, { borderColor: colors.borderColor }, targetGrade === g && { borderColor: gold, backgroundColor: gold + '18' }]}
                  onPress={() => setTargetGrade(g)}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: targetGrade === g ? gold : colors.textMuted }}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={{ fontSize: 12, color: colors.textDim, marginBottom: 8 }}>
              {isIBSelection && !targetProgram ? 'Pick a programme above to see its grades.' : 'No higher grade available.'}
            </Text>
          )}

          {!!err && <Text style={{ color: colors.accentRed, fontSize: 12, marginTop: 8 }}>{err}</Text>}

          <View style={dialogStyles.footer}>
            <TouchableOpacity style={[dialogStyles.cancelBtn, { borderColor: colors.borderColor }]} onPress={onClose} disabled={submitting}>
              <Text style={{ color: colors.textMuted, fontWeight: '600', fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dialogStyles.submitBtn, { backgroundColor: gold }, (submitting || !targetGrade.trim()) && { opacity: 0.5 }]}
              onPress={handleConfirm}
              disabled={submitting || !targetGrade.trim()}
            >
              {submitting ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={{ color: '#0B0B0B', fontWeight: '700', fontSize: 13 }}>Promote</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dialogStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, borderRadius: 16, borderWidth: 1, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  hint: { fontSize: 12, marginBottom: 14, lineHeight: 17 },
  label: { fontSize: 11.5, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  footer: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  submitBtn: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
});

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', gap: 2,
  },
  statValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: { fontSize: 10, color: c.textDim, textAlign: 'center', fontWeight: '500' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: c.textMain, fontSize: 14 },

  tabsScroll: { marginHorizontal: -spacing.xl },
  tabs: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  tabActive: { backgroundColor: c.accentYellow + '18', borderColor: c.accentYellow },
  tabText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  tabTextActive: { color: c.accentYellow },
  tabBadge: {
    backgroundColor: c.accentRed, borderRadius: 8, width: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },

  empty: { alignItems: 'center', gap: 12, paddingTop: 40 },
  emptyText: { fontSize: 14, color: c.textDim },

  studentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  studentCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md,
    width: '49%',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  cardInfo: { flex: 1 },
  studentName: { fontSize: 15, fontWeight: '700', color: c.textMain },
  studentMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  attentionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#B8797E18', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#B8797E40',
  },
  onTrackBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#5A8A7018', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#5A8A7040',
  },
  gettingStartedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#9A7B2E18', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#9A7B2E40',
  },
  badgeText: { fontSize: 10, fontWeight: '700' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressBarBg: { flex: 1, height: 6, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  progressText: { fontSize: 11, fontWeight: '700', color: c.textMuted, width: 32, textAlign: 'right' },

  cardStats: { flexDirection: 'row', gap: spacing.lg },
  cardStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardStatVal: { fontSize: 11, color: c.textMuted, fontWeight: '600' },

  // Add student button (below header)
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end',
    marginHorizontal: spacing.xl, marginBottom: 4,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1,
    borderColor: c.accentYellow + '40', backgroundColor: c.accentYellow + '18',
  },
  addBtnText: { fontSize: 13, fontWeight: '600', color: c.accentYellow },

  promoteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1,
    borderColor: c.accentYellow + '40', backgroundColor: c.accentYellow + '18',
  },
  promoteBtnText: { fontSize: 13, fontWeight: '600', color: c.accentYellow },
  promoteBtnActive: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor,
  },
  promoteBtnActiveText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  promoteBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: spacing.xl, marginBottom: 8,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md, backgroundColor: c.accentYellow + '12',
    borderWidth: 1, borderColor: c.accentYellow + '30',
  },
  promoteBarText: { fontSize: 12.5, fontWeight: '600', color: c.textMuted },
  promoteConfirmBtn: { backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 7 },
  promoteConfirmBtnText: { fontSize: 12.5, fontWeight: '700', color: '#0B0B0B' },
  studentCardSelected: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '0D' },

  // Empty state add button
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    paddingHorizontal: spacing.xl, paddingVertical: 12,
    borderRadius: radius.md, backgroundColor: c.accentYellow,
  },
  emptyAddBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, width: '100%', maxWidth: 480 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalNote: { fontSize: 13, color: c.textMuted, lineHeight: 20, marginBottom: spacing.md },
  modalTabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  modalTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: radius.md, borderWidth: 1,
    borderColor: c.borderColor, backgroundColor: 'transparent',
  },
  modalTabActive: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
  modalTabText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  modalFieldLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 4 },
  modalInput: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, height: 46, paddingHorizontal: spacing.md,
  },
  modalTextInput: { flex: 1, fontSize: 14, color: c.textMain, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  modalOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, marginTop: 4,
  },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },
});
