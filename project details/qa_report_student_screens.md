---
name: QA Report — Student Module (Full)
description: Complete QA analysis of all 10 student screens — 34 bugs found across P0-P3 severity levels, test cases, root causes, and screen-by-screen breakdown
type: project
---

# QA Report — AI Mentor Student Module
**Date:** 2026-03-21
**Reviewed by:** Claude (acting as QA Engineer)
**Screens Reviewed:** Dashboard, Profile, AICoach, Assignments, LearningPaths, Challenges, Progress, Schedule, Settings, HelpCenter
**Total Issues Found:** 34 (P0: 2 · P1: 8 · P2: 14 · P3: 10)

**Why:** User requested a full QA review of the student pages, acting as a QA engineer with complex test cases.
**How to apply:** Use this as the source of truth for all known bugs. Reference TC IDs when fixing issues. Update this file as bugs are resolved.

---

## PROCESS / METHODOLOGY

Files analyzed in order:
1. `src/screens/student/DashboardScreen.tsx`
2. `src/screens/student/ProfileScreen.tsx`
3. `src/screens/student/AICoachScreen.tsx`
4. `src/screens/student/AssignmentsScreen.tsx`
5. `src/screens/student/LearningPathsScreen.tsx`
6. `src/screens/student/ChallengesScreen.tsx`
7. `src/screens/student/ProgressScreen.tsx`
8. `src/screens/student/ScheduleScreen.tsx`
9. `src/screens/student/SettingsScreen.tsx`
10. `src/screens/student/HelpCenterScreen.tsx`

Supporting files also reviewed:
- `src/context/AuthContext.tsx`
- `src/context/StudentDataContext.tsx`
- `src/context/ThemeContext.tsx`
- `src/services/aiMentorApi.ts`
- `src/navigation/AppNavigator.tsx`

---

## P0 — APP BREAKING / PRODUCTION BLOCKERS

### TC-001 | Hardcoded `localhost:3001` Server URLs
**Screens:** LearningPathsScreen.tsx:14, ProgressScreen.tsx:20, ScheduleScreen.tsx:20, DashboardScreen.tsx
**Code pattern:** `const SERVER_URL = 'http://localhost:3001';`
**Impact:** LearningPaths, Schedule, Progress screens completely non-functional on real devices
**Fix needed:** Replace with env variable (e.g., `process.env.EXPO_PUBLIC_API_URL` or a config file)
**Status:** OPEN

### TC-002 | Progress Screen — Infinite Spinner When `studentId` is Null
**Screen:** ProgressScreen.tsx:92-102
**Code:**
```ts
useEffect(() => {
  if (!studentId) return; // setLoading(false) never called
  Promise.all([...]).then(() => setLoading(false));
}, [studentId]);
```
**Fix needed:** Add `else { setLoading(false); }` after the early return
**Status:** OPEN

---

## P1 — FEATURE COMPLETELY BROKEN

### TC-003 | Assignments — Filter Tabs Have No Effect
**Screen:** AssignmentsScreen.tsx:141-211
**Root cause:** `activeFilter` state is set but never applied. Both `UPCOMING` and `HISTORY` arrays render unconditionally.
**Fix needed:** Add filter logic before rendering, e.g.:
```ts
const filteredUpcoming = UPCOMING.filter(item => activeFilter === 'All Tasks' || item.statusStyle === filterMap[activeFilter]);
```
**Status:** OPEN

### TC-004 | Assignments — All Action Buttons Non-Functional
**Screen:** AssignmentsScreen.tsx:131-136
**Root cause:** `AssignmentCard` component renders `TouchableOpacity` for action button but no `onPress` prop is wired up. "View All →" also has no handler.
**Fix needed:** Add `onPress` prop to `AssignmentCard`, pass navigation handler from parent
**Status:** OPEN

### TC-005 | Challenges — "Completed" Tab Always Shows Empty State
**Screen:** ChallengesScreen.tsx:85-88
**Code:**
```ts
const filtered = CHALLENGES.filter((c) =>
  activeTab === 'Active' ? c.status === 'active' :
  activeTab === 'New' ? c.status === 'new' : false  // Completed always false
);
```
**Fix needed:** Add `c.status === 'completed'` for Completed tab
**Status:** OPEN

### TC-006 | Challenges — "Continue" Button Has No Action
**Screen:** ChallengesScreen.tsx:164
**Root cause:** `<TouchableOpacity style={styles.continueBtn} activeOpacity={0.8}>` — no `onPress`
**Status:** OPEN

### TC-007 | Schedule — "isNow" Time Highlight Logic Broken
**Screen:** ScheduleScreen.tsx:213
**Code (broken):**
```ts
const isNow = t === todayISO.slice(0, 5) && selectedDate === todayISO;
// todayISO = "2024-01-15" → .slice(0,5) = "2024-" ← never matches "08:00"
```
**Fix needed:**
```ts
const currentHour = `${String(new Date().getHours()).padStart(2, '0')}:00`;
const isNow = t === currentHour && selectedDate === todayISO;
```
**Status:** OPEN

### TC-008 | AI Coach — Grade Hardcoded to "Grade 3"
**Screen:** AICoachScreen.tsx:74
**Code:** `askAIMentor(msgText, 'Grade 3', undefined, 'IB_PYP')`
**Fix needed:** Use `user?.grade ?? 'Grade 3'` from AuthContext
**Status:** OPEN

### TC-009 | Learning Paths — Grade Hardcoded to "Grade 3"
**Screen:** LearningPathsScreen.tsx:15
**Code:** `const GRADE = 'Grade 3';`
**Fix needed:** Derive from `useStudentData()` or `useAuth()` context
**Status:** OPEN

### TC-010 | Learning Paths — Search Timer Memory Leak
**Screen:** LearningPathsScreen.tsx:254-270
**Root cause:** `searchTimer.current` setTimeout never cleared on component unmount
**Fix needed:**
```ts
useEffect(() => {
  return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
}, []);
```
**Status:** OPEN

---

## P2 — FUNCTIONAL DEFECTS

### TC-011 | Profile — Avatar & Cartoon Not Persisted
**Screen:** ProfileScreen.tsx:47-52
**Root cause:** `selectedAvatar`, `savedAvatar`, `cartoon`, `customCartoon` all in local `useState`. Reset on navigation.
**Fix needed:** Persist to AsyncStorage or Firebase user document
**Status:** OPEN

### TC-012 | Profile — Initials Crash on Double-Space Names
**Screen:** ProfileScreen.tsx:102
**Code:** `(user?.name || 'U').split(' ').map((w) => w[0]).join('').slice(0,2).toUpperCase()`
**Bug:** Double space → empty string in split → `w[0]` on `''` = `undefined`
**Fix needed:** `split(' ').filter(Boolean).map((w) => w[0])`
**Status:** OPEN

### TC-013 | Schedule — No End-Before-Start Validation
**Screen:** ScheduleScreen.tsx:130-155 (addEvent function)
**Fix needed:** Compare `newTime` and `newEndTime` before calling API
**Status:** OPEN

### TC-014 | Schedule — Delete Event Without Confirmation
**Screen:** ScheduleScreen.tsx:157-162 (removeEvent)
**Fix needed:** Wrap `removeEvent` in `Alert.alert('Delete Event', ..., [{ onPress: () => removeEvent(id) }])`
**Status:** OPEN

### TC-015 | Settings — Daily Study Goal Has No State
**Screen:** SettingsScreen.tsx:362-368
**Root cause:** Goal chips render with no `useState` tracking selection. All look identical, no active highlight.
**Fix needed:** Add `const [studyGoal, setStudyGoal] = useState(60)` and apply active style
**Status:** OPEN

### TC-016 | Settings — Notification Toggles Not Persisted
**Screen:** SettingsScreen.tsx:41-45
**Root cause:** All 5 notification toggles are pure local state
**Fix needed:** Persist to AsyncStorage / Firebase user preferences
**Status:** OPEN

### TC-017 | Settings — Confirm Password Field Missing Eye Toggle
**Screen:** SettingsScreen.tsx:489-499
**Root cause:** `showCurrent` and `showNew` states exist, but confirm field hardcodes `secureTextEntry` with no toggle
**Fix needed:** Add `showConfirm` state + `TouchableOpacity` eye icon to confirm field
**Status:** OPEN

### TC-018 | Progress — Month Tab Shows Same Weekly Data
**Screen:** ProgressScreen.tsx:234-241
**Root cause:** `periodTab` state toggled but never used in data fetch or render logic
**Fix needed:** Conditionally fetch monthly data when `periodTab === 'Month'`
**Status:** OPEN

### TC-019 | AI Coach — Android: Enter Key Sends Newline Instead of Message
**Screen:** AICoachScreen.tsx:190-200
**Root cause:** React Native known issue — `multiline={true}` + `returnKeyType="send"` → `onSubmitEditing` doesn't fire on Android
**Fix needed:** Separate send trigger; add explicit "Send" action or use single-line mode
**Status:** OPEN

### TC-020 | Help Center — "Billing" Quick Link Returns Zero Results
**Screen:** HelpCenterScreen.tsx:283-295
**Root cause:** Sets search to "Billing" but no TOPICS or FAQS contain the word "Billing"
**Fix needed:** Either add billing content or replace with a relevant quick link
**Status:** OPEN

### TC-021 | Help Center — Article Rows Are Dead Taps
**Screen:** HelpCenterScreen.tsx:418-423
**Root cause:** `TouchableOpacity` with no `onPress` on each article row inside topic modal
**Fix needed:** Either link to article content or navigate to relevant screen
**Status:** OPEN

### TC-022 | Help Center — "Join Community" Has No Action
**Screen:** HelpCenterScreen.tsx:391-393
**Root cause:** `TouchableOpacity` with no `onPress`
**Fix needed:** Add `Linking.openURL('https://community.url')` or navigate to community screen
**Status:** OPEN

### TC-023 | Help Center — Ticket Submit is Simulated (Fake)
**Screen:** HelpCenterScreen.tsx:216-232
**Root cause:** `setTimeout(..., 1200)` simulates success. No real API call.
**Fix needed:** POST to backend `/support/ticket` endpoint
**Status:** OPEN

### TC-024 | Challenges — "flame" Is Not a Valid Feather Icon
**Screen:** ChallengesScreen.tsx:36
**Code:** `{ label: 'Current Streak', icon: 'flame', color: colors.accentRed }`
**Root cause:** Feather icon set does not include "flame". Renders blank.
**Fix needed:** Use `'zap'` or `'activity'` as replacement
**Status:** OPEN

---

## P3 — UX ISSUES

### TC-025 | Challenges — Section Title Doesn't Match Active Tab
**Screen:** ChallengesScreen.tsx:119
**Issue:** Always shows "Active Challenges" even when "New" or "Completed" tab is selected
**Fix needed:** Dynamic title: `${activeTab} Challenges`

### TC-026 | Learning Paths — `outlineStyle: 'none'` Web-Only CSS
**Screen:** LearningPathsScreen.tsx:457
**Code:** `outlineStyle: 'none'` in StyleSheet
**Fix needed:** Remove or guard with `Platform.OS === 'web'`

### TC-027 | AI Coach — Loader Icon Doesn't Animate
**Screen:** AICoachScreen.tsx:209
**Code:** `<Feather name={isTyping ? 'loader' : 'send'} />`
**Fix needed:** Replace with `<ActivityIndicator size="small" color="white" />`

### TC-028 | AI Coach — Chat History Lost on Navigation
**Screen:** AICoachScreen.tsx:57
**Issue:** `useState<Message[]>(INITIAL_MESSAGES)` — local only, lost on unmount

### TC-029 | Settings — "Build 2024" Stale Version Text
**Screen:** SettingsScreen.tsx:403
**Code:** `AI Mentor v1.0.0 · Build 2024`
**Fix needed:** Update to current year or pull from `app.json`

### TC-030 | Help Center — FAQ References Non-Existent "Overdue" Tab
**Screen:** HelpCenterScreen.tsx (FAQS array, FAQ #5)
**Issue:** Says "Overdue assignments move to the 'Overdue' tab" — no such tab exists in AssignmentsScreen (tabs: All Tasks, Pending, In Progress, Completed, Quizzes)

### TC-031 | Schedule — Events Outside 08:00–17:00 Invisible
**Screen:** ScheduleScreen.tsx:22
**Code:** `const TIMES = ['08:00', ..., '17:00'];` — 10 fixed slots only
**Fix needed:** Extend TIMES array or add dynamic hour range

### TC-032 | Profile — Edit Modal Lacks Keyboard Avoidance
**Screen:** ProfileScreen.tsx:277-334
**Issue:** Modal has TextInputs but no `KeyboardAvoidingView` wrapper

### TC-033 | Settings — Recovery Email Not Format-Validated
**Screen:** SettingsScreen.tsx:143-147
**Fix needed:** Add regex email validation: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`

### TC-034 | Settings — Camera Icon on Avatar Is Non-Interactive
**Screen:** SettingsScreen.tsx:205-207
**Issue:** Camera overlay implies photo upload but nothing is tappable or actionable

---

## BUG SUMMARY TABLE

| ID | Screen | Severity | Status |
|---|---|---|---|
| TC-001 | API Screens | P0 | OPEN |
| TC-002 | Progress | P0 | OPEN |
| TC-003 | Assignments | P1 | OPEN |
| TC-004 | Assignments | P1 | OPEN |
| TC-005 | Challenges | P1 | OPEN |
| TC-006 | Challenges | P1 | OPEN |
| TC-007 | Schedule | P1 | OPEN |
| TC-008 | AI Coach | P1 | OPEN |
| TC-009 | Learning Paths | P1 | OPEN |
| TC-010 | Learning Paths | P1 | OPEN |
| TC-011 | Profile | P2 | OPEN |
| TC-012 | Profile | P2 | OPEN |
| TC-013 | Schedule | P2 | OPEN |
| TC-014 | Schedule | P2 | OPEN |
| TC-015 | Settings | P2 | OPEN |
| TC-016 | Settings | P2 | OPEN |
| TC-017 | Settings | P2 | OPEN |
| TC-018 | Progress | P2 | OPEN |
| TC-019 | AI Coach | P2 | OPEN |
| TC-020 | Help Center | P2 | OPEN |
| TC-021 | Help Center | P2 | OPEN |
| TC-022 | Help Center | P2 | OPEN |
| TC-023 | Help Center | P2 | OPEN |
| TC-024 | Challenges | P2 | OPEN |
| TC-025 | Challenges | P3 | OPEN |
| TC-026 | Learning Paths | P3 | OPEN |
| TC-027 | AI Coach | P3 | OPEN |
| TC-028 | AI Coach | P3 | OPEN |
| TC-029 | Settings | P3 | OPEN |
| TC-030 | Help Center | P3 | OPEN |
| TC-031 | Schedule | P3 | OPEN |
| TC-032 | Profile | P3 | OPEN |
| TC-033 | Settings | P3 | OPEN |
| TC-034 | Settings | P3 | OPEN |
