# My Degree Planner

ANU's Programs & Courses pages hold everything a Computing student needs to know
about their degree, but the Program Requirements section is a long block of
text: nested "6 units from the following list", "one of the following
specialisations", "Either … OR … AND …", plus whole-program rules like "a
maximum of 60 units may come from 1000-level courses". My Degree Planner turns
that text for four standalone 2027 Computing programs into an interactive
requirements tree. It then lays the student's own record over it: courses
completed, being studied now, and planned for a future semester. The same plan
is also shown as a semester-by-semester timeline. It is a planning aid built on
the official catalogue, not a degree audit.

![The requirements tree for the Bachelor of Advanced Computing (Honours): groups with progress bars, the compulsory courses expanded with each course's status, and the whole-program rules on the right](public/readme-tree.png)

## What good looks like here

**Every academic fact is official, and traceable.** The four programs (BCOMP,
AACOM, AACRD, AENSE), the seven majors and five specialisations they point to,
and all 98 courses they name were read from the 2027 ANU Programs & Courses
catalogue on 27 September 2026. The plain-text extracts, each with its source
URL, are committed in `research/2027/`. The course catalogue the app seeds into
SQLite *is* `research/2027/courses.json`, so no title, unit value or offering
is typed in by hand. Every requirement group shows its official sentence word
for word. The short title above it is only a navigation label. Where sources
disagree, the app shows both: the program page lists COMP2100 as "Software
Design Methodologies" while its course page says "Software Construction", and
the leaf carries both. One gap is kept visible rather than hidden: the Machine
Learning specialisation is listed in the 2027 AACOM requirements but has no
2027 page. Its structure comes from the 2026 page, and the node says so.

**Hierarchy one level at a time, with a visual grammar for "and" and "or".**
Nothing is expanded when the page loads. Each group has a glyph, a plain-words
relation ("All 8 required", "Choose 1 of 2", "At least 12 units", "Up to 12
units · optional", "One pathway", "Any 18 units"), and a connector line whose
style repeats the relation: solid when every child is needed, dashed when you
choose among them, dotted for an open "any course that fits" requirement.
Pathways (specialisations, majors, the AACOM final-year options) are cards. The
one you choose is marked and the others step back. On a phone the same tree
becomes a drill-down: one group's children fill the screen, with a breadcrumb
trail back up, rather than a desktop outline squeezed sideways.

![On a phone: breadcrumbs above the AI specialisation's 4000-level list, with one course planned for 2028 Semester 1](public/readme-mobile.png)

**Every course leads to its official page.** Every course anywhere in the tree
or the semester plan has a direct link to
`programsandcourses.anu.edu.au/2027/course/<CODE>`. The course panel repeats it
as its most prominent action and shows only the official unit value, 2027
offerings and graduate attributes.

**One plan, two perspectives, persisted.** A student picks a program, then
records courses as Completed, Studying now or Planned, each with a year and
session. The choice of program, every entry and every pathway choice are rows
in SQLite, not browser state. So a reload, a redeploy or another device shows
the same plan. The requirements tree (`/`) and the semester plan (`/plan/`) read
the same evaluation of the same rows. Plan COMP4550 for 2027 Semester 1 in
either view and it appears in both. Each semester entry says which requirement
it counts toward. Changes are broadcast over server-sent events, so a second
open tab refreshes itself. Status is never colour alone: completed is a filled
tick, studying now is half-filled, planned is a dashed ring and a hatched bar
segment, and each one carries a text label.

![The semester plan: 2025 and 2026 semesters with completed and current courses, the current semester outlined](public/readme-plan.png)

**Whole-program rules sit beside the tree, not inside it.** Total units, the
1000-level maximum, the 3000/4000- or 4000-level COMP minimums and the
Transdisciplinary Problem-Solving minimum are quoted in full and measured
against every entry in the plan. Rules the planner deliberately doesn't
evaluate are listed separately under "Rules this planner doesn't check": the
AACRD 75%/80% WAM progression rules and the honours calculations.

### How courses are placed, and where it stops

A course named in the tree counts wherever it is named. A course named only
inside a pathway nobody has chosen, or not named at all, goes to the first open
requirement it fits. Filtered ones fill first ("18 units of 3000/4000-level
COMP"), then unrestricted electives. Anything left is marked "not counted
towards a listed requirement". This is an estimate, and its limits are
deliberate:

- a course listed in two places (say, a compulsory course that also appears in
  a specialisation list) counts in each listing's progress bar
- local rules inside majors and specialisations ("a maximum of 18 units may
  come from 1000-level courses", incompatibilities) are shown as notes, not
  checked
- the Transdisciplinary count uses the "Transdisciplinary" graduate attribute
  on each course page as the tag, and says to confirm it with the School
- prerequisites, timetables, marks and eligibility are not modelled
- ANU sign-in is out of scope: everyone acts as one signed-in demo student, so
  the deployed demo's plan is shared by whoever opens it

What was left out on purpose: combined and double degrees, every other ANU
program, course recommendations of any kind, prerequisite checking, timetable
clashes, GPA, ISIS integration and graduation guarantees. The interesting part
is official requirements, a hierarchy you can read, and a plan that persists,
and everything else would dilute it.

## What's enforced, and what's judged

`pnpm check` holds the mechanical promises:

- `spec/degree-planner.test.ts` drives the running server over HTTP:
  - the four programs are offered by their official names
  - the chosen program persists across a fresh load
  - every group starts collapsed
  - the whole-program rules carry the official numbers
  - every course in all four trees links to its official 2027 page
  - malformed entries are rejected
  - a planned course appears in both the tree and the semester plan after a
    reload, and status changes and removals persist the same way
  - plan changes reach other tabs over the event stream
  - a populated tree and plan clear the accessibility floor
- `spec/requirements.test.ts` guards the transcription without a server:
  - every course named exists in the scraped catalogue
  - each program adds up to its official total (144 or 192 units), and every
    fixed group's parts add up to the units its official wording states
  - the placement rules above
- `spec/invariants.test.ts` covers `/`, `/plan/` and `/readme/`, and
  `spec/readme.test.ts` checks this page is served in full.

What only a person can judge: whether the tree is genuinely easier to follow
than the official text, whether the visual grammar reads without the legend,
whether the motion (groups unfolding, a changed course pulsing once, bars
easing to their new length) explains structure rather than decorating it, and
whether the look is calm and recognisably ANU without imitating its site.

## Running it

```sh
mise install
pnpm install
pnpm dev      # http://localhost:4321
pnpm check    # types, build, and every spec above
```

The schema lives in `src/lib/schema.ts` and its migrations in `drizzle/`,
applied at boot. The reference data (courses and programs) is re-seeded from
`research/` and `src/data/` on every boot, and personal tables are never touched
by the seed.
