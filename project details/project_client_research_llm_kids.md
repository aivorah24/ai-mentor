---
name: Client Research — LLM Web App for Kids
description: Full ChatGPT research shared by client (Prethyushaa) on building a multi-LLM educational web app for kids under 14
type: project
---

**Source:** ChatGPT group chat "LLM Web App for Kids" — shared by Prethyushaa Reddy on 2026-03-23

**Why:** Client shared this as the product direction reference. Performance this week determines the offer letter.

---

## Target
- Age: 6–14 years
- Purpose: Homework help, storytelling, quizzes, creative writing, language learning, math, coding basics
- Compliance: COPPA, GDPR-K

---

## Point 5 — Modules & Microtools (KEY: How we deliver content)
| Module | Description |
|--------|-------------|
| Quiz Generator | Creates fun quizzes on a topic |
| AI Storyteller | Interactive stories with choices |
| Drawing Buddy | Generates drawing prompts |
| Word Wizard | Vocabulary builder + spelling help |
| Math Helper | Explains math step-by-step |
| Code Coach | Basic coding logic + gamified levels |

---

## Tech Stack (Client's Vision)
- **Frontend:** React.js + Tailwind CSS / Next.js, Framer Motion animations
- **Voice:** Web Speech API (STT) + Speech Synthesis API (TTS)
- **Backend:** Node.js + Express.js (already built)
- **LLMs:** OpenAI GPT-4, Anthropic Claude, Google Gemini, LLaMA 3 via LangChain/LlamaIndex
- **Auth:** Firebase/Supabase — Parent + Child roles (RBAC)
- **DB:** Firestore / Supabase

---

## Multi-LLM Routing Logic
```js
app.post("/ask", async (req, res) => {
  const { question, model } = req.body;
  if (model === "gpt4") answer = await callOpenAI(question);
  else if (model === "claude") answer = await callClaude(question);
  else answer = await callGemini(question);
  res.json({ answer });
});
```

---

## Gamification
- XP system with streaks
- Customizable avatars
- Leaderboards (age-filtered)
- Virtual coins for completion

---

## Safety
- No open-ended internet access
- Pre-validated prompt templates
- Block sensitive content (Perspective API / clean-text)
- Parent monitoring logs
- Basic profanity filter utility

---

## Sample Prompts by Module
| Subject | Prompt Example |
|---------|----------------|
| Stories | "Tell me a story about a kind dragon who saves a town." |
| Science | "What are planets? Explain like I'm 10 years old." |
| Math | "Help me solve: What is 12 ÷ 3?" |
| Coding | "What is a loop in Scratch?" |
| Art | "Give me a drawing idea of a magical forest." |

---

## UI Pages Needed
1. Home Page – Choose learning path (Stories, Quizzes, AI Buddy)
2. Chat Page – Ask AI a question, select model
3. Module Pages – Topic-specific tools
4. Parent Dashboard – View child's activity, set restrictions
5. Login/Register Page

---

## Deployment
- Frontend: Vercel / Netlify
- Backend: Render / Railway (already on Railway plan)
- DB: Firebase or Supabase

---

## How to apply
This research defines the PRODUCT DIRECTION the client expects. Our AI Mentor app should incorporate:
1. The 6 content delivery modules (Quiz, Storyteller, Drawing Buddy, Word Wizard, Math Helper, Code Coach)
2. Multi-LLM switching (we have Groq/Claude — add OpenAI GPT-4 + Gemini options)
3. Parent dashboard with activity monitoring
4. Gamification (XP, streaks, coins, avatars)
5. High-energy cartoon voices (separate feedback from Prethyushaa)
