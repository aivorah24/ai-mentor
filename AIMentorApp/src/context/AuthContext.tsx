import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import SERVER_URL from '../config/serverUrl';

const PROFILE_KEY = 'ai_mentor_user_profile';

export type UserRole = 'student' | 'teacher' | 'parent';

export interface User {
  name: string;
  email: string;
  role: UserRole;            // always equals activeRole — used by all existing code
  roles?: UserRole[];        // all roles this user has (dual-role users: ['teacher','parent'])
  activeRole?: UserRole;     // currently active profile
  grade?: string;
  curriculum?: string;       // e.g. 'NCERT', 'IB PYP', 'CBSE', 'IGCSE'
  school?: string;
  location?: string;
  onboardingComplete?: boolean;
  emailVerified?: boolean;
  photoUrl?: string;
  avatarStyle?: string;      // e.g. 'default', 'casual', 'gamer', 'creator', 'scholar', 'champion'
  learningStyle?: string;
  interests?: string[];
  bio?: string;
  accountStatus?: string;
  isPro?: boolean;            // premium subscription — controlled by admin in DB
  // Relationship metadata
  children?: { name: string; grade: string; email: string; curriculum?: string }[];  // for parents
  teaches?: { grade: string; curriculum: string }[];            // for teachers
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (user: User) => void;
  logout: () => void;
  updateUser: (fields: Partial<User>) => void;
  saveProfile: (fields: { curriculum?: string; grade?: string; school?: string; location?: string }) => Promise<void>;
  signInWithEmail: (email: string, password: string, role: UserRole) => Promise<void>;
  signUpWithEmail: (name: string, email: string, password: string, role: UserRole, curriculum?: string) => Promise<void>;
  signInWithGoogle: (role: UserRole) => Promise<void>;
  demoLogin: (role?: UserRole) => void;
  testLogin: (email: string) => void;
  switchRole: (newRole: UserRole) => void;  // switch between teacher/parent profiles
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  loading: true,
  login: () => {},
  logout: () => {},
  updateUser: () => {},
  saveProfile: async () => {},
  signInWithEmail: async () => {},
  signUpWithEmail: async (_n, _e, _p, _r, _c) => {},
  signInWithGoogle: async () => {},
  demoLogin: () => {},
  testLogin: () => {},
  switchRole: () => {},
});

// Fetch full profile from Supabase (includes curriculum, grade, location, onboardingComplete)
async function fetchSupabaseProfile(email: string): Promise<Partial<User>> {
  const combined: Partial<User> = {};
  try {
    const res = await fetch(`${SERVER_URL}/user/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      const data = await res.json();
      Object.assign(combined, {
        grade:              data.grade      || undefined,
        curriculum:         data.curriculum || undefined,
        school:             data.school     || undefined,
        location:           data.location   || undefined,
        onboardingComplete: data.onboardingComplete ?? false,
        photoUrl:           data.photoUrl   || undefined,
        name:               data.name       || undefined,
        role:               data.role       || undefined,
        roles:              Array.isArray(data.roles) ? data.roles : undefined,
        isPro:              data.isPro === true,
      });
    }
  } catch {}

  try {
    const prefRes = await fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(email)}`);
    if (prefRes.ok) {
      const pref = await prefRes.json();
      if (pref && typeof pref === 'object') {
        Object.assign(combined, {
          avatarStyle: pref.avatarStyle || undefined,
          learningStyle: pref.learningStyle || undefined,
          interests: Array.isArray(pref.interests) ? pref.interests : undefined,
          bio: pref.bio || undefined,
          accountStatus: pref.accountStatus || undefined,
          teaches: Array.isArray(pref.teaches) && pref.teaches.length > 0 ? pref.teaches : undefined,
          children: Array.isArray(pref.children) && pref.children.length > 0 ? pref.children : undefined,
          roles: Array.isArray(pref.roles) && pref.roles.length > 0 ? pref.roles : undefined,
        });
      }
    }
  } catch {}

  return combined;
}

let _pendingRole: UserRole = 'student';

// Module-level variable to survive onAuthStateChanged state resets.
// When a teacher clicks "Add Parent Profile", we store 'teacher' here
// so OnboardingScreen can read it even after setUser() overwrites React state.
let _pendingReturnRole: string | undefined;
export function setPendingReturnRole(role: string | undefined) { _pendingReturnRole = role; }
export function getPendingReturnRole() { return _pendingReturnRole; }

function isSystemGeneratedStudentEmail(email: string) {
  return String(email || '').toLowerCase().trim().endsWith('@aivorah.student');
}


export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const email = firebaseUser.email || '';

        // Load saved local profile + fetch Supabase profile (needed to detect parent-activated accounts)
        const [supaProfile, savedRaw] = await Promise.all([
          fetchSupabaseProfile(email),
          AsyncStorage.getItem(PROFILE_KEY).catch(() => null),
        ]);
        let savedLocal: Partial<User> = {};
        try { if (savedRaw) savedLocal = JSON.parse(savedRaw); } catch {}

        // Auto-generated @aivorah.student emails have no mailbox — bypass verification
        // Parent-activated student accounts (accountStatus = 'active') also bypass verification
        // All other roles (student, teacher, parent) must verify via Firebase email link
        const allowAutoGen = isSystemGeneratedStudentEmail(email);
        const allowParentActivated = supaProfile.accountStatus === 'active';
        const storedRole = (firebaseUser.displayName?.split('|')[1] as UserRole) || (supaProfile.role as UserRole) || _pendingRole || 'student';
        const emailVerified = firebaseUser.emailVerified || allowAutoGen || allowParentActivated;
        const baseUser: User = {
          name:          firebaseUser.displayName?.split('|')[0] || firebaseUser.displayName || 'User',
          email,
          role:          storedRole,
          emailVerified,
        };

        const resolvedRole = (supaProfile.role as UserRole) || baseUser.role;

        // allowParentActivated skips onboarding only for parent-created student accounts
        // (their grade/curriculum was set by the parent). Self-registered parents/teachers
        // who verified their email still need to go through onboarding.
        const isParentCreatedStudent = allowParentActivated && resolvedRole === 'student';
        const onboardingComplete =
          allowAutoGen ||
          isParentCreatedStudent ||
          supaProfile.onboardingComplete === true ||
          savedLocal.onboardingComplete === true;
        setUser({ ...baseUser, ...savedLocal, ...supaProfile, onboardingComplete, role: resolvedRole });

        // Persist locally
        AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...savedLocal, ...supaProfile })).catch(() => {});
        fetch(`${SERVER_URL}/analytics/track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'app_access',
            userEmail: baseUser.email,
            role: resolvedRole,
            source: 'auth',
            meta: { provider: 'firebase' },
          }),
        }).catch(() => {});
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  function login(userData: User) {
    setUser(userData);
  }

  function updateUser(fields: Partial<User>) {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...fields };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
        name: updated.name, grade: updated.grade, curriculum: updated.curriculum,
        school: updated.school, location: updated.location,
        onboardingComplete: updated.onboardingComplete,
        avatarStyle: updated.avatarStyle,
        learningStyle: updated.learningStyle,
        interests: updated.interests,
        bio: updated.bio,
        photoUrl: updated.photoUrl,
        roles: updated.roles,
      })).catch(() => {});
      fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: updated.email,
          name: updated.name,
          role: updated.role,
          grade: updated.grade,
          curriculum: updated.curriculum,
          school: updated.school,
          location: updated.location,
          avatarStyle: updated.avatarStyle,
          learningStyle: updated.learningStyle,
          interests: updated.interests,
          bio: updated.bio,
          photoUrl: updated.photoUrl,
        }),
      }).catch(() => {});
      return updated;
    });
  }

  // Save curriculum/grade/school/location to Supabase and update local state
  async function saveProfile(fields: { curriculum?: string; grade?: string; school?: string; location?: string }) {
    if (!user?.email) return;
    try {
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, ...fields }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated: Partial<User> = {
          grade:              data.grade      || undefined,
          curriculum:         data.curriculum || undefined,
          school:             data.school     || undefined,
          location:           data.location   || undefined,
          onboardingComplete: data.onboardingComplete ?? false,
        };
        updateUser(updated);
      }
    } catch {}
  }

  async function logout() {
    await signOut(auth);
    await AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
    setUser(null);
  }

  async function signInWithEmail(email: string, password: string, role: UserRole) {
    _pendingRole = role;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Fetch full profile first — needed to detect parent-activated student accounts
      const [profile, savedRaw] = await Promise.all([
        fetchSupabaseProfile(email),
        AsyncStorage.getItem(PROFILE_KEY).catch(() => null),
      ]);
      const savedLocal: Partial<User> = savedRaw ? JSON.parse(savedRaw) : {};

      // Allow login without Firebase email verification for:
      // 1. Auto-generated @aivorah.student emails (no real mailbox)
      // 2. Parent-created student accounts (accountStatus = 'active' in Supabase)
      // All other accounts (including teacher/parent) must verify via email link
      const allowAutoGen = isSystemGeneratedStudentEmail(email);
      const allowParentActivated = profile.accountStatus === 'active';
      if (!cred.user.emailVerified && !allowAutoGen && !allowParentActivated) {
        await signOut(auth);
        throw new Error('Please verify your email before signing in. Check your inbox for the activation link.');
      }

      const name = profile.name || cred.user.displayName?.split('|')[0] || cred.user.displayName || '';
      const resolvedRole: UserRole = (profile.role as UserRole) || role;
      const isParentCreatedStudent = allowParentActivated && resolvedRole === 'student';
      const onboardingComplete =
        allowAutoGen ||
        isParentCreatedStudent ||
        profile.onboardingComplete === true ||
        savedLocal.onboardingComplete === true;

      // Legacy: activate old pending_verification accounts on first verified login
      if (cred.user.emailVerified && role === 'student' && profile.accountStatus === 'pending_verification') {
        fetch(`${SERVER_URL}/parent/children/activate-verified`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, firebaseUid: cred.user.uid }),
        }).then(r => r.ok ? r.json() : null).then(d => {
          if (d?.success) {
            profile.accountStatus = 'active';
            profile.onboardingComplete = true;
          }
        }).catch(() => {});
      }

      const newUser: User = {
        name, email, role: resolvedRole,
        roles:              Array.isArray(profile.roles) ? profile.roles as UserRole[] : [resolvedRole],
        grade:              profile.grade              || undefined,
        curriculum:         profile.curriculum         || undefined,
        school:             profile.school             || 'Hyderabad International School',
        location:           profile.location           || 'Hyderabad, India',
        onboardingComplete: profile.onboardingComplete === true || onboardingComplete,
        emailVerified:      cred.user.emailVerified || allowAutoGen || allowParentActivated,
        accountStatus:      profile.accountStatus,
      };
      setUser(newUser);
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(newUser)).catch(() => {});

      // Sync to Supabase — only send role if Supabase didn't have one yet (avoid overwriting signup role)
      fetch(`${SERVER_URL}/user/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, ...(profile.role ? {} : { role: resolvedRole }), school: newUser.school }),
      }).catch(() => {});
    } catch (error: any) {
      console.error('Firebase Signin Error:', error.code, error.message);
      // If this is a custom error we threw ourselves (no Firebase code), re-throw as-is
      if (!error.code) throw error;
      let message = 'An unexpected error occurred during signin.';

      switch (error.code) {
        case 'auth/user-not-found':
          message = 'No account found with this email.';
          break;
        case 'auth/wrong-password':
          message = 'Incorrect password.';
          break;
        case 'auth/invalid-credential':
          message = 'Invalid email or password.';
          break;
        case 'auth/invalid-email':
          message = 'The email address is badly formatted.';
          break;
        case 'auth/user-disabled':
          message = 'This user account has been disabled.';
          break;
        case 'auth/too-many-requests':
          message = 'Too many attempts. Please try again later.';
          break;
        case 'auth/network-request-failed':
          message = 'Network error. Please check your internet connection.';
          break;
      }
      throw new Error(message);
    }
  }

  async function signUpWithEmail(name: string, email: string, password: string, role: UserRole, curriculum?: string) {
    _pendingRole = role;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: `${name}|${role}` });

      // Sync to Supabase so the account exists before onAuthStateChanged fires
      await fetch(`${SERVER_URL}/user/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role, curriculum: curriculum || undefined }),
      }).catch(() => {});

      // Send branded verification email from aivorah24@gmail.com (not Firebase spam)
      const frontendOrigin = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : 'https://aivorah.ai';
      fetch(`${SERVER_URL}/user/send-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, frontendOrigin }),
      }).catch(() => {});
      // onAuthStateChanged will fire automatically and show VerifyEmailScreen
    } catch (error: any) {
      console.error('Firebase Signup Error:', error.code, error.message);
      let message = 'An unexpected error occurred during signup.';
      switch (error.code) {
        case 'auth/email-already-in-use':
          message = 'This email address is already in use.';
          break;
        case 'auth/invalid-email':
          message = 'The email address is badly formatted.';
          break;
        case 'auth/operation-not-allowed':
          message = 'Email/Password sign-in is disabled in Firebase Console.';
          break;
        case 'auth/weak-password':
          message = 'The password is too weak. Please use at least 6 characters.';
          break;
        case 'auth/network-request-failed':
          message = 'Network error. Please check your internet connection.';
          break;
      }
      throw new Error(message);
    }
  }

  async function signInWithGoogle(role: UserRole) {
    _pendingRole = role;
    if (Platform.OS === 'web') {
      try {
        const provider = new GoogleAuthProvider();
        const cred = await signInWithPopup(auth, provider);
        const name  = cred.user.displayName || cred.user.email?.split('@')[0] || 'User';
        const email = cred.user.email || '';
        const [profile, savedRaw] = await Promise.all([
          fetchSupabaseProfile(email),
          AsyncStorage.getItem(PROFILE_KEY).catch(() => null),
        ]);
        const savedLocal: Partial<User> = savedRaw ? JSON.parse(savedRaw) : {};
        const onboardingComplete =
          profile.onboardingComplete === true ||
          savedLocal.onboardingComplete === true;
        const newUser: User = {
          name, email, role,
          roles:              Array.isArray(profile.roles) ? profile.roles as UserRole[] : [role],
          grade:              profile.grade      || undefined,
          curriculum:         profile.curriculum || undefined,
          school:             profile.school     || undefined,
          location:           profile.location   || 'Hyderabad, India',
          onboardingComplete,
          emailVerified:      cred.user.emailVerified,
        };
        setUser(newUser);
        fetch(`${SERVER_URL}/user/sync`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, role }),
        }).catch(() => {});
      } catch (error: any) {
        console.error('Google Signin Error:', error.code, error.message);
        let message = 'An error occurred during Google signin.';
        if (error.code === 'auth/popup-closed-by-user') {
          message = 'Google sign-in was cancelled.';
        } else if (error.code === 'auth/network-request-failed') {
          message = 'Network error. Please check your connection.';
        }
        throw new Error(message);
      }
    } else {
      demoLogin(role);
    }
  }

  // Switch between teacher/parent profiles (dual-role users only)
  function switchRole(newRole: UserRole) {
    setUser(prev => {
      if (!prev || !prev.roles?.includes(newRole)) return prev;
      const updated = { ...prev, role: newRole, activeRole: newRole };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...updated })).catch(() => {});
      return updated;
    });
  }

  // Quick-login for test accounts — TEST_USERS data always wins over Supabase
  async function testLogin(email: string) {
    const S = 'Hyderabad International School';
    const L = 'Hyderabad, India';
    const base = { school: S, location: L, onboardingComplete: true as true, emailVerified: true as true };

    const TEST_USERS: Record<string, User> = {

      // ── IB PYP STUDENTS (4) — Demo for principal ──────────────────────────────
      'aanya@test.ai': {
        ...base, name: 'Aanya Kapoor', email: 'aanya@test.ai',
        role: 'student', grade: 'Grade 3', curriculum: 'IB PYP',
        avatarStyle: 'scholar',
      },
      'ishaan@test.ai': {
        ...base, name: 'Ishaan Mehta', email: 'ishaan@test.ai',
        role: 'student', grade: 'Grade 4', curriculum: 'IB PYP',
        avatarStyle: 'gamer',
      },
      'rohan@test.ai': {
        ...base, name: 'Rohan Patel', email: 'rohan@test.ai',
        role: 'student', grade: 'Grade 5', curriculum: 'IB PYP',
        avatarStyle: 'champion',
      },
      'diya@test.ai': {
        ...base, name: 'Diya Sharma', email: 'diya@test.ai',
        role: 'student', grade: 'Grade 3', curriculum: 'IB PYP',
        avatarStyle: 'creator',
      },

      // ── IB PYP TEACHERS (3) ───────────────────────────────────────────────────
      'anjali@test.ai': {
        ...base, name: 'Ms. Anjali Kumar', email: 'anjali@test.ai',
        role: 'teacher', roles: ['teacher'],
        teaches: [
          { grade: 'Grade 3', curriculum: 'IB PYP' },
          { grade: 'Grade 4', curriculum: 'IB PYP' },
        ],
      },

      // ── DUAL ROLE: Teacher + Parent ───────────────────────────────────────────
      // Priya Kapoor — Grade 3 IB PYP teacher AND mother of Aanya (Grade 3)
      'priya.k@test.ai': {
        ...base, name: 'Priya Kapoor', email: 'priya.k@test.ai',
        role: 'teacher', roles: ['teacher', 'parent'], activeRole: 'teacher',
        teaches: [{ grade: 'Grade 3', curriculum: 'IB PYP' }],
        children: [{ name: 'Aanya Kapoor', grade: 'Grade 3', curriculum: 'IB PYP', email: 'aanya@test.ai' }],
      },
      // Vikram Sharma — Grade 3 & 4 IB PYP teacher AND father of Diya (Grade 3)
      'vikram@test.ai': {
        ...base, name: 'Vikram Sharma', email: 'vikram@test.ai',
        role: 'teacher', roles: ['teacher', 'parent'], activeRole: 'teacher',
        teaches: [
          { grade: 'Grade 3', curriculum: 'IB PYP' },
          { grade: 'Grade 4', curriculum: 'IB PYP' },
        ],
        children: [{ name: 'Diya Sharma', grade: 'Grade 3', curriculum: 'IB PYP', email: 'diya@test.ai' }],
      },

      // ── PARENTS ONLY ──────────────────────────────────────────────────────────
      'suresh@test.ai': {
        ...base, name: 'Suresh Mehta', email: 'suresh@test.ai',
        role: 'parent', roles: ['parent'],
        children: [{ name: 'Ishaan Mehta', grade: 'Grade 4', curriculum: 'IB PYP', email: 'ishaan@test.ai' }],
      },
      'deepa@test.ai': {
        ...base, name: 'Deepa Patel', email: 'deepa@test.ai',
        role: 'parent', roles: ['parent'],
        children: [{ name: 'Rohan Patel', grade: 'Grade 5', curriculum: 'IB PYP', email: 'rohan@test.ai' }],
      },

      // ── NCERT STUDENTS ──────────────────────────────────────────────────────────
      'arjun@test.ai': { ...base, name: 'Arjun Sharma', email: 'arjun@test.ai', role: 'student', grade: 'Grade 3', curriculum: 'NCERT' },
      'priya@test.ai': { ...base, name: 'Priya Nair',   email: 'priya@test.ai', role: 'student', grade: 'Grade 3', curriculum: 'NCERT' },
      'kavya@test.ai': { ...base, name: 'Kavya Reddy',  email: 'kavya@test.ai', role: 'student', grade: 'Grade 5', curriculum: 'NCERT' },

      // ── CBSE STUDENTS ────────────────────────────────────────────────────────────
      'tanvi@test.ai':  { ...base, name: 'Tanvi Gupta',  email: 'tanvi@test.ai',  role: 'student', grade: 'Grade 3', curriculum: 'CBSE' },
      'meera@test.ai':  { ...base, name: 'Meera Joshi',  email: 'meera@test.ai',  role: 'student', grade: 'Grade 4', curriculum: 'CBSE' },
      'vivaan@test.ai': { ...base, name: 'Vivaan Kumar', email: 'vivaan@test.ai', role: 'student', grade: 'Grade 5', curriculum: 'CBSE' },
      'aarav@test.ai':  { ...base, name: 'Aarav Singh',  email: 'aarav@test.ai',  role: 'student', grade: 'Grade 6', curriculum: 'CBSE' },
    };
    const testUser = TEST_USERS[email];
    if (!testUser) return;
    // Set test user immediately so UI doesn't wait on network
    setUser(testUser);
    // Fetch live Supabase profile — merge photoUrl and dynamically-added roles (e.g. teacher who added parent profile)
    const profile = await fetchSupabaseProfile(email);
    // Merge roles: if server has more roles than hardcoded (e.g. teacher added parent profile), use server version
    const mergedRoles = (profile.roles && profile.roles.length > (testUser.roles?.length ?? 1))
      ? profile.roles
      : testUser.roles;
    setUser({
      ...testUser,
      photoUrl: profile.photoUrl ?? testUser.photoUrl,
      roles: mergedRoles,
      // Always preserve test user's core identity fields
      role:       testUser.role,
      name:       testUser.name,
      grade:      testUser.grade,
      curriculum: testUser.curriculum,
    });
    // Sync test user profile to Supabase so backend sees correct curriculum/grade
    fetch(`${SERVER_URL}/user/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: testUser.name, email: testUser.email, role: testUser.role,
        grade: testUser.grade, curriculum: testUser.curriculum, school: testUser.school,
      }),
    }).catch(() => {});
  }

  function demoLogin(role: UserRole = 'student') {
    const demos: Record<UserRole, User> = {
      student: { name: 'Alex Richardson', email: 'alex@demo.com', role: 'student', grade: 'Grade 3', curriculum: 'IB PYP', school: 'Hyderabad International School', location: 'Hyderabad, India', onboardingComplete: true, emailVerified: true },
      teacher: { name: 'Ms. Zara',        email: 'teacher@demo.com', role: 'teacher', school: 'Hyderabad International School', location: 'Hyderabad, India', onboardingComplete: true, emailVerified: true, teaches: [{ grade: 'Grade 3', curriculum: 'IB PYP' }] },
      parent:  { name: 'Priya Richardson', email: 'parent@demo.com', role: 'parent', location: 'Hyderabad, India', onboardingComplete: true, emailVerified: true, children: [{ name: 'Alex Richardson', grade: 'Grade 3', curriculum: 'IB PYP', email: 'alex@demo.com' }] },
    };
    setUser(demos[role]);
  }

  return (
    <AuthContext.Provider value={{
      user, isAuthenticated: !!user, loading,
      login, logout, updateUser, saveProfile,
      signInWithEmail, signUpWithEmail, signInWithGoogle,
      demoLogin, testLogin, switchRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
