/**
 * OnboardingScreen.tsx
 * Multi-step onboarding for Student, Teacher, Parent
 * Collects role-specific data, saves to backend, marks onboardingComplete
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Modal, Alert, BackHandler,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { useAuth, getPendingReturnRole, setPendingReturnRole } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { AVATAR_STYLES } from '../../constants/avatarStyles';
import SERVER_URL from '../../config/serverUrl';
import firebaseApp from '../../config/firebase';

// ── Custom Date Picker ─────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// mode: 'day' | 'month' | 'year'
function DatePickerInput({ value, onChange, colors }: {
  value: string;
  onChange: (v: string) => void;
  colors: any;
}) {
  const [open, setOpen]     = useState(false);
  const [pos,  setPos]      = useState({ top: 0, left: 0 });
  const [mode, setMode]     = useState<'day'|'month'|'year'>('day');
  const [yearRangeStart, setYearRangeStart] = useState(0);
  const btnRef = useRef<any>(null);

  const today  = new Date();
  const parsed = value ? (() => {
    const [d, m, y] = value.split('/').map(Number);
    return new Date(y, m - 1, d);
  })() : null;

  const [viewYear,  setViewYear]  = useState(parsed?.getFullYear()  ?? today.getFullYear() - 15);
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth()      ?? today.getMonth());

  function openPicker() {
    if (Platform.OS === 'web' && btnRef.current) {
      const rect = (btnRef.current as any).getBoundingClientRect?.();
      if (rect) setPos({ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX });
    }
    setMode('day');
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const handler = (e: any) => {
      const cal = document.getElementById('aivorah-cal');
      if (cal && !cal.contains(e.target) && btnRef.current && !(btnRef.current as any).contains?.(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const bg = colors.bgDark, border = colors.borderColor, text = colors.textMain, muted = colors.textMuted;
  const displayValue = value || 'DD / MM / YYYY';
  const selectedDay  = parsed?.getMonth() === viewMonth && parsed?.getFullYear() === viewYear ? parsed.getDate() : null;

  const navBtn  = `background:transparent;border:none;color:${TEAL};font-size:16px;cursor:pointer;padding:4px 8px;border-radius:6px;`;
  const headBtn = `background:transparent;border:none;color:${text};font-weight:700;font-size:15px;cursor:pointer;padding:4px 8px;border-radius:6px;text-decoration:underline dotted ${TEAL};`;

  function buildDayView() {
    const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (number|null)[] = [...Array(firstDay).fill(null), ...Array.from({length:daysInMonth},(_,i)=>i+1)];
    while (cells.length % 7 !== 0) cells.push(null);

    const dayHeaders = DAYS.map(d => `<div style="flex:1;text-align:center;font-size:11px;font-weight:700;color:${muted};padding:4px 0">${d}</div>`).join('');
    const dayRows = Array.from({length: cells.length/7}, (_, row) => {
      const cols = cells.slice(row*7, row*7+7).map(day => {
        const isSel   = day !== null && day === selectedDay;
        const isToday = day !== null && viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
        return `<button data-day="${day??''}" style="flex:1;height:34px;border:none;border-radius:8px;background:${isSel?TEAL:isToday?TEAL+'33':'transparent'};color:${isSel?'#fff':day?text:'transparent'};font-size:13px;font-weight:${isSel||isToday?'700':'400'};cursor:${day?'pointer':'default'}">${day??''}</button>`;
      }).join('');
      return `<div style="display:flex;margin-bottom:2px">${cols}</div>`;
    }).join('');
    const clearBtn = value ? `<button id="aivorah-cal-clear" style="margin-top:10px;width:100%;background:transparent;border:none;color:#ef4444;font-size:12px;cursor:pointer">Clear date</button>` : '';

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <button id="cal-pm" style="${navBtn}">‹</button>
        <div style="display:flex;gap:4px">
          <button id="cal-hm" style="${headBtn}">${MONTHS[viewMonth]}</button>
          <button id="cal-hy" style="${headBtn}">${viewYear}</button>
        </div>
        <button id="cal-nm" style="${navBtn}">›</button>
      </div>
      <div style="display:flex;margin-bottom:6px">${dayHeaders}</div>
      ${dayRows}${clearBtn}`;
  }

  function buildMonthView() {
    const rows = Array.from({length:3}, (_,row) => {
      const cols = Array.from({length:4}, (_,col) => {
        const mi = row*4+col;
        const isSel = mi === viewMonth;
        return `<button data-month="${mi}" style="flex:1;padding:10px 4px;border:none;border-radius:8px;background:${isSel?TEAL:'transparent'};color:${isSel?'#fff':text};font-size:13px;font-weight:${isSel?'700':'400'};cursor:pointer">${MONTHS[mi].slice(0,3)}</button>`;
      }).join('');
      return `<div style="display:flex;gap:4px;margin-bottom:4px">${cols}</div>`;
    }).join('');
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <button id="cal-py" style="${navBtn}">‹</button>
        <button id="cal-hy" style="${headBtn}">${viewYear}</button>
        <button id="cal-ny" style="${navBtn}">›</button>
      </div>
      ${rows}`;
  }

  function buildYearView() {
    const start = yearRangeStart || Math.floor(viewYear/12)*12;
    const years = Array.from({length:12}, (_,i) => start+i);
    const rows = Array.from({length:3}, (_,row) => {
      const cols = years.slice(row*4, row*4+4).map(yr => {
        const isSel = yr === viewYear;
        return `<button data-year="${yr}" style="flex:1;padding:10px 4px;border:none;border-radius:8px;background:${isSel?TEAL:'transparent'};color:${isSel?'#fff':text};font-size:13px;font-weight:${isSel?'700':'400'};cursor:pointer">${yr}</button>`;
      }).join('');
      return `<div style="display:flex;gap:4px;margin-bottom:4px">${cols}</div>`;
    }).join('');
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <button id="cal-pyr" style="${navBtn}">‹</button>
        <span style="font-weight:700;font-size:14px;color:${text}">${start} – ${start+11}</span>
        <button id="cal-nyr" style="${navBtn}">›</button>
      </div>
      ${rows}`;
  }

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let el = document.getElementById('aivorah-cal');
    if (!open) { if (el) el.style.display = 'none'; return; }
    if (!el) { el = document.createElement('div'); el.id = 'aivorah-cal'; document.body.appendChild(el); }
    el.style.cssText = `position:fixed;top:${pos.top}px;left:${pos.left}px;z-index:99999;background:${bg};border:1.5px solid ${TEAL}80;border-radius:14px;padding:16px;width:290px;display:block;box-shadow:0 8px 32px rgba(0,0,0,0.5);`;

    if (mode === 'day')   el.innerHTML = buildDayView();
    if (mode === 'month') el.innerHTML = buildMonthView();
    if (mode === 'year')  el.innerHTML = buildYearView();

    // Day view events
    document.getElementById('cal-pm')?.addEventListener('click', () => {
      if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); } else setViewMonth(m => m-1);
    });
    document.getElementById('cal-nm')?.addEventListener('click', () => {
      if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); } else setViewMonth(m => m+1);
    });
    document.getElementById('cal-hm')?.addEventListener('click', () => setMode('month'));
    document.getElementById('cal-hy')?.addEventListener('click', () => {
      setYearRangeStart(Math.floor(viewYear/12)*12);
      setMode('year');
    });
    el.querySelectorAll('button[data-day]').forEach(btn => {
      const day = parseInt((btn as HTMLElement).dataset.day || '');
      if (day) btn.addEventListener('click', () => {
        const d = String(day).padStart(2,'0'), m = String(viewMonth+1).padStart(2,'0');
        onChange(`${d}/${m}/${viewYear}`); setOpen(false);
      });
    });
    document.getElementById('aivorah-cal-clear')?.addEventListener('click', () => { onChange(''); setOpen(false); });

    // Month view events
    document.getElementById('cal-py')?.addEventListener('click', () => setViewYear(y => y-1));
    document.getElementById('cal-ny')?.addEventListener('click', () => setViewYear(y => y+1));
    el.querySelectorAll('button[data-month]').forEach(btn => {
      const mi = parseInt((btn as HTMLElement).dataset.month || '');
      btn.addEventListener('click', () => { setViewMonth(mi); setMode('day'); });
    });

    // Year view events
    document.getElementById('cal-pyr')?.addEventListener('click', () => setYearRangeStart(s => (s||Math.floor(viewYear/12)*12) - 12));
    document.getElementById('cal-nyr')?.addEventListener('click', () => setYearRangeStart(s => (s||Math.floor(viewYear/12)*12) + 12));
    el.querySelectorAll('button[data-year]').forEach(btn => {
      const yr = parseInt((btn as HTMLElement).dataset.year || '');
      btn.addEventListener('click', () => { setViewYear(yr); setMode('month'); });
    });
  }, [open, mode, viewMonth, viewYear, yearRangeStart, pos, selectedDay, value]);

  useEffect(() => () => { document.getElementById('aivorah-cal')?.remove(); }, []);

  return (
    <TouchableOpacity ref={btnRef} onPress={openPicker} activeOpacity={0.8}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        height: 48, paddingHorizontal: 14, borderRadius: 10,
        borderWidth: 1, borderColor: open ? TEAL : border,
        backgroundColor: bg, alignSelf: 'flex-start' as any, minWidth: 220,
      }}>
      <Text style={{ fontSize: 15, color: value ? text : muted, marginRight: 12 }}>{displayValue}</Text>
      <Feather name="calendar" size={16} color={open ? TEAL : muted} />
    </TouchableOpacity>
  );
}

// ── Constants ──────────────────────────────────────────────
const CURRICULA = ['IB PYP', 'IB MYP', 'IB DP', 'NCERT', 'CBSE', 'ICSE', 'Cambridge', 'State Board'];

function getGradesForCurriculum(curr: string): string[] {
  if (curr === 'IB PYP') return ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5'];
  if (curr === 'IB MYP') return ['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];
  if (curr === 'IB DP')  return ['Grade 11','Grade 12'];
  if (curr === 'Cambridge') return ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];
  return ['Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
}

const GRADES_TEACHER = ['Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
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

interface ChildEntry {
  name: string;
  age: string;
  grade: string;
  curriculum: string;
  school: string;
  email: string;
  linkEmail: string;
  password: string;
}
function emptyChild(): ChildEntry {
  return { name: '', age: '', grade: '', curriculum: '', school: '', email: '', linkEmail: '', password: '' };
}

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
    { title: 'Curriculum', icon: 'book-open', subtitle: 'What do you study?' },
    { title: 'School & Grade', icon: 'home', subtitle: 'Your school details' },
    { title: 'Your Avatar', icon: 'smile', subtitle: 'Pick your look' },
    { title: 'Learning Style', icon: 'zap', subtitle: 'How do you learn best?' },
  ];
}

export default function OnboardingScreen() {
  const { user, updateUser, saveProfile, logout } = useAuth();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const role = user?.role || 'student';
  const steps = getSteps(role);

  // Read return role from module-level variable (completely outside React state,
  // immune to onAuthStateChanged overwriting user state on live/slower networks).

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [exitConfirm, setExitConfirm] = useState(false);

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
  const [children, setChildren] = useState<ChildEntry[]>([emptyChild()]);
  const [activeChildIdx, setActiveChildIdx] = useState(0);
  const [showChildPassword, setShowChildPassword] = useState(false);
  const [showChildCreds, setShowChildCreds] = useState(false);
  const [createdChildCreds, setCreatedChildCreds] = useState<Array<{
    name: string; loginId: string; password: string; studentId: string; verificationRequired: boolean;
  }>>([]);
  const [pendingUserPatch, setPendingUserPatch] = useState<any | null>(null);
  const [copiedField, setCopiedField] = useState('');

  const activeChild = children[activeChildIdx] || emptyChild();
  const updateChild = (field: keyof ChildEntry, value: string) => {
    setChildren(prev => prev.map((c, i) => i === activeChildIdx ? { ...c, [field]: value } : c));
  };
  const addAnotherChild = () => {
    const newIdx = children.length;
    setChildren(prev => [...prev, emptyChild()]);
    setActiveChildIdx(newIdx);
    setShowChildPassword(false);
  };
  const removeChild = (idx: number) => {
    if (children.length <= 1) return;
    const newLen = children.length - 1;
    setChildren(prev => prev.filter((_, i) => i !== idx));
    setActiveChildIdx(prev => {
      if (idx < prev) return prev - 1;
      return Math.min(prev, newLen - 1);
    });
  };

  function copyToClipboard(text: string, field: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 1500);
  }

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
      if (step === 1) return curriculum.length > 0;
      if (step === 2) return school.trim().length >= 2 && grade.length > 0;
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
      if (step === 1) return children.every(c => c.name.trim().length >= 2 && c.grade.length > 0 && c.curriculum.length > 0);
      if (step === 2) {
        return children.every(c => {
          const ageNum = c.age ? parseInt(c.age, 10) : 0;
          if (ageNum >= 14) return /^\S+@\S+\.\S+$/.test(c.linkEmail.trim());
          if (c.password.length > 0 && c.password.length < 6) return false;
          return true;
        });
      }
      if (step === 3) return true;
    }
    return true;
  }, [step, role, fullName, dob, school, grade, curriculum, teachGrades, teachCurriculum, children]);

  async function handleFinish() {
    setSaving(true);
    setSaveError('');
    // Read from module-level variable — completely outside React state management.
    const capturedReturnRole = getPendingReturnRole();
    try {
      const email = user?.email || '';

      // ── Pre-flight validation ──────────────────────────────────────────
      // Catch empty values before hitting the server — empty string is falsy
      // on the server and would be silently skipped, leaving nulls in Supabase.
      if (role === 'student') {
        if (!grade.trim())      throw new Error('Please select your grade before continuing.');
        if (!curriculum.trim()) throw new Error('Please select your curriculum before continuing.');
      }

      // If teacher is adding a parent profile (_returnRole='teacher'), keep 'teacher'
      // as the persisted role — 'parent' is only a temporary UI state for onboarding.
      const persistRole = capturedReturnRole === 'teacher' ? 'teacher' : role;

      // ── Dual-role: add parent role to server IMMEDIATELY ──────────────────
      // Call add-role BEFORE any Firebase operations. Firebase child-account
      // creation (createUserWithEmailAndPassword on secondary app) can trigger
      // onAuthStateChanged on the primary app, which unmounts OnboardingScreen
      // before the later add-role calls run. By calling it here, even if the
      // screen unmounts mid-flow, the server already has roles:['teacher','parent']
      // so onAuthStateChanged will restore the correct state including Switch Profile.
      if (capturedReturnRole === 'teacher') {
        await fetch(`${SERVER_URL}/user/add-role`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role: 'parent' }),
        }).catch(() => {});
      }

      const body: any = {
        email,
        role: persistRole,           // send role so server can validate without an extra DB lookup
        name: fullName.trim(),
        school,
        location: city,
        complete: true,
      };

      if (role === 'student') {
        body.grade = grade.trim();
        body.curriculum = curriculum.trim();
      } else if (role === 'teacher') {
        body.curriculum = teachCurriculum;
        body.teaches = teachGrades.map(g => ({
          grade: g,
          curriculum: teachCurriculum,
          subjects: teachSubjects,
        }));
      } else if (role === 'parent') {
        body.children = children
          .filter(c => {
            const age = c.age ? parseInt(c.age, 10) : 0;
            return age < 14 && c.name.trim();
          })
          .map(c => ({
            name: c.name.trim(),
            grade: c.grade,
            school: c.school || school,
            curriculum: c.curriculum,
            email: c.email.trim().toLowerCase() || undefined,
          }));
      }

      // Save profile to Supabase
      const profileRes = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!profileRes.ok) {
        const errText = await profileRes.text().catch(() => '');
        throw new Error(`Profile save failed (${profileRes.status}): ${errText.slice(0, 200)}`);
      }

      // ── Verify server actually persisted the data ──────────────────────
      // Parse the response and confirm grade + curriculum are present for students.
      // If the server returned nulls, we reject and show an error instead of
      // marking onboarding complete with corrupt data.
      const saved = await profileRes.json().catch(() => ({}));
      if (role === 'student') {
        if (!saved.grade || !saved.curriculum) {
          throw new Error('Your profile could not be saved correctly. Please try again.');
        }
      }

      // Save preferences (avatar, learning style) — fire-and-forget, don't block
      fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: fullName.trim(),
          role: persistRole,
          grade: role === 'student' ? grade.trim() : undefined,
          curriculum: role === 'student' ? curriculum.trim() : teachCurriculum || undefined,
          school,
          location: city,
          avatarStyle,
          learningStyle: learningStyle || undefined,
          gender: gender || undefined,
        }),
      }).catch(() => {});

      // Build local completion patch; parent flow may defer applying this until
      // credentials are acknowledged in the modal.
      const localCompletionPatch: any = {
        name: fullName.trim(),
        school,
        location: city,
        onboardingComplete: true,
        avatarStyle,
        ...(role === 'student' ? { grade: saved.grade, curriculum: saved.curriculum } : {}),
        ...(role === 'teacher' ? {
          curriculum: teachCurriculum,
          teaches: teachGrades.map(g => ({ grade: g, curriculum: teachCurriculum })),
        } : {}),
      };

      // ── Parent child account handling ─────────────────────────────────────
      if (role === 'parent') {
        const allCreds: Array<{ name: string; loginId: string; password: string; studentId: string; verificationRequired: boolean }> = [];

        for (const child of children) {
          if (!child.name.trim()) continue;
          const ageNum = child.age ? parseInt(child.age, 10) : 0;

          // ── Age >= 14: Link existing student account ──────────────────────
          if (ageNum >= 14 && child.linkEmail.trim()) {
            const linkRes = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(email)}/children`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ childEmail: child.linkEmail.trim().toLowerCase() }),
            });
            if (!linkRes.ok) {
              const err = await linkRes.json().catch(() => ({}));
              throw new Error(err?.error || `Could not link ${child.name}'s account. Make sure they have a registered Aivorah account.`);
            }
            continue;
          }

          // ── Age < 14: Auto-create student account ─────────────────────────
          const cleanName = child.name.trim();
          const candidateStudentId = generateStudentId(cleanName);
          const initRes = await fetch(`${SERVER_URL}/parent/children/init-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: cleanName,
              studentId: candidateStudentId,
              email: child.email.trim().toLowerCase() || undefined,
              age: child.age ? parseInt(child.age, 10) : undefined,
              password: child.password.trim() || undefined,
            }),
          });
          const init = await initRes.json().catch(() => ({}));
          if (!initRes.ok) throw new Error(init?.error || `Could not prepare ${cleanName}'s account credentials.`);

          const finalEmail = String(init.email || '').toLowerCase();
          const finalPassword = String(init.password || '');
          const finalStudentId = init.studentId || candidateStudentId;
          const emailProvided = Boolean(init.emailProvided);

          // Create child in Firebase Auth
          const secondaryName = `onboarding-child-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const childApp = initializeApp((firebaseApp as any).options, secondaryName);
          const childAuth = getAuth(childApp);
          let firebaseUid = '';
          try {
            const childCred = await createUserWithEmailAndPassword(childAuth, finalEmail, finalPassword);
            firebaseUid = childCred.user.uid;
            await updateProfile(childCred.user, { displayName: `${cleanName}|student` }).catch(() => {});
          } catch (fbErr: any) {
            if (fbErr?.code === 'auth/email-already-in-use') {
              throw new Error(`${cleanName}'s email already exists. Use another email or leave it blank for auto-generated login.`);
            }
            throw new Error(fbErr?.message || `Could not create ${cleanName}'s account.`);
          } finally {
            await signOut(childAuth).catch(() => {});
            await deleteApp(childApp).catch(() => {});
          }

          const createRes = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(email)}/children/link-created`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              firebaseUid,
              name: cleanName,
              studentId: finalStudentId,
              email: finalEmail,
              grade: child.grade,
              curriculum: child.curriculum,
              school: child.school || school,
              verificationRequired: emailProvided,
              age: child.age ? parseInt(child.age, 10) : undefined,
              initialPassword: finalPassword,
            }),
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}));
            if (createRes.status === 409) {
              throw new Error(err?.error || `A child named "${cleanName}" with this grade already exists on your account.`);
            }
            throw new Error(err?.error || `Could not create ${cleanName}'s account during onboarding.`);
          }
          const created = await createRes.json().catch(() => null);
          if (!created) throw new Error(`Could not read ${cleanName}'s account response. Please try again.`);
          const createdChild = created?.child;

          allCreds.push({
            name: cleanName,
            loginId: createdChild?.email || finalEmail,
            password: finalPassword,
            studentId: createdChild?.studentId || finalStudentId,
            verificationRequired: emailProvided,
          });
        }

        // Show credentials if any children were created (under 14)
        if (allCreds.length > 0) {
          setCreatedChildCreds(allCreds);
          if (capturedReturnRole === 'teacher') {
            setPendingReturnRole(undefined);
            setPendingUserPatch({
              ...localCompletionPatch,
              role: 'teacher',
              roles: ['teacher', 'parent'],
              onboardingComplete: true,
            });
          } else {
            setPendingUserPatch(localCompletionPatch);
          }
          setShowChildCreds(true);
          return;
        }

        // All children were linked (age >= 14) or no children — complete onboarding
        if (capturedReturnRole === 'teacher') {
          setPendingReturnRole(undefined);
          const linkPatch = { ...localCompletionPatch, role: 'teacher', roles: ['teacher', 'parent'] };
          updateUser(linkPatch as any);
          setTimeout(() => {
            Alert.alert('Parent Profile Added', 'Your parent details have been saved. You can switch between Teacher and Parent profiles from the sidebar.', [{ text: 'OK' }]);
          }, 400);
        } else {
          updateUser(localCompletionPatch as any);
        }
        return;
      }

      // ── Dual-role: teacher adding parent profile (no children path) ──────
      if (capturedReturnRole === 'teacher') {
        setPendingReturnRole(undefined);
        const teacherPatch = {
          ...localCompletionPatch,
          role: 'teacher',
          roles: ['teacher', 'parent'],
          onboardingComplete: true,
        };
        updateUser(teacherPatch as any);
        setTimeout(() => {
          Alert.alert(
            'Parent Profile Added',
            'Your parent details have been successfully saved. You can now switch between Teacher and Parent profiles from the sidebar.',
            [{ text: 'OK' }]
          );
        }, 400);
      } else {
        // Only mark onboarding complete locally after server confirmed the save
        updateUser(localCompletionPatch as any);
      }
    } catch (err: any) {
      console.error('Onboarding save error:', err);
      setSaveError(err?.message || 'Could not save your profile. Please try again.');
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

  function confirmChildCredsAndFinish() {
    setShowChildCreds(false);
    if (pendingUserPatch) {
      const patch = pendingUserPatch;
      setPendingUserPatch(null);
      if (patch.role === 'teacher') {
        // Navigate to teacher dashboard IMMEDIATELY — prevents double-click on "Get Started"
        // from re-triggering handleFinish while the alert is still showing.
        updateUser(patch as any);
        setTimeout(() => {
          Alert.alert(
            'Parent Profile Added',
            'Your parent details have been successfully saved. You can now switch between Teacher and Parent profiles from the sidebar.',
            [{ text: 'OK' }]
          );
        }, 400);
      } else {
        updateUser(patch);
      }
    }
  }

  function showExitConfirm() {
    if (Platform.OS === 'web') {
      setExitConfirm(true);
    } else {
      Alert.alert('Exit Onboarding', 'Would you like to sign out and return to the login screen?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
      ]);
    }
  }

  useEffect(() => {
    // Handle Android hardware back button
    const backAction = () => {
      if (step > 0) { setStep(s => s - 1); return true; }
      showExitConfirm();
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [step, logout]);


  function handleBack() {
    if (step > 0) {
      setStep(s => s - 1);
    } else {
      showExitConfirm();
    }
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
          
          <Text style={styles.fieldLabel}>Date of Birth</Text>
          {Platform.OS === 'web' ? (
            <DatePickerInput value={dob} onChange={setDob} colors={colors} />
          ) : (
            <TextInput style={styles.input} value={dob} onChangeText={setDob}
              placeholder="DD/MM/YYYY" placeholderTextColor={colors.textDim} keyboardType="numeric" />
          )}
          
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
          <Text style={styles.fieldLabel}>Curriculum</Text>
          <View style={styles.chipRow}>
            {CURRICULA.map(c => (
              <TouchableOpacity key={c} style={[styles.chip, curriculum === c && styles.chipActive]}
                onPress={() => { setCurriculum(c); setGrade(''); }} activeOpacity={0.8}>
                <Text style={[styles.chipText, curriculum === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 2) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>School Name</Text>
          <TextInput style={styles.input} value={school} onChangeText={setSchool}
            placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>City</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity}
            placeholder="e.g. Hyderabad" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>Grade</Text>
          <View style={styles.chipRow}>
            {getGradesForCurriculum(curriculum).map(g => (
              <TouchableOpacity key={g} style={[styles.chip, grade === g && styles.chipActive]}
                onPress={() => setGrade(g)} activeOpacity={0.8}>
                <Text style={[styles.chipText, grade === g && styles.chipTextActive]}>{g}</Text>
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
            {GRADES_TEACHER.map(g => (
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
      if (step === 1) {
        const ageNum = activeChild.age ? parseInt(activeChild.age, 10) : 0;
        return (
          <View style={styles.stepContent}>
            {/* Child tabs — shown when more than 1 child */}
            {children.length > 1 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {children.map((c, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.chip, activeChildIdx === i && styles.chipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                    onPress={() => { setActiveChildIdx(i); setShowChildPassword(false); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, activeChildIdx === i && styles.chipTextActive]}>
                      {c.name.trim() || `Child ${i + 1}`}
                    </Text>
                    {children.length > 1 && (
                      <TouchableOpacity onPress={() => removeChild(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Feather name="x" size={12} color={activeChildIdx === i ? '#fff' : colors.textDim} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.fieldLabel}>Child's Full Name</Text>
            <TextInput style={styles.input} value={activeChild.name} onChangeText={v => updateChild('name', v)}
              placeholder="Enter your child's name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
            <Text style={styles.fieldLabel}>Child's Age</Text>
            <TextInput style={styles.input} value={activeChild.age} onChangeText={v => updateChild('age', v)}
              placeholder="e.g. 9" placeholderTextColor={colors.textDim} keyboardType="numeric" maxLength={2} />

            {/* Age-based flow hint */}
            {activeChild.age.length > 0 && (
              <View style={{
                backgroundColor: ageNum >= 14 ? TEAL + '18' : FOREST + '15',
                borderRadius: 8, padding: 12, borderWidth: 1,
                borderColor: ageNum >= 14 ? TEAL + '40' : FOREST + '40',
              }}>
                <Text style={{ fontSize: 13, color: ageNum >= 14 ? TEAL : FOREST, lineHeight: 18 }}>
                  {ageNum >= 14
                    ? 'Students 14 and older should have their own account. In the next step, enter their registered Aivorah email to link it.'
                    : 'Aivorah will create a login ID and password for your child. You can optionally provide their email in the next step.'}
                </Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>Child's Curriculum</Text>
            <View style={styles.chipRow}>
              {CURRICULA.map(c => (
                <TouchableOpacity key={c} style={[styles.chip, activeChild.curriculum === c && styles.chipActive]}
                  onPress={() => { updateChild('curriculum', c); updateChild('grade', ''); }} activeOpacity={0.8}>
                  <Text style={[styles.chipText, activeChild.curriculum === c && styles.chipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Child's Grade</Text>
            <View style={styles.chipRow}>
              {getGradesForCurriculum(activeChild.curriculum).map(g => (
                <TouchableOpacity key={g} style={[styles.chip, activeChild.grade === g && styles.chipActive]}
                  onPress={() => updateChild('grade', g)} activeOpacity={0.8}>
                  <Text style={[styles.chipText, activeChild.grade === g && styles.chipTextActive]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Add Another Child button */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                paddingVertical: 14, borderWidth: 1, borderColor: TEAL + '40', borderRadius: 10,
                borderStyle: 'dashed' as any, backgroundColor: TEAL + '08' }}
              onPress={addAnotherChild}
              activeOpacity={0.7}
            >
              <Feather name="plus-circle" size={16} color={TEAL} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: TEAL }}>Add Another Child</Text>
            </TouchableOpacity>
          </View>
        );
      }
      if (step === 2) {
        const ageNum = activeChild.age ? parseInt(activeChild.age, 10) : 0;

        return (
          <View style={styles.stepContent}>
            {/* Child tabs — shown when more than 1 child */}
            {children.length > 1 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {children.map((c, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.chip, activeChildIdx === i && styles.chipActive]}
                    onPress={() => { setActiveChildIdx(i); setShowChildPassword(false); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, activeChildIdx === i && styles.chipTextActive]}>
                      {c.name.trim() || `Child ${i + 1}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Age >= 14: Link existing student account */}
            {ageNum >= 14 ? (
              <>
                <View style={{ backgroundColor: TEAL + '12', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: TEAL + '30', gap: 6 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: TEAL }}>Link {activeChild.name || 'your child'}'s Account</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 18 }}>
                    Students 14+ have their own Aivorah account. Ask your child for their registered email, then enter it below to link it to your parent dashboard.
                  </Text>
                </View>
                <Text style={styles.fieldLabel}>Child's Registered Email</Text>
                <TextInput
                  style={styles.input}
                  value={activeChild.linkEmail}
                  onChangeText={v => updateChild('linkEmail', v)}
                  placeholder="child@email.com"
                  placeholderTextColor={colors.textDim}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                  If your child hasn't signed up yet, ask them to create a Student account first, then come back to complete this step.
                </Text>
              </>
            ) : (
              <>
                {/* Age < 14: Create account for child */}
                <Text style={styles.fieldLabel}>{children.length > 1 ? `${activeChild.name || 'Child'}'s School` : "Child's School"}</Text>
                <TextInput style={styles.input} value={activeChild.school} onChangeText={v => updateChild('school', v)}
                  placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />

                <Text style={styles.fieldLabel}>{children.length > 1 ? `${activeChild.name || 'Child'}'s Email (optional)` : "Child's Email (optional)"}</Text>
                <TextInput style={styles.input} value={activeChild.email} onChangeText={v => updateChild('email', v)}
                  placeholder="child@email.com" placeholderTextColor={colors.textDim}
                  keyboardType="email-address" autoCapitalize="none" />
                <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18, marginTop: -8 }}>
                  Leave blank — Aivorah auto-generates a login ID. Real email requires verification before login.
                </Text>

                <Text style={styles.fieldLabel}>Password (optional)</Text>
                <View style={{ position: 'relative' }}>
                  <TextInput
                    style={[styles.input, { paddingRight: 48 }]}
                    value={activeChild.password}
                    onChangeText={v => updateChild('password', v)}
                    placeholder="Leave blank to auto-generate"
                    placeholderTextColor={colors.textDim}
                    secureTextEntry={!showChildPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    importantForAutofill="no"
                  />
                  <TouchableOpacity
                    style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}
                    onPress={() => setShowChildPassword(v => !v)}
                    activeOpacity={0.7}
                  >
                    <Feather name={showChildPassword ? 'eye-off' : 'eye'} size={16} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
                {activeChild.password.length > 0 && activeChild.password.length < 6 && (
                  <Text style={{ fontSize: 12, color: '#ef4444', marginTop: -8 }}>
                    Password must be at least 6 characters.
                  </Text>
                )}
                <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18, marginTop: -8 }}>
                  Set a password your child will remember, or leave blank to auto-generate one.
                </Text>
              </>
            )}
          </View>
        );
      }
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
                <Feather name={av.icon as any} size={28} color="#fff" />
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

        {/* ── Exit modal ── */}
        <Modal visible={exitConfirm} transparent animationType="fade" onRequestClose={() => setExitConfirm(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Exit Onboarding?</Text>
              <Text style={styles.modalText}>You'll be signed out and returned to the login screen. Your progress will not be saved.</Text>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <TouchableOpacity onPress={() => setExitConfirm(false)} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                  <Text style={{ color: colors.textMuted, fontWeight: '600', fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setExitConfirm(false); logout(); }} style={{ backgroundColor: '#ef4444', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Child credentials modal ── */}
        <Modal visible={showChildCreds} transparent animationType="fade" onRequestClose={confirmChildCredsAndFinish}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { maxHeight: '80%' as any }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: TEAL + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="key" size={17} color={TEAL} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>{createdChildCreds.length > 1 ? 'Child Accounts Created' : 'Child Account Created'}</Text>
                  <Text style={styles.modalText}>Share these login details with your {createdChildCreds.length > 1 ? 'children' : 'child'}</Text>
                </View>
              </View>
              <ScrollView style={{ flexGrow: 0 }}>
                {createdChildCreds.map((cred, idx) => (
                  <View key={idx} style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.borderColor, marginBottom: idx < createdChildCreds.length - 1 ? 12 : 0 }}>
                    {createdChildCreds.length > 1 && <Text style={{ fontSize: 14, fontWeight: '700', color: TEAL }}>{cred.name}</Text>}
                    <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>Save these — {cred.name} uses them to log in as a Student on any device.</Text>
                    {[
                      { label: 'Student ID', value: cred.studentId, field: `studentId-${idx}` },
                      { label: 'Login ID (Email)', value: cred.loginId, field: `loginId-${idx}` },
                      ...(cred.password ? [{ label: 'Password', value: cred.password, field: `password-${idx}` }] : []),
                    ].map(({ label, value, field }) => (
                      <View key={field} style={{ gap: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardDark, borderWidth: 1, borderColor: copiedField === field ? TEAL : colors.borderColor, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
                          onPress={() => copyToClipboard(value, field)} activeOpacity={0.7}>
                          <Text style={{ flex: 1, color: colors.textMain, fontSize: 13, fontFamily: 'monospace' }} selectable>{value}</Text>
                          <Feather name={copiedField === field ? 'check' : 'copy'} size={14} color={copiedField === field ? TEAL : colors.textDim} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {cred.verificationRequired && (
                      <View style={{ backgroundColor: '#5F8A8612', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#5F8A8630', gap: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#5F8A86' }}>Your child can log in right away.</Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                          A verification link was sent to <Text style={{ fontWeight: '700', color: colors.textMain }}>{cred.loginId}</Text>. You (the parent) can open that inbox and click the link — this enables "Forgot Password" if your child ever needs it.
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.modalBtn} onPress={confirmChildCredsAndFinish} activeOpacity={0.85}>
                <Text style={styles.modalBtnText}>Got it, I've saved these</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ── Header ── */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerLeft} onPress={showExitConfirm} activeOpacity={0.7}>
              <View style={styles.logoMark}>
                <Feather name="zap" size={16} color="#fff" />
              </View>
              <Text style={styles.logoText}>Aivorah</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={showExitConfirm}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#ef444418', borderWidth: 1, borderColor: '#ef444440' }}
              activeOpacity={0.7}>
              <Feather name="log-out" size={13} color="#ef4444" />
              <Text style={{ fontSize: 13, color: '#ef4444', fontWeight: '700' }}>Exit</Text>
            </TouchableOpacity>
          </View>

          {/* ── Horizontal step cards ── */}
          <View style={styles.stepsRow}>
            {steps.map((s, i) => {
              const isCompleted = i < step;
              const isActive    = i === step;
              const isLocked    = i > step;
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.stepCard,
                    isCompleted && styles.stepCardDone,
                    isActive    && styles.stepCardActive,
                    isLocked    && styles.stepCardLocked,
                  ]}
                  onPress={() => isCompleted && setStep(i)}
                  activeOpacity={isCompleted ? 0.7 : 1}
                  disabled={isLocked}
                >
                  {/* Number / status badge */}
                  <View style={[
                    styles.stepBadge,
                    isCompleted && { backgroundColor: TEAL },
                    isActive    && { backgroundColor: TEAL },
                    isLocked    && { backgroundColor: colors.borderColor },
                  ]}>
                    {isCompleted
                      ? <Feather name="check" size={13} color="#fff" />
                      : isLocked
                        ? <Feather name="lock" size={11} color={colors.textDim} />
                        : <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff' }}>{i + 1}</Text>
                    }
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[
                      styles.stepCardTitle,
                      isActive    && { color: TEAL },
                      isCompleted && { color: TEAL },
                      isLocked    && { color: colors.textDim },
                    ]}>{s.title}</Text>
                    <Text style={[styles.stepCardSub, isLocked && { color: colors.borderColor }]}>{s.subtitle}</Text>
                  </View>
                  {isCompleted && (
                    <Feather name="edit-2" size={12} color={TEAL + '80'} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Connector line between cards ── */}
          <View style={styles.connectorRow}>
            {steps.map((_, i) => i < steps.length - 1 && (
              <View key={i} style={[styles.connector, i < step && { backgroundColor: TEAL }]} />
            ))}
          </View>

          {/* ── Form card ── */}
          <View style={styles.formCard}>
            {/* Step heading inside card */}
            <View style={styles.formCardHeader}>
              <View style={[styles.stepIconCircle, { backgroundColor: TEAL + '18' }]}>
                <Feather name={steps[step].icon as any} size={18} color={TEAL} />
              </View>
              <View>
                <Text style={styles.formCardTitle}>{steps[step].title}</Text>
                <Text style={styles.formCardSub}>{steps[step].subtitle}</Text>
              </View>
            </View>

            <View style={styles.formDivider} />

            {/* Step content */}
            {renderStepContent()}

            {/* Save error */}
            {saveError ? (
              <Text style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', marginTop: 8 }}>{saveError}</Text>
            ) : null}

            {/* ── Navigation buttons inside card ── */}
            <View style={styles.navRow}>
              {step > 0 ? (
                <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.8}>
                  <Feather name="arrow-left" size={16} color={colors.textMuted} />
                  <Text style={[styles.backBtnText, { color: colors.textMuted }]}>Back</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#ef444418', borderWidth: 1, borderColor: '#ef444440' }}
                  onPress={showExitConfirm} activeOpacity={0.8}>
                  <Feather name="log-out" size={13} color="#ef4444" />
                  <Text style={{ fontSize: 13, color: '#ef4444', fontWeight: '700' }}>Sign Out</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.nextBtn, !canProceed() && styles.nextBtnDisabled]}
                onPress={handleNext}
                disabled={!canProceed() || saving}
                activeOpacity={0.85}
              >
                <Text style={styles.nextBtnText}>
                  {saving ? 'Saving...' : isLastStep ? 'Get Started' : 'Continue'}
                </Text>
                {!saving && !isLastStep && <Feather name="arrow-right" size={16} color="#fff" />}
                {!saving &&  isLastStep && <Feather name="check"       size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },

  scrollContent: { flexGrow: 1, alignItems: 'center', paddingBottom: 48, paddingHorizontal: spacing.md },

  // ── Header ──
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', maxWidth: 900,
    paddingTop: 40, paddingBottom: spacing.lg, alignSelf: 'center',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 18, fontWeight: '700', color: c.textMain, letterSpacing: -0.3 },

  // ── Horizontal step cards ──
  stepsRow: {
    flexDirection: 'row', gap: 0,
    width: '100%', maxWidth: 900, alignSelf: 'center',
    marginBottom: 0,
  },
  stepCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 16, paddingHorizontal: 14,
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 0,
  },
  stepCardActive: {
    borderColor: TEAL,
    backgroundColor: TEAL + '10',
    borderBottomWidth: 3,
    borderBottomColor: TEAL,
  },
  stepCardDone: {
    borderColor: TEAL + '50',
    backgroundColor: TEAL + '08',
  },
  stepCardLocked: {
    opacity: 0.5,
  },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: TEAL,
  },
  stepCardTitle: { fontSize: 13, fontWeight: '700', color: c.textMain },
  stepCardSub:   { fontSize: 11, color: c.textMuted, marginTop: 1 },

  // Connector dots between cards
  connectorRow: {
    flexDirection: 'row', width: '100%', maxWidth: 900, alignSelf: 'center',
    marginBottom: 24,
  },
  connector: {
    flex: 1, height: 2,
    backgroundColor: c.borderColor,
  },

  // ── Form card ──
  formCard: {
    width: '100%', maxWidth: 900, alignSelf: 'center',
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  formCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepIconCircle: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  formCardTitle: { fontSize: 18, fontWeight: '800', color: c.textMain },
  formCardSub:   { fontSize: 13, color: c.textMuted, marginTop: 2 },
  formDivider:   { height: 1, backgroundColor: c.borderColor },

  stepContent: { gap: spacing.lg },

  fieldLabel: {
    fontSize: 13, fontWeight: '700', color: c.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    height: 48, backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md,
    fontSize: 15, color: c.textMain, maxWidth: 480,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.bgDark,
  },
  chipActive: { backgroundColor: TEAL + '20', borderColor: TEAL },
  chipText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  chipTextActive: { color: TEAL },

  lsCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  lsCardActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
  lsIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: c.borderColor + '60', alignItems: 'center', justifyContent: 'center',
  },
  lsLabel: { fontSize: 15, fontWeight: '700', color: c.textMain },
  lsDesc: { fontSize: 12, color: c.textMuted, marginTop: 2 },

  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  avatarCard: {
    flexBasis: '22%', flexGrow: 1, maxWidth: '25%',
    alignItems: 'center', gap: 10,
    paddingVertical: spacing.lg, paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.bgDark,
  },
  avatarCardActive: { borderColor: TEAL, backgroundColor: TEAL + '15' },
  avatarCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  avatarLabel: { fontSize: 13, fontWeight: '600', color: c.textMuted, textAlign: 'center' },
  avatarCheck: {
    position: 'absolute', top: 8, right: 8,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
  },

  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: c.borderColor,
    marginTop: spacing.sm,
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

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: {
    width: '100%', maxWidth: 420,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: c.textMain },
  modalText: { fontSize: 14, color: c.textMuted, lineHeight: 20 },
  modalBtn: { marginTop: spacing.sm, alignSelf: 'flex-end', backgroundColor: TEAL, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10 },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
