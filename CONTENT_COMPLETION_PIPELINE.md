# Content Completion Pipeline — 786 missing-content topics

Goal: give every topic in the worklist a real, grounded `AI_EXPLANATION`
resource in Supabase. No placeholders, no invented content unconnected to
the actual NCERT book.

## 1. Input — the worklist (already generated, do not regenerate)

`server/data/curricula/ncert_catalog/missing-content-topics.json`

786 entries, one per topic that currently has either no `topic_resources`
row or a `PLACEHOLDER`/sample-flagged one:

```json
{ "grade": 1, "subject": "English", "chapterTitle": "My Family and Me",
  "chapterId": "<uuid>", "topicId": "<uuid>", "topicName": "Two Little Hands" }
```

Breakdown: G1=20, G2=57, G3=60, G4=75, G5=59, G6=53, G7=54, G8=78, G9=45,
G10=54, G11=114, G12=117.

If the DB has changed since this file was written, regenerate it first:
`node server/scripts/audit-content-coverage.cjs` (batches Supabase queries
in groups of 80 — a naive single `.in()` call with 300+ ids fails silently
against Supabase's URL length limit; this is what produced a false
"Grade 6 has 0 topics" reading earlier — don't repeat that bug).

## 2. Per-topic loop

For each `{ grade, subject, chapterId, topicId, topicName }`:

### a. Resolve the source book
```js
const syllabus = require('./services/syllabus-map');
const chs = syllabus.chaptersFor(grade, subject);           // real book order
const rec = chs.find(c => c.title === chapterTitle);        // or match by chapter no
const pdfPath = path.join(BOOKS_ROOT, rec.bookPath);         // e.g. grade1/english/aemr101.pdf
```
`bookPath` was just backfilled for 107 previously-broken chapters — if a
lookup returns `bookPath: null`, stop and fix that file in
`server/data/curricula/*-chapters.json` before generating (don't generate
against a missing book).

### b. Ground the lesson
Two grounding sources exist, use both where available:
- **Direct PDF text** — extract the topic's page(s) from `pdfPath` with
  `pdf-parse` (see `server/scripts/orchestrate-ncert.js` /
  `generate-chapter-subject-content.js` for the existing extraction pattern).
- **Qdrant embeddings** (already ingested, do not re-embed) —
  `server/services/qdrant.js`: `searchGrounding({ vector, curriculum, grade, subject, topic, limit })`
  or `server/services/rag.js`: `retrieveCurriculumContext({...})`. Resolve
  the collection via `resolveCollection(curriculum, grade)`.

For Grade 1-2 specifically: topics are short poems/stories/activities, not
long chapters — the lesson must be grounded in that specific poem/story's
actual printed text, not a generic literacy-skill module (this is exactly
the bug that produced "Two Little Hands" being blank — don't recreate it
under a different name).

### c. Generate
Call the LLM (same provider/fallback chain as
`generate-chapter-subject-content.js` — Groq primary, watch the Gemini
budget note in project memory: "~₹100 left, don't batch on it"). Prompt
must require every claim to trace back to the extracted book text /
retrieved chunks — no invented facts, no filler about unrelated skills.

### d. Write result — exact shape (verified live from an existing real row)

```js
await sb.from('topic_resources').upsert({
  topic_id: topicId,
  resource_type: 'AI_EXPLANATION',
  status: 'READY',
  source_tier: 'ORIGINAL_AI',           // NOT 'PLACEHOLDER'
  static_payload: {
    text: '...',                        // full lesson prose
    summary: '...',
    vocabulary: [ { word, meaning }, ... ],
    keyConcepts: [ '...', '...' ],
    reflectionQuestion: '...',
    attribution: 'AI Generated — Aivorah',
    // do NOT set isSample — its absence is what marks this as real
  },
}, { onConflict: 'topic_id,resource_type' });
```

## 3. Skip / resume logic

- Before generating, re-check the row still lacks real content (another run
  may have already handled it) — `static_payload.isSample` absent AND
  `source_tier !== 'PLACEHOLDER'` means already done, skip.
- On any generation failure (rate limit, unreadable PDF, no grounding
  found), log the topicId and move on — do not block the batch. Retry
  skipped ones in a second pass.
- Process is naturally idempotent/resumable via the same check, so it's
  safe to stop and restart at any point.

## 4. Validation before calling a topic done

Match the standard already used by `run-vision-qa-audit.js` in this repo:
content should not be sample/placeholder text, should reflect the actual
book topic (not a generic reskin), and should render without errors in the
Learn tab. A lightweight self-check: confirm `static_payload.text.length`
is non-trivial and doesn't contain any of the known placeholder strings
("Interactive Practice Module — Sample Lesson", "is being prepared from
the NCERT textbook").

## 5. Report format expected at the end

Per grade: attempted / succeeded / skipped (with reason). Total across all
12 grades should reconcile against the 786 starting count.
