# Curriculum Fix — Audit Log

Generated: 2026-07-25T13:57:52.559Z

Structure is parsed directly from the NCERT textbook PDFs (chapter title from the
page-1 heading, subtopics from the book's numbered section headings). No chapter
title, number, subtopic or bookPath in this map comes from a language model.

## Summary

| Metric | Value |
|---|---|
| Grades processed | 12 |
| Curriculum files | 137 |
| Chapters total | 1287 |
| Chapters with a real title | 783 (61%) |
| Subtopics extracted | 2180 |
| Chapters missing a title | 504 |
| Chapters with no subtopics | 898 |
| Broken / missing bookPath | 107 |

## Per grade

| Grade | Subjects | Chapters | Titled | Subtopics | Chapters w/ subtopics | Bad bookPath |
|---|---|---|---|---|---|---|
| 1 | 2 | 17 | 0 | 0 | 0 | 13 |
| 2 | 4 | 68 | 1 | 0 | 0 | 13 |
| 3 | 7 | 91 | 30 | 0 | 0 | 12 |
| 4 | 7 | 98 | 37 | 0 | 0 | 0 |
| 5 | 6 | 74 | 34 | 0 | 0 | 10 |
| 6 | 10 | 106 | 84 | 160 | 30 | 26 |
| 7 | 9 | 85 | 73 | 106 | 28 | 7 |
| 8 | 16 | 140 | 105 | 252 | 53 | 6 |
| 9 | 8 | 86 | 58 | 204 | 29 | 0 |
| 10 | 9 | 80 | 48 | 141 | 46 | 0 |
| 11 | 27 | 220 | 167 | 748 | 107 | 5 |
| 12 | 32 | 222 | 146 | 569 | 96 | 15 |

## Live database (syllabus_chapters)

`unit_no = 1` on every row is the signature of the old publish() bug, which
created one chapter per generated topic instead of using the book's chapters.

| Grade | Chapter rows | Rows with unit_no=1 | Distinct subject+unit |
|---|---|---|---|
| 1 | 36 | 21 | 18 |
| 2 | 66 | 20 | 49 |
| 3 | 23 | 23 | 4 |
| 4 | 18 | 18 | 4 |
| 5 | 11 | 11 | 2 |
| 6 | 657 | 657 | 4 |
| 7 | 117 | 117 | 4 |
| 8 | 208 | 208 | 4 |
| 9 | 112 | 112 | 3 |
| 10 | 120 | 120 | 4 |
| 11 | 87 | 11 | 84 |
| 12 | 83 | 12 | 76 |

## Missing chapter titles — needs manual check (504)

- G1 English ch1 (aemr101.pdf)
- G1 English ch2 (aemr103.pdf)
- G1 English ch3 (aemr106.pdf)
- G1 English ch4 (aemr108.pdf)
- G1 Mathematics ch1 (aejm101.pdf)
- G1 Mathematics ch2 (aejm102.pdf)
- G1 Mathematics ch3 (aejm103.pdf)
- G1 Mathematics ch4 (aejm104.pdf)
- G1 Mathematics ch5 (aejm105.pdf)
- G1 Mathematics ch6 (aejm106.pdf)
- G1 Mathematics ch7 (aejm107.pdf)
- G1 Mathematics ch8 (aejm108.pdf)
- G1 Mathematics ch9 (aejm109.pdf)
- G1 Mathematics ch10 (aejm110.pdf)
- G1 Mathematics ch11 (aejm111.pdf)
- G1 Mathematics ch12 (aejm112.pdf)
- G1 Mathematics ch13 (aejm113.pdf)
- G10 English ch5 (jewe205.pdf)
- G10 English ch6 (jewe206.pdf)
- G10 English ch7 (jewe207.pdf)
- G10 English ch8 (jewe208.pdf)
- G10 Physical Education ch1 (jehp101.pdf)
- G10 Physical Education ch3 (jehp103.pdf)
- G10 Physical Education ch4 (jehp104.pdf)
- G10 Physical Education ch5 (jehp105.pdf)
- G10 Physical Education ch7 (jehp107.pdf)
- G10 Physical Education ch9 (jehp109.pdf)
- G10 Physical Education ch10 (jehp110.pdf)
- G10 Physical Education ch11 (jehp111.pdf)
- G10 Physical Education ch12 (jehp112.pdf)
- G10 Science ch1 (jesc101.pdf)
- G10 Science ch3 (jesc103.pdf)
- G10 Science ch4 (jesc104.pdf)
- G10 Science ch5 (jesc105.pdf)
- G10 Science ch6 (jesc106.pdf)
- G10 Science ch7 (jesc107.pdf)
- G10 Science ch9 (jesc109.pdf)
- G10 Science ch10 (jesc110.pdf)
- G10 Science ch11 (jesc111.pdf)
- G10 Science ch12 (jesc112.pdf)
- …and 464 more

## Chapters with no subtopics extracted (898)

- G1 English ch1 "Chapter 1"
- G1 English ch2 "Chapter 2"
- G1 English ch3 "Chapter 6"
- G1 English ch4 "Chapter 4"
- G1 Mathematics ch1 "Chapter 1"
- G1 Mathematics ch2 "Chapter 2"
- G1 Mathematics ch3 "Chapter 3"
- G1 Mathematics ch4 "Chapter 4"
- G1 Mathematics ch5 "Chapter 5"
- G1 Mathematics ch6 "Chapter 6"
- G1 Mathematics ch7 "Chapter 7"
- G1 Mathematics ch8 "Chapter 8"
- G1 Mathematics ch9 "Chapter 9"
- G1 Mathematics ch10 "Chapter 10"
- G1 Mathematics ch11 "Chapter 11"
- G1 Mathematics ch12 "Chapter 12"
- G1 Mathematics ch13 "Chapter 13"
- G10 English ch1 "Unit"
- G10 English ch2 "Unit"
- G10 English ch3 "Unit"
- G10 English ch5 "Chapter 5"
- G10 English ch6 "Chapter 6"
- G10 English ch7 "Chapter 7"
- G10 English ch8 "Chapter 8"
- G10 Physical Education ch1 "Chapter 1"
- G10 Physical Education ch2 "Rala Lvrv"
- G10 Physical Education ch3 "Chapter 3"
- G10 Physical Education ch4 "Chapter 4"
- G10 Physical Education ch5 "Chapter 5"
- G10 Physical Education ch9 "Chapter 9"
- G10 Physical Education ch10 "Chapter 10"
- G10 Physical Education ch11 "Chapter 11"
- G10 Physical Education ch12 "Chapter 12"
- G10 Social Science ch1 "Development of Resources"
- G10 Social Science ch2 "Chapter 2"
- G10 Social Science ch3 "Water Scarcity and the Need for Water Conservation and Management"
- G10 Social Science ch4 "Types of Farming"
- G10 Social Science ch5 "Mode of Occurrence of Minerals"
- G10 Social Science ch6 "Importance of Manufacturing"
- G10 Social Science ch7 "Transport"
- …and 858 more

## Broken or missing PDF paths — viewer will 404 (107)

- G1 Mathematics ch1 → (no bookPath)
- G1 Mathematics ch2 → (no bookPath)
- G1 Mathematics ch3 → (no bookPath)
- G1 Mathematics ch4 → (no bookPath)
- G1 Mathematics ch5 → (no bookPath)
- G1 Mathematics ch6 → (no bookPath)
- G1 Mathematics ch7 → (no bookPath)
- G1 Mathematics ch8 → (no bookPath)
- G1 Mathematics ch9 → (no bookPath)
- G1 Mathematics ch10 → (no bookPath)
- G1 Mathematics ch11 → (no bookPath)
- G1 Mathematics ch12 → (no bookPath)
- G1 Mathematics ch13 → (no bookPath)
- G11 English ch1 → (no bookPath)
- G11 English ch2 → (no bookPath)
- G11 English ch3 → (no bookPath)
- G11 English ch4 → (no bookPath)
- G11 English ch5 → (no bookPath)
- G12 Fine Arts ch1 → (no bookPath)
- G12 Fine Arts ch2 → (no bookPath)
- G12 Fine Arts ch3 → (no bookPath)
- G12 Fine Arts ch4 → (no bookPath)
- G12 Fine Arts ch5 → (no bookPath)
- G12 Fine Arts ch6 → (no bookPath)
- G12 Fine Arts ch7 → (no bookPath)
- G12 Fine Arts ch8 → (no bookPath)
- G12 Home Science ch1 → (no bookPath)
- G12 Home Science ch2 → (no bookPath)
- G12 Home Science ch3 → (no bookPath)
- G12 Home Science ch4 → (no bookPath)
- G12 Home Science ch5 → (no bookPath)
- G12 Home Science ch6 → (no bookPath)
- G12 Home Science ch7 → (no bookPath)
- G2 English ch1 → (no bookPath)
- G2 English ch2 → (no bookPath)
- G2 English ch3 → (no bookPath)
- G2 English ch4 → (no bookPath)
- G2 English ch5 → (no bookPath)
- G2 English ch6 → (no bookPath)
- G2 English ch7 → (no bookPath)
- …and 67 more

---

# Work completed (Phase 1)

> The data tables above are regenerated by `node server/scripts/audit-curriculum.cjs`.
> These narrative sections are appended after it runs.

## Root cause

`publish()` in `server/scripts/pipeline.cjs` created a `syllabus_chapters` row for
**every generated topic**, with `unit_no` hardcoded to `1`. The app was faithfully
rendering an invented curriculum:

- Grade 11 Mathematics listed "Area of a Triangle" as a chapter instead of
  NCERT's Ch 1 *Sets* / Ch 2 *Relations and Functions*.
- Every unit contained exactly one topic, because a unit *was* a topic.
- No lesson recorded which book it came from, so `pdfFile` was null everywhere
  and the split-screen "ORIGINAL TEXTBOOK" panel had nothing to open. The panel
  was never broken; Grade 2 worked only because its lessons happened to carry
  `pdfFile`.

## What changed

| Area | Change |
|---|---|
| `scripts/extract-ncert-structure.cjs` | **New.** Parses chapter title (page-1 heading), subtopics (the book's numbered section headings) and `bookPath` from the PDFs. Uses the `Chapter N.indd` footer for the book's own chapter number, since primary readers split one chapter across several files. |
| `scripts/seed-curriculum-files.cjs` | **New.** Creates maps for subjects that had PDFs but no curriculum file — G11/G12 Accountancy, History, Business Studies, Computer Science and Psychology were entirely unmapped, which is why 136 of 330 G11 lessons could not be placed. |
| `scripts/sanitize-chapter-titles.cjs` | **New.** Reverts implausible extracted titles to `Chapter N` + `needsTitleReview`. A wrong title is worse than an honest placeholder. |
| `services/syllabus-map.js` | **New.** Single authority: chapter code -> {chapter no, title, subtopics, bookPath}. |
| `scripts/pipeline.cjs` -> `publish()` | Resolves the real chapter via the map: correct `unit_no`, many topics per chapter, `topic_order` from subtopic position, `bookPath` in the payload. |
| `scripts/migrate-chapters.cjs` | **New.** Re-keys already-published lessons and backfills `pdfFile`/`bookPath`. |
| `AIMentorApp/src/screens/student/LessonScreen.tsx` | PDF resolved via `bookSrc()`, preferring the payload's `bookPath`. Fixed `subjectToBookFolder`, where `includes('science')` sent **Computer Science** and **Political Science** to the `/science/` folder. |
| `scripts/audit-curriculum.cjs` | **New.** This report. |

**No chapter title, number, subtopic or path comes from a language model.** All of
it is parsed from the textbooks; anything unparseable is left as a flagged
placeholder rather than guessed.

## Verified

- Grade 11 Mathematics: all 14 chapters match the NCERT syllabus — Sets ·
  Relations and Functions · Trigonometric Functions · Complex Numbers and
  Quadratic Equations · Linear Inequalities · Permutations and Combinations ·
  Binomial Theorem · Sequences and Series · Straight Lines · Conic Sections ·
  Dimensional Geometry · Limits and Derivatives · Statistics · Probability.
- Ch 1 *Sets* carries its 9 real subtopics.
- `grade11/computer_science/kecs101.pdf` resolves; the old code built
  `grade11/science/...`, which does not exist.
- Grade 1 English correctly merged 22 PDFs into 4 chapters.

## Migration counts (Phase 1)

| | Grade 11 | Grade 12 |
|---|---|---|
| Lessons re-keyed onto real chapters | 281 | 587 |
| Invented one-topic chapters deleted | 279 | 584 |

## Open items — manual attention

1. **Primary-grade chapter titles (G1-G5).** Those books print no chapter heading
   and Qdrant holds only file codes, so there is no machine-readable source. Left
   as placeholders; needs manual entry from the printed contents pages.
2. **No subtopics for G1-G5.** Primary books do not use numbered section
   headings. Senior grades yielded 2,180 subtopics.
3. **107 broken `bookPath` entries** — PDF referenced by the map but absent from
   `data/ncert_books/`. Needs the missing files downloaded.
4. **6 mixed book folders** (`data/mixed-book-folders.json`) — e.g.
   `grade9/social_science` holds Maths, Science, English and PE books. Seeding was
   skipped rather than mislabel them.
5. **Multi-volume duplicate chapter numbers** — Accountancy Part I and II both
   start at Chapter 1. The UI should group by volume.
6. **A missing PDF returns HTTP 200** from the static route (SPA fallback), so the
   viewer renders blank instead of erroring. Filesystem checks are the reliable test.

---

# Phase 2 — semantic re-key (complete)

Lexical matching left 119 lessons under invented one-topic chapters, because a
topic's wording need not overlap its chapter's ("Behavior of Terms in Infinite
G.P." shares no word with "Sequences and Series"). `scripts/semantic-rekey.cjs`
embeds each chapter as *title + its subtopics*, embeds the topic, and takes the
best cosine match. Embeddings are local, so this cost no API tokens.

## Result — 0 invented chapters remain

| | Grade 11 | Grade 12 |
|---|---|---|
| Chapter rows | 87 | 83 |
| Real NCERT chapters | **87 (100%)** | **83 (100%)** |
| Chapters holding multiple topics | 66 | 63 |
| **Invented / placeholder chapters** | **0** | **0** |

- Re-keyed by semantic match: **116** (48 G11 + 68 G12)
- Invented chapter rows deleted: **116**
- Resolved individually after inspection: **2**

Sample matches: "Animal Classification Challenges" → Ch 4 *Animal Kingdom*
(0.759) · "Atomic Spectra and Bohr's Model" → Ch 2 *Structure of Atom* (0.525) ·
"Articles of Association: Internal rules of a company" → Ch 7 (0.775).

## The two handled by inspection, and why not by threshold

Both sat just under the 0.30 cut-off. Lowering the threshold to capture them
would have loosened matching for every other lesson, so each was decided on its
merits instead:

1. **G12 Accountancy — "Average Interest on Drawings"** (best 0.295). Genuinely
   belongs to Ch 1 *Accounting for Partnership: Basic Concepts*; interest on
   drawings is taught under 1.5 *Distribution of Profit among Partners*, which is
   not its own numbered section, so neither lexical nor semantic matching could
   reach it cleanly. Placed under Ch 1 explicitly.
2. **G11 Mathematics — "Assumptions in Mathematical Models"** (best 0.297).
   **Off-syllabus** — NCERT Class 11 Mathematics has no mathematical-modelling
   chapter, so there was no correct chapter to place it under. It was an invented
   topic, and was removed from navigation rather than filed somewhere wrong.
   Content backed up to `removed-offsyllabus-g11-maths.json`.

A placeholder chapter title ("Chapter 1") was also found to poison the semantic
comparison — every such chapter looks alike. Where a title is a placeholder the
subtopics now carry the match alone.

## Backups for this pass

| File | Contents |
|---|---|
| `backup-g11g12-prerekey.json` | 240 chapters + 657 topics, pre-re-key |
| `backup-syllabus-chapters.json` | 2,025 chapter rows, pre-migration |
| `removed-offsyllabus-g11-maths.json` | The one removed lesson, in full |
| `curricula-backup-2/` | Curriculum map before bulk rewrite |

Every step was dry-run before execution.

## Still open (unchanged from Phase 1)

Grades 1–10 have **not** been through this migration — only G11 and G12 were in
scope. G1–G5 chapter titles remain placeholders (those books print no chapter
heading and there is no machine-readable source), 107 bookPaths reference PDFs
absent from disk, and 6 book folders hold mixed subjects.
