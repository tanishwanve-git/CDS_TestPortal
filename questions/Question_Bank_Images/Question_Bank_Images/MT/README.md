# MT (Metallurgical Engineering) — Question Bank Images

Source: GATE MT past papers, 2014–2026 (13 years), from `CDS Test questions\MT\`.

## Folder structure

```
MT/
├── GA/                 130 images  (13 years x 10 General Aptitude questions)
├── MT/                 715 images  (13 years x 55 Metallurgical Engineering questions)
├── metadata.csv         845 rows, one per image
└── README.md            this file
```

Images are pooled by **section**, not by year — `GA/` and `MT/` each hold every year's
questions for that section together, rather than a year-by-year subfolder tree. This is
so a whole subject's General Aptitude bank, or its whole core-subject bank, can be
zipped and handed off as a single unit.

### Filename convention

`MT_<year>_<section>_<question_no>.png`, e.g. `MT_2019_MT_034.png` =
GATE 2019, MT section, locally-numbered question 34 (1-indexed within that year+section,
not the paper's raw/global question number).

## What each image contains

One PNG per question: the full question text, any figures/diagrams/graphs, and all
answer options (for MCQ/MSQ), cropped directly from the source PDF page(s) at 200 DPI.

- The printed question-number label (e.g. "Q.34", "Q.No. 34") is **redacted** (painted
  white) since the app renumbers questions itself.
- The **(A)/(B)/(C)/(D) option letters are preserved** in the image — only the leading
  "Q.n" label is blanked, never the option markers, since the app's own UI adds plain
  radio buttons/inputs below the image and needs those letters to still read naturally
  alongside them.
- NAT (Numerical Answer Type) questions have no options in the image at all — just the
  question stem and figures; the app is expected to render a blank text input for these.

## metadata.csv columns

| Column | Meaning |
|---|---|
| `image_filename` | Base filename of the cropped image, matches the file in its section folder. |
| `relative_path` | Path relative to `Question_Bank_Images/`, e.g. `MT/MT/MT_2019_MT_034.png`. |
| `subject` | Always `MT` in this file. |
| `year` | GATE year (2014–2026). |
| `section` | `GA` or `MT`. |
| `question_no` | 1-indexed position of the question within its year+section (not the paper's raw global number). |
| `question_type` | `MCQ`, `MSQ`, or `NAT`, as printed in that year's official answer key. |
| `correct_answer` | The option letter(s) for MCQ/MSQ (comma-separated if multiple, e.g. `B,C`), or the numeric value/range for NAT. `MTA` (Marks-to-All, GATE's marker for a dropped/ambiguous question) is preserved as-is when that's what the key says. |
| `marks` | Marks awarded for a correct answer (1 or 2, per the official key). |
| `negative_marks` | Marks deducted for a wrong answer. MCQ: `marks / 3` (GATE's standard 1/3 penalty). MSQ and NAT: `0` (GATE does not negative-mark these). Any question marked `MTA` in the key: `0`, regardless of type, since every candidate is awarded full marks on it. |

## Decisions, rationale, and per-year notes

**Why order-based numbering, not the printed number.** For several years, the
question-paper PDF is not reliable text to parse directly for its own printed number
(OCR misreads digits, or a label appears in an unusual position). Since GATE's question
counts per section are fixed and known in advance (GA = 10, MT = 55, in that order every
year except one — see 2017 below), each question is instead numbered by its **position**
in the document, section by section. This sidesteps digit-recognition errors entirely;
a "5" misread as "S" doesn't matter because the code never reads the digit, only counts
occurrences in order.

**Four distinct PDF layouts were found across the 13 years, and each needed its own
extraction approach:**

- **2014, 2016, 2018** — plain flowing text, question and option text is directly
  extractable from the PDF, with a "Q.n" label on its own line. Most straightforward
  case: crop is derived from the label's position to the next label's position.
- **2015, 2017, 2020** — the question/option *content* is an embedded raster image
  (not extractable as text), but *structural* text (headers, labels) is real PDF text.
  Each of these three years has its own quirks:
  - **2015**: correct-answer indicators for MCQs are colored checkmark/cross glyphs
    (green = correct, red = incorrect) in a small image beneath each question, not text.
    These were read by classifying pixel colors row-by-row and clustering them into
    bands, rather than assuming a fixed layout, since trailing whitespace varies
    question to question.
  - **2017**: this is the one year where the official answer key lists **MT questions
    before GA** (global numbers 1–55 = MT, 56–65 = GA) — the reverse of every other
    year. Local (within-section) numbering is derived by rank within each section
    rather than a fixed offset, to avoid this flipping GA/MT numbering silently.
  - **2020**: the question-number label sits in the left margin on the *same line* as
    the first line of question content (rather than on its own line above it, as in
    every other year), so the crop has to start at the label's top and then redact
    just the label's own bounding box, rather than starting the crop below the label.
- **2019, 2021** — fully scanned pages, zero extractable text; both question labels
  and the answer-key table were recovered via OCR (`pytesseract`) plus computer-vision
  grid detection (`opencv`) for the bordered answer-key tables. Multiple OCR passes at
  different crop widths and page-segmentation modes were unioned to recover labels a
  single pass silently dropped (not misread — entirely absent from that pass's output).
- **2022–2026** — a newer, more consistent format (some years bordered/tabular,
  some borderless/flowing) with question papers and answer keys as separate PDF files.

**Validation performed for every year:** exact section/type/gap/duplicate checks (question
counts match GA=10, MT=55 exactly, with no missing or repeated question numbers), a
blank-crop check (no all-white images), and manual visual spot-checks of representative
crops for each newly-solved format.

**Known assumption:** where a year's official key marks a question `MTA`, that question's
`correct_answer` field is left as `MTA` rather than a letter/value — there is no "correct"
option to render as selected in that case, and the app should treat it as full-marks-
regardless-of-answer if it needs to score these.
