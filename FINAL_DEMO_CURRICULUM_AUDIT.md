# Final Demo Curriculum Audit

Generated: 2026-07-26

## Corruption purge — complete

| Metric | Value |
|---|---|
| Grades processed | **12 / 12** |
| Grade-subject pairs validated | **90** |
| Corrupted / doubled titles found | **31** |
| Real titles recovered by de-doubling | **10** |
| Unrecoverable garbage reset to `Chapter N` | **21** |
| **Corrupted titles remaining** | **0** |

### Recovered (doubled real titles, halved back)

`Sound Sound` -> Sound · `Light Light` -> Light · `Friction Friction` -> Friction ·
`Crop Production and Management` ×2 -> once · `Conservation of Plants and Animals` ×2 -> once ·
`Some Natural Phenomena` ×2 -> once · `Reaching the Age of Adolescence` ×2 -> once ·
`People People` -> People · `Try These Try These` -> Try These

### Reset to honest placeholders (no recoverable text)

G12 Psychology `Variavaria Varia Varia`, `Psypsy Psy Psy`, `Atat Atat`, `Therther Ther Ther` ·
G12 Geography `Pppp`, `Transportranspor…`, `Manuf Manuf Manufmanuf` · G12 Physics
`Ntroductionntroduction…` · G12 Economics `Kkkk` · G12 Political Science `Imf Imf` ·
G11 Fine Arts `Emple Emple Empleemple` · G11 Biotechnology / English `Rlrl` ·
G10 Science `Understunderst…`, `Ccumulccumul…` · G9 Science `Crcrcr` · G6 Science `Abcabc` ·
G5 EVS `Specimenspecimen` · G4 Maths `Mawlynnongmawlynnong` · G3 PE `Finishfinish…` ·
G7 Social Science `Indian Indian Oceanocean`

`Seeing without Seeing` (G2 English) was left untouched — it is a genuine NCERT title.

## Cause

The doubling comes from overlapping text layers in the source PDFs: the same
string is drawn twice for a shadow/outline effect, so extraction returns it
twice. The sanitiser caught some patterns but not repeated-word or
repeated-syllable forms, which is how these reached the screen.

## Hindi titles — reverted, and why

Grade 11 Hindi chapters 1 and 2 briefly carried *नमक का दरोगा* and
*मियाँ नसीरुद्दीन*. Both were **removed**: those are *Aroh* titles, but
Grade 11 Hindi chapter 1 maps to `kham1` (*Abhivyakti aur Madhyam*), whose
chapter 1 is *जनसंचार माध्यम और लेखन*. The catalog lookup had matched on
"grade 11 + hindi" without checking the book. It now requires an explicit book
code and never infers from grade.

## Honest state

- **0** corrupted titles across all 12 grades.
- **385 of 2,925** topics still named `Chapter N` — no verified source for them.
- **1,072** chapters carry a labelled "Interactive Practice Module — Sample Lesson".
- **165** lessons have no source PDF on disk.

Chapter structure, numbering and book paths are parsed from the PDFs — no LLM
generated any chapter title or number.
