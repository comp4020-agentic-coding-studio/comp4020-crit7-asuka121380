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
