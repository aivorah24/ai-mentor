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

function normalizeEmail(email: string | undefined | null) {
  return String(email || '').toLowerCase().trim();
}

function isCachedProfileForEmail(profile: Partial<User>, email: string) {
  return normalizeEmail(profile.email) === normalizeEmail(email);
}

export type UserRole = 'student' | 'teacher' | 'parent' | 'super_admin';

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
  mustChangePassword?: boolean; // true for auto-generated student accounts until they set their own password
  // Relationship metadata
  children?: { name: string; grade: string; email: string; curriculum?: string }[];  // for parents
  teaches?: { grade: string; curriculum: string }[];            // for teachers
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  login: (user: User) => void;
  logout: () => void;
  updateUser: (fields: Partial<User>) => void;
  refreshProfile: () => Promise<void>;
  saveProfile: (fields: { curriculum?: string; grade?: string; school?: string; location?: string }) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (name: string, email: string, password: string, role: UserRole, curriculum?: string) => Promise<void>;
  signInWithGoogle: (role?: UserRole) => Promise<void>;
  demoLogin: (role?: UserRole) => void;
  testLogin: (email: string) => void;
  switchRole: (newRole: UserRole) => void;
  addParentRoleToTeacher: (email: string, password: string) => Promise<void>;
  addParentRoleToTeacherSSO: (email: string) => Promise<void>;
  beginAddParentProfile: () => void;
  cancelAddParentProfile: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  loading: true,
  authError: null,
  clearAuthError: () => {},
  login: () => {},
  logout: () => {},
  updateUser: () => {},
  refreshProfile: async () => {},
  saveProfile: async () => {},
  signInWithEmail: async () => {},
  signUpWithEmail: async (_n, _e, _p, _r, _c) => {},
  signInWithGoogle: async () => {},
  demoLogin: () => {},
  testLogin: () => {},
  switchRole: () => {},
  addParentRoleToTeacher: async () => {},
  addParentRoleToTeacherSSO: async () => {},
  beginAddParentProfile: () => {},
  cancelAddParentProfile: () => {},
});

// Fetch full profile from Supabase (includes curriculum, grade, location, onboardingComplete)
async function fetchSupabaseProfile(email: string): Promise<Partial<User> & { _syncOk?: boolean; _accountExists?: boolean }> {
  const combined: Partial<User> & { _syncOk?: boolean; _accountExists?: boolean } = {};
  try {
    const res = await fetch(`${SERVER_URL}/user/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      const data = await res.json();
      // _syncOk: the DB lookup itself succeeded (distinguishes "account missing"
      // from "network error" — only the former should trigger a forced sign-out).
      // _accountExists: a real identity row was returned. When no row exists,
      // /user/sync replies with just { email, onboardingComplete:false } (no id,
      // no role) — meaning the account was never created or has been deleted.
      combined._syncOk = true;
      combined._accountExists = !!(data.id || data.role);
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
        mustChangePassword: data.mustChangePassword === true,
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
          activeRole: pref.activeRole || undefined,
        });
      }
    }
  } catch {}

  return combined;
}

let _pendingRole: UserRole = 'student';
let _pendingRoleSet = false; // true only when role was explicitly chosen this session (not the default)
let _isAddingRole = false; // true when an existing user is adding a second role (teacher↔parent only)
// True while a user-initiated sign-in / sign-up is running (and briefly after).
// The "account deleted server-side" auto-sign-out must NOT fire during this window,
// because a brand-new signup can momentarily look account-less to a concurrent
// onAuthStateChanged before its /user/sync row finishes writing.
let _authActionInProgress = false;
function markAuthAction() {
  _authActionInProgress = true;
  // Tag this browser TAB session as having an explicit login/signup. RootNavigator
  // uses it to tell a live signup flow (continue into onboarding, survives F5)
  // apart from a STALE half-registered session restored days later — which must
  // show the landing page, not trap the visitor in the setup screen.
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('aivorah_auth_this_session', '1');
  } catch {}
  // Keep the guard active a few seconds past the function returning so the
  // post-action onAuthStateChanged cycle (incl. its network fetch) completes.
  setTimeout(() => { _authActionInProgress = false; }, 3000);
}

// AsyncStorage key — persists across multiple onAuthStateChanged fires (module flag gets cleared too early)
const PENDING_VERIFY_KEY = 'aivorah_pending_verify_email';

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
  const [authError, setAuthError] = useState<string | null>(null);
  // True once Firebase has confirmed the auth state (user or null)
  const firebaseConfirmed = React.useRef(false);
  function clearAuthError() { setAuthError(null); }

  // On web: immediately restore cached profile so the correct screen shows
  // on page refresh without waiting for Firebase to read IndexedDB.
  // Firebase will still confirm in the background and override if the session expired.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    AsyncStorage.getItem(PROFILE_KEY).then(raw => {
      if (!raw || firebaseConfirmed.current) return;
      try {
        const cached = JSON.parse(raw);
        if (cached?.email && cached?.role) {
          setUser(cached);
          setLoading(false);
        }
      } catch {}
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      firebaseConfirmed.current = true;
      if (firebaseUser) {
        const email = firebaseUser.email || '';

        // Load saved local profile + fetch Supabase profile (needed to detect parent-activated accounts)
        let supaProfile: Partial<User> & { _syncOk?: boolean; _accountExists?: boolean } = {};
        let savedRaw: string | null = null;
        try {
          [supaProfile, savedRaw] = await Promise.all([
            fetchSupabaseProfile(email),
            AsyncStorage.getItem(PROFILE_KEY).catch(() => null),
          ]);
        } catch {
          // Network error — fall back to cached profile so refresh doesn't kick user out
          const cached = await AsyncStorage.getItem(PROFILE_KEY).catch(() => null);
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              if (parsed?.email === email) {
                setUser(parsed);
                setLoading(false);
                return;
              }
            } catch {}
          }
          setLoading(false);
          return;
        }
        let savedLocal: Partial<User> = {};
        try {
          if (savedRaw) {
            const parsed = JSON.parse(savedRaw);
            savedLocal = isCachedProfileForEmail(parsed, email) ? parsed : {};
          }
        } catch {}

        // Auto-generated @aivorah.student emails have no mailbox — bypass verification
        // Parent-activated student accounts (accountStatus = 'active') also bypass verification
        // All other roles (student, teacher, parent) must verify via Firebase email link
        const allowAutoGen = isSystemGeneratedStudentEmail(email);

        // ── Deleted / non-existent account guard ──────────────────────────────
        // If the DB lookup SUCCEEDED but found NO account, it's one of two things:
        //   (a) a genuinely deleted account whose Firebase session is still cached
        //       client-side (must go to Landing), or
        //   (b) a brand-new signup whose users-row write simply hasn't landed yet
        //       (must continue to "Check your inbox").
        // The old timer-based flag was unreliable and sometimes bounced a fresh
        // signup to Landing. Instead, re-confirm with one delayed re-fetch: a real
        // deletion stays missing; a signup race finds the row the second time.
        // NOTE: this guard runs for ALL accounts including auto-generated
        // @aivorah.student ones. `allowAutoGen` only bypasses email VERIFICATION,
        // not the deleted-account check — without this, a parent-created student
        // whose DB record was deleted stayed stuck on the cached "Set Password"
        // screen instead of being signed out to Landing. (client feedback)
        if (
          supaProfile._syncOk === true &&
          supaProfile._accountExists === false
        ) {
          await new Promise((r) => setTimeout(r, 300));
          let recheck: Partial<User> & { _syncOk?: boolean; _accountExists?: boolean } = {};
          try { recheck = await fetchSupabaseProfile(email); } catch {}
          if (recheck._syncOk === true && recheck._accountExists === false) {
            // Row STILL missing. But if a sign-up / sign-in is in progress (or this
            // email is a fresh pending-verification signup), the row simply hasn't
            // finished writing yet — common on a cold/slow server during beta. In
            // that window we must NOT bounce the user to Landing; keep the session
            // so they land on "Check your inbox" instead of a blank screen.
            const pendingVerify = await AsyncStorage.getItem(PENDING_VERIFY_KEY).catch(() => null);
            const freshSignupInFlight = _authActionInProgress || pendingVerify === email;
            if (!freshSignupInFlight) {
              // Confirmed missing & no signup in flight — genuine deletion. Sign out cleanly to Landing.
              console.log('[Auth] Account confirmed missing in DB — signing out to Landing:', email);
              await AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
              await AsyncStorage.removeItem(PENDING_VERIFY_KEY).catch(() => {});
              await signOut(auth).catch(() => {});
              setUser(null);
              setLoading(false);
              return;
            }
            console.log('[Auth] DB row not landed yet but signup in flight — keeping session for verification:', email);
          }
          // Account exists now (the signup row landed) — adopt the fresh data.
          if (recheck._syncOk === true && recheck._accountExists !== false) supaProfile = recheck;
        }

        const allowParentActivated = supaProfile.accountStatus === 'active';
        const storedRole = (firebaseUser.displayName?.split('|')[1] as UserRole) || (supaProfile.role as UserRole) || _pendingRole || 'student';

        // Block first-time Google SSO users until they click the Aivorah verification link.
        // Google users always have firebaseUser.emailVerified = true, so we can't rely on that.
        // Instead: if the user signed in via Google AND onboarding isn't complete (new user),
        // require accountStatus === 'active' (set by server when they click the email link).
        // AsyncStorage flag is kept as a secondary signal but we no longer race-depend on it.
        const isGoogleProvider = firebaseUser.providerData.some(p => p.providerId === 'google.com');
        const isPasswordProvider = firebaseUser.providerData.some(p => p.providerId === 'password');
        const isExistingUser = supaProfile.onboardingComplete === true;
        const pendingVerifyEmail = await AsyncStorage.getItem(PENDING_VERIFY_KEY).catch(() => null);
        let requiresVerification: boolean;
        if ((isGoogleProvider || isPasswordProvider) && !isExistingUser && !allowAutoGen) {
          // New signup (Google SSO or email/password) — must verify via Aivorah link.
          // Require accountStatus === 'active' explicitly: right after signup, onAuthStateChanged
          // can fire before /user/send-verification finishes creating the user_preferences row,
          // so accountStatus is briefly undefined — that must NOT be treated as verified.
          requiresVerification = supaProfile.accountStatus !== 'active';
        } else {
          // Email/password users or returning verified users — use accountStatus or AsyncStorage flag.
          // An already-active account (verified via the Aivorah link) always wins over a
          // stale local "pending verification" flag from signup time.
          requiresVerification = !allowParentActivated &&
            ((pendingVerifyEmail === email) || supaProfile.accountStatus === 'pending_verification');
        }
        // Clear the AsyncStorage flag once the user is actually verified (accountStatus = active)
        if (pendingVerifyEmail === email && allowParentActivated) {
          await AsyncStorage.removeItem(PENDING_VERIFY_KEY).catch(() => {});
        }
        const emailVerified = !requiresVerification && (firebaseUser.emailVerified || allowAutoGen || allowParentActivated);
        const baseUser: User = {
          name:          firebaseUser.displayName?.split('|')[0] || firebaseUser.displayName || 'User',
          email,
          role:          storedRole,
          emailVerified,
        };

        const resolvedRole = (supaProfile.role as UserRole) || baseUser.role;

        // Role validation — only run when the user explicitly chose a role this session.
        // After a page reload _pendingRole resets to 'student' (default) — skip validation then
        // to avoid signing out a returning teacher/parent who navigated back to the app.
        if (_pendingRoleSet && _pendingRole && supaProfile.role) {
          const registeredRoles: UserRole[] = Array.isArray(supaProfile.roles) && supaProfile.roles.length > 0
            ? supaProfile.roles as UserRole[]
            : [supaProfile.role as UserRole];
          if (!registeredRoles.includes(_pendingRole)) {
            // Teacher trying to add Parent role → keep session alive, show club-profile alert
            if (supaProfile.role === 'teacher' && _pendingRole === 'parent') {
              setAuthError(`TEACHER_ADD_PARENT:${email}`);
              _pendingRoleSet = false;
              setLoading(false);
              return; // Don't set user, don't sign out
            }
            const registeredLabel = supaProfile.role === 'teacher' ? 'Teacher'
              : supaProfile.role === 'parent' ? 'Parent'
              : 'Student';
            setAuthError(`This account is registered as a ${registeredLabel}. Please select the correct role and try again.`);
            signOut(auth).catch(() => {});
            _pendingRoleSet = false;
            setLoading(false);
            return; // Don't set user
          }
        }
        _pendingRoleSet = false; // clear after validation so page reloads don't re-trigger it

        // Only skip onboarding for parent-created student accounts (auto-generated @aivorah.student emails)
        // Regular users who verified via Aivorah email still need onboarding regardless of accountStatus
        const isParentCreatedStudent = allowAutoGen && resolvedRole === 'student';

        // When a teacher is adding a parent profile, force parent onboarding
        const isAddingNewRole = _isAddingRole;
        if (_isAddingRole) _isAddingRole = false;

        const onboardingComplete = isAddingNewRole ? false : (
          allowAutoGen ||
          isParentCreatedStudent ||
          supaProfile.onboardingComplete === true ||
          // Only trust local cache if DB didn't explicitly say false (prevents stale cache bypassing onboarding after account deletion)
          (supaProfile.onboardingComplete !== false && savedLocal.onboardingComplete === true)
        );
        // On refresh, honour the role the user last switched to (saved in AsyncStorage).
        // Only fall back to DB resolvedRole if no local activeRole is saved, or if we're
        // adding a new role this session.
        // Best available roles — take whichever source has the most (DB pref > local cache > single)
        const bestRoles: UserRole[] =
          (Array.isArray(supaProfile.roles) && supaProfile.roles.length > 0 ? supaProfile.roles as UserRole[] : null) ||
          (Array.isArray(savedLocal.roles)   && savedLocal.roles.length   > 0 ? savedLocal.roles   as UserRole[] : null) ||
          [resolvedRole];
        const validRoles = bestRoles;
        // Priority: AsyncStorage > DB activeRole > DB role
        const savedActiveRole = (savedLocal.activeRole || supaProfile.activeRole) as UserRole | undefined;
        const activeRole: UserRole = isAddingNewRole
          ? _pendingRole
          : (savedActiveRole && validRoles.includes(savedActiveRole) ? savedActiveRole : resolvedRole);
        const resolvedUser = { ...baseUser, ...savedLocal, ...supaProfile, email, onboardingComplete, emailVerified, role: activeRole, roles: bestRoles };
        setUser(resolvedUser);

        // Persist locally
        AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(resolvedUser)).catch(() => {});
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
        // Firebase confirmed no authenticated user (session expired or never logged in).
        // Clear any optimistically-loaded cached profile.
        AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Poll every 30 s while a real user is logged in.
  // If the DB row is gone (admin deleted the account), sign out immediately to Landing.
  useEffect(() => {
    const isDemoOrTest = user?.email?.endsWith('@demo.com') || user?.email?.endsWith('@test.ai') || user?.email?.endsWith('@aivorah.ai');
    if (!user?.email || isDemoOrTest) return;
    // Never auto-sign-out a user who is still pending email verification — their
    // DB row may legitimately be mid-creation (slow/cold server), and a missing
    // row here would wrongly bounce them off "Check your inbox" to Landing.
    // VerifyEmailScreen runs its own check-verified polling to advance them.
    if (user?.emailVerified === false) return;
    const email = user.email;
    const interval = setInterval(async () => {
      try {
        const profile = await fetchSupabaseProfile(email);
        if (profile._syncOk === true && profile._accountExists === false) {
          // A fresh signup/sign-in still settling must not be treated as deleted.
          const pendingVerify = await AsyncStorage.getItem(PENDING_VERIFY_KEY).catch(() => null);
          if (_authActionInProgress || pendingVerify === email) return;
          clearInterval(interval);
          await AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
          await signOut(auth).catch(() => {});
          setUser(null);
        }
      } catch {}
    }, 30_000);
    return () => clearInterval(interval);
  }, [user?.email, user?.emailVerified]);

  function login(userData: User) {
    setUser(userData);
  }

  function updateUser(fields: Partial<User>) {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...fields };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
        name: updated.name, grade: updated.grade, curriculum: updated.curriculum,
        email: updated.email,
        role: updated.role,
        activeRole: updated.activeRole,
        school: updated.school, location: updated.location,
        onboardingComplete: updated.onboardingComplete,
        emailVerified: updated.emailVerified,
        accountStatus: updated.accountStatus,
        avatarStyle: updated.avatarStyle,
        learningStyle: updated.learningStyle,
        interests: updated.interests,
        bio: updated.bio,
        photoUrl: updated.photoUrl,
        roles: updated.roles,
        mustChangePassword: updated.mustChangePassword,
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

  // Re-pull the authoritative profile (grade/curriculum/school/name/photo) from the
  // server and update the session — so changes made elsewhere (e.g. a parent editing
  // the child's grade) reflect for the logged-in user without re-login.
  async function refreshProfile() {
    const email = user?.email;
    if (!email) return;
    try {
      const fresh = await fetchSupabaseProfile(email);
      if (fresh._accountExists === false) return; // don't clobber on a missing/error read
      setUser(prev => {
        if (!prev) return prev;
        const updated: User = {
          ...prev,
          grade:      fresh.grade      ?? prev.grade,
          curriculum: fresh.curriculum ?? prev.curriculum,
          school:     fresh.school     ?? prev.school,
          name:       fresh.name       ?? prev.name,
          photoUrl:   fresh.photoUrl   ?? prev.photoUrl,
        };
        AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({
          name: updated.name, grade: updated.grade, curriculum: updated.curriculum,
          email: updated.email, role: updated.role, activeRole: updated.activeRole,
          school: updated.school, location: updated.location,
          onboardingComplete: updated.onboardingComplete, emailVerified: updated.emailVerified,
          accountStatus: updated.accountStatus, avatarStyle: updated.avatarStyle,
          learningStyle: updated.learningStyle, interests: updated.interests, bio: updated.bio,
          photoUrl: updated.photoUrl, roles: updated.roles, mustChangePassword: updated.mustChangePassword,
        })).catch(() => {});
        return updated;
      });
    } catch {}
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
    // Clear local state + cache FIRST so logout works even if signOut() hangs
    // on a flaky network (otherwise setUser(null) would never run).
    setUser(null);
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('aivorah_auth_this_session'); } catch {}
    await AsyncStorage.removeItem(PROFILE_KEY).catch(() => {});
    await signOut(auth).catch(() => {});
  }

  async function signInWithEmail(email: string, password: string) {
    markAuthAction();
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Fetch full profile first — needed to detect parent-activated student accounts
      const [profile, savedRaw] = await Promise.all([
        fetchSupabaseProfile(email),
        AsyncStorage.getItem(PROFILE_KEY).catch(() => null),
      ]);
      let savedLocal: Partial<User> = {};
      try {
        if (savedRaw) {
          const parsed = JSON.parse(savedRaw);
          savedLocal = isCachedProfileForEmail(parsed, email) ? parsed : {};
        }
      } catch {}

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
      // Role comes straight from the account — at sign-in we never ask the user to
      // declare it, so there's no "wrong role" rejection. _pendingRoleSet=false makes
      // onAuthStateChanged skip its role-validation pass.
      const resolvedRole: UserRole = (profile.role as UserRole) || 'student';
      _pendingRole = resolvedRole; _pendingRoleSet = false;

      const isParentCreatedStudent = allowAutoGen && resolvedRole === 'student';
      const onboardingComplete =
        allowAutoGen ||
        isParentCreatedStudent ||
        profile.onboardingComplete === true ||
        (profile.onboardingComplete !== false && savedLocal.onboardingComplete === true);

      // Legacy: activate old pending_verification accounts on first verified login
      if (cred.user.emailVerified && resolvedRole === 'student' && profile.accountStatus === 'pending_verification') {
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
        mustChangePassword: profile.mustChangePassword === true,
      };
      setUser(newUser);
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(newUser)).catch(() => {});

      // Sync to Supabase — only send role if Supabase didn't have one yet (avoid overwriting signup role)
      // IMPORTANT: never write `name`/`school` back from a login. The DB is the source of
      // truth for the editable display name; `name` here can fall back to the Firebase
      // displayName (set at signup, never updated on rename), so writing it on every login
      // silently reverts any rename — which then shows the old name in teacher/parent views.
      // Only echo the DB's own name back (harmless self-heal); only set school if missing.
      fetch(`${SERVER_URL}/user/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          ...(profile.name ? { name: profile.name } : {}),
          ...(profile.role ? {} : { role: resolvedRole }),
          ...(profile.school ? {} : { school: newUser.school }),
        }),
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
    _pendingRole = role; _pendingRoleSet = true;
    markAuthAction();
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: `${name}|${role}` });

      // Mark this email as pending verification BEFORE the network syncs — this
      // survives multiple onAuthStateChanged fires and guarantees the user lands
      // on "Check your inbox" even if the DB row write is slow (cold server).
      await AsyncStorage.setItem(PENDING_VERIFY_KEY, email).catch(() => {});

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
      const safeName = name?.trim() || email.split('@')[0]; // fallback if name is empty
      try {
        const verifyRes = await fetch(`${SERVER_URL}/user/send-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name: safeName, frontendOrigin }),
        });
        if (!verifyRes.ok) {
          const errData = await verifyRes.json().catch(() => ({}));
          console.error('[signup] send-verification failed:', errData.error || verifyRes.status);
        }
      } catch (verifyErr: any) {
        console.error('[signup] send-verification network error:', verifyErr.message);
      }
      // onAuthStateChanged will fire automatically and show VerifyEmailScreen
    } catch (error: any) {
      console.error('Firebase Signup Error:', error.code, error.message);
      let message = 'An unexpected error occurred during signup.';
      switch (error.code) {
        case 'auth/email-already-in-use': {
          // Fetch existing role to determine how to handle
          let existingRole = '';
          try {
            const res = await fetch(`${SERVER_URL}/user/role?email=${encodeURIComponent(email)}`);
            if (res.ok) existingRole = (await res.json()).role || '';
          } catch {}

          // Only Teacher → Parent dual-role is supported
          // Throw a special tagged error so LandingScreen can show a confirmation dialog
          if (existingRole === 'teacher' && role === 'parent') {
            throw new Error(`TEACHER_ADD_PARENT:${email}`);
          }

          // All other combinations — show clear error
          const roleLabel = existingRole === 'teacher' ? 'Teacher'
            : existingRole === 'parent' ? 'Parent'
            : existingRole === 'student' ? 'Student'
            : '';
          message = roleLabel
            ? `This email is already registered as a ${roleLabel}. Please login using your existing account, or sign up with a different email.`
            : 'This email is already registered. Please login using your existing account, or sign up with a different email.';
          break;
        }
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

  async function signInWithGoogle(role?: UserRole) {
    // `role` is the chip selection. It only assigns a role to a BRAND-NEW account;
    // a returning user's role always comes from the DB.
    if (role) _pendingRole = role;
    // Google NEVER runs onAuthStateChanged's role-validation: returning users use
    // their stored role, new users have none to conflict with. Set this false up
    // front (not after the async popup) so validation can't race ahead and show the
    // old "This account is registered as a Student" error.
    _pendingRoleSet = false;
    markAuthAction();
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
        let savedLocal: Partial<User> = {};
        try {
          if (savedRaw) {
            const parsed = JSON.parse(savedRaw);
            savedLocal = isCachedProfileForEmail(parsed, email) ? parsed : {};
          }
        } catch {}

        const existingRole = profile.role as UserRole | undefined;

        // NEW Google user with no role → came from the LOGIN modal (sign-in needs no
        // role). We can't create an account without a role, so clear the transient
        // Google session (prevents the deleted-account guard firing) and bounce them
        // to the Sign-Up modal to choose a role.
        if (!existingRole && !role) {
          await signOut(auth).catch(() => {});
          throw new Error(`NEW_GOOGLE_USER:${email}`);
        }

        // EXISTING account → always sign in with the STORED role. The role chip is
        // ignored for returning users (they just tap Google). The single exception is
        // the dual-profile case: a Teacher who explicitly picks "Parent" is offered
        // to add a Parent profile. No "wrong role" rejection — a returning user can
        // never be locked out by which chip happened to be selected.
        if (existingRole) {
          // Returning user → ignore the role chip; the stored role is used. The one
          // exception: a Teacher explicitly picking "Parent" → offer a Parent profile.
          const registeredRoles: UserRole[] = Array.isArray(profile.roles) && profile.roles.length > 0
            ? profile.roles as UserRole[]
            : [existingRole];
          if (role === 'parent' && existingRole === 'teacher' && !registeredRoles.includes('parent')) {
            throw new Error(`TEACHER_ADD_PARENT:${email}`);
          }
        }

        // Returning → stored role; brand-new signup → the role chosen BEFORE the tap.
        // Because the role is known before account creation, there's never an
        // "authenticated but account-less" window — so the core routing/guard is
        // untouched by this flow.
        const effectiveRole: UserRole = existingRole || role || 'student';

        const onboardingComplete =
          profile.onboardingComplete === true ||
          savedLocal.onboardingComplete === true;
        const newUser: User = {
          name, email, role: effectiveRole,
          roles:              Array.isArray(profile.roles) ? profile.roles as UserRole[] : [effectiveRole],
          grade:              profile.grade      || undefined,
          curriculum:         profile.curriculum || undefined,
          school:             profile.school     || undefined,
          location:           profile.location   || 'Hyderabad, India',
          onboardingComplete,
          // First-time Google SSO users must verify via Aivorah email before entering
          emailVerified: existingRole ? cred.user.emailVerified : false,
        };

        // Send Aivorah activation email if not yet verified (covers new users + returning unverified)
        const isAlreadyVerified = profile.accountStatus === 'active';
        if (!isAlreadyVerified) {
          // Persist to AsyncStorage — survives multiple onAuthStateChanged fires
          await AsyncStorage.setItem(PENDING_VERIFY_KEY, email).catch(() => {});

          // Sync user to Supabase first so user_preferences row exists for token storage
          await fetch(`${SERVER_URL}/user/sync`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, role: effectiveRole }),
          }).catch(() => {});

          // Now send the verification email
          const frontendOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://aivorah.ai';
          try {
            const vRes = await fetch(`${SERVER_URL}/user/send-verification`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, name, frontendOrigin }),
            });
            if (!vRes.ok) {
              const d = await vRes.json().catch(() => ({}));
              console.error('[google-sso] send-verification failed:', d.error || vRes.status);
            }
          } catch (err: any) {
            console.error('[google-sso] send-verification network error:', err.message);
          }
        } else {
          // Returning verified user — don't overwrite the DB display name with the
          // Google displayName (which ignores in-app renames). Echo the DB name instead.
          fetch(`${SERVER_URL}/user/sync`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, ...(profile.name ? { name: profile.name } : { name }), role: effectiveRole }),
          }).catch(() => {});
        }
      } catch (error: any) {
        // Re-throw our custom errors (role mismatch etc.) directly — don't replace message
        if (!error.code) throw error;
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
      demoLogin(role || 'student');
    }
  }

  // Called when a Teacher confirms they want to add a Parent profile (dual-role)
  // Signs in with existing credentials, adds parent role, triggers parent onboarding
  async function addParentRoleToTeacher(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
    await fetch(`${SERVER_URL}/user/add-role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: 'parent' }),
    });
    _pendingRole = 'parent'; _pendingRoleSet = true;
    _isAddingRole = true;
    // onAuthStateChanged will fire and route to parent onboarding
  }

  // Google SSO variant — user is already signed in, no password needed
  async function addParentRoleToTeacherSSO(email: string) {
    await fetch(`${SERVER_URL}/user/add-role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: 'parent' }),
    });
    _pendingRole = 'parent'; _pendingRoleSet = true;
    _isAddingRole = true;
    _pendingReturnRole = 'teacher';

    // user state is null at this point (onAuthStateChanged returned early without setUser)
    // Build user from scratch using Firebase current user + Supabase profile
    const firebaseUser = auth.currentUser;
    const profile = await fetchSupabaseProfile(email);
    const name = firebaseUser?.displayName || profile.name || email.split('@')[0];

    setUser({
      name,
      email,
      role: 'parent',
      roles: ['teacher', 'parent'],
      activeRole: 'parent',
      onboardingComplete: false,
      emailVerified: true,
      accountStatus: profile.accountStatus,
      school: profile.school,
      location: profile.location,
      curriculum: profile.curriculum,
    });
  }

  // Switch between teacher/parent profiles (dual-role users only)
  function switchRole(newRole: UserRole) {
    _pendingReturnRole = undefined;
    setUser(prev => {
      if (!prev || !prev.roles?.includes(newRole)) return prev;
      const updated = { ...prev, role: newRole, activeRole: newRole };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ ...updated })).catch(() => {});
      // Persist activeRole to DB so it survives browser storage clears
      if (prev.email) {
        fetch(`${SERVER_URL}/user/preferences`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: prev.email, activeRole: newRole }),
        }).catch(() => {});
      }
      return updated;
    });
  }

  // ── Teacher → add Parent profile (deferred persistence) ───────────────────
  // Starting the flow only flips IN-MEMORY state so the onboarding gate shows the
  // parent steps. Nothing is written to AsyncStorage/DB here — the parent role is
  // persisted ONLY when parent onboarding completes (OnboardingScreen). So if the
  // user backs out, no half-created parent profile is left behind.
  function beginAddParentProfile() {
    // Only pendingReturnRole + in-memory state (mirrors the original working path,
    // minus the premature persistence). Completion persists the parent role.
    _pendingReturnRole = 'teacher';
    setUser(prev => prev ? { ...prev, role: 'parent', onboardingComplete: false } : prev);
  }

  // Cancel the add-parent flow (in-app Back or browser Back) — restore the teacher
  // profile entirely from memory. Because beginAddParentProfile never persisted
  // anything, AsyncStorage/DB still hold the clean teacher state; we just re-sync
  // the in-memory user so the app routes straight back to the teacher dashboard.
  function cancelAddParentProfile() {
    _pendingReturnRole = undefined;
    setUser(prev => {
      if (!prev) return prev;
      const roles = (prev.roles || []).filter(r => r !== 'parent');
      return {
        ...prev,
        role: 'teacher',
        activeRole: 'teacher',
        roles: roles.length > 0 ? roles : ['teacher'],
        onboardingComplete: true,
      };
    });
  }

  // Quick-login for test accounts — TEST_USERS data always wins over Supabase
  async function testLogin(email: string) {
    const S = 'Hyderabad International School';
    const L = 'Hyderabad, India';
    const base = { school: S, location: L, onboardingComplete: true as true, emailVerified: true as true };

    const TEST_USERS: Record<string, User> = {

      // ── DEMO ACCOUNTS (interconnected: Anaya + Meera + Priya) ───────────────
      'anaya@aivorah.ai': {
        ...base, name: 'Anaya Reddy', email: 'anaya@aivorah.ai',
        role: 'student', grade: 'Grade 4', curriculum: 'IB PYP',
        avatarStyle: 'scholar',
        id: 'a1000000-0000-0000-0000-000000000001',
      },
      'meera.reddy@aivorah.ai': {
        ...base, name: 'Meera Reddy', email: 'meera.reddy@aivorah.ai',
        role: 'parent', roles: ['parent'],
        children: [{ name: 'Anaya Reddy', grade: 'Grade 4', curriculum: 'IB PYP', email: 'anaya@aivorah.ai' }],
        id: 'a2000000-0000-0000-0000-000000000002',
      },

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
      // Priya Kapoor — Grade 3 & 4 IB PYP teacher (teaches Anaya, Grade 4 demo student)
      'priya.k@test.ai': {
        ...base, name: 'Priya Kapoor', email: 'priya.k@test.ai',
        role: 'teacher', roles: ['teacher', 'parent'], activeRole: 'teacher',
        teaches: [
          { grade: 'Grade 3', curriculum: 'IB PYP' },
          { grade: 'Grade 4', curriculum: 'IB PYP' },
        ],
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
      student:     { name: 'Alex Richardson',  email: 'alex@demo.com',    role: 'student',     grade: 'Grade 3', curriculum: 'IB PYP', school: 'Hyderabad International School', location: 'Hyderabad, India', onboardingComplete: true, emailVerified: true },
      teacher:     { name: 'Ms. Zara',         email: 'teacher@demo.com', role: 'teacher',     school: 'Hyderabad International School', location: 'Hyderabad, India', onboardingComplete: true, emailVerified: true, teaches: [{ grade: 'Grade 3', curriculum: 'IB PYP' }] },
      parent:      { name: 'Priya Richardson', email: 'parent@demo.com',  role: 'parent',      location: 'Hyderabad, India', onboardingComplete: true, emailVerified: true, children: [{ name: 'Alex Richardson', grade: 'Grade 3', curriculum: 'IB PYP', email: 'alex@demo.com' }] },
      super_admin: { name: 'Sunitha Gujjula',  email: 'gujjula.sunitha@gmail.com', role: 'super_admin', school: 'The Shri Ram Academy', location: 'Hyderabad, India', onboardingComplete: true, emailVerified: true },
    };
    setUser(demos[role]);
  }

  return (
    <AuthContext.Provider value={{
      user, isAuthenticated: !!user, loading,
      authError, clearAuthError,
      login, logout, updateUser, refreshProfile, saveProfile,
      signInWithEmail, signUpWithEmail, signInWithGoogle,
      demoLogin, testLogin, switchRole, addParentRoleToTeacher, addParentRoleToTeacherSSO,
      beginAddParentProfile, cancelAddParentProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
