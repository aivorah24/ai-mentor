# AI Mentor — Product Vision & Development Guide

---

## MANDATORY: Read Before Every Session

At the start of **every conversation**, you MUST:

1. Read `C:\Users\Asus\.claude\projects\C--Users-Asus-Desktop-AI-Mentor\memory\MEMORY.md` (index)
2. Read `project_meeting_2026_03_27.md` — latest client decisions (Aivorah, demo April 10, UI feedback, features)
3. Read `project_full_requirement.md` — master product vision

**Client decisions and suggestions are the highest priority.** Never contradict or ignore them. If a code change conflicts with a client decision, flag it before proceeding.

Key facts to always remember:
- Product name: **Aivorah** (not "AI Mentor", not "Ayura")
- Demo deadline: **April 10, 2026**
- No Firebase (shutting down March 2027) — use Supabase instead
- No 5E model — learning flow is **Learn → Practice** only
- Server port: **3006** — never kill -9, increment if conflict
- Voice: family voices planned (ElevenLabs temp); no Matilda for kids

---

## Company & Context

- **Company**: Nu+Shift (Pratisha's husband's company; new EdTech company being registered)
- **Product Name**: Aivorah (formerly called AI Mentor)
- **Pilot School**: Top-tier school in Hyderabad (very large, land bank ~$6B, in hospitality, hospitals, green infra)
- **Pilot Timeline**: May–June (IB PYP Grades 3, 4, 5)
- **Survey**: 500 parents contacted → 10,000 responses; overwhelming interest from teachers too

---

## Core Problem Being Solved

1. **One-size-fits-all education fails kids** — every child learns differently; same teacher, same class, different outcomes
2. **Teachers are burned out** — 20-30 students, no time for individual attention, manual assignment correction takes huge effort
3. **Parents are stuck** — become reluctant teachers at home; can't accept their child is struggling, can't fix it either
4. **Kids lose confidence** — when they don't understand basics (e.g., carrying over in addition), they give up; fear builds over time
5. **No patient tutor** — human tutors get tired, irritated; repetition feels discouraging
6. **Practice is missing** — understanding concepts is not enough; kids need guided practice with feedback

**What we're NOT doing**: Replacing teachers. We're **augmenting teacher effort** so they can focus on training kids, not correcting papers.

---

## Product Vision

An **AI-powered adaptive learning platform** that:
- Personalises education to each student's level
- Acts as a **patient, compassionate, motivating AI tutor** (never gets irritated, always encouraging)
- Tracks progress **scientifically** and automatically nudges students
- Bridges teachers, parents, and students in one platform
- Boosts confidence — meets kids where they are, builds up from there

**Core philosophy**: _"Equality of IQ is a myth. But every kid can perform at their own 80%."_

---

## Target Users (Three Personas)

### 1. Student Persona
- Age group: 5–18 years
- Pilot: IB PYP Grades 3, 4, 5
- Screens: Dashboard, Profile, Learning Paths, AI Coach, Schedule, Assignments, Challenges, Progress, Help Center, Settings

### 2. Parent Persona
- Same dashboard/profile as student
- Can view their children's learning paths, assignments, progress (read-only for child)
- Can add assignments/challenges for their child
- If 2 kids → can switch between viewing each child's progress
- Has an "Explorer" option to learn themselves

### 3. Teacher Persona
- Completely different dashboard from student/parent
- Sees all enrolled students and their individual progress
- Can assign work (assignments, challenges) to students
- Progress view: where are students stuck, how far along in learning path
- Works in collaboration with parents (not adversarially)

---

## Curriculum Coverage

| Curriculum | Grades | Status |
|-----------|--------|--------|
| IB PYP | 3, 4, 5 | Pilot content available |
| NCERT/CBSE | 5–9 | Content ingested from textbooks |
| Cambridge | TBD | Later phase |

**Starting with Maths** — because right/wrong is clear, easy to validate AI quality.
Later: Science, English Literature.

**Content storage**: Qdrant vector DB (text chunks + image chunks with Groq Vision captions)

---

## Key Features

### Learning Paths
- Curriculum-aligned topics per grade
- Topics split into: Basic / Intermediate / Advanced
- Assigned by teacher OR self-explored
- Routes to AI Coach for free exploration topics

### AI Coach (Most Important Feature)
- LLM-powered conversational tutoring
- Personalized explanations in simple language
- Patient, encouraging, motivating — never irritated
- Prompt characteristic: _"You are a compassionate, patient, motivating tutor whose only goal is to make me successfully understand and master the concept"_
- Uses **5E Instructional Model**: Engage → Explore → Explain → Elaborate → Evaluate

### Adaptive Learning Loop
```
Student attempts question
    ↓
Wrong? → AI explains (simpler terms + real-world example)
    ↓
Retry same level
    ↓
Still wrong? → Explain even more, go ONE level lower
    ↓
Build confidence → step back up gradually
```
**Goal**: Never let a student quit feeling defeated.

### Assignments
- Given by teacher or parent
- Linked to learning path topics
- Auto-graded by AI
- Wrong answers → AI explanation → retry
- Tracked in Schedule/Calendar automatically

### Challenges
- Self-directed OR school-conducted quarterly
- Competitive exam prep (IIT, Olympiads, etc.)
- Schools can run paid/free challenges
- Only teachers/parents can enroll students (not self-enroll under 14)

### Progress
- Scientific tracking per student
- Dashboard routes to detailed progress view
- Shows: task completion, challenge rank, daily goals
- Teachers see class-wide view + individual drilldown

### Schedule
- Auto-populated from assignments + learning paths
- Time blocks auto-suggested (5-6pm: Math, 6-7pm: Science, etc.)
- Due dates tracked and surfaced

---

## Technical Architecture

### Frontend
- **React Native + Expo** (TypeScript) — web + mobile from same codebase
- Dark/light/auto theme
- Sidebar (web) + Drawer (mobile) navigation
- No emojis in UI — use SVG icons

### Backend (`/server`)
- **Express.js** on port 3006
- **Qdrant Cloud** vector DB (384-dim, MiniLM-L6-v2, collection: `ai_mentor_content`)
- **Groq API**: LLM (llama-3.1-8b-instant) + Vision (llama-4-scout-17b-16e-instruct)
- **ElevenLabs TTS**: Matilda voice (warm, nurturing) for Ms. Zara
- **HeyGen**: AI avatar videos for chapter engagement (Ms. Zara character)
- Images served statically from `/server/data/images/`

### Routes
- `POST /ask` — Student Q&A (RAG from Qdrant)
- `POST /lesson/script` — Generate 5E lesson script via Groq
- `POST /lesson/tts` — Text-to-speech via ElevenLabs
- `GET /ncert/chapters` — List 14 NCERT Maths Mela Ch3 chapters
- `GET /ncert/chapter-content?topic=` — Text + image chunks for a chapter
- `POST /ncert/quiz` — 5 MCQ questions for a chapter
- `POST /ncert/explain-wrong` — Adaptive explanation when student answers wrong
- `GET /curriculum` — IB PYP curriculum data
- `GET /student` — Student profile data
- `GET /videos` — Video library

### AI Characters
- **Ms. Zara** — warm, enthusiastic female teacher (primary character)
- 2 main characters per grade level (to be defined)
- HeyGen avatar videos per chapter (Ch1 done: "Ms. Zara's Number Hunt")

---

## Content Already Ingested

| Content | Status |
|---------|--------|
| NCERT Maths Mela Class 3 (Ch1–14) | ✅ Ingested (text + images, ~232 chunks) |
| IB PYP Grade 3 Maths | ✅ Available via /curriculum |
| IB PYP Grade 4, 5 | Partial |
| NCERT Grade 4, 5 | Pending (user to provide ZIP) |

---

## Development Rules

1. **No emojis in UI** — use SVG/Feather icons only
2. **Show content based on student's curriculum** — NCERT student → Maths Mela; IB PYP student → IB content
3. **Adaptive quiz is mandatory** — wrong answer MUST trigger AI explanation + retry, never just show score
4. **Server port**: 3006 (never kill -9, always increment if conflict)
5. **10 frontend files** have SERVER_URL — update ALL when port changes
6. **Windows platform** — use Unix shell syntax in bash, forward slashes
7. **Lady voice (Matilda, ElevenLabs)** for all TTS — confirmed by user
8. **5E Model** is the core learning flow for all content
9. **PDF images** saved to disk (`/server/data/images/`), not base64 in Qdrant
10. **expo-av removed** (crashes on web) — use HTML5 `<video>` tag with Platform.OS check

---

## What We Are NOT Building (Yet)
- Content marketplace (like Coursera)
- Board exam prep (Grade 10/12)
- Physical education / nutrition tracking (interest noted, not in scope)
- Self-enroll challenges for under-14
- Paid challenge system

---

## Sprint Priority (from meeting)
1. **Now**: Profile, Help Center, Settings, Logout (low-hanging fruit)
2. **Next**: AI Coach + Schedule
3. **Then**: Assignments + Challenges + Progress (need vector DB content)
4. **Later**: Teacher dashboard, Parent dashboard
5. **Future**: NCERT Grade 4, 5; Cambridge; paid challenges

---

## Key Stakeholder Quotes (to guide product decisions)

> "Equality is a myth. But I can't accept that my daughter doesn't understand this."

> "It's not replacing teachers. It's augmenting their effort so they can focus on training kids."

> "The best part with AI is it will not get irritated. It can cheer you up."

> "All about boosting confidence for the kids rather than quitting."

> "We are doing maths first because we know what is right, what is wrong."
