Verification is done — the issue should not be closed yet. Here's what's actually true vs. assumed:

What's real: Qdrant push does exist. When a teacher publishes an interactive quiz from a worksheet, server/routes/assignments.js (lines 1630–1703) does push it into a Qdrant collection called school_quizzes with metadata (subject, grade, curriculum, school, teacher_name, teacher_id, etc.) — so the "worksheet → knowledge base" idea from the founder call is genuinely implemented, not just planned.

What's broken:
1. Two divergent save paths write to the same Qdrant collection with inconsistent payloads. assignments.js saves the full metadata set; a second, older path in quiz.js (POST /save) saves a stripped-down version missing school, curriculum, and teacher_name entirely. Depending on which path fires, some quizzes in the library are properly tagged and others aren't.
2. The actual scoping the founder asked for doesn't exist. GET /quiz/list only filters by school_id/grade/subject if the frontend happens to send them — there's no mandatory enforcement. The frontend (TeacherAssignmentsScreen.tsx) never sends schoolId or curriculum at all, and sends a teacherId that the backend silently ignores. Net result: exactly the bug the founder described live on the call — "restrict to my school" isn't happening; the library isn't scoped by school or curriculum today.
3. Supabase's assignments table doesn't store school or teacher name — only grade/curriculum — so even the DB-side record is missing part of the metadata the founder wants.
4. No trace of issue #168 in git history — can't confirm whether that dependency was ever actually resolved.

So: infrastructure for the vision is there, but the specific ask ("don't show my worksheets to other schools") is not enforced, and it's the exact bug she hit live on today's call.

Given this and the Submit-button fix are both flagged for the same demo — which do you want me on first?---
name: QA Fix Priority Plan — Student Module
description: Ordered fix plan for all 34 bugs found in the student module QA review, grouped by sprint priority and estimated effort
type: project
---

# QA Fix Priority Plan
**Created:** 2026-03-21
**Based on:** QA Report (34 bugs, TC-001 to TC-034)

**Why:** Gives a clear execution order so fixes are done in logical priority and dependency order.
**How to apply:** Use this plan when the user asks to fix bugs. Start from Sprint 1, work down.

---

## SPRINT 1 — CRITICAL (Fix Before Any Testing on Device)

| TC | Screen | Fix | Effort |
|---|---|---|---|
| TC-001 | 4 screens | Replace `http://localhost:3001` with env var `process.env.EXPO_PUBLIC_API_URL` | Small |
| TC-002 | Progress | Add `else { setLoading(false) }` after `if (!studentId) return` | Tiny |
| TC-007 | Schedule | Fix isNow: use current hour string not date string | Tiny |
| TC-009 | LearningPaths | Replace `const GRADE = 'Grade 3'` with `user?.grade ?? 'Grade 3'` | Tiny |
| TC-008 | AI Coach | Replace hardcoded `'Grade 3'` with `user?.grade ?? 'Grade 3'` | Tiny |

---

## SPRINT 2 — HIGH (Core Feature Functionality)

| TC | Screen | Fix | Effort |
|---|---|---|---|
| TC-003 | Assignments | Wire `activeFilter` to filter UPCOMING/HISTORY before render | Small |
| TC-004 | Assignments | Add `onPress` to AssignmentCard + "View All" button | Medium |
| TC-005 | Challenges | Fix filter: add `c.status === 'completed'` for Completed tab | Tiny |
| TC-006 | Challenges | Add `onPress` to Continue button | Small |
| TC-010 | LearningPaths | Add cleanup useEffect to clear searchTimer on unmount | Tiny |
| TC-024 | Challenges | Replace `icon: 'flame'` with `icon: 'zap'` in STATS array | Tiny |

---

## SPRINT 3 — MEDIUM (UX Functionality Gaps)

| TC | Screen | Fix | Effort |
|---|---|---|---|
| TC-011 | Profile | Persist avatar + cartoon to AsyncStorage | Medium |
| TC-012 | Profile | Fix initials: add `.filter(Boolean)` after split | Tiny |
| TC-013 | Schedule | Validate endTime > startTime in addEvent | Small |
| TC-014 | Schedule | Add Alert.alert confirmation in removeEvent | Small |
| TC-015 | Settings | Add `studyGoal` useState + active chip style | Small |
| TC-016 | Settings | Persist notification toggles to AsyncStorage | Medium |
| TC-017 | Settings | Add `showConfirm` state + eye icon to confirm password field | Small |
| TC-018 | Progress | Implement monthly data fetch when periodTab === 'Month' | Medium |
| TC-019 | AI Coach | Fix Android multiline send — add send button only approach | Small |
| TC-023 | Help Center | Implement real ticket POST to backend | Medium |
| TC-022 | Help Center | Add Linking.openURL or navigation to Join Community | Small |
| TC-021 | Help Center | Add article onPress (navigate to screen or show content) | Medium |
| TC-020 | Help Center | Replace "Billing" quick link with relevant topic | Tiny |

---

## SPRINT 4 — LOW (Polish & Cleanup)

| TC | Screen | Fix | Effort |
|---|---|---|---|
| TC-025 | Challenges | Dynamic section title: `${activeTab} Challenges` | Tiny |
| TC-026 | LearningPaths | Remove `outlineStyle: 'none'` or guard with Platform.OS | Tiny |
| TC-027 | AI Coach | Replace Feather loader with ActivityIndicator | Tiny |
| TC-028 | AI Coach | Persist chat history to AsyncStorage | Medium |
| TC-029 | Settings | Update "Build 2024" to current year / pull from app.json | Tiny |
| TC-030 | Help Center | Fix FAQ #5 text to say "Overdue" filter or correct tab name | Tiny |
| TC-031 | Schedule | Extend TIMES to include early morning / evening slots | Small |
| TC-032 | Profile | Wrap Edit Profile modal in KeyboardAvoidingView | Small |
| TC-033 | Settings | Add email regex validation to recovery email | Small |
| TC-034 | Settings | Connect camera icon to image picker or navigate to Profile | Medium |

---

## QUICK WINS (< 5 min fixes)

These can be done in one pass:
- TC-002: 2 lines of code
- TC-007: 2 lines of code
- TC-005: 1 line of code
- TC-012: 1 word change (`.filter(Boolean)`)
- TC-024: 1 word change (`'flame'` → `'zap'`)
- TC-025: 2 words change (dynamic title)
- TC-026: 1 line delete
- TC-029: Update string constant
- TC-030: Edit FAQ text string

---

## DEPENDENCY NOTES

- TC-001 must be fixed before TC-002, TC-018 can be tested
- TC-009/TC-008 grade fix requires `user?.grade` to be populated — verify AuthContext stores grade
- TC-011 (avatar persistence) depends on deciding storage strategy (AsyncStorage vs Firebase)
- TC-023 (real ticket submit) requires a backend `/support/ticket` endpoint to exist first
