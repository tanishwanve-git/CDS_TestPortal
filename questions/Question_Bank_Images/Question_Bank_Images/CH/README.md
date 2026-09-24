# CH — Question Bank Images (GATE Chemical Engineering)

Source: GATE Chemical Engineering past papers, 2015-2025 (11 years, one paper per
year — unlike ME there is no multi-session-per-year complication), from
`CDS Test questions\chemical\` (files named `GATE_<year>_brijesh.docx`). GATE-only —
no ESE/IES Chemical Engineering paper exists, so this subject is structured like
`MT/` and `ME/` (GATE-only, section-pooled), not pooled with an ESE counterpart.

## Folder structure

```
CH/
├── GA/                 110 images  (GATE General Aptitude, all 11 years)
├── CH/                  605 images  (GATE Chemical Engineering core, all 11 years)
├── metadata.csv          715 rows
└── README.md             this file
```

Images are pooled by **section**, not by year — same convention as every other
subject in this bank.

### Filename convention

`CH_<year>_<section>_<question_no>.png`, e.g. `CH_2022_CH_035.png`. No session suffix
is needed — every year here has exactly one GATE paper. `question_no` is 1-indexed
within that year+section, assigned purely by **position** in the document (the
Nth question header encountered in reading order becomes question N of its
section) — never the paper's own printed number. This matters because this
source's printed core-section numbering is *not* consistent across years (see
"Continuous vs. restarting numbering" below); position-based numbering absorbs
that inconsistency automatically without any special-casing.

## Source format: this is not a scanned exam paper

Unlike every other GATE-image subject in this bank, this source is a **plain,
cleanly-typed Word document reconstruction** of each year's paper — question text,
options, and a `Correct Answer: ... ` / `Solution: ...` block per question, one
paragraph per line — rather than a faithful page-image reproduction of the
original exam booklet. This made extraction easier in some ways (explicit,
unambiguous boundary markers instead of positional/OCR heuristics) but required
substantially more care in others (see the provenance caveat below, which is the
most important thing in this document).

### docx → PDF conversion

Converted with the same pandoc+xelatex pipeline used for `ME/` (LibreOffice's
`--convert-to pdf` silently drops embedded Office Math/OMML equations — confirmed
present in `GATE_2022_brijesh.docx`, which has 27 `<m:oMath>` elements; the other
10 files have none, but all 11 were run through the same pipeline for consistency):

```
pandoc file.docx -o file.pdf --pdf-engine=xelatex --template=default_template.tex -V mainfont="DejaVu Serif"
```

`default_template.tex` is pandoc's own default LaTeX template (`pandoc -D latex`)
with the `\usepackage{lmodern}` line stripped (not installed, network-blocked) —
same fix as `ME/`. **One addition beyond the `ME/` pipeline**: `-V mainfont="DejaVu
Serif"` was necessary here. Without it, xelatex's default font silently rendered
many Unicode symbols used throughout this source (≈, π, ζ, τ, φ, θ, superscript
minus signs in exponents like `s⁻¹`) as blank glyphs / the Unicode replacement
character (U+FFFF) in the extracted PDF text — invisible in some cases, wrong in
others. Switching to DejaVu Serif (which has full Greek + math-symbol coverage)
fixed this cleanly; confirmed by re-extracting all 11 PDFs and checking for stray
U+FFFF characters (none remain, except legitimate math-alphanumeric codepoints
inside 2022's OMML equations, which are correct content, not a rendering defect).

**Because of this same font/glyph-mapping risk, `correct_answer` and
`question_type` in `metadata.csv` were sourced directly from the original `.docx`
text via `python-docx`, not from the rendered-PDF text extraction.** The PDF is
used only for image geometry (crop boundaries). This was cross-validated: two
independent extraction pipelines (PDF-word-position-based and
docx-paragraph-based) were built and run against all 715 questions, and after
fixing two bugs found by the cross-check (see "Bugs found and fixed" below), they
agree exactly on question type and answer for all 715 rows.

## Two header-format eras, one extractor

- **Format A (2015, 2016, 2017, 2018, 2022, 2023, 2025 — 7 files)**:
  `Q1. [General Aptitude | 1 Mark | MCQ]` — 2015-2018 print `1 Mark`, 2022/2023/2025
  print `1 Mark(s)`; both tolerated by the same regex. The question type (MCQ /
  MSQ / NAT) is given explicitly in the bracket tag and is trusted directly.
- **Format B (2019, 2020, 2021, 2024 — 4 files)**: `Q.1 (General Aptitude — 1 mark)`
  — often has no explicit type tag, but frequently does (e.g. `Q.36 (Chemical
  Engineering — 2 marks, NAT)`); when present it is trusted, otherwise the type is
  inferred from the number of `(A)`/`(B)`/... letters found in the answer text (2+
  letters → MSQ, exactly 1 → MCQ, 0 → NAT), matching the `ME/` pipeline's
  options-presence fallback idea but keyed off the answer rather than the
  question body, since a small number of questions have image-only options with
  no printed `(A)`/`(B)` lines in the text at all (see GATE 2021 GA Q.4 below).

Question-start regex matches both `^Q\d+\.\s*\[` and `^Q\.\d+\s*\(`, gated on the
digit being immediately followed by the format's own bracket/paren so that the
"`Q.1 to Q.5 carry 1 mark each | Q.6 to Q.10 carry 2 marks each`" instructional
line (present at the top of each section in Format-A years) never false-matches
as a question header.

The crop-stop marker is unusually unambiguous in this source: every question ends
its options block with a line starting `Correct Answer:` (tolerant of a missing
colon, a missing space, and — because a page-break can literally split the two
words `Correct` / `Answer:` onto different pages — a marker spanning a page
boundary), immediately followed by a `Solution:` paragraph (often several lines,
sometimes with its own figures) before the next question starts. Because
explanatory content follows the answer, the crop always stops **before** the
answer line (never redacts it after the fact) — the same "crop stops before the
answer" design as `ME/`'s 2021+ papers. The crop boundary is anchored to the
*bottom of the last content word before* the answer marker, not the top of the
answer marker's own line, specifically to avoid a single-pixel sliver of the
answer text leaking in at the very bottom edge of the image (an early build of
the extractor had this bug; caught and fixed during visual QA — see below).

**The printed question-number label is redacted** (painted white) — e.g. `Q1.` or
`Q.1` at the very start of a question's own image is blanked out, matching the
convention used for every other subject (the app supplies its own numbering).
Nothing else needs redacting, since the answer/solution are excluded from the
crop entirely rather than painted over.

**Multi-page questions**: many questions (roughly a quarter of them, more in
years with heavier figure content) span a PDF page break. The crop stitches the
bottom portion of the starting page and the top portion of the ending page into
one tall composite image via PIL, the same approach `ME/` used.

## Continuous vs. restarting numbering — verified per-year, not assumed

Nine of the eleven years (2015, 2017, 2019, 2020, 2021, 2022, 2023, 2024, 2025)
print the core Chemical Engineering section's numbering *continuing* straight
from GA — GA is Q1-Q10, core continues Q11...Q65 with no reset. **Two years,
2016 and 2018, instead restart the core section's printed numbering at Q1**
(confirmed directly from the source text: `— CHEMICAL ENGINEERING —` is
immediately followed by `Q1.` in these two years, not `Q11.`). This is the
opposite of what a same-source-family assumption would predict, and is called
out here specifically because it was initially assumed (based on a general
description of this source) that *all* 11 years continue without restarting;
checking each year individually turned up the exception. It has **no effect on
the delivered data**, because `question_no` is assigned by position, not by
parsing the printed digit — the extractor counts the Nth header found after the
10th (GA) header as the section's own question N regardless of what number the
source printed on it. The printed number is not even used as a rebasing
reference; position alone determines the final 1-55.

## Answer formats and how `correct_answer`/`question_type` are derived

| Printed shape | `question_type` | `correct_answer` |
|---|---|---|
| `Correct Answer: (B) memento` | MCQ | the letter only: `B` |
| `Correct Answer: (B) and (D)` / `(A), (B), and (D)` / `(B and (D)` (source typo, missing `)`) | MSQ | comma-joined letters: `B,D` / `A,B,D` |
| `Correct Answer: 7` | NAT | `7` |
| `Correct Answer: 309 to 311  (≈ 310 K)` | NAT | full text verbatim, including the tolerance range: `309 to 311  (≈ 310 K)` |
| `Correct Answer: (A) [pattern A]` (image-only options, e.g. GATE 2021 GA Q.4, a folded-paper-punch pattern question) | MCQ | `A` — a single lettered answer is treated as MCQ even when no `(A)`/`(B)` option lines were found in the question body, since the options are figures rather than text |
| `A,B,C,D. Marks to all according to the Answer Key.` (GATE 2016 CH Q.53, one occurrence in all 11 years) | keeps its tagged type (MCQ) | literal `MTA` |

**Unlike `ME/`, NAT answers here were expected (per the initial task brief) to be
exact point values with no tolerance range, on the theory that this source was
typed fresh rather than transcribed from an official range-based key.**
Investigation did not bear this out: a meaningful number of NAT answers *do*
carry an explicit range or an "accepted range" annotation (e.g. GATE 2017 Q.19
`16,000 Rupees (15900 to 16100)`, GATE 2018 Q.24 `≈ 0.184 (accepted range: 0.170
to 0.200)`, GATE 2023 Q.57 `0.982,0.003 (0.002 to 0.004 OR 0.981 to 0.983)`). So
the `ME/`-style convention was kept instead: **the full raw answer text is
preserved verbatim for NAT questions**, not reduced to a single leading number —
this is a strict superset of "just the number" for the years where that's all
there is, and avoids silently discarding real tolerance information for the
years where there's more.

**`marks`/`negative_marks`** follow the same GATE positional convention as every
other subject: for the 10-question GA section, 1-5 are 1 mark and 6-10 are 2
marks; for the 55-question core section (using the position-based 1-55
numbering), 1-25 are 1 mark and 26-55 are 2 marks — cross-checked against the
explicit per-question mark tags in every Format-A year and found consistent.
`negative_marks = marks / 3` (rounded to 2 dp) for MCQ, `0` for MSQ/NAT and for
the one MTA question (marks-to-all means nobody is penalized).

## Bugs found and fixed during extraction (documented for the next session)

Two independent extraction pipelines were built (PDF-word-position-based, for
image cropping; docx-paragraph-based, for answer text) and cross-validated
against each other question-by-question. This caught three real bugs before any
image was finalized:

1. **False-positive answer-marker detection** (PDF pipeline): an early matcher
   flagged any word starting with "correct" followed within two words by
   anything containing "answer" as the `Correct Answer:` marker. This
   false-matched ordinary prose like *"Question A was **correctly answered** by
   3,30,000 candidates"* inside a GATE 2018 GA reading-comprehension question,
   causing that question's crop to truncate after only the first sentence.
   Fixed by requiring an exact token match (`correct` as its own word, followed
   by `answer` as its own word) rather than a substring/prefix match.
2. **Answer-sliver leak at the crop's bottom edge**: the very first version of
   the cropper stopped at *"top of the answer line + a few pixels of padding"*,
   which let a thin sliver of the actual answer text peek into the bottom edge
   of the image (confirmed visually, e.g. on GATE 2015 CH Q.55, where `(D) LTS
   reactor is followed by HTS reactor` was partially legible at the very
   bottom). Fixed by anchoring the crop's bottom edge to the *bottom of the
   last content word before* the answer marker instead, with padding added only
   on that side — verified by re-inspecting the same image afterward.
3. **A single-letter MSQ answer with a missing closing parenthesis** (source
   typo, not an extraction bug): GATE 2023 CH Q.29's `Correct Answer: (B and
   (D)` is missing the `)` after `B`, so the original letter-extraction regex
   (which required both parentheses) only found `D`, losing the `B`. Fixed by
   making the closing parenthesis optional in the extraction regex, verified
   against all 16 MSQ questions across all 11 years to confirm no other
   instance of this or a similar malformed answer exists.

## ⚠️ Provenance and trustworthiness caveat — read this before trusting `correct_answer`

**This is the most important thing in this document, and it is different from
every other subject in this bank.** Every other subject's source PDF is a
genuine scanned/typeset reproduction of an official paper with an official
printed answer key. This source is not that: its own subtitle claims "Questions
verbatim from the official paper, with Correct Answers & Detailed Solutions",
but it reads as a **reconstruction** — the Solution text for some questions is
visibly weaker than an official key would be. The clearest example, investigated
directly: **GATE 2015 GA Q.8**, a "fill in the missing value" pattern-completion
question built around a diamond arrangement of numbered circles. The source's
own printed solution hedges and gives inconsistent reasoning — it trails off
with phrasing like *"...or by symmetry of the diamond, the middle value = 1+2 =
3, or by pattern of sums..."* rather than one clean derivation, which reads like
a best-effort reconstruction rather than a transcription of a real official
solution.

**This specific example was spot-checked against an independent source** (a
third-party worked solution for the equivalent 2015 GA question, which is shared
verbatim across multiple GATE branch papers in the same session) and the
printed answer, `3`, was independently corroborated — with the reasoning "middle
element of each row = sum of the other elements in that row, divided by 2"
giving the same result. So in this particular flagged case, the *answer* held up
even though the *solution text* looked shaky. A handful of other spot-checks
(a General Aptitude quantitative-reasoning question verified by direct
computation, and a Chemical Engineering conceptual question on water-gas-shift
converter staging — HTS-then-LTS — verified against standard process
sequencing) also corroborated the source. This is a small sample, not a full
audit, and should not be read as blanket confirmation.

**What this means in practice**: the vast majority of this subject's 715
questions are ordinary textbook-style problems with clean, checkable
derivations, and are very likely fine. But because this source was
reconstructed rather than transcribed from a scanned official answer key the
way every other subject in this bank was, **`correct_answer` in this subject's
`metadata.csv` should be treated with more skepticism than in any other subject
here** — particularly for questions that depend on a figure/diagram the
reconstructor may have lacked faithful access to. Every `Correct Answer:` value
was extracted and recorded exactly as given (715 of 715 — no value was
second-guessed or dropped), because silently discarding a source-provided answer
would be a worse data-integrity problem than an occasional wrong one. Embedded
figures were also spot-checked for coverage: each of the 11 source files
contains 15-21 embedded images, and the count of figure-referencing question
lines roughly tracks the embedded-image count per file, suggesting most
figure-dependent questions do have their actual diagram included rather than
just a text description — but this was not verified figure-by-figure across all
715 questions.

## Genuinely missing answers: none

Every one of the 715 questions across all 11 years prints an explicit `Correct
Answer:` line (confirmed both by the PDF-word-position pipeline and
independently by the docx-paragraph pipeline, with zero disagreements after the
bug fixes above) — so, unusually for this bank, **no question required an
`UNKNOWN` fallback**. This is expected given the source's own design (every
question was apparently given a reconstructed answer, for better or worse — see
the provenance caveat above, which is the more relevant caution for this
subject than the usual "is an answer present at all" question).

## Verification performed

- Every one of the 11 papers was checked for exactly 65 questions (10 GA + 55
  core) with no missing or duplicate printed question numbers, via two
  independently-built extraction pipelines that were cross-validated against
  each other question-by-question (715/715 agreement after fixing the three
  bugs listed above).
- Per-year, per-section image counts (110 GA + 605 CH = 715) were reconciled
  against `metadata.csv`'s row count and against a full recursive listing of
  the delivered folder — exact match, zero filename collisions, zero missing
  files.
- A sample of crops was visually inspected across both header-format eras,
  multi-page-spanning questions, MSQ questions, the one MTA question, and the
  originally-flagged GATE 2015 GA Q.8 figure question, to confirm no answer
  text leaks into any image and no question text is truncated.
