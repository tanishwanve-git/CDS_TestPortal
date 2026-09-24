# CSE — Question Bank Images (GATE Computer Science Engineering)

Source: `cse/GATECSEPYQ.xlsx`, a single flat spreadsheet (534 rows: `Q.No`, `Question`,
`Option A`-`D`, `Correct Answer`, `Solution`; sheet name is literally `main.csv`) with
**no year, exam session, section, or marks data anywhere in it**. This subject is
structurally different from every other subject in this bank and the differences below
are load-bearing — read this whole file before trusting or building on this data.

## Read this first: provenance caveat

Prior investigation of this file (before extraction began) found it is not a
transcription of real official GATE papers, but an **AI-reconstructed compilation**,
with concrete, verified problems:

- **2 rows explicitly admit missing question text** in the source itself (Q97: *"Missing
  question text from PDF, appears to be incomplete"*; Q118: *"Missing question"*).
- **A meaningful number of NAT-style rows reference a C program, figure, diagram, or
  matrix/graph that the row describes in words but doesn't actually include** — the
  question asks the reader to compute something from an artifact that was never
  transcribed into the spreadsheet, only paraphrased.
- **Roughly a dozen rows have a `Solution` column that visibly disagrees with the row's
  own `Correct Answer`** — the reconstruction's own worked derivation reaches a different
  value than the stated answer, before hedging/deferring to it anyway (e.g. "the correct
  answer is stated as C, though my derivation gives D").

Per an explicit user decision made for this subject (and only this subject — no other
subject in this bank has been handled this way), **none of this was fixed or dropped**.
The three strategic decisions in effect here:

1. **Every row ships**, including the ones with known problems. A new `usable` column
   (see below) flags which ones have a verified content gap, rather than silently
   dropping or "fixing" them.
2. **The `Solution` column is ignored entirely.** `correct_answer` is taken verbatim from
   the `Correct Answer` column only — the Solution text's own hedging/self-contradiction
   plays no role in what's shipped, is not reproduced anywhere in the output, and was not
   used to override or second-guess any stated answer.
3. **Images are rendered fresh from the spreadsheet text**, not cropped from a source
   PDF — this is the only subject in the whole bank with no source PDF at all (see
   "Image rendering" below).

**Treat every `correct_answer` in this subject with more skepticism than any other
subject in this bank**, even for rows marked `usable = yes` — the Solution-column
disagreements above show the source data itself is not fully self-consistent, and
`usable = yes` only means the question has enough information to be answerable, not that
the stated answer has been independently verified.

## Folder structure

```
CSE/
├── CSE/                    534 images (all questions — no GA/section split; this
│                            source has no General Aptitude section at all)
├── metadata.csv            534 rows, 11 columns (10 standard + usable)
├── metadata_review.xlsx    same 534 rows, with every unusable row's whole row
│                            highlighted red — a human-scannable review copy
└── README.md                this file
```

Unlike every other subject, there is no `GA/` folder — this source is 100% core CSE
questions with no General Aptitude section present anywhere in it.

### Filename convention

`CSE_<question_no>.png`, e.g. `CSE_042.png`. `question_no` is the source spreadsheet's
own `Q.No` column (1-534, confirmed sequential with no gaps or duplicates before
extraction), zero-padded to 3 digits. There is no year or session segment in the
filename — the source has none.

## The `usable` column (a schema deviation from the rest of the bank)

This is the only subject in the bank with an 11th metadata column. `usable` is `yes` or
`no` for every row. A row is `usable = no` when its question text does not actually
contain enough information to answer it — specifically:

- the source explicitly marks the question text as missing (Q97, Q118), or
- (NAT questions only) the question references a figure, diagram, table, matrix, graph,
  or program that is described but not actually included/given values in the row.

**23 of 534 rows are flagged `usable = no`.** Full list with reasons:

| Q.No | Reason |
|---|---|
| 42, 96, 138, 139, 176, 180, 323, 361, 372, 373, 394, 444, 445, 479, 480 | references a C program/code segment not included in the row |
| 77, 172, 391 | references a figure/diagram/graph/table not included in the row |
| 199, 420, 471 | names a matrix/graph/tree but gives no values for it in the row |
| 97, 118 | explicitly marked missing in the source |

This was derived with a regex-based classifier, iteratively tuned against manual spot
checks to avoid two failure modes: under-flagging (e.g. an early version missed
`"B+ tree index of order 1 shown."` because it didn't match the initial narrower
phrasing) and over-flagging (a naive "matrix/graph named by a single letter" rule
initially mis-flagged self-contained questions like *"Two eigenvalues of 3×3 real matrix
P are 2+√-1 and 3. Determinant of P?"* — which does supply real values despite naming the
matrix by a bare letter; fixed by only flagging a bare-named matrix/graph/tree when the
question also contains **no digits at all**, i.e. truly gives no values for it).

This heuristic was spot-checked against a meaningful sample, not against all 534 rows
individually — a false negative (an unflagged row that actually can't be answered) or a
false positive (a flagged row that's actually fine) is possible in the remainder. Treat
`usable` as a strong signal, not a guarantee.

**23 flagged rows out of 534 (~4.3%) still get an image rendered and a metadata row
written** — they are not excluded from the counts anywhere in this bank's totals. A
consumer of this data should filter on `usable == "yes"` if it wants only the verified-
answerable subset.

### `metadata_review.xlsx`

A second deliverable, requested specifically for this subject: the same 534 rows as
`metadata.csv`, as an Excel workbook, with every `usable = no` row's entire row filled
red. This exists purely so a human reviewer can scan the sheet and immediately see which
questions have a known content gap, without needing to read or filter the `usable`
column text itself. It is a review copy, not an alternate source of truth — `metadata.csv`
is still the canonical file an app should read.

## Image rendering (no source PDF — a first for this bank)

Every other subject's images are 200-DPI crops of a real source PDF page. **This subject
has no source PDF at all** — the spreadsheet is the only source — so images are instead
rendered fresh from the spreadsheet's own text, via PIL (`ImageDraw`/`ImageFont`,
DejaVu Sans, 1200px wide, word-wrapped). Question text is rendered first, then (for MCQ
rows) the four lettered options `(A)`-`(D)`; NAT rows render a plain "Answer: ______"
placeholder line where the app's own numeric input goes.

The "correct answer never appears in the image" contract that holds everywhere else in
this bank is satisfied here too, just by a different mechanism: instead of cropping
around or redacting an answer line, the renderer simply never includes `Correct Answer`
or `Solution` text in what it draws — there is no answer text anywhere in the source
region being rendered, so there's nothing to redact.

Rendering was visually spot-checked across MCQ and NAT rows and rows containing unicode
math notation (√, ×, ≥, ∞, Σ, superscripts written inline as `x^(1/x)`, etc. — DejaVu Sans
renders all of these cleanly) before being run at full scale across all 534 rows.

## A data-corruption bug found and fixed: Excel's silent date coercion

**8 option cells across 3 questions (Q207, Q298, Q344) were silently reinterpreted by
Excel as `datetime` objects** at some point before this file reached this project —
fraction-like option text such as `"4/5"` got auto-converted to a date on save, so what
openpyxl reads back is `datetime.datetime(2026, 4, 5, 0, 0)` instead of the string `"4/5"`.

This was recoverable losslessly: the datetime's month and day are exactly the two
numbers that were originally typed (Excel's default locale parses `M/D`), which was
verified against the other, uncorrupted sibling options in the same rows — e.g. Q344's
full four-option set was clearly a family of `M/D`-style fractions (`4/5`, `5/6`, `7/8`,
`11/12`), all parsing consistently under the same month/day interpretation. All 8 cells
were fixed by reconstructing `f"{val.month}/{val.day}"` from the corrupted datetime
before rendering.

## No MSQ questions in this dataset

Every question in this source is either MCQ (single-letter answer, options A-D present)
or NAT (numeric/short answer, no options). A regex scan of the entire `Correct Answer`
column found no multi-letter answers, so `question_type` here only ever takes the values
`MCQ` (311 rows) or `NAT` (223 rows) — `MSQ` does not occur.

## Blank `year`, `section`-is-constant, and blank `marks`/`negative_marks`

Same reasoning as `CE/`: the source genuinely doesn't supply this information anywhere,
so these columns are left blank/constant rather than guessed:

- `year` — blank for every row. No year or exam session is stated anywhere in the source.
- `section` — always `CSE` (constant). There is no sub-sectioning in the source (no GA,
  no per-topic split) to record.
- `marks` / `negative_marks` — blank for every row. No per-question marks scheme is
  printed anywhere in the source spreadsheet.

## Final counts

- 534 total rows / 534 images (1:1, no gaps or duplicate `Q.No` in the source).
- 311 MCQ, 223 NAT, 0 MSQ.
- 511 `usable = yes`, 23 `usable = no` (see table above).
- 8 option cells recovered from Excel date-coercion corruption (Q207, Q298, Q344).
- `correct_answer` is `UNKNOWN` for 3 rows, following the same bank-wide convention as
  every other subject (the source genuinely has no answer for that question):
  - **Q97, Q118** — the same two rows flagged `usable = no` above for missing question
    text; their `Correct Answer` cell is also blank/`-` in the source.
  - **Q150** — question text is self-contained (`usable = yes`: *"Integral of f(x) given
    af(x)+bf(1/x)=1/x-25"*), but the source's `Correct Answer` cell is literally `-` with
    no value at all — a genuinely missing answer key for an otherwise fine question,
    same as the `UNKNOWN` cases documented in `ME/README.md` and elsewhere in this bank.
