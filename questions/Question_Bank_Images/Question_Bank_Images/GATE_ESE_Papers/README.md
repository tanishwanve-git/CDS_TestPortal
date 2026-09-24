# GATE_ESE_Papers — Question Bank Images (EC, EE, IN, GS)

Source: GATE past papers (EC, EE, IN) and ESE/IES Prelims past papers (EC/ECE, EE, GS),
from `CDS Test questions\GATE_ESE_Papers\`.

GATE and ESE content for the same subject are **pooled together in one folder** —
`EC/` holds both GATE-EC and ESE-ECE-Prelims questions, `EE/` holds both GATE-EE and
ESE-EE-Prelims questions. `IN` is GATE-only (ESE has no Instrumentation paper). `GS`
(General Studies + Engineering Aptitude) is ESE-only (GATE has no equivalent paper).

**ESE Mains papers (Paper I / Paper II, conventional/descriptive-answer papers) are
excluded entirely from this bank** — only objective/MCQ-style papers are processed
(GATE EC/EE/IN, ESE GS, ESE Prelims).

## Folder structure

```
GATE_ESE_Papers/
├── EC/
│   ├── EC/            1,805 images  (GATE-EC 605 + ESE-ECE-Prelims 1,200 — full
│   │                    coverage restored 2026-09, see "Filename-collision bug"
│   │                    below for the full history and how it was recovered)
│   ├── GA/               110 images  (GATE General Aptitude, GATE-EC papers only)
│   ├── metadata.csv    1,915 rows  (one row per image, restored)
│   └── dropped_orphaned_ese_rows.csv  385 rows removed by the 2026-09 dedup fix,
│                          superseded by the recovery below — kept only as a
│                          historical record (it was also used to independently
│                          cross-check the recovered answers); not part of the bank
├── EE/
│   ├── EE/            1,805 images  (GATE-EE 604 + ESE-EE-Prelims 1,201 — same note)
│   ├── GA/               110 images  (GATE General Aptitude, GATE-EE papers only)
│   ├── metadata.csv    1,915 rows  (restored, same as EC)
│   └── dropped_orphaned_ese_rows.csv  385 rows, same status as EC's
├── IN/
│   ├── IN/               495 images  (GATE-IN, 9 years x 55)
│   ├── GA/                90 images  (GATE General Aptitude, GATE-IN papers only)
│   └── metadata.csv      585 rows
├── GS/
│   ├── GS/                700 images  (ESE GS Prelims, 7 years x 100)
│   └── metadata.csv       700 rows
└── README.md              this file
```

Images are pooled by **section**, not by year, same convention as the MT bank —
each section subfolder holds every processed year's questions for that section together.

### Filename convention

`<SUBJECT>_<year>_<section>_<question_no>.png`, e.g. `EC_2019_EC_034.png` = GATE 2019,
EC section, question 34; `EC_2021_EC_012.png` = ESE-ECE Prelims 2021, question 12.
**For EC/EE 2018-2024 specifically, ESE-ECE/EE Prelims questions 1-55 carry an extra
`ESE` tag** — `EC_2018_ESE_EC_001.png`, not `EC_2018_EC_001.png` — precisely so they
can never again collide with GATE's own filenames for those years (see
"Filename-collision bug" below). Questions 56-150 for those same years, and every
ESE Prelims filename for 2017 and earlier, don't need the tag and don't have it —
GATE and ESE images for the same subject/section normally live side by side in the same
folder, distinguished by year and by `question_no` scale (GATE-EC/EE run 1–55,
ESE-EC/EE Prelims run 1–150). **This assumption turned out to be wrong for 2018-2024,
both EC and EE — see the filename-collision note below**, which documents a real bug
found and partially fixed after the fact, not just a naming-convention footnote.

### Filename-collision bug (found and fixed 2026-09) — EC/EE, 2018-2024, questions 1-55

GATE-EC/EE was originally believed to only cover 2017 (S1+S2), 2025, and 2026 — that's
what every version of this README said until this fix. **That was wrong: GATE-EC/EE
2018-2024 was also extracted into this bank at some point**, using its own core-section
filenames (`EC_2018_EC_001.png` ... `EC_2018_EC_055.png`, etc.) — but those exact
filenames were *already in use* by ESE-ECE/EE Prelims' own core-section questions 1-55
for those same years, which use the same plain `<SUBJECT>_<year>_<section>_<n>.png`
pattern with no GATE/ESE disambiguating tag (2017 avoided this by luck — its GATE
filenames carry an `S1`/`S2` session tag that ESE's don't use). Whichever extraction
ran second overwrote the other's image file on disk, while `metadata.csv` kept
accumulating rows from both passes with no deduplication — so for 7 years x 55
questions x 2 subjects (EC, EE) = 770 filenames, `metadata.csv` carried two rows (one
GATE, one ESE) pointing at a single image that could only ever be one or the other.

**Verified, not assumed:** several of the affected images were read directly and
cross-checked against the real GATE answer keys (`EC_Key_2018.pdf`,
`ECFinalAnswerKey_2024.pdf`) and, for the one non-GATE/ESE-collision outlier
(`EE_2019_EE_014.png`, see below), against the ESE 2019 EE Prelims source PDF's own
printed answer — in every case, the image's actual content matched the row carrying a
GATE-style `negative_marks` value, and the other row's answer was simply wrong for what
that image actually shows.

**Fix applied:** for every one of the 385 affected filenames per subject, the row
matching the real image (verified GATE-style `negative_marks`) was kept and the other
was removed from `metadata.csv` — `EC/metadata.csv` and `EE/metadata.csv` are now 1,530
rows each, matching their 1,530 images exactly, restoring the bank-wide "one row per
image" invariant. One further one-off case, `EE_2019_EE_014.png`, had two ESE-tagged
rows (no GATE collision at all) — one with a corrupted `marks` value of literal `x`;
that row was dropped and the other (verified against the ESE 2019 EE Prelims source
PDF's own printed `Answer: (D)`) was kept.

**Update (2026-09, later the same day): recovered.** The 385 lost questions per
subject were NOT gone for good — the source PDFs for all 14 affected papers (ESE-ECE
and ESE-EE Prelims, 2018-2024) are still in `CDS Test questions\GATE_ESE_Papers\ESE
papers\...`, so they were re-extracted from scratch, this time under the
collision-proof `ESE` filename tag described above
(`EC_2018_ESE_EC_001.png`, not `EC_2018_EC_001.png`). `EC/metadata.csv` and
`EE/metadata.csv` are back to 1,915 rows each, matching 1,915 real images, with zero
filename collisions checked against the live folder before a single file was written.
`dropped_orphaned_ese_rows.csv` is no longer the only record of these questions — it's
kept purely as a historical artifact (and it turned out to double as a useful
cross-check, see below) — the recovered rows are the ones actually in `metadata.csv`
now.

**How the recovery was verified, step by step, before anything was written to this
folder:**

1. The question-boundary extraction (a from-scratch rebuild of the two-column /
   state-machine pipeline described below, since the original extraction script
   wasn't preserved) was tested against all 14 source PDFs until it found exactly
   55 questions in every one, with several real false-positive/false-negative bugs
   caught and fixed along the way — a question's own internal numbered sub-list
   (e.g. "Consider the following statements: 1. ... 2. ...") initially false-matched
   the next real question's number; a paper with all four options printed on one
   line broke a boundary rule that assumed one option per line; a question number
   printed on its own line with nothing following it broke a regex that required a
   trailing space.
2. Every one of the 770 recovered rows' `correct_answer` was cross-checked against
   `dropped_orphaned_ese_rows.csv` — the answers the *original* (pre-collision) ESE
   extraction had recorded for these same 770 questions, years before this bug was
   ever found. 766 of 770 matched exactly. The 4 that didn't were each individually
   investigated, not just accepted or rejected by count:
   - `EC 2018 Q13`: old row said `UNKNOWN`, new row says the source's own literal
     printed text, `No option is correct` — not a disagreement, just a different
     convention for the same fact (see the answer-format notes below).
   - `EE 2018 Q53`: old row said `UNKNOWN` (unable to parse a non-standard printed
     answer), new row resolves it — see the manual-override note below.
   - `EE 2019 Q14`: old row said `A`. This is the one already documented above as
     the `EE_2019_EE_014.png` one-off collision outlier, whose `A`-answer row was
     the one *removed* by the original dedup fix (it had a corrupted `marks` value)
     — the recovery's independently-derived `D` matches the verified-correct row
     that fix kept, not the discarded one.
   - `EE 2019 Q50`: old row said `UNKNOWN` (unable to parse `Answer: (B and A)`).
     The recovery's first attempt at parsing multi-letter answers had its own bug —
     naively scanning the string for any `A`-`D` character matched a spurious `D`
     out of the word "AND" itself, producing `A,B,D` instead of `A,B`. Caught by
     this exact cross-check, not by luck — fixed to only match whole-word letter
     tokens before being accepted.
3. A visual sample across different years, subjects, and edge cases (a `*`-answer
   question, a from-scratch-numbered no-answer-key paper, both multi-letter
   answers, a question spanning a page break, an untouched middle year) was read
   and checked by eye for clean crops and correct redaction before the batch was
   trusted at full scale.
4. Before any file was written into this folder, every one of the 770 target
   filenames was checked against what's already on disk — zero collisions, by
   construction (the new `ESE` tag was never used by any prior extraction) and by
   explicit check.
5. After writing, `metadata.csv` row count vs. real image count on disk was
   reconciled for both subjects (1,915 = 1,915, 0 missing, 0 duplicate filenames).

**Non-standard answer formats found during recovery (all in the recovered 1-55 range,
all handled by preserving what's genuinely printed rather than guessing):**

- **`*`** (12 questions across both subjects/several years, e.g. `EC 2019 Q32`) — the
  source itself prints `Answer: (*)` with no further explanation anywhere on the page.
  Preserved literally as `*`, the same convention this bank already uses for GATE's
  `MTA` — never resolved to a guessed letter.
- **`No option is correct`** (`EC 2018 Q13`) — preserved literally, same reasoning.
- **Multi-letter answers** (`EC 2024 Q47`: `Answer: (C, D)`; `EE 2019 Q50`:
  `Answer: (B and A)`) — normalized to sorted, comma-joined letters (`C,D`; `A,B`)
  and `question_type` set to `MSQ`, matching this bank's existing MSQ convention.
- **A bare digit** (`EE 2018 Q53`: `Answer: (2)`) — **not** auto-converted to a
  letter. The obvious-looking assumption (a 1-indexed option position, so `2` → `B`)
  was checked against this exact question — an SRTF preemptive-scheduling
  average-waiting-time calculation — by simulating the algorithm the question itself
  describes in code, for the exact process table it prints. The simulation's answer,
  5.5 ms, matches the question's own printed option **(C)**, not (B): a 1-indexed
  conversion would have been wrong. Since one example can't establish which indexing
  (if any) the source actually intends, no general digit-to-letter rule was applied
  anywhere; this single question's answer was corrected to `C` by hand, with the
  full derivation kept as a comment in the extraction code
  (`ese_recover_crop.py`'s `EE_2018_Q53_OVERRIDE`) rather than shipped as a silent
  guess.
- **No answer at all** — 56 questions in EC (55 of them `EC 2023`, which — confirmed
  directly, not assumed — has no answer key anywhere in its source PDF for any
  question, matching what was already known about this paper before recovery; the
  56th is `EC 2018 Q36`) and 2 in EE (`EE 2020 Q4` and `Q51`) print no `Answer:` line
  whatsoever. Recorded as `UNKNOWN`, same as every other genuinely-missing answer in
  this bank. All of these exact questions were *already* listed in this README's
  "Individual missing answers" section below, from the original pre-collision
  extraction — the recovery reproduces the same gaps independently rather than
  introducing new ones.

## What each image contains

One PNG per question: the full question text, any figures/diagrams/graphs, and all
answer options (for MCQ), cropped directly from the source PDF page(s) at 200 DPI.

- The correct-answer text is **redacted** (painted white) in every ESE image — the
  source PDFs print "Answer: (X)" directly beneath each question, so that text is
  blanked out before saving, matching the same principle as GATE's "Q.n" label redaction.
- GATE images follow the same convention already documented in `MT/README.md`
  (printed question-number label redacted, option letters preserved, NAT questions
  have no options rendered).
- ESE questions are all MCQ with four lettered options (A)-(D); a handful of GS/EC/EE
  "Statement-I / Statement-II" assertion-reason items use a shared coded rubric instead
  of per-item lettered options — these are extracted and cropped the same way, just
  without an options block of their own in the image.

## metadata.csv columns

Same ten columns as `MT/metadata.csv` (`image_filename`, `relative_path`, `subject`,
`year`, `section`, `question_no`, `question_type`, `correct_answer`, `marks`,
`negative_marks`). Two differences for ESE rows:

- **`negative_marks` is left blank for every ESE row.** ESE's official negative-marking
  scheme (commonly cited as 1/3 per question under UPSC convention, same as GATE) was
  **not confirmed from any source document** in `CDS Test questions\`, so rather than
  guess it, the field is left empty. GATE rows keep the already-established convention
  (MCQ: `marks / 3`, MSQ/NAT: `0`).
- **`correct_answer` is `UNKNOWN`** for any ESE question where the source PDF genuinely
  has no answer for it — see "Papers with no answer key" and "Individual missing
  answers" below. This is never guessed or inferred; it means the information simply
  isn't present anywhere in the supplied source materials.

## Papers skipped entirely — no answer key available anywhere in the source tree

Per instruction, **no image-extraction effort was spent on papers with no answer key
available anywhere in the source materials** (the question PDF has no embedded
"Answer:" text, and no separate answer-key document exists for that paper either).
These papers are not present in this image bank at all:

| Paper | Reason |
|---|---|
| **ESE GS 2021 Prelims** (`GS-IES-2021-Prelims-Final.pdf`) | No "Answer:" text anywhere in the PDF; no separate key exists. |
| **ESE ECE 2025 & 2026 Prelims** | Scanned-image PDFs (no extractable text layer at all — would require full-page OCR); no answer key anywhere in the source tree either, so OCR effort would still only produce `UNKNOWN` answers throughout. |
| **ESE EE 2025 & 2026 Prelims** | Same as above — scanned, no answer key anywhere. |
| **ESE GS 2025 & 2026 Prelims** | Same as above — scanned, no answer key anywhere. |

If an answer key for any of these ever becomes available, they can be processed with
the same pipeline used for the other years.

## Papers processed, with individual UNKNOWN answers (genuine source-PDF gaps)

Every other objective-paper year listed in the folder structure above was processed.
A very small number of *individual* questions within otherwise-normal papers have no
"Answer:" text in the source PDF (confirmed by visual inspection of the rendered page —
the answer line is simply absent from the booklet, not an extraction failure). These
are recorded as `correct_answer = UNKNOWN`:

- **ESE ECE Prelims**: 2017 Q92, 2018 Q36, 2019 Q66 (3 questions). **2018 Q13 was
  originally listed here too** (before the 2026-09 filename-collision recovery, when
  the only evidence available for these questions was the pre-collision extraction's
  own `UNKNOWN` fallback) **but is not truly answer-less** — the source prints
  `Answer: (No option is correct)`, a real, if non-standard, printed answer. It's
  preserved literally as that text rather than as `UNKNOWN` — see the
  filename-collision recovery note above.
- **ESE ECE Prelims 2023**: **no answer key exists for this paper at all** (confirmed —
  no "Answer:" text anywhere in the PDF, no separate key elsewhere in the source tree,
  reconfirmed independently for questions 1-55 during the 2026-09 recovery). Unlike the
  fully-skipped papers above, this one *was* still processed and its 150 question images
  are included, since the paper itself was already staged and its question-boundary
  format is unambiguous — only every `correct_answer` for this one paper is `UNKNOWN`.
- **ESE EE Prelims**: 2017 Q46 & Q101, 2018 Q97, 2019 Q87, 2020 Q4 & Q51 & Q65 & Q67,
  2024 Q116 (9 questions). **2018 Q53 and 2019 Q50 were originally listed here too**,
  for the same reason as EC 2018 Q13 above — the 2026-09 recovery's more careful
  parsing resolved both to real answers (`C`, independently verified by simulating the
  SRTF scheduling calculation the question describes; and `A,B`, a multi-letter answer
  a parsing bug had previously misread) rather than leaving them `UNKNOWN` — see the
  filename-collision recovery note above for both derivations.
- **ESE GS Prelims**: 2023 Q91 (1 question)

## Decisions, rationale, and per-format notes

**Order-based (sequential) question numbering**, same principle as `MT/README.md` —
questions are numbered by their position in the document rather than by trusting a
parsed/OCR'd digit, for both GATE and ESE extraction.

**ESE answer-key format is fundamentally different from GATE's.** GATE papers ship
with a separate answer-key document/pages; ESE Prelims papers instead print
`Answer: (X)` inline, immediately after each question's options, with no separate key
document anywhere in the source tree. This required a new extraction pipeline built
specifically for ESE:

- PDFs are two-column, extractable-text layout. Each page's words are split into left/
  right columns by x-position, grouped into lines by y-coordinate clustering, and the
  two columns are concatenated in reading order (left column top-to-bottom, then right
  column top-to-bottom) to build one flat, whole-document line list.
- A question-boundary state machine walks that flat list: a line matching `^N.` is only
  accepted as a genuine new-question start if `N` equals the expected next sequential
  number **and** the previous question has already shown its own `Answer: (X)` line (or,
  for papers with no answer key at all, once its `(D)` option marker or a
  `Statement (II)` line has been seen). This avoids false-matching a question's own
  internal numbered sub-statements (e.g. "1. / 2. / 3." inside "Consider the following
  statements: ...") which also start at the column margin and can coincidentally equal
  the next real question number.
- "Statement-I / Statement-II" assertion-reason items that share one coded rubric across
  several consecutive items (rather than each carrying its own A-D options) are handled
  by treating a `Statement (II)` line, not just an option-D marker, as a valid
  question-closing signal.
- The `Answer: (X)` text itself is redacted (painted white) in the saved crop, the same
  way GATE's question-number label is redacted.

**Validation performed for every ESE year:** exact expected-question-count checks
(150 for EC/EE Prelims, 100 for GS Prelims, with no missing or duplicate question
numbers), and the extraction script's own missing-answer warnings were individually
investigated (not just logged) — each one confirmed by rendering the actual page image
and visually checking that the source PDF genuinely has no answer text there, before
being recorded as `UNKNOWN` rather than treated as an extraction bug.
