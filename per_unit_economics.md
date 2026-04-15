# Aivorah — Per-Unit Economics
**Prepared:** April 2026 | **For:** School Subscription Pricing & Investor Deck

---

## 1. Technology Stack (Services Used)

| Layer | Service | Purpose |
|-------|---------|---------|
| Auth | Firebase Authentication | Login, email verification, session management |
| Database | Supabase (PostgreSQL) | Users, assignments, progress, messages, schedule |
| Vector DB | Qdrant Cloud | Curriculum content, RAG for AI Coach |
| AI / LLM | Groq API (Llama 3.1-8B) | AI Coach Q&A, quiz generation, grading |
| AI / Vision | Groq API (Llama 4 Scout) | Image understanding from textbook scans |
| TTS | ElevenLabs | Ms. Zara voice for lesson narration |
| Storage | GCP Cloud Storage / Cloudinary | Images, PDFs, uploaded files |
| Hosting | GCP Cloud Run | Backend API server (auto-scaling) |
| Frontend | Expo (web + mobile) | No hosting cost — static web build |

---

## 2. Usage Assumptions Per Active Student / Month

> Assuming **30 active days/month**, **20 min/day** average usage.

| Activity | Frequency | Volume |
|---------|-----------|--------|
| AI Coach questions | 5 per day | 150 questions/month |
| Quiz generation | 1 per day | 30 quizzes/month |
| AI grading (answers) | 5 per day | 150 gradings/month |
| TTS lesson narration | 1 lesson/day | 30 lessons/month (~400 chars each) |
| DB reads/writes | ~50 ops/day | 1,500 ops/month |
| File storage per student | Profile + uploads | ~5 MB |

---

## 3. Cost Per Student Per Month (at Different Scales)

### 3A. AI / LLM Cost — Groq API

| Model | Rate | Per-Student Usage | Monthly Cost |
|-------|------|------------------|-------------|
| Llama 3.1-8B (AI Coach + Quiz + Grading) | $0.05/M input, $0.08/M output | ~300K input + 60K output tokens | **~$0.020** |
| Llama 4 Scout Vision (image queries) | $0.11/M input, $0.34/M output | ~20K input + 5K output (occasional) | **~$0.004** |

> **Total Groq per student/month: ~$0.024** *(₹2.00)*

---

### 3B. Text-to-Speech — ElevenLabs

**How it works:** Ms. Zara voice audio is **pre-recorded once** and saved to the server. Every student plays the same downloaded audio file — no new voice is generated per student. It's like a pre-recorded video: made once, used by thousands.

#### Content Volume (IB PYP Grades 3, 4, 5 — Maths)

| Grade | Topics | Cards/Topic | Chars/Card | Total Chars |
|-------|--------|-------------|------------|-------------|
| Grade 3 | ~25 | 6 | ~350 | ~52,500 |
| Grade 4 | ~36 | 6 | ~350 | ~75,600 |
| Grade 5 | ~34 | 6 | ~350 | ~71,400 |
| **Total** | **~95 topics** | | | **~199,500 chars** |

#### One-Time Production Cost

| ElevenLabs Plan | Included | Fee | Overage (99,500 chars) | **Total One-Time Cost** |
|-----------------|----------|-----|----------------------|------------------------|
| Creator | 100,000 chars | $11 | 99.5K × $0.30/1K = $29.85 | **~$41** *(₹3,400)* |
| Pro | 500,000 chars | $82.50 | $0 (within limit) | **~$83** *(₹6,900)* |

> **Recommended:** Creator plan — generate all Grade 3+4+5 audio in one billing month for ~$41 total, then downgrade/cancel.

#### Per-Student Cost After Production

| Students | Audio Storage | Ongoing TTS Cost | **Cost/Student** |
|---------|--------------|-----------------|-----------------|
| 100 | ~10 MB flat | $0 | **$0.41** one-time *(₹34)* |
| 500 | ~10 MB flat | $0 | **$0.08** one-time *(₹6.8)* |
| 1,000 | ~10 MB flat | $0 | **$0.04** one-time *(₹3.4)* |
| 5,000 | ~10 MB flat | $0 | **$0.008** one-time *(₹0.68)* |

> Audio for all 95 topics = ~10 MB total storage (negligible cost on GCP/Cloudinary).  
> When new grades or subjects are added, a small one-time re-generation cost applies for that new content only.

---

### 3C. Vector Database — Qdrant Cloud

| Tier | Resources | Cost |
|------|-----------|------|
| Free | 1 cluster, 1 GB RAM, 4 GB disk | $0/month |
| Standard | Pay-per-hour (0.5 vCPU / 1 GB RAM cluster) | ~$35–50/month |

> Current collection: ~232 chunks, 384-dim vectors. **Free tier is sufficient up to ~10,000 chunks / 5,000 students.**

**Cost at pilot scale (< 500 students):** **$0** (free tier)  
**Cost at 5,000 students:** ~$35–50/month → **$0.007–0.010/student/month** *(₹0.58–0.83)*

---

### 3D. Database — Supabase

| Plan | DB Size | Storage | Cost |
|------|---------|---------|------|
| Free | 500 MB | 1 GB | $0 |
| Pro | 8 GB | 100 GB | $25/month |
| Overage | — | Extra storage | $0.021/GB |

**Per-student DB footprint:** ~50 KB (stats, assignments, messages)  
→ 1,000 students ≈ 50 MB (well within Pro plan)

**Cost at 1,000 students:** $25/month → **$0.025/student/month** *(₹2.08)*  
**Cost at 10,000 students:** $25 + overages ≈ $35/month → **$0.0035/student/month** *(₹0.29)*

---

### 3E. Backend Hosting — GCP Cloud Run

| Metric | Free Tier | Paid Rate |
|--------|-----------|-----------|
| Requests | 2M/month free | $0.40/M after |
| vCPU | 180K vCPU-sec/month free | $0.000024/vCPU-sec |
| Memory | 360K GiB-sec/month free | $0.0000025/GiB-sec |

**Per-student requests:** ~50/day × 30 = 1,500 requests/month  
**At 1,000 students:** 1.5M requests/month → within free tier  
**At 5,000 students:** 7.5M requests → ~$2.20 for requests + ~$15–25 compute  

**Cost at 1,000 students:** ~$0–5/month → **<$0.005/student/month** *(₹0.42)*  
**Cost at 5,000 students:** ~$25–40/month → **$0.005–0.008/student/month** *(₹0.42–0.66)*

---

### 3F. File Storage — GCP Cloud Storage

| Metric | Free Tier | Paid Rate |
|--------|-----------|-----------|
| Storage | 5 GB free (always free) | $0.020/GB/month (Standard) |
| Operations | 5,000 Class A ops/month free | $0.05/10K ops |
| Egress | 1 GB/month free | $0.12/GB (after free tier) |

**Per-student storage footprint:** ~5 MB (profile photo + uploaded files)  
**At 1,000 students:** ~5 GB → within free tier  
**At 5,000 students:** ~25 GB → ~$0.40/month storage + ~$3/month egress

**Cost at 1,000 students:** ~$0/month (free tier) → **$0/student/month**  
**Cost at 5,000 students:** ~$3–5/month → **$0.0006–0.001/student/month** *(₹0.05–0.08)*

> Pre-recorded TTS audio (~10 MB flat) and textbook images are served from Cloud Storage — these are shared assets, not per-student. Egress costs scale with concurrent active users, not total students.

---

### 3H. Authentication — Firebase Auth

| Tier | MAU Limit | Cost |
|------|-----------|------|
| Free (Spark) | 50,000 MAU | $0 |
| Paid | >50,000 MAU | $0.0055/MAU |

**Cost at pilot (< 50,000 students): $0**

---

## 4. Total Per-Student Monthly Cost Summary

| Component | Cost/Student/Month (INR) | Notes |
|-----------|------------------------|-------|
| Groq AI (LLM + Vision) | ₹2.00 | Active usage, 30 AI queries/day |
| ElevenLabs TTS | ₹0.07 (one-time, amortized) | Pre-recorded once for all 95 topics; ₹3,400 total ÷ students |
| Qdrant Vector DB | ₹0.58 | Pilot: free; scales cheaply |
| Supabase Database | ₹2.08 | At 1,000 students on Pro plan |
| GCP Cloud Usage | ₹0.42 | Largely within free tier at pilot scale |
| GCP Cloud Storage (files) | ₹0.07 | ~5 MB/student; free at pilot; ~₹0.07 at scale |
| Firebase Auth | ₹0.00 | Free up to 50K users |
| **Total** | **₹5.22/student/month** | |
| **Add 20% buffer (domain, monitoring, misc)** | **₹1.04** | |
| **Total with buffer** | **₹6.26/student/month** | **~$0.075/student/month** |

---

## 5. Cost at Scale

| Students | Monthly Infra Cost (INR) | Per Student |
|---------|--------------------------|------------|
| 100 | ~₹3,500 | ₹35.00 |
| 500 | ~₹7,500 | ₹15.00 |
| 1,000 | ~₹10,000 | ₹10.00 |
| 5,000 | ~₹35,000 | ₹7.00 |
| 10,000 | ~₹60,000 | ₹6.00 |

> Costs drop significantly with scale due to fixed plan costs spreading across more users.

---

## 6. Suggested Subscription Pricing

> Rule of thumb: Infra cost should be **≤10% of revenue per user**.

| Plan | Target | Monthly Price | Margin at 1K Students |
|------|--------|-------------|----------------------|
| School B2B (per student) | Schools | ₹200–350/student/month | **95–97% gross margin** |
| Parent B2C | Direct parents | ₹499–799/child/month | **98–99% gross margin** |
| Add-on: Bedtime Stories | Parents | ₹200–300/child/month | ~99% margin |
| Add-on: Olympiad Prep | Parents/Schools | ₹299–499/month | ~98% margin |

### School Deal Example (500 students, Grade 3–5)
- Price: ₹250/student/month
- Revenue: ₹1,25,000/month
- Infra cost: ~₹7,500/month
- **Gross profit: ₹1,17,500/month (94% margin)**

---

## 7. Cost Optimization Strategies (Already in Place / Planned)

| Strategy | Saving |
|---------|--------|
| Web Speech API for routine TTS | Saves ~₹1.50/student vs full ElevenLabs |
| Bundled lesson content (no server call) | Reduces Cloud Run requests by ~30% |
| Cache-first curriculum loading | Reduces Qdrant + Cloud Run calls by 80% |
| Groq free tier for dev/test | $0 during development |
| Qdrant free tier for pilot | $0 up to ~5,000 students |

---

## 8. One-Time / Setup Costs

| Item | Cost (approx.) |
|------|---------------|
| Domain (aivorahapp.com or similar) | $12–15/year |
| GCP setup + CI/CD | ~$0 (within free credits) |
| ElevenLabs voice cloning (Ms. Zara custom voice) | $99/month on Creator+ |

---

*Pricing sources: [Groq](https://groq.com/pricing) · [ElevenLabs](https://elevenlabs.io/pricing) · [Qdrant](https://qdrant.tech/pricing/) · [Supabase](https://supabase.com/pricing) · [GCP Cloud Run](https://cloud.google.com/run/pricing) · [Firebase](https://firebase.google.com/pricing)*
