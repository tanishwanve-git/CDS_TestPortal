# ME — Question Bank Images (GATE Mechanical Engineering)

Source: GATE Mechanical Engineering past papers, 2016-2025 (10 years, 16 papers total —
several years had multiple GATE sessions), from `CDS Test questions\ME\`. GATE-only —
no ESE/IES Mechanical Engineering paper exists, so unlike `EC`/`EE` this subject is not
pooled with an ESE counterpart, and is structured the same way as `MT/` (GATE-only,
section-pooled).

## Folder structure

```
ME/
├── GA/                 130 images  (GATE General Aptitude, all 16 papers)
├── ME/                 880 images  (GATE Mechanical Engineering core, all 16 papers)
├── metadata.csv       1,010 rows
└── README.md           this file
```

Images are pooled by **section**, not by year — same convention as every other subject
in this bank.

### Filename convention

`ME_<year>[_<session>]_<section>_<question_no>.png`, e.g. `ME_2022_ME_035.png` (2022 had
only one GATE session, so no session tag) or `ME_2016_S1_GA_004.png` (2016 had three
GATE sessions/papers, so `S1`/`S2`/`S3` disambiguates). Years with more than one source
paper: 2016 (S1/S2/S3), 2017 (no tag + S2), 2019 (S1/S2), 2020 (S1/S2), 2021 (S1/S2).
`question_no` is 1-indexed within that year+session+section, matching the project-wide
order-based numbering convention (see below) — never the paper's own printed number,
which in a few years' core sections isn't even 1-indexed in the first place (see
"Continuous vs restarting numbering").

## Source format and the docx→PDF conversion problem

Unlike every other subject in this bank, ME's source files are **`.docx`, not PDF** —
16 Word documents, one per paper. They needed converting to PDF before the same
pdfplumber/pdf2image extraction pipeline used everywhere else could run.

**LibreOffice's own `--convert-to pdf` silently drops every embedded equation.** These
docx files use embedded Office Math (OMML) for essentially all mathematical notation,
and LibreOffice's PDF export renders every one of them as blank space — confirmed by
visual inspection of the rendered pages (equations render as gaps) and by inspecting the
raw `document.xml`, where the OMML markup is present and well-formed. This wasn't a
one-off: it reproduced identically via a direct `--convert-to pdf`, via a double
conversion through an intermediate `.odt`, and under `xvfb-run`.

**Fix**: convert via pandoc instead, through LaTeX:
```
pandoc file.docx -o file.pdf --pdf-engine=xelatex --template=default_template.tex
```
`default_template.tex` is pandoc's own default LaTeX template (`pandoc -D latex`) with
the `\usepackage{lmodern}` line stripped out — the `lmodern` package isn't installed in
the environment this was built in and couldn't be installed (network-blocked), and
pandoc's default template fails without that line removed. This pipeline renders every
equation and figure correctly. All 16 PDFs were produced this way before extraction.

(A separate theory — that oversized embedded images were inflating page counts in the
2021+ papers — was investigated and ruled out: resizing the embedded JPGs to a fraction
of their original size and reconverting produced an identical page count. The large page
counts in 2021+ papers are genuine content — full worked solutions after every answer,
see below — not a rendering artifact.)

## Two source-format eras, one extraction pipeline

The 16 papers split into two distinct formats, handled by one flexible extractor
(`section_specs`/regex-tolerant rather than two separate scripts):

- **2016-2020 ("old" format)**: bare `N.` question numbering, `Answer: (X)` printed
  immediately after the question's options with **no further text after it** — the same
  shape as every other GATE subject in this bank. Section headers are literal text lines
  `General Aptitude` / `Mechanical Engineering`.
- **2021-2025 ("new" format)**: `Q. N` question numbering, `Ans. (X)` printed
  immediately after the options, **followed by a full multi-paragraph worked solution**
  (sometimes with its own figures) before the next question starts. Section headers are
  `SECTION-A GENERAL APTITUDE` / `SECTION-B TECHNICAL` (2021-2022) or
  `SECTION - A GENERAL APTITUDE` / `SECTION - B TECHNICAL` with spaces around the dash
  (2023-2025) — both tolerated by the same header regex.

**Because the 2021+ era has explanation text (and sometimes images) *after* each
question's answer line**, the image crop stops at the **top of the answer line itself**,
not at the next question's start (the reverse of the old-format papers, where nothing
followed the answer and the crop can safely run to the next question). This also means
**no redaction of the answer text is needed** for any ME paper — the answer is simply
never included in the crop in the first place, unlike ESE Prelims where the answer had
to be painted over.

**The printed question-number label is redacted** (painted white), matching the
convention used for every other subject — e.g. `Q. 4` or `16.` at the very start of a
question's own image is blanked out (the app supplies its own numbering). This is
best-effort: a handful of 2021+ questions had their `Q.` and number fused directly onto
the next word with no space between them (a pandoc/xelatex rendering quirk on some
pages, see below) — in those specific cases the label is left unredacted rather than
risk painting over real question text with an imprecise guess at the boundary. This
affects a small minority of images; spot-checked and judged an acceptable trade-off
(showing the source's own original question number is a much smaller information leak
than the correct answer would be, and it's still not the app's own numbering).

**Multi-page questions**: a single question's content (frequently a large figure in the
2021+ era, e.g. GATE 2021 Set 1 Q.4's jigsaw-puzzle options spanning 4 pages) can span
more than one PDF page. The crop function stitches these into one tall composite image
via PIL rather than truncating at the page boundary.

## Continuous vs. restarting numbering (a real per-year quirk, not a bug)

In most years the core section's printed numbering **restarts at 1** after the GA
section (GA prints 1-10, core separately prints 1-55). **GATE 2022, 2023, and 2025
instead continue the GA section's numbering into the core section** — GA prints 1-10,
and the core section continues immediately with 11, 12, ... 65, never resetting to 1.
Confirmed directly from the source text (`SECTION-B TECHNICAL` is immediately followed
by `Q. 11` in these three years, not `Q. 1`). GATE 2024, despite being from the same
"new" format era, **does** restart at 1 like most other years — confirmed the same way.

This is handled without a separate code path: the extractor's per-section spec takes an
optional "starts at" printed number (defaults to 1), and whatever the source prints, the
**stored `question_no` in the filename and CSV is always re-based to 1-55 within its own
section** — so this source quirk is fully absorbed during extraction and is invisible in
the delivered data. It's noted here only so a future session touching this pipeline
understands why the extractor has that parameter.

## Answer-key formats and how `correct_answer`/`question_type` are derived

GATE ME answers appear in several different printed shapes across the 10 years, and
**the full text is preserved rather than reduced to a single number**, since GATE NAT
(numerical-answer) questions are graded against a tolerance *range*, not an exact value
— collapsing e.g. `(96) (95.999 to 96.001)` down to just `96` would throw away real
scoring information an app would need. Shapes seen and how each maps to
`question_type`/`correct_answer`:

| Printed shape | Era | `question_type` | `correct_answer` |
|---|---|---|---|
| `Answer: (C)` / `Ans. (c)` | both | MCQ | the letter, uppercased: `C` |
| `Ans. (a, b)` | 2021+ | MSQ | comma-joined uppercase letters: `A,B` |
| `Answer: (60 to 61)` | 2016-2020 | NAT | the range verbatim: `60 to 61` |
| `Ans. 11.3 (11.2 to 11.4)` | 2021-2022 | NAT | verbatim: `11.3 (11.2 to 11.4)` |
| `Ans. (96) (95.999 to 96.001)` | 2023-2025 | NAT | verbatim: `(96) (95.999 to 96.001)` |
| `Ans. (7)` | any | NAT | the number: `7` |
| `MTA` / `(Marks to all)` | any | (question's own type) | literal `MTA` |
| `(31) (not matching with IIT key)` | 2017 | NAT | verbatim, including the caveat |
| *(no answer line at all)* | rare | inferred from options present | `UNKNOWN` |

`MTA` ("Marks to All") is preserved literally, never resolved to a guessed letter — same
convention as every other subject in this bank. `question_type` for an MTA question is
still derived from whether the question itself printed lettered options (MCQ) or not
(NAT), since MTA can apply to either.

**`marks`/`negative_marks`** follow the same GATE positional convention used everywhere
else in this bank: for a 10-question GA section, questions 1-5 are 1-mark and 6-10 are
2-mark; for the 55-question core section, 1-25 are 1-mark and 26-55 are 2-mark.
`negative_marks = marks / 3` for MCQ, `0` for MSQ/NAT/MTA.

## Genuinely missing answers (3 questions, hand-verified)

A tiny number of questions across all 1,010 have **no usable answer printed anywhere in
the source** — confirmed by reading the rendered page directly, not just an
extraction-script warning:

- **GATE ME 2019 Set 2, GA Q.4** — the question and its four options print normally, but
  no `Answer:` line follows before Q.5 begins. `correct_answer = UNKNOWN`.
- **GATE ME 2022, Q.35** (core section) — the full worked solution is printed (several
  lines deriving the result), but the source never states an explicit `Ans. (X)` line
  for this one question. `correct_answer = UNKNOWN`.
- **GATE ME 2017 Set 2, Q.40** (core section) — the source's own answer line reads
  literally `Answer: Answer is not matched with IIT Key`, with no numeric value at all
  (contrast with GATE ME 2017 Q.34, `Answer: (31) (not matching with IIT key)`, which
  *does* give a value alongside the same caveat and is kept as `31`, not treated as
  missing). `correct_answer = UNKNOWN`.

No paper for this subject had to be skipped entirely — every one of the 16 source files
has a usable answer key for the overwhelming majority of its questions.

## GA-less papers (2017 and 2018 — a structural source gap, not a skip)

**GATE ME 2017 and GATE ME 2017 Set 2 and GATE ME 2018 contain no General Aptitude
section at all** — confirmed by searching the full extracted text of each file for
"General Aptitude"/"SECTION-A" and finding zero matches; each of these three files
begins directly with `Mechanical Engineering` / `Q. No. 1-25 Carry One Mark Each` and
contains only the 55-question core section. This isn't a skip or an extraction gap —
these three `.docx` source files genuinely never included a GA section to begin with
(GATE ME's GA questions for those years may have been distributed as a separate booklet
that simply isn't among the files in `CDS Test questions\ME\`). `GA/` therefore has no
images at all for 2017 (either session) or 2018; `ME/` has the full 55 for each.

## Verification performed

Every one of the 16 papers was checked for exact expected question counts (10 GA + 55
core where GA exists, 55 core-only for the three GA-less papers) with no missing or
duplicate question numbers before being accepted. Every extraction-script warning
(missing answer, missing question number) was individually investigated against the
actual rendered page text — not just logged — before being recorded as `UNKNOWN`,
following the same standard used for every other subject in this bank. A full recursive
listing of the delivered `ME/` folder was reconciled against `metadata.csv`'s row count
(1,010 images, 1,010 rows, zero filename collisions) as the final step before declaring
this subject done.
