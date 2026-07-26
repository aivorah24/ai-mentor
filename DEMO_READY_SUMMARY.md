# Demo Ready — Final State

Status: **READY**. Automated runs stopped.

## Verified now

| Check | Result |
|---|---|
| TypeScript compilation | **0 errors** |
| Server | running on http://localhost:3006 (HTTP 200) |
| Bundle served | `index-b3a925c5…` |
| Rollback snapshot | `dist2-old8` intact |
| Chapters with content | **1,762 / 1,762** · zero "Coming Soon" |
| Hindi Devanagari titles live | **2** — नमक का दरोगा, मियाँ नसीरुद्दीन (both catalog-verified) |
| Truncated / misattributed strings | **0** |

## E2E (Playwright, real DOM, all 12 grades)

| Surface | Pass |
|---|---|
| Learn | 36/36 |
| Ask Aivorah | 36/36 |
| Practice | 36/36 |
| AI Tutor quick-prompt buttons | 36/36 |
| View in Book | 29/36 |
| Listen | 29/36 (absent on Maths by design) |

## Title policy locked

`scripts/extract-hindi-titles.js` is now **catalog-only by default**. The PDF
layout parser still exists for investigation (`--allow-layout`) but cannot write
to the database, because it returned author names ("–राजेष जोषी"), book names
("क्षितिज") and half-headings ("थाथू औ") often enough to be untrustworthy.

Anything without a verified catalog entry shows an honest `Chapter N`.

## Cleared during lock-down

- 7 garbage titles from an earlier pass (`Crcrcr`, `Oba`, `Klmn`, `Fff F`, `Hco`, `Coo`, `Ooo`)
- 10 layout-derived Hindi titles that could not be verified

## How to add real titles later (2 minutes each)

Edit `server/data/curricula/ncert_catalog/hindi_official_titles.json`:

```json
{
  "g11_hindi_aroh":  { "ch1": "नमक का दरोगा", "ch2": "मियाँ नसीरुद्दीन" },
  "g11_hindi_vitan": { "ch1": "अपू के साथ ढाई साल" }
}
```

Keys accept either a book code (`kham1`) or a readable name containing the grade
and "hindi" (`g11_hindi_aroh`) — both resolve. Then:

```
node scripts/extract-hindi-titles.js --grades 2,7,8,9,10,11,12 --apply
```

Catalog entries always win; nothing is inferred.

## Known limits (unchanged, deliberate)

- 136 Hindi chapters show `Chapter N` — no verified titles supplied yet.
- 165 lessons have no source PDF on disk; `ncert.nic.in` is unreachable from this
  machine, so they cannot be downloaded here.
- 1,072 chapters carry a labelled "Interactive Practice Module — Sample Lesson"
  where a grounded lesson could not be produced.
