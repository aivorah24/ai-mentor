---
name: AI Mentor Project — Technical Architecture
description: React Native/Expo student app — architecture, stack, server details, current port, data files
type: project
---

**Last updated:** 2026-03-25

## Stack
- Frontend: React Native + Expo (TypeScript), runs on port 8081 (`npx expo start --web` from AIMentorApp/)
- Real server: `server/index.js` — runs on PORT **3006** (from server/.env), use `npm start` from server/
- Root `server.js` — old support/chat server, ignore for main app functionality

## Real Server (server/index.js) — Port 3006
Routes: /curriculum, /curriculum/subjects, /curriculum/search, /lesson/script, /lesson/tts, /schedule, /schedule/upcoming, /videos, /ask, /ingest, /health, /modules (new)
APIs: Groq (LLM), ElevenLabs (TTS, voice swapped to **Jessica** as of 2026-03-24), Qdrant (vector DB), Gemini (new service: server/services/gemini.js)
Env file: server/.env (has all real keys)

## Key Issue: Port Conflicts
Old node processes cannot be killed from Git Bash (kill -9 doesn't work on Windows PIDs).
Fix: increment port number and update all SERVER_URL in frontend files.
All 10 frontend files need SERVER_URL updated when port changes.

## Frontend SERVER_URL Files (currently pointing to localhost:3006)
- src/context/StudentDataContext.tsx
- src/screens/student/DashboardScreen.tsx
- src/screens/student/LearningPathsScreen.tsx
- src/screens/student/ProgressScreen.tsx
- src/screens/student/ScheduleScreen.tsx
- src/screens/student/VideoLessonScreen.tsx
- src/screens/student/VideoPlayerScreen.tsx
- src/screens/teacher/TeacherScheduleScreen.tsx
- src/screens/teacher/TeacherVideoLibraryScreen.tsx
- src/services/aiMentorApi.ts

## Data Files (server/data/)
- schedule.json — demo events for IB PYP
- videos.json — 5 YouTube educational videos
- students.json — student XP/progress records
- lessons/ch2_script.json through ch14_script.json — pre-generated 5E lesson scripts (new, untracked)

## Scripts (server/scripts/) — new as of 2026-03-25
- generate-ch2-images.js — image generation for Chapter 2
- generate-scene-images.js — scene image generation
- ingest-scene-images.js — ingest generated images into Qdrant
- pregenerate-audio.js — pre-generate TTS audio for lessons

## Services (server/services/)
- gemini.js — new Gemini API integration (untracked, 2026-03-25)

## Qdrant
- Collection: ai_mentor_content, Vector size: 384 (all-MiniLM-L6-v2 local model)
- IB_PYP curriculum: 36 topics, Grades 3-5
- NCERT Maths Mela Class 3: ALL 14–15 chapters fully ingested (text + image chunks, ~232+ chunks)
  - Images saved to disk: server/data/images/ncert/grade3/
  - Image path stored in payload as image_path field
  - Served via Express static: GET /data/images/ncert/grade3/<filename>

## Deployment
- Frontend: Vercel (Vercel routing updated in last commit)
- Backend: Railway (supports Express + file system)
- GitHub: https://github.com/saimohan24092003/ai-mentor

## Planned Next
- Build 5E learning flow screens (Engage→Explore→Explain→Elaborate→Evaluate)
- NCERT Grade 4 and Grade 5 Maths Mela ingestion (user to provide zip files)
- AI Storyteller module, Math Helper module
- Multi-LLM selector (Claude + Gemini alongside Groq — Gemini service now added)
- Basic gamification (XP + streaks on dashboard)
