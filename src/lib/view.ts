import { checkPlacement, type Issue } from "./checks";
import {
  type Course,
  getCatalogue,
  getChoices,
  getProgram,
  getProgramCode,
  getSelections,
  listEntries,
  listPrograms,
  type PlanEntry,
} from "./db";
import { courseCodes, type Program } from "./requirements";
import { type Evaluation, evaluate } from "./progress";
import { currentTerm } from "./terms";

// Everything a page needs for one signed-in student, read in one place and
// evaluated once, so the tree, the rules and the semester plan are always
// the same numbers.
export type PlannerView = {
  programs: Program[];
  program: Program | null;
  entries: PlanEntry[];
  choices: Record<string, string>;
  selections: Record<string, string>;
  catalogue: Map<string, Course>;
  evaluation: Evaluation | null;
  warnings: Map<number, Issue[]>;
  now: ReturnType<typeof currentTerm>;
};

export function loadView(user: number): PlannerView {
  const code = getProgramCode(user);
  const program = code ? (getProgram(code) ?? null) : null;
  const entries = listEntries(user);
  const choices = program ? getChoices(user, program.code) : {};
  const selections = program ? getSelections(user, program.code) : {};
  const catalogue = getCatalogue();
  const now = currentTerm();

  const warnings = new Map<number, Issue[]>();
  for (const e of entries) {
    const course = catalogue.get(e.courseCode);
    if (!course) continue;
    const others = entries
      .filter((o) => o.id !== e.id)
      .map((o) => ({ placement: o, semesters: catalogue.get(o.courseCode)?.semesters ?? 1 }));
    // an existing entry can't be blocked after the fact; show everything
    // that's off about it as a warning
    const issues = checkPlacement(e, course, now, others);
    if (issues.length) warnings.set(e.id, issues);
  }

  return {
    programs: listPrograms(),
    program,
    entries,
    choices,
    selections,
    catalogue,
    evaluation: program ? evaluate(program, entries, choices, selections, catalogue) : null,
    warnings,
    now,
  };
}

// The client script gets the same facts the server rendered from, for the
// courses on this page; the full catalogue is fetched only for search.
export function clientData(view: PlannerView) {
  const codes = new Set([...(view.program ? courseCodes(view.program.requirements) : []), ...view.entries.map((e) => e.courseCode)]);
  return {
    program: view.program?.code ?? null,
    now: view.now,
    entries: view.entries.map((e) => ({
      id: e.id,
      course: e.courseCode,
      status: e.status,
      year: e.year,
      session: e.session,
      units: e.units,
      counts: view.evaluation?.credit.get(e.id)?.title ?? null,
    })),
    courses: Object.fromEntries(
      [...codes].flatMap((code) => {
        const c = view.catalogue.get(code);
        return c
          ? [
              [
                code,
                {
                  title: c.title,
                  min: c.unitsMin,
                  max: c.unitsMax,
                  semesters: c.semesters,
                  semesterNote: c.semesterNote,
                  offered: c.offered,
                  tps: c.transdisciplinary,
                  incompatible: c.incompatible,
                  incompatibleNote: c.incompatibleNote,
                  detailed: c.detailed,
                },
              ],
            ]
          : [];
      }),
    ),
  };
}
