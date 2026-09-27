# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the starter is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec. Read them before you plan or build;
what the agent needs to carry from any of it is your call.

## Carried forward from Assignment 2

These three conventions held up across the last deliverable and are kept
deliberately; everything else from that repo's harness (curriculum content,
visual system, audio policy) was specific to that project and dropped.

### CLAUDE.md versus spec/ checks

This file carries qualitative, judgment-based rules. When an invariant is
reliably machine-checkable, express it as a `spec/*.test.ts` check instead.
Don't convert subjective design calls (whether an interaction is well-judged,
whether a flow makes sense) into brittle tests just to have more tests — those
stay judged, by you and at the crit.

### Engineering workflow

- Keep the dev server running (`pnpm dev`) so you see changes as you make
  them.
- Run `pnpm check` before you push; read failure output before changing
  anything. Never commit a red state.
- Open the page in a browser and look at it — the rendered page is the truth,
  not your mental model of it. Static checks (types, build, `spec/`) can't
  validate runtime interaction: anything a person notices only by using a
  control needs checking there.
- Understand the starter's structure (routing, DB schema/migrations, build
  pipeline) before introducing a new abstraction on top of it. Don't refactor
  the starter's infrastructure without a clear reason tied to this week's
  needs.
- Don't spend disproportionate time on infrastructure or polish that doesn't
  materially improve the response to the brief — a working, persisted flow
  comes before visual refinement.

### PROCESS.md as a working log

After each meaningful, successful commit, append an entry to `PROCESS.md`
with: the real commit hash (only after the commit exists — never invent or
predict one), what changed, why, and how you checked or evaluated the result.
This is a chronological evidence log, not the final submission narrative —
don't compress or rewrite earlier entries. It gets manually curated into the
shorter reflective version later, separately.

## Crit 7: My Degree Planner

Rules from my brief for this week, held for every session on this repo:

- The 2027 ANU Programs & Courses catalogue is the only source for academic
  facts: program names, requirement wording, unit values, course codes and
  titles, offerings, majors and specialisations. Never invent, paraphrase into
  a rule, or "tidy" one. If a source is ambiguous or two pages disagree, keep
  the official wording and show the disagreement rather than resolving it.
- New facts arrive through `research/2027/` first (a plain-text extract with
  its source URL), then get transcribed into `src/data/`. The seeded course
  catalogue is `research/2027/courses.json` itself.
- A requirement group's `text` is the official sentence verbatim; its `title`
  is only a navigation label and must not assert anything the text doesn't.
- Every course rendered anywhere links to its official 2027 course page.
- It's a planning aid, never an audit: no copy that claims eligibility,
  completion or graduation.
- Course status is never colour alone: mark shape and a text label as well.
- Stay in scope: no recommendations, prerequisite checking, timetabling,
  GPA, real ANU sign-in or ISIS integration.
- Every write is a plain form POST that works without JavaScript; enhanced
  forms carry `data-astro-reload` so Astro's router leaves them to
  `src/scripts/planner.ts`.
- The Fly.io token lives in the environment. Never print, inspect, log or
  commit it.

## Accounts, integrity and progress (added for the reliability pass)

- Accounts are My Degree Planner's own. Never ask for, store or imitate ANU
  credentials, never scrape ANUHub or ISIS, and never treat a student number as
  identity. Any account UI carries the notice that this isn't an ANU account.
- The user comes from the server-side session only. Every query and mutation in
  `src/lib/db.ts` takes the session user's id explicitly; nothing reads a user
  id from the request. Live events are filtered to that account.
- A constraint that matters is enforced by the server and, where possible, the
  database (`UNIQUE(user_id, course_code)`, the course foreign key), not only by
  disabling controls.
- Only codes in the verified catalogue (`research/2027/ug-catalogue.json`) can
  enter a plan. Never invent a title or build an official link for a code that
  isn't there.
- Progress is calculated in one place, `src/lib/progress.ts`: each record
  credits at most one requirement, within every enclosing cap. Pages read its
  result; they never recompute totals themselves.
- Refuse only data-integrity problems: a duplicate record, an unknown course,
  units outside the official range, malformed input, an unauthenticated or
  unowned request. Everything academic is a warning (Planned) or a note
  (Completed, Studying now). `src/lib/checks.ts` holds these for server and
  client alike.
- API failures answer with a specific status and `code`, and the client shows
  the server's message. Never collapse them into one generic error.
- In client templates, never name a form field `action`, `method` or another
  form property: it shadows the DOM property (this broke Edit and Remove once).
  Read the URL with `form.getAttribute("action")`.

## Course-page rules

- Never infer a relationship from a course code's mere presence in a
  requisite block. Codes become incompatibilities only from an incompatibility
  clause; prerequisites keep their AND/OR structure, unit counts, exclusions
  and marks; program restrictions, permission, co-requisites, assumed
  knowledge and co-taught courses are each their own kind.
- Parse only what can be read reliably; otherwise keep the official wording
  and mark the rule partial. An uncertain prerequisite is never turned into a
  hard rule.
- Hand readings live in `src/data/rule-overrides.ts`, each pinned to the exact
  official text. After any data refresh run `pnpm rules:audit` and `pnpm check`;
  `spec/course-rules.test.ts` fails if a review is stale or a relationship
  isn't backed by its clause.
- Completed is history and is never refused or warned for course rules;
  degree choose-one groups are enforced by allocation, not by refusing
  records.
- Warning copy says what the plan appears to show and what it doesn't
  ("The plan does not yet show…"); never "can't be added", "not eligible" or
  "requirements satisfied" unless the structure supports it.
