# Company Mock Tests — Design

Date: 2026-11-12
Status: Approved in chat, pending written-spec review

## Goal

Let admins publish company-specific mock tests built from the existing GATE
question bank, visible only to a chosen list of roll numbers, with editable
instructions that the student must acknowledge before starting.

## Decisions (from the clarifying rounds)

| Topic | Decision |
|---|---|
| Attempts | Admin sets `max_attempts` per test (default 1) |
| Availability | `starts_at` / `ends_at` window; admin can also deactivate |
| Late start | Deadline = min(start + duration, ends_at) |
| Result view | Same as department mocks: score + section breakdown |
| Unknown roll numbers | Creation rejected; unknown rolls listed |
| Question source | "Student's own department" OR one specific department |
| Own-dept draw style | Same section mix as that department's mock, scaled to N |
| Own-dept with no bank | Creation rejected; those rolls listed |
| Dual majors | Primary discipline only |
| Specific dept | One department only: CSE, ME, EE, CH, MT, CE (the six department-mock recipes) |
| Paper | Same paper per department, drawn when the admin saves; order shuffled per student within each section |
| Re-attempt | Same paper, reshuffled |
| Marking | Fixed: +4 correct, −1 wrong MCQ, 0 negative NAT (bank values) |
| Admin results | Per-test results table + Excel export |
| HODs | Read-only view, limited to their own department's students |
| Editing | Everything until first attempt; afterwards only rolls, instructions, end time, max attempts, active |
| Delete | Only with no attempts; otherwise deactivate |
| Roll input | Paste box (commas / spaces / newlines) with live validation |
| Dashboard | Separate "Company mock tests" section at the top; Upcoming / Open / Closed states; Closed cards stay visible with score |
| Instructions | Default text (below), editable per test; `{N}`, `{T}`, `{END}` placeholders |
| Checkbox | Start disabled until "I have read and understood all the instructions above and I will follow them." is ticked; enforced server-side |

## Architecture

Company mocks are a new **kind** of `Mock_Exams` row. The arena, autosave,
server-side clock, proctoring, grading and review all key off
`Exam_Attempts → Mock_Exams` and are reused unchanged, except for the deadline
calculation.

### Schema (additive; idempotent migrations in `src/config/db.js`)

`Mock_Exams` new columns (all nullable or defaulted):
- `kind VARCHAR(20) NOT NULL DEFAULT 'department'`
- `instructions TEXT NULL`
- `question_source VARCHAR(20) NULL`: `'OWN'` or a department-mock code
- `starts_at DATETIME NULL`, `ends_at DATETIME NULL`
- `max_attempts INT NULL`
- `created_by VARCHAR(255) NULL`

`Exam_Attempts` new column: `instructions_accepted_at DATETIME NULL`.

New tables:
- `Company_Mock_Eligible (id, exam_id FK→Mock_Exams CASCADE, roll_number, UNIQUE(exam_id, roll_number))`
- `Company_Mock_Papers (id, exam_id FK CASCADE, paper_key VARCHAR(20), section_name, section_order, position, question_id FK→Question_Bank CASCADE, UNIQUE(exam_id, paper_key, position))`

Company rows use `code = 'CO-<id>'` (a temporary unique code is set at insert,
then replaced), `department = 'COMPANY'`, and `disciplines = NULL`. The existing
`examServes()` therefore never matches them.

### Paper building (`src/utils/companyMock.js`)

- `departmentRecipes(pool)`: the active `kind='department'` exams with their
  `Mock_Exam_Sections`.
- `scaleSections(sections, N)`: largest-remainder apportionment of N across
  sections in proportion to `question_count`. Zero-count sections are dropped.
- `paperKeyForStudent(recipes, discipline)`: the code of the department exam
  that `examServes([discipline])`, preferring an exact `department` match.
- `drawPaper(conn, recipe, N)`: for each scaled section, a random draw from
  `Question_Bank` (same filter as `startAttempt`). It throws a clear error if
  the bank is short.
- Saving a test (create, or an update before any attempt) deletes and redraws
  the papers for every needed paper_key. An update after attempts exist only
  draws papers for paper_keys that are newly needed, for example after new
  rolls from another department were added.
- Start: if the student's paper is somehow missing (for example their roster
  discipline changed), it is drawn lazily inside the start transaction.

### Student flow (`mockController`)

- `GET /api/tests/company`: the company tests the student is eligible for,
  identified by roll number from `allowed_students` (by email), falling back to
  `Students.roll_number`. Each test comes with its state (upcoming / open /
  closed), attempts used, best score, in-progress id and instructions (with
  placeholders filled).
- `POST /api/tests/mock/:examId/start` (company kind) checks, in this order:
  active, eligible, window open, `acknowledged === true`, attempts used <
  max_attempts (an in-progress attempt resumes and doesn't count). It then
  copies the paper into `Attempt_Questions`, shuffled within each section, and
  stamps `instructions_accepted_at`.
- `secondsRemaining()` honours `ends_at`.
- `abandonAttempt` returns 403 for company kind.
- `listMockExams` filters `kind='department'`.

### Admin (`src/controllers/companyMockController.js`, routes under `/api/admin/company-mocks`)

- `GET /` (admin + HOD): the list with counts. For a HOD, counts are limited to
  their students, and only tests that include at least one of their students
  are shown.
- `POST /validate-rolls` (admin): `{ valid:[{roll,name,discipline,paper_key}], unknown:[...], no_bank:[...] }`.
- `POST /`, `PUT /:id`, `DELETE /:id` (admin only), with the rules above.
- `GET /:id` (admin + HOD): the test detail plus results rows (scoped for HODs).
- `GET /:id/export` (admin + HOD): xlsx of the results.
- `GET /defaults` (admin): the default instruction text and the department
  options.

### Protecting existing behaviour

Add `kind = 'department'` (or `COALESCE(kind,'department')='department'`) to:
- `examIdsFor` (HOD scope)
- `listMockExams`
- the admin overview / coverage / tests-list / matrix queries that enumerate
  `Mock_Exams`
- the importer's "deactivate unlisted exams" UPDATE

The Attempts and Warnings tabs keep showing company attempts, which is useful
for proctoring.

### Frontend

- `admin.html` / `admin.js`: a new "Company mocks" nav item and section with a
  list, form and results views.
- `dashboard.html` / `dashboard.js`: a "Company mock tests" section at the top.
  The rules modal shows the instructions and a required checkbox for company
  tests.

## Default instructions

```
1. This test has {N} questions and a duration of {T} minutes.
2. Marking: +4 for every correct answer, -1 for every wrong MCQ answer. Numerical (NAT) questions carry no negative marking. Unanswered questions get 0.
3. The test runs in fullscreen. Switching tabs, minimising the window or leaving fullscreen is recorded. The second violation submits your test automatically.
4. The test closes at {END}. If you start late, you only get the time remaining until then.
5. Your answers are saved automatically. Click 'Submit final test' when you are done.
6. Your marks will be shared in the WhatsApp group.
7. Do not use any unfair means: no phones, no other people, no AI tools, no searching online. Any malpractice will lead to disqualification.
```

## Testing

- A scratch database (`cds_portal_test`) on local MySQL, with the server
  started against it.
- `tests/company_mock.test.js` (`node --test`) seeds a minimal bank, recipes,
  roster, an admin and a HOD, then covers:
  - create validation (unknown rolls, no bank, short bank)
  - eligibility, time window, acknowledgement, attempt limit
  - same paper per department plus a different order per student
  - deadline capped at `ends_at`
  - grading, abandon being blocked, edit locking
  - HOD scoping, export
  - department mocks and HOD exam scope unaffected
- A browser smoke check of the admin form and the dashboard modal.

## Deployment

`DEPLOY_COMPANY_MOCKS.md` covers backup, pull, install, restart, what the
automatic migration does, SQL verification queries and rollback.
