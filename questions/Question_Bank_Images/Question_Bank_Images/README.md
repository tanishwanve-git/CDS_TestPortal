# Question_Bank_Images — Overview

This is the root of the exam-testing question-bank image system: pre-rendered
question+options images, paired with correct-answer metadata kept in a separate CSV
(never printed inside the image itself). It's built to sit behind a testing app that
renders each image, adds its own plain radio buttons/text inputs below it, and scores
answers using the CSV — nothing in the image or filename reveals the correct answer.

**This file is the map of everything in this folder. Update it every time a new
subject or paper set is added** — new top-level folder, new row in the table below,
and a one-line note on anything unusual about that addition.

## How the whole thing is organized

```
Question_Bank_Images/
├── README.md              this file — start here
├── MT/                    GATE Metallurgical Engineering
│   └── README.md          subject-specific details
├── GATE_ESE_Papers/       GATE (EC, EE, IN) + ESE/IES Prelims (EC, EE, GS), pooled
│   └── README.md          subject-specific details
├── ME/                    GATE Mechanical Engineering
│   └── README.md          subject-specific details
├── CH/                    GATE Chemical Engineering
│   └── README.md          subject-specific details
├── CE/                    Civil Engineering (GATE + ESE, topic-organized, no year)
│   └── README.md          subject-specific details
└── CSE/                   GATE Computer Science Engineering (rendered, not cropped)
    └── README.md          subject-specific details
```

Every subject lives in its own top-level folder, and every top-level folder has its
own `README.md` with the full detail for that subject (exact folder tree, filename
convention, metadata columns, per-year quirks, what was skipped and why). **This
root file only gives the map and the conventions that hold across all of them** — for
anything specific to one subject, open that subject's own README.

Two exams' content is pooled into the same folder when they cover the same subject
matter (e.g. GATE-EC and ESE-ECE-Prelims both live under `GATE_ESE_Papers/EC/`) —
see that folder's own README for how GATE and ESE questions are told apart within it.

## Conventions that hold everywhere in this bank

- **One PNG per question.** Full question text, any figures/diagrams, and (for
  MCQ-type questions) the lettered options, cropped directly from the source PDF at
  200 DPI. The printed question-number label and/or the correct-answer text (whichever
  the source PDF prints) is redacted (painted white) — the app supplies its own
  numbering and answer controls.
- **Images are pooled by section, not by year** — a section subfolder (e.g. `MT/MT/`,
  `GATE_ESE_Papers/EC/EC/`) holds every processed year's questions for that section
  together, not a year-by-year subfolder tree. This is so a whole section's bank can be
  zipped and handed off as a single unit.
- **Filenames**: `<SUBJECT>_<year>_<section>_<question_no>.png` (some subjects add a
  session suffix, e.g. `EC_2017_S1_GA_001.png` for a year with two GATE sessions).
  `question_no` is 1-indexed *within that year+section*, not the paper's raw/global
  number — see "why order-based numbering" below.
- **`metadata.csv`** — one per subject folder, one row per image, always these ten
  columns: `image_filename`, `relative_path`, `subject`, `year`, `section`,
  `question_no`, `question_type`, `correct_answer`, `marks`, `negative_marks`.
  `relative_path` is relative to this `Question_Bank_Images/` folder. **Exception:
  `CSE/metadata.csv` has an 11th column, `usable` — see the `CSE/` note below and
  `CSE/README.md`.**
- **Order-based (position-based) question numbering, not the printed number.** Source
  PDFs are not always reliable to parse for their own printed number (OCR misreads
  digits, labels in unusual positions). Since each exam's question counts per section
  are fixed and known in advance, every question is instead numbered by its *position*
  in the document, section by section. A misread digit therefore can't corrupt the
  numbering — the code never trusts the digit, only counts occurrences in order.
- **`UNKNOWN` in `correct_answer`** means exactly one thing: the source PDF genuinely
  has no answer for that question (verified by hand against the rendered page, not
  just an extraction-script warning) or no answer key exists anywhere in the supplied
  source materials for that whole paper. It is never a guess or an inference.
- **No effort is spent extracting a paper that has no answer key anywhere in the
  source materials** (no "Answer:" text in the question PDF itself, and no separate
  key document exists for it either) — such papers are skipped entirely and listed by
  name in that subject's own README, so the gap is documented rather than silently
  missing.
- **Descriptive/conventional-answer papers are out of scope for this bank entirely**
  (e.g. ESE Mains Paper I/II) — only objective/MCQ-style papers are processed.

## Subjects in this bank so far

| Folder | Exam(s) | Coverage | Images | metadata rows |
|---|---|---|---|---|
| `MT/` | GATE | Metallurgical Engineering, 2014-2026 (13 years) | 845 | 845 |
| `GATE_ESE_Papers/EC/` | GATE-EC + ESE-ECE-Prelims | GATE 2017 (S1+S2), 2018-2026 + ESE Prelims 2017-2024 | 1,805 (+110 GA) | 1,915 |
| `GATE_ESE_Papers/EE/` | GATE-EE + ESE-EE-Prelims | GATE 2017 (S1+S2), 2018-2026 + ESE Prelims 2017-2024 | 1,805 (+110 GA) | 1,915 |
| `GATE_ESE_Papers/IN/` | GATE-IN | GATE 2018-2026 (9 years) | 495 (+90 GA) | 585 |
| `GATE_ESE_Papers/GS/` | ESE-GS-Prelims | 2017-2020, 2022-2024 (2021 skipped, no answer key) | 700 | 700 |
| `ME/` | GATE | Mechanical Engineering, 2016-2025 (10 years, 16 papers) | 1,010 (880 core + 130 GA) | 1,010 |
| `CH/` | GATE | Chemical Engineering, 2015-2025 (11 years, 11 papers) | 715 (605 core + 110 GA) | 715 |
| `CE/` | GATE + ESE (undated, topic-organized) | Civil Engineering, 8 topics, no year in source | 1,233 | 1,233 |
| `CSE/` | GATE (unverified compilation) | Computer Science Engineering, no year in source | 534 | 534 |

Papers deliberately left out of the bank (no answer key available anywhere in the
source tree — see `GATE_ESE_Papers/README.md` for the full list and reasoning): ESE
GS 2021 Prelims; ESE EC/EE/GS 2025 and 2026 Prelims (all six are also scanned-image
PDFs with no extractable text, so would need OCR on top of having no key to check
against).

`ME/` note: no paper was skipped for this subject (every one of the 16 source files has
a usable answer key), but 3 individual questions across all 1,010 have no usable answer
anywhere in the source and are recorded as `UNKNOWN` — see `ME/README.md`. Also, 3 of
the 16 papers (GATE ME 2017, 2017 Set 2, 2018) structurally contain no General Aptitude
section at all in the supplied source files — not a skip, the source itself never
included one for those years.

`CH/` note: **its source is different in kind from every other subject here, not just
in per-year quirks — read `CH/README.md`'s provenance caveat before trusting its
`correct_answer` column.** The 11 source `.docx` files are a plain reconstruction of
each paper (question text, options, and a `Correct Answer:`/`Solution:` block per
question) rather than a scanned/typeset reproduction of an official paper with an
official printed key, and spot-checking found at least one question (GATE 2015 GA Q.8)
whose printed solution reads as a hedged best-effort reconstruction rather than an
official derivation (though the printed *answer* itself was independently corroborated
in that case). Every question does print an explicit answer, so — unusually for this
bank — no question needed `UNKNOWN`, but the answers should be treated with more
skepticism than any other subject's.

`CE/` note: source is a single 382-page consolidated PDF organized by **topic**, not by
year or exam type, with no year or GATE/ESE marker printed anywhere in it — see
`CE/README.md` for the full explanation. `year`, `marks`, and `negative_marks` are
therefore blank for every row in this subject (a genuine "the source doesn't supply
this," not an extraction gap), and there is no `<year>` segment in its filenames. No
question in this subject required `UNKNOWN` — every section's printed answer key is
complete.

`CSE/` note: **its source is not a real exam paper at all, and its `correct_answer`
column should be trusted less than any other subject in this bank — read
`CSE/README.md`'s provenance caveat in full before using this data.** The source is a
single flat spreadsheet (534 rows, no source PDF) that investigation found to be an
AI-reconstructed compilation rather than a transcription of official papers: 2 rows
explicitly admit missing question text, ~12 rows have a `Solution` column that visibly
disagrees with its own row's `Correct Answer` (the Solution column is ignored entirely
in what's shipped, per an explicit decision for this subject only), and a further chunk
of NAT rows reference a figure/program/matrix that the row describes but doesn't
actually include. Per explicit decision for this subject, **nothing was dropped or
silently fixed** — every row ships, and a new 11th `usable` (yes/no) column (this
subject's only schema deviation from the rest of the bank) flags the **23 of 534 rows**
with a verified content gap; a companion `metadata_review.xlsx` highlights those same 23
rows in red for quick human review. Because there's no source PDF, images here are
**rendered fresh from the spreadsheet text** (PIL/DejaVu Sans) rather than cropped —
the only subject in this bank produced this way. `year`, `marks`, and `negative_marks`
are blank (not in the source); there is no `GA/` split (no General Aptitude section
exists in this source at all); `correct_answer` is `UNKNOWN` for 3 rows (Q97, Q118, Q150
— genuinely no answer given in source).

## Data-quality issues found and fixed (2026-09)

Both issues below were originally flagged here as "not yet fixed." Both have now been
fixed; this section records what was actually wrong (in one case, worse than first
described) and what was done about it, since the fix itself created one permanent,
documented data gap that a consumer of this bank needs to know about.

- **`relative_path` prefix inconsistency — fixed.** `GATE_ESE_Papers/{EC,EE,IN,GS}/
  metadata.csv` were missing the `GATE_ESE_Papers/` prefix and `ME/metadata.csv` was
  missing the `ME/` prefix (and, for its core `ME/ME/` section specifically, was
  missing a second path segment too — its `relative_path` pointed at `ME/<file>.png`
  when the file actually lives at `ME/ME/<file>.png`; GA rows only needed the outer
  `ME/` prefix). All five files now store `relative_path` correctly relative to this
  `Question_Bank_Images/` folder — verified by checking every row's path resolves to a
  real file on disk (0 missing across all five files, 5,355 rows checked).
- **`GATE_ESE_Papers/EC/metadata.csv` and `EE/metadata.csv` duplicate rows — fixed,
  but the root cause was worse than originally described, and the fix has a real,
  unrecoverable gap.** This was first documented as "same image, differing
  `negative_marks`." Investigation for the fix found that's not what was actually
  happening: it's a **filename-collision bug** — GATE-EC/EE 2018-2024 (never
  previously documented as processed at all) was extracted using the same filenames as
  ESE-ECE/EE Prelims' own core-section questions 1-55 for those same years, and
  whichever extraction ran second overwrote the other's image on disk while
  `metadata.csv` kept both rows. In most of the 385 affected pairs per subject, the two
  rows' `correct_answer` genuinely disagreed (not just `negative_marks`) — spot-checked
  against the real GATE answer keys, the row matching the actual image content was
  always the GATE-style one. **Fixed** by keeping only the row that matches each
  image (verified, not assumed) and dropping the other; both files are now 1,530 rows,
  matching their 1,530 images exactly at that point. **Update, same day: the 385
  lost questions per subject were then recovered**, re-extracted from the still-intact
  source PDFs under a new collision-proof filename tag (`ESE_EC`/`ESE_EE`) that can
  never again collide with GATE's own filenames. `EC/metadata.csv` and
  `EE/metadata.csv` are back to their full 1,915 rows each, matching 1,915 real images
  — every recovered answer was cross-checked against the previously-dropped rows
  (766 of 770 matched exactly; the 4 that didn't were each individually resolved, not
  just picked by majority) and a sample was visually spot-checked before delivery, with
  zero filename collisions against the live bank checked before anything was written.
  `dropped_orphaned_ese_rows.csv` is kept next to each subject's `metadata.csv` purely
  as a historical record now — not part of the bank. Full detail on both the original
  bug and the recovery, including several non-standard answer formats found and how
  each was handled without guessing, is in `GATE_ESE_Papers/README.md`'s
  "Filename-collision bug" section.

## Adding a new subject

1. Build the images + `metadata.csv` for the new subject in its own top-level folder,
   following the conventions above.
2. Write that subject's own `README.md` inside its folder (folder tree, filename
   convention, metadata column notes, per-year/per-paper quirks, anything skipped).
3. Come back to **this** file and add a row to the table above, plus a one-line note
   in "papers deliberately left out" if anything for that subject had no answer key.
