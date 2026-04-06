---
name: Client Meeting 2026-03-27 — Key Decisions & Feedback
description: Product decisions from Reddy E + Sai Mohan call on 2026-03-27: mascot, voices, demo date, UI feedback, features
type: project
---

**Meeting date:** 2026-03-27 (call between Reddy E / Pratisha and Sai Mohan)
**Recorded:** 2026-03-28

---

## 1. Product & Mascot Name: "Aivorah" (NEW — HIGH PRIORITY)

**Product name: Aivorah** (confirmed spelling 2026-03-28)
Character/mascot name: **Aivorah** (means light; AI = AI light)
- Company is working with a design firm for copyright + mascot design (in parallel with dev)
- Three age-tier mascots:
  - Age 5–8: small Aivorah
  - Age 9–12: medium Aivorah
  - 13–18: adult/teen Aivorah
- Users can change **colors and dresses** of Aivorah (same character, customizable)
- Goal: our own copyrighted mascot like Elsa — no copyright issues

**Why:** Client wants brand identity distinct from generic AI characters (Ms. Zara etc.)
**How to apply:** Product and mascot are both called Aivorah. Ms. Zara is existing built content; Aivorah is the future brand direction.

---

## 2. Voice Characters — Family Voices Plan

Client wants to record actual family voices for TTS characters:
- Age 5–8 tier: **younger daughter's voice**
- Age 9–12 tier: **elder daughter's voice**
- Adult tier: **Pratisha's (client's) own voice**

Plan: beta test with close friends → if average feedback is normal, add other cartoon voices as alternatives.

**Why:** Personal touch, zero copyright issues, more authentic for Indian kids
**How to apply:** Current ElevenLabs voices are temp. When voice recording assets arrive, integrate per age tier.

---

## 3. Demo Deadline: April 10, 2026

Target: working demo ready for school pilot by **April 10, 2026** (second week of April).
Scope: NCERT Grade 3 maths + science + IB PYP Grade 3 (2 chapters) fully functional.

---

## 4. Image Generation — Current Approach

- Sai using **Hugging Face** free models (some images already generated)
- Client suggestion: also try **Mistral picture** and other HF models
- For better quality (especially science): eventually buy **Gemini API**
- For now: use free options, don't force paid
- Current learning format: **scene-based** (image + audio script, plays continuously, skippable)

Experiment planned: generate **one video** + **one scene** version of same chapter → give to kids → get feedback on preference.

---

## 5. UI Feedback from Client

### Schedule screen
- **Change**: use **start time + duration** (e.g., 1 hour, 1.5 hours) NOT start time + end time
- Reason: fewer validations needed on backend; simpler UX

### Challenges screen
- **Change**: display challenges as **small tiles (side by side / grid)**, not a list
- Reason: better use of screen real estate, more visually appealing

### Dashboard activity section
- **Change**: make activity section **more compact / less scattered**
- Reason: currently looks messy, wastes space

### Dark mode
- **Change**: replace purple accent color with something that looks better on black background
- Reason: purple on dark looks off; find a color that suits the dark theme

---

## 6. Assignment Feature — PDF Auto-Convert

Client wants:
- Teacher uploads PDF or image → system **auto-splits into questions**
- Student attempts each question individually
- On submit: **immediate AI feedback** (right/wrong + explanation if wrong), same as practice quiz flow
- Client will send sample worksheet from daughter to test with

**Why:** Matches real school workflow; teachers already have printed worksheets

---

## 7. Leaderboard / Challenges — Motivational Ranking

Student-facing leaderboard should NOT show exact position:
- Show: **"You are in the top 3"** or **"You are in the top 5"** (percentile buckets)
- Add: **tips and tricks** on which concepts to focus on to improve
- Show: which concepts the student is struggling with (visible to student AND parent)
- Do NOT show: who is first, who is last (demotivating)

**Why:** Keep competition motivating, not demoralizing; psychological safety for kids

---

## 8. In-App Messaging (NEW FEATURE)

Add messaging feature **within the portal** (not WhatsApp/external):
- Between **teachers and parents** (primary use case)
- Secondary: teacher → student
- Use case: parent asks "my child is struggling because..."
- Build on top of the existing 3-dashboard connection

**⚠️ FIREBASE CONFLICT:** Client mentioned "we are using Firebase" for this — but Firebase is being shut down March 2027 (confirmed in feedback_no_firebase.md). Do NOT use Firebase. Use Supabase Realtime or Socket.io instead.

---

## 9. Student/Parent Progress Insights

Show students and parents:
- Which concepts they are struggling with
- Where they need attention (same data shown to teacher, surfaced to student/parent age-appropriately)
- For under-13: framed carefully (not discouraging)
- For 13+: more direct/adult framing

---

## 10. Mobile Publishing (Future)

- Client thinking about iOS/Android publishing (React Native already supports this)
- Leaning toward: parents + teachers get mobile app first (students use web/tablet)
- Not immediate — after April demo
