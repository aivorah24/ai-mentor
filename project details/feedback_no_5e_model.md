---
name: No 5E Model — Learn + Practice only
description: Product does NOT use 5E instructional model; flow is simply Learn → Practice
type: feedback
---

The app does NOT use the 5E instructional model (Engage, Explore, Explain, Elaborate, Evaluate).

The learning flow is simply: **Learn → Practice**

**Why:** User explicitly corrected this — 5E is not the product's pedagogy.

**How to apply:**
- Never mention 5E in code, prompts, comments, agent prompts, or explanations
- The screen is called `Learn5EScreen.tsx` but treat it as just the Learn screen
- Lesson scripts = scenes the student watches/listens to (Learn phase)
- After Learn comes Practice (quiz with adaptive explanation on wrong answers)
- Do not add Engage/Explore/Explain/Elaborate/Evaluate labels to anything
