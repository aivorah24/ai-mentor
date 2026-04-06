---
name: QA Screen-by-Screen Analysis
description: Per-screen deep dive of all 10 student screens — architecture observations, data flow, what's real vs mock, hardcoded values, and interaction gaps
type: project
---

# Screen-by-Screen QA Analysis
**Date:** 2026-03-21
**Why:** Detailed per-screen analysis to support bug fixing and future development reference.

---

## 1. DashboardScreen.tsx
- Imports `react-native-svg` (Svg, Path, Circle, Ellipse, G) — heavy dependency
- Uses `SERVER_URL = 'http://localhost:3001'` — production blocker (TC-001)
- Custom SVG icons: FlameIcon, ShieldStarIcon, RocketDecoration
- Subject colors only cover: Mathematics, Science, Social Studies (no English, Arts, PE, ICT)
- `getGreeting()` — time-based greeting, correctly implemented
- Pulls from `useStudentData()` and `useAuth()` contexts

## 2. ProfileScreen.tsx
- Avatar data: 6 icon-based avatars, no photo uploads (intentional design)
- Cartoon options: Naruto, Doraemon, Shinchan, Spider-Man, Iron Man, Custom...
- **State issues:** `selectedAvatar`, `savedAvatar`, `cartoon`, `customCartoon`, `showCustomInput` all local only → lost on unmount (TC-011)
- **Initials bug:** `.split(' ').map((w) => w[0])` crashes on empty strings from double spaces (TC-012)
- `handleSaveAvatar()` — fires Alert even when selectedAvatar === savedAvatar (minor UX)
- Edit Profile modal: updates name, grade, location via `updateUser()` — NO email field (intentional, email managed in Settings)
- No `KeyboardAvoidingView` in modal (TC-032)
- Activity Overview pulls from `useStudentData()` stats — real data
- `useMemo(() => makeStyles(colors), [colors])` pattern used correctly throughout

## 3. AICoachScreen.tsx
- Uses `askAIMentor()` from `services/aiMentorApi.ts` — real API call to Groq LLaMA 3
- Grade hardcoded: `askAIMentor(msgText, 'Grade 3', ...)` (TC-008)
- Curriculum: hardcoded `'IB_PYP'`
- `INITIAL_MESSAGES` defined INSIDE component — recreated each render (not causing bugs but inefficient)
- Message IDs: `Date.now()` and `Date.now() + 1` — ID collision risk on fast machines
- `isTyping` blocks input correctly, but loader icon is static (TC-027)
- `scrollRef.current?.scrollToEnd()` called twice with 80ms and 100ms delays — race condition potential
- Suggestions shown only when `messages.length === 1` — works correctly after Clear Chat
- Android multiline + onSubmitEditing issue (TC-019)
- Chat history not persisted (TC-028)
- `exploreTopic()` called on successful AI response — correctly tracks real topic exploration

## 4. AssignmentsScreen.tsx
- **100% static mock data** — no API calls at all
- `UPCOMING` array: 3 items — Quadratic Equations Quiz (overdue), Physics Lab Report (pending), Essay Draft (in progress)
- `HISTORY` array: 2 items — WW2 quiz (92%), Python functions (100%)
- Due dates are hardcoded strings: "Due Yesterday", "May 18, 2025" — stale relative to today
- `activeFilter` state exists but is NEVER applied to filter rendered data (TC-003)
- `AssignmentCard` action button has no `onPress` (TC-004)
- "View All →" has no `onPress` (TC-004)
- Stats card shows hardcoded: 5 Pending, 12 Completed, 1 Overdue — doesn't match mock data count
- Progress bar uses `width: \`\${item.progress}%\` as any` — TypeScript workaround, works on native
- `ghost` prop applies `opacity: 0.85` to history items — visual distinction

## 5. LearningPathsScreen.tsx
- **Real API calls** to `/curriculum/subjects` and `/curriculum/search`
- Grade hardcoded: `const GRADE = 'Grade 3'` (TC-009)
- Search: debounced 450ms via `setTimeout`, cleanup missing (TC-010)
- Subject metadata: 7 subjects with emoji icons, colors, Feather icons
- Completion tracking via `completedSet = new Set(stats.completedTopics)` — real data from context
- `SubjectCard`: shows completion ring percentage — real calculation
- `TopicCard`: Animated.sequence press animation — minor issue: `.start(onPress)` passes `{finished}` object to `onPress`
- Error state: no retry button (TC-001 side effect)
- Loading state: proper ActivityIndicator shown
- `outlineStyle: 'none'` web-only CSS (TC-026)
- Navigate to `'VideoLesson'` with `{ topic, grade }` params

## 6. ChallengesScreen.tsx
- **100% static mock data** — no API calls
- Stats hardcoded: 2,450 XP, 12 done, 3 active, 14 days streak
- 4 challenge items: Algebra Master Week (75%), Science Sprint (35%), Vocabulary Builder (90%), History Deep Dive (15%)
- `status` values: 3× `'active'`, 1× `'new'` — no `'completed'` items exist
- Tab filter broken for Completed (TC-005)
- "Continue" button no `onPress` (TC-006)
- `'flame'` icon invalid in Feather (TC-024)
- Section title static "Active Challenges" (TC-025)
- Avatar stack: 2 colored dots overlapping — decorative only, not real user avatars
- Stats `icon: 'flame'` — invalid Feather icon causes blank render

## 7. ProgressScreen.tsx
- **Real API calls** to `/student/${studentId}/weekly` and `/curriculum?curriculum=IB_PYP`
- `studentId` null check missing in loading gate (TC-002)
- Month tab: purely cosmetic, no different data fetch (TC-018)
- `RingProgress`: SVG ring component, properly uses stroke-dashoffset for percentage
- Subject performance: calculated from curriculum data × completedSet — real
- Achievements: 8 items, unlocked based on real `stats` values
- XP progress bar: `xpForNextLevel(stats.xpPoints)` — real function from context
- `weeklyDays.every(d => d.studyMinutes === 0)` — vacuous truth on empty array shows empty state (acceptable)
- Completed topics list: shows first 6 with "+N more" overflow
- `SUBJECT_CONFIG` only covers 3 subjects: Mathematics, Science, Social Studies — missing English, Arts, PE, ICT

## 8. ScheduleScreen.tsx
- **Real API calls** to `/schedule`, `/schedule/upcoming`, `/schedule/month`
- `isNow` logic broken — compares time slots against date string (TC-007)
- `fetchEvents` triggers on `selectedDate`, `calYear`, `calMonth` changes — potentially many re-fetches
- `addEvent` POST to server — real functionality
- `removeEvent` DELETE — real, no confirmation (TC-014)
- No end-before-start time validation (TC-013)
- Empty catch blocks `catch {}` — errors silently swallowed
- Month calendar built by `buildMonthCalendar()` — correctly handles leap years, day offsets
- Week selector: prev/next navigation works correctly
- Timeline: 08:00–17:00 only, 10 fixed slots (TC-031)
- Multi-hour events not visualized — only shows at start time slot
- Modal lacks keyboard avoidance (TC-032 pattern)
- `createdBy === 'teacher'` shows purple "👩‍🏫 Teacher" badge — teacher-assigned events visible

## 9. SettingsScreen.tsx
- **Firebase integration** for email change, password change, account deletion
- Notification toggles: 5 toggles, all local state (TC-016)
- Study goal chips: no state (TC-015)
- Language: 3 options, changes state but no i18n effect
- Theme: properly connected to `ThemeContext.setThemeMode` — actually works
- Camera icon on avatar: decorative, no action (TC-034)
- Recovery email: saves locally only with no email format validation (TC-033)
- Confirm password no eye toggle (TC-017)
- `handleDeleteAccount`: Firebase deleteUser, but demo mode skips re-auth (security concern)
- `updateUser()` from AuthContext updates local state
- Version text stale: "Build 2024" (TC-029)
- `AppModal`, `FieldRow`, `SectionHeader`, `ModalButtons` — well-extracted sub-components
- All modals use `animationType="fade"` with `onRequestClose` — good Android back button handling

## 10. HelpCenterScreen.tsx
- **Ticket submission is fake** — `setTimeout` simulation (TC-023)
- 10 FAQs hardcoded — static content
- 8 topic cards — navigate to relevant screen via `handleGoToScreen()`
- Search filters both topics and FAQs simultaneously
- `filteredTopics` `useMemo` includes `colors` in deps — unnecessary re-computation (TC-020 related)
- "Billing" quick link dead end (TC-020)
- Article rows in topic modal: non-interactive (TC-021)
- "Join Community" button: no action (TC-022)
- FAQ #5 references non-existent "Overdue" filter tab (TC-030)
- FAQ #3 says "Tap any event to delete it" — actually must tap the X button specifically
- `Linking` imported but never used
- `search` state drives `filteredTopics` and `filteredFaqs` — correctly reactive

---

## DATA REALITY MAP

| Screen | Data Source | Real/Mock |
|---|---|---|
| Dashboard | `useStudentData()` + server | Mixed |
| Profile | `useAuth()` + local state | Mixed (avatar mock) |
| AI Coach | Groq LLaMA 3 API | Real AI, grade mock |
| Assignments | Hardcoded arrays | 100% Mock |
| Learning Paths | `localhost:3001/curriculum` | Real (broken on device) |
| Challenges | Hardcoded arrays | 100% Mock |
| Progress | `localhost:3001` + context | Real (broken on device) |
| Schedule | `localhost:3001/schedule` | Real (broken on device) |
| Settings | Firebase Auth | Real |
| Help Center | Static + fake submit | Mostly static |

---

## SHARED PATTERNS OBSERVED

**Good patterns:**
- `useMemo(() => makeStyles(colors), [colors])` — all screens do this correctly
- `useTheme()` for theming — consistent
- `ScreenLayout` wrapper — consistent
- `Header` component reuse — consistent
- `activeOpacity` on all TouchableOpacity — consistent

**Bad patterns (repeated across screens):**
- `SERVER_URL = 'http://localhost:3001'` in 4+ files
- Grade `'Grade 3'` hardcoded in 2 files
- `any` type casts: `item.icon as any`, `styles.progressFill { width: ... as any }`
- Empty catch blocks: `catch {}`
- No `onPress` on interactive elements
