# Process overview

## What I built

My Degree Planner: four official 2027 ANU Computing programs rendered as
collapsible requirement trees, with a student's completed, current and planned
courses persisted in SQLite and shown in two views, the tree and a semester
plan. `README.md` says what it is and what good means here. This file is the
working log of how it got there. It is a chronological evidence log, to be
curated into the final account later.

## How I got here

### Harness first

[`3ccb193`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-asuka121380/commit/3ccb193)
carried the harness forward from `comp4020-ass2-Asuka121380`. That repo's
`CLAUDE.md` was mostly about the A2 guitar-tone course site, so only its three
general conventions came across: CLAUDE.md-versus-`spec/` checks, the
engineering workflow, and this working log. Everything project-specific was
dropped. The rule "never commit a red state" shaped what followed: the crit 7
contract tests were written first and ran red (12 failing), but were committed
together with the implementation that turned them green, not on their own.

### Research before any data model

The brief set the bar:

> All program names, requirement text, unit values, course codes, course
> titles, specialisations/pathways, and other academic information shown in
> the prototype must come from real official ANU sources.

[`ad3621d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-asuka121380/commit/ad3621d)
commits the evidence: plain-text extracts of the Program Requirements for
BCOMP, AACOM, AACRD and AENSE, and of the majors and specialisations they
reference. It also records title, unit value, 2027 offerings and graduate
attributes for all 98 courses they name, each with its source URL. The catalogue
listing is rendered by JavaScript, so program pages were fetched directly by
code (`/2027/program/AACOM`) and the requirement sections extracted as text.
Checks made at this stage:

- **Arithmetic confirms the structure.** BCOMP's "96 units from the following
  lists" is 6+6+6+24+48+6, which settled that the ICT-course requirement
  sits beside the "48 units COMP or a major" choice, not inside it. Every
  program sums to its official 144 or 192.
- **Sources disagree, so both are kept.** Program pages print different
  course titles than the course pages (COMP2100, COMP2300, COMP3770, ASIA3032,
  MUSI3309, ENGN4300). The course page is treated as the course's authority and
  the program page's wording is shown as "Listed as".
- **A gap is surfaced, not papered over.** The Machine Learning specialisation
  is listed in AACOM's 2027 requirements but only has a 2026 page. It's kept,
  labelled with that fact.
- **Course pages settle ambiguous units.** "COMP3500 Software Engineering
  Project (12 units)" on AENSE is a 6-unit course taken twice in consecutive
  semesters, per its own page. The same holds for COMP4500, COMP4550 and
  COMP3770.
- **The Transdisciplinary tag has a visible proxy.** Course pages list a
  "Transdisciplinary" graduate attribute. The planner counts that towards
  Transdisciplinary Problem-Solving minimums, and says so wherever it does.

### The grammar, the schema and the contract

[`14fadf2`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-asuka121380/commit/14fadf2)
is the main build. Decisions, in the order they were made:

- **A requirement grammar small enough to transcribe by hand.** Every rule in
  the four programs, seven majors and five specialisations fits six node kinds:
  course, all-of, choose N units (exact, at least, or up to), one pathway, and
  an open "any N units matching a filter" bucket. Each group keeps the official
  sentence verbatim in `text`, with a short navigation `title` beside it
  (`src/lib/requirements.ts`, `src/data/`).
- **Reference data in the database, re-seeded on boot.** Courses and programs
  are tables populated from the committed sources at every boot, so a corrected
  transcription reaches the Fly volume with the next deploy. The course
  catalogue is `research/2027/courses.json` itself.
- **Personal state belongs to the student, not the program.** `plan_entries`
  (course, status, year, session, units) have no program key, so switching
  program re-reads the same courses against new rules. `profiles` holds the
  chosen program and `pathway_choices` the chosen specialisation, major or
  final-year option. ANU sign-in is out of scope, so one demo user owns every
  row, but the rows still carry `user_id`. drizzle-kit wanted an interactive
  rename prompt when the guestbook table disappeared, so the schema change is
  two migrations: add the planner tables, then drop `messages`.
- **One evaluation, two views.** `src/lib/progress.ts` evaluates entries
  against a tree once. `/` and `/plan/` both read it, which is what makes "plan
  it here, see it there" true by construction.
- **The contract as HTTP tests.** `spec/degree-planner.test.ts` was written
  before the pages, against `data-*` hooks rather than markup. It covers:
  program names, persistence of the chosen program, collapsed-by-default groups,
  official numbers in the whole-program rules, an official link on every course
  in all four trees, rejected malformed input, persistence of a planned course
  in both views, persistence of updates and removals, and live updates over SSE.
- **Visual system chosen for the job.** Warm neutral surfaces and a serif for
  program names, with ANU gold kept to the chrome (wordmark, active tab, "now")
  so it never competes with plan state. The three status colours were run
  through a palette validator in light and dark mode (CVD separation, lightness
  band, contrast against the surface) before use. They are always paired with a
  distinct mark shape and a text label.

### Driving it in a browser

[`d07948b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-asuka121380/commit/d07948b)
collects what only showed up by using the app in Chromium, at 1360px and at
390px on a touch viewport, in two tabs at once:

- Astro's view-transition router was intercepting the planner's form submits
  and turning them into navigations. Forms now carry `data-astro-reload`, and
  the in-place submit handler owns them.
- Typing a course code in the add-course panel inserted a hint line that moved
  the submit button out from under the pointer, so the click never landed. The
  hint now reserves its line.
- A COMP course completed under BCOMP counted towards nothing. It was named
  inside an unchosen major, and that listing "claimed" it. Unchosen pathways no
  longer claim courses, so it counts as an elective. A regression test pins it.
- A bodyless POST returned a 500. It now returns a 400.
- Annual courses now show per-semester units and "1 of 2 semesters in your
  plan", and the panel suggests the next semester. Group rows read as one
  phrase. `[hidden]` now beats component display rules. The mobile tabs fit on
  one line.

`spec/requirements.test.ts` arrived in the same commit and turns the hand
arithmetic from the research step into a check: every named course exists in
the catalogue, and every program and fixed group adds up to its official units.

### Checked by

- `pnpm check`: 57 tests. Invariants on `/`, `/plan/` and `/readme/`, the
  README served in full, the contract above, the transcription arithmetic, the
  placement rules, and an axe pass on a fully expanded, populated tree and
  semester plan.
- In the browser:
  - golden path: choose a program, mark a course, plan a course, choose a
    pathway, reload, and see both views agree
  - live refresh between two tabs
  - switching program keeps the courses
  - mobile drill-down and bottom sheet with no horizontal scroll
  - keyboard only: Enter opens groups and the panel, Escape closes it
  - dark mode
