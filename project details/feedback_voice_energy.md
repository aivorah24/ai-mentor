---
name: Voice Energy Feedback (Client)
description: Client requires high-energy cartoon-like TTS voices for kids under Grade 4, not dull/flat narration
type: feedback
---

Client (Prethyushaa, via Reddy E) reviewed the chapter video and found the audio "very dull" — lacks energy.

**Requirement:** Voices that create energy like cartoon characters (Doraemon, Elsa style) for kids under Grade 4.

**Why:** Licensing prevents using actual Doraemon/Elsa voices. Agreed to use free ElevenLabs alternatives.

**Approved free ElevenLabs voices to evaluate:**
- Emma
- Milly Maple
- Lutz
- Michael Mouse

**How to apply:** Replace current ElevenLabs Matilda voice in `server/routes/lesson.js` (TTS route) with one of the approved cartoon-energy voices. May need to A/B test which has the best energy for kids under Grade 4.

**Status:** Client shared ChatGPT research on this — waiting to receive it before implementing.
