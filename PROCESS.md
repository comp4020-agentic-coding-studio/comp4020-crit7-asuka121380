# Process overview

## What I built

My Degree Planner: four official 2027 ANU Computing programs rendered as
collapsible requirement trees, with a student's completed, current and planned
courses persisted in SQLite and shown in two views, the tree and a semester
plan. `README.md` says what it is and what good means here. This file is the
chronological evidence log of how it got there.

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

### Reliability pass: private accounts, one record per course, one calculation

A second brief reported the deployed prototype's failures. Every visitor
shared one plan; courses could be added twice; Remove did nothing; Edit said
"Something went wrong"; both options of a choose-one list counted; the headline
(114 units) disagreed with the tree; and COMP0721, which doesn't exist, was
accepted with an official link to a 404. Each was reproduced before anything
changed.

**Findings first.**

- **Deployed data:** `/api/state` showed 19 records, 16 distinct courses and
  114 units, all owned by one anonymous user.
- **Edit and Remove:** both panel forms had a hidden input named `action`,
  which shadows the DOM's `form.action`. So `fetch(form.action)` requested
  `[object HTMLInputElement]`, got a 404 page, and failed to parse it as JSON.
  The Remove form had nowhere to show that error, so it failed silently. The
  earlier HTTP tests called the API directly and never exercised these client
  forms, which is why they missed it.

[`d9fdbae`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-asuka121380/commit/d9fdbae) adds the official evidence this pass relies on:

- **The full course list:** all 1,523 2027 undergraduate courses, from the JSON
  behind the catalogue's own search, so a plan can hold any real course and
  nothing else.
- **Course-page detail:** each program course's official requisite and
  incompatibility text, and the sentence saying whether it runs over two
  consecutive semesters.
- **Load limits:** the ANU study load policy clauses behind the 24-unit warning
  (clause 12) and the 36-unit limit (clause 20).

[`0a0a925`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-asuka121380/commit/0a0a925) is the change itself:

- **Accounts.** My Degree Planner's own username and password: scrypt hashes,
  and an HttpOnly session cookie whose token is stored only as a SHA-256.
  Middleware resolves the user from that session alone. Every function in
  `db.ts` takes that user's id, and live events are filtered to the account.
  Migration `0003` clears the shared anonymous data, which can't be attributed
  to anyone. That migration trail was run against a copy of production-shaped
  data before deploying: the old build recreated its duplicates and COMP0721,
  and the new build booted on it cleanly.
- **Integrity.** `UNIQUE(user_id, course_code)`, plus a foreign key to the
  verified catalogue. A two-semester course is one record that appears in both
  semesters. Official incompatibilities (COMP1100 and COMP1130) are refused with
  the page's own sentence. Each failure has its own status and code.
- **One calculation.** `progress.ts` now allocates credit. Each record credits
  at most one requirement, within every enclosing unit cap. A choose-one list
  credits one option, and the student can pick which. The headline, tree, rules
  and semester plan all read that one result. A screenshot during verification
  caught a 24-unit course being partly squeezed into an 18-unit requirement;
  courses now go whole into the first requirement that can hold them.
- **Client.** The `action` field is renamed to `op`, and the URL is read with
  `getAttribute`. Also new:
  - double submits are prevented
  - server messages are shown in place
  - "Move it here" for a duplicate, and Undo after Remove
  - focus returns to what opened the panel
  - the program switcher has accessible names
  - `checks.ts` drives live warnings in the panel with the same rules the
    server enforces

  Browser testing found one more real bug: blurring the course-code field
  re-rendered the hint area and replaced "Move it" mid-click. The hint now
  re-renders only when its content changes.

Checked by: `pnpm check` (89 tests, including account isolation, ownership,
duplicate and incompatibility refusal, each error code, choose-one credit, and
the headline agreeing with the total rule), and `pnpm e2e`, which drove the 15
required scenarios through a real browser, all passing.

### Correction pass: course-page rules read as what they say

A third brief pointed at COMP3320: the planner said it couldn't be added
alongside COMP2100, which is one of its prerequisites. The brief asked for the
cause to be fixed, not the case. The cause was the model: each official
requisite block had been flattened to a list of codes, and every code in the
same "sentence" as the word *incompatible* was treated as incompatible. COMP3320's
block has no full stop before "Incompatible with COMP6464", so its prerequisites
were swallowed too.

Evidence first. Every one of the 98 program courses' blocks was re-read from
the page's HTML structure ([`ac42fc8`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-asuka121380/commit/ac42fc8)), which keeps the line breaks
between clauses, along with Assumed Knowledge and the separate "Co-taught
Course" field. Comparing the old flat reading with the new one showed the error
was systemic:

- **9 courses had prerequisites wrongly marked incompatible:** COMP3320,
  COMP3425, COMP3430, COMP3610, COMP3630, COMP4350, COMP4425, COMP4670 and
  MATH3301.
- **14 courses had genuine exclusions missed**, because their wording ("if you
  have *previously* completed…") didn't match the old pattern.

[`0169375`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-asuka121380/commit/0169375) replaces the model.

- **Reading.** Clauses are classified by their opening words:
  prerequisites, incompatibilities, program restrictions, permission and
  notes. A prerequisite becomes an AND/OR expression tree only when every token
  is understood, covering unit counts by subject and level with exclusions,
  co-requisite options, marks and program nodes. Anything else stays as official
  wording, flagged. Where the parser couldn't finish, a hand reading pinned to
  the exact text (24 courses) records decisions such as:
  - "ENGN3000/4000 courses" is a course level, not two course codes
  - MATH2222's mark applies to both MATH1013 and MATH1014
  - INFS3059's grouping is ambiguous, so it stays wording-only
- **Validation.** `spec/course-rules.test.ts` checks every course on every
  run: incompatibilities must come from an incompatibility clause, nothing may be
  both a prerequisite and incompatible, every prerequisite code must be in the
  official wording, and a hand review fails if its source text changes. The
  validator caught two of my own over-confident "complete" labels (MUSI3309 and
  SOCR3001 include a consent alternative that can't be checked). It also caught
  the page's own "COMP1110/1140" abbreviation.
- **Policy.** Only data integrity is refused. Completed is history and is
  never warned for course rules. Studying now gets notes. Planned gets
  chronological, group-by-group warnings in the brief's wording, and "Add
  anyway".
- **History versus credit.** A course incompatible with one already counting
  is recorded but credits nothing. Adding the other option of a choose-one group
  offers to replace the counting course, done atomically on the server.
- **Smaller fixes.** One live region instead of two; Move only offered into a
  different semester; and "AACOM requirements" spacing.

Checked by: `pnpm check` (127 tests, including the parser on representative
structures, the all-course validator, the COMP3320 regression, status policy and
allocation), and `pnpm e2e` (20 browser steps). The browser steps cover the
original 15 scenarios plus the rule headings, "Add anyway", replacement, no
same-semester Move and a single announcement. A screenshot of the COMP3320
panel confirmed the wording reads as the brief asks.

### Earlier first-build checks

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
