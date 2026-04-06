---
name: Full Product Requirement — AI Mentor (as of 2026-03-23)
description: Consolidated requirement from client research, stakeholder meetings, and feedback — what we must build to win the offer letter
type: project
---

**Last updated:** 2026-03-23
**Stakes:** Offer letter from client (Prethyushaa / Reddy E) depends on performance this week.
**Pilot:** Top-tier school in Hyderabad, IB PYP Grades 3, 4, 5. May–June pilot window.

---

## What We Are Building
An AI-powered adaptive learning web app for kids aged 6–14. Not replacing teachers — augmenting them. Three users: Student, Parent, Teacher.

---

## 1. Core Philosophy
- Every child learns differently — personalize to their level
- AI tutor that never gets irritated, always encouraging
- Build confidence first — meet kids where they are, step up gradually
- 5E Instructional Model: Engage → Explore → Explain → Elaborate → Evaluate
- Start with Maths (right/wrong is clear, easy to validate AI quality)

---

## 2. How Content Is Delivered — The 6 Modules (Point 5 from client research)
This is the KEY requirement the client shared. Content must be delivered through specific micro-tools:

| Module | Description | Status |
|--------|-------------|--------|
| **Quiz Generator** | Topic → fun MCQ quiz, adaptive wrong-answer explanation | Partial (NCERT quiz built) |
| **AI Storyteller** | Interactive branching stories — kid makes choices, AI continues | Not built |
| **Drawing Buddy** | Kid picks theme → AI gives drawing prompt + description | Not built |
| **Word Wizard** | Vocabulary builder + spelling help, age-appropriate | Not built |
| **Math Helper** | Step-by-step math solver, shows working not just answer | Not built |
| **Code Coach** | Basic coding logic (Scratch level) + gamified levels | Not built |

---

## 3. Multi-LLM Switching
Client wants kids to be able to use different AI models:
- OpenAI GPT-4
- Anthropic Claude
- Google Gemini
- LLaMA 3 (open model, via Groq — already integrated)

**Current state:** Only Groq (LLaMA). Need to add GPT-4, Claude, Gemini with a model selector UI.

---

## 4. Voice — HIGH PRIORITY (client flagged as urgent)
- Current voice (Matilda/ElevenLabs): "very dull", lacks energy
- Client wants: cartoon-character energy (like Doraemon, Elsa style)
- Cannot use licensed voices
- **Approved free ElevenLabs voices:** Emma, Milly Maple, Lutz, Michael Mouse
- Must feel high-energy, fun, encouraging for kids under Grade 4
- **Action:** Swap Matilda → one of the approved voices in server/routes/lesson.js

---

## 5. Gamification
- XP system with streaks
- Customizable avatars per child
- Leaderboards (age-filtered)
- Virtual coins / rewards for task completion
- Badges

---

## 6. Safety & Compliance
- COPPA + GDPR-K compliant
- No open-ended internet access from AI
- Pre-validated prompt templates per module
- Profanity/inappropriate content filter (Perspective API or basic word list)
- Parent monitoring logs — can review child's chat history
- Kids under 14 cannot self-enroll in challenges

---

## 7. User Roles
### Student (Age 6–14)
- Dashboard, Learning Paths, AI Coach, Schedule, Assignments, Challenges, Progress
- Sees content based on curriculum (NCERT → Maths Mela; IB PYP → IB content)

### Parent
- Read-only view of child's progress
- Can add assignments/challenges for their child
- Switch between multiple children
- "Explorer" mode to learn themselves

### Teacher
- Completely separate dashboard
- Sees all enrolled students + individual progress
- Assigns work to students
- Class-wide progress view + individual drilldown

---

## 8. UI Pages Required
1. Home — Choose learning path (Stories, Quizzes, AI Buddy, Modules)
2. Chat — Ask AI, select model (GPT-4 / Claude / Gemini / Groq)
3. Module Pages — Quiz, Storyteller, Drawing Buddy, Word Wizard, Math Helper, Code Coach
4. Parent Dashboard — Activity logs, restrictions, progress view
5. Teacher Dashboard — Student overview, assign work
6. Login/Register — Email+Password, Parent/Child roles

---

## 9. Tech Stack (Confirmed)
- **Frontend:** React Native + Expo (TypeScript) — web + mobile from same codebase (existing)
- **Backend:** Node.js + Express on port 3001 (existing, server/index.js)
- **Vector DB:** Qdrant Cloud — collection: ai_mentor_content, 384-dim MiniLM
- **LLMs:** Groq (current) + GPT-4 + Claude + Gemini (to add)
- **TTS:** ElevenLabs — swap Matilda → high-energy cartoon voice
- **Auth:** Firebase (already integrated in frontend)
- **Animations:** Framer Motion (to add for kid-friendly UI)

---

## 10. Content Already Ingested
- NCERT Maths Mela Class 3 (all 15 chapters, text + image chunks, ~232 chunks)
- IB PYP Grade 3, 4, 5 Maths (partial)
- NCERT Grade 4, 5 — pending (user to provide ZIP)

---

## 11. Deployment Plan
- Frontend: Vercel (images too large — need CDN or Railway)
- Backend: Railway (supports Express + file system, no 100MB limit)
- Images: 149MB in server/data/images — need Cloudinary or Railway
- GitHub: https://github.com/saimohan24092003/ai-mentor (pushed 2026-03-23)

---

## 12. This Week's Priority (Offer Letter at Stake)
1. **Swap TTS voice** to high-energy ElevenLabs cartoon voice (quick win, client noticed this)
2. **AI Storyteller module** — most visually impressive for demo
3. **Math Helper module** — step-by-step solver (client's primary subject)
4. **Multi-LLM selector** — at minimum add Claude + Gemini alongside Groq
5. **Basic gamification** — XP + streaks on dashboard
6. **Deploy live** — Railway for backend + Vercel for frontend (need to solve image hosting)
