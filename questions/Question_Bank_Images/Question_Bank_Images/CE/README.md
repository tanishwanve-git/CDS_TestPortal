# CE (Civil Engineering) — Question Bank Images

Source: a single consolidated file, `ESE and GATE consolidated with answer key.pdf`
(382 pages), from `CDS Test questions\Civil\`.

**This source is structurally different from every other subject in this bank**, and
the pipeline was designed around that difference rather than force-fitting the
year-based template used by `MT/` and `GATE_ESE_Papers/`. The judgment calls made
below are documented so a future session (or a human) can understand why this
folder doesn't look like the others.

## Why this subject doesn't have a year or an exam type

The source PDF is organized **by topic**, not by year or by exam. It contains eight
topic sections, each a block of questions immediately followed by that topic's own
answer key (also plain extractable text, not a table needing OCR). The entire
document was searched for "GATE", "ESE", and "IES" — zero hits. There is no year
printed anywhere either. So, unlike `MT/` and `GATE_ESE_Papers/`, this bank has:

- **no `<year>` in the filename** (dropped rather than invented),
- **`year` left blank** in every row of `metadata.csv`,
- **`marks` and `negative_marks` left blank** in every row — the source has no marks
  scheme printed anywhere (no "2 marks", no negative-marking note, nothing to infer
  from), so rather than assume GATE's or ESE's conventions apply here, these two
  columns are simply empty for the whole subject. This is a genuine "can't supply"
  gap, documented the same way ESE's missing negative-marking scheme is documented
  in `GATE_ESE_Papers/README.md`.

## Folder structure

```
CE/
├── EnvironmentalEngineering/         128 images
├── EngineeringMathematics/            84 images  (Q.13 does not exist — see below)
├── CPM/                              130 images
├── WaterResourcesEngineering/        195 images
├── Surveying/                         80 images
├── Transportation/                   116 images
├── GeotechnicalEngineering/          174 images
├── StructuralEngineering/            326 images
├── metadata.csv                     1,233 rows, one per image
└── README.md                         this file
```

Images are pooled by **section** (here, topic), not by year, same convention as
every other subject in this bank.

### Filename convention

`CE_<section>_<question_no>.png`, e.g. `CE_EnvironmentalEngineering_001.png`. No
`<year>` segment (see above). `question_no` is three-digit zero-padded.

## Numbering: printed label used directly, not pure sequential position

Every other subject in this bank numbers questions by **position**, distrusting the
printed/OCR'd digit, because those sources needed OCR or had unreliable digit
recognition in places. **This source needed no OCR anywhere** — all 382 pages are
plain, digitally-encoded text, and the "Q.N" labels are exact text tokens, not
scanned glyphes. Since the motivating risk (a misread digit) doesn't apply here, and
since one section (see below) has a genuine content gap that *only* the printed
label — not position — resolves correctly, `question_no` for every CE question is
taken directly from its printed "Q.N" label, cross-checked for strict ascending
order across the whole section (flagged if not, understood case-by-case, never
silently trusted). This is the position-vs-label conflict the root README's
numbering rule anticipates, resolved in favor of the label because the label here is
reliable and the position isn't (see next section for why).

**One label formatting inconsistency was found and normalized:** page 90 of the PDF
prints question 100 as `Q100` instead of `Q.100` (missing the period). The label
regex accepts both `Q.N` and `QN` — verified this is the only such occurrence in the
document (every other 3-digit question number uses the period).

### The one genuine content gap: Engineering Mathematics has no Q.13

The Engineering Mathematics question section jumps directly from Q.12 to Q.14 in the
source PDF — Q.13's question text is simply absent from the booklet (confirmed by
reading the rendered pages: page 38 starts mid-way through Q.12's options, continues
into Q.14 with no Q.13 in between). **The answer key still lists an answer for label
13** (`C`), because the key was evidently built from the original 85-question paper
before whatever edit dropped Q.13's text from this consolidated PDF.

This is why label-based numbering was used for all of CE rather than pure sequential
position: if questions were renumbered 1-84 by position, the alignment between
question images and the answer key would silently shift by one for every question
from (physical) Q.14 onward, and the wrong answer would be attached to every
subsequent image. Using the printed label directly keeps every image correctly
paired with its answer-key entry, at the cost of `EngineeringMathematics` having no
`CE_EngineeringMathematics_013.png` file — 84 images numbered 1-12 and 14-85. This
gap is intentional and documented here, not a missing file.

No other section has this issue — every other section's question count matches its
answer key's count exactly, with no gaps (verified programmatically for all 8
sections: labels found in the question text vs. entries in the answer key text).

## What each image contains

One PNG per question: the full question text, any tables/figures, and all four
lettered options `(a)-(d)` as printed, cropped directly from the rendered PDF page(s)
at 200 DPI.

- **The printed "Q.N" / "QN" label is redacted** (painted white), same convention as
  every other subject — the app supplies its own numbering.
- **There is nothing to redact for the correct answer** — CE's answer keys are a
  fully separate section per topic, never printed inline near the question, so no
  in-image answer leakage is possible in the first place.
- A handful of questions run across a page break in the source (a question's stem
  starts at the very bottom of one page and continues at the top of the next, with
  no repeated label). These are detected and **stitched**: the bottom portion of the
  first page (from the label down) and the top portion of the following page(s) (up
  to the next question's label) are rendered separately at 200 DPI and joined into
  one vertical image, so the question reads as a single continuous crop despite
  spanning a page boundary in the source.
- Each crop is auto-trimmed of excess leading/trailing whitespace (a 14px margin is
  kept) after redaction, since blanking the label at the top of a crop, or a question
  ending right at a page's bottom margin, would otherwise leave a large blank band.

## metadata.csv columns

Same ten columns as every other subject (`image_filename`, `relative_path`,
`subject`, `year`, `section`, `question_no`, `question_type`, `correct_answer`,
`marks`, `negative_marks`).

- `subject` is always `CE`.
- `year` is always blank (no year exists anywhere in the source — see above).
- `marks` and `negative_marks` are always blank (no marks scheme printed anywhere in
  the source — see above). If this project later obtains a marks scheme for this
  paper, these two columns can be filled in without touching anything else.
- `question_type` is inferred from the shape of the answer-key entry, since the
  source never prints a "MCQ"/"MSQ"/"NAT" label anywhere: a single-letter answer (or
  an ambiguous `"X or Y"` key — see below) is classed `MCQ`; a comma-separated list of
  letters (e.g. `A,B`) is classed `MSQ`. There are no NAT-style questions in this
  subject — even the fill-in-the-blank-style stems (e.g. "...is ______ MJ/kg") are
  answered by picking a lettered range option, not by typing a number, so every
  question in this subject has lettered options in its image.
- `correct_answer` is copied **exactly as printed** in the topic's answer key,
  including these non-standard forms the source itself uses (never a guess — always
  what the key literally says):
  - Comma-separated multiple letters (e.g. `A,B`, `A,B,D`) for MSQ-style questions.
  - `MTA` ("marks to all" / voided question) — 7 occurrences across the subject.
  - Ambiguous `"X or Y"` keys, where the source itself hedges between two options
    (e.g. `A or D`, `C or D`) — 6 occurrences. One question
    (`StructuralEngineering` Q.276) even hedges between two *option sets*:
    `A,C or A,B,C`. These are preserved verbatim rather than picked arbitrarily.
- **No question in this subject required `UNKNOWN`.** Every section's answer key has
  a complete, unbroken 1-to-N run of entries with no gaps, and every question image
  has a matching answer-key entry (including the Q.13 case above, which is a missing
  *question*, not a missing *answer* — the key still has an answer for label 13,
  it's just that no image numbered 013 exists to pair it with).

## Validation performed

- Every section's question-label count cross-checked against its own answer key's
  entry count — all 8 match exactly (128/128, 85/85, 130/130, 195/195, 80/80,
  116/116, 174/174, 326/326 — Engineering Mathematics shows 85 both times because the
  key has an orphaned entry for label 13, matching the label sequence 1-12,14-85 plus
  the one missing physical question).
- Sequential-order check on every section's labels (position N's label must equal the
  previous label + 1, or be understood and documented if not) — the only exception
  found and understood is the Engineering Mathematics Q.13 gap described above.
- Visual spot-checks of rendered crops across all 8 sections, including: a
  plain single-page question, a question stitched across a page break, a
  "Match the following lists" table question, a mathematical-notation-heavy question
  (square roots, fractions), and a question containing an embedded data table — all
  render correctly and completely, with the "Q.N" label cleanly redacted and no
  leaked answer text (there being none to leak).
- Final image-count reconciliation performed **after** delivery to the user's
  machine: a recursive listing of `Question_Bank_Images/CE/` confirmed exactly 1,233
  PNGs on disk, matching the 1,233 rows in `metadata.csv` and the 1,233 images
  produced by the extraction script, with the correct per-topic split.

## Decisions and rationale (summary)

1. **Topic sections used as `section`** in place of the year-based sections other
   subjects use, since this source has no year/exam axis at all.
2. **`year`, `marks`, `negative_marks` left blank** rather than guessed, since none of
   the three is recoverable from anything in the source materials.
3. **Printed "Q.N" label used as `question_no` directly**, not sequential position —
   the reverse of the other subjects' convention — because this source's labels are
   digitally reliable (no OCR anywhere) and because one section's genuine content gap
   (Engineering Math Q.13) means position-based numbering would silently misalign
   images against answer-key entries from that point forward.
4. **Multi-page question stitching** implemented (not needed in the simpler
   single-page layouts some MT years had) since this source's plain single-column
   flowing text regularly lets a question's stem end at a page's very bottom margin.
5. **Ambiguous/void answer-key values (`MTA`, `"X or Y"`) preserved verbatim**, never
   collapsed to a guess or to `UNKNOWN` — they are genuine printed content, not gaps.
