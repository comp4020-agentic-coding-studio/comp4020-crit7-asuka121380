import {
  type Course,
  getCatalogue,
  getChoices,
  getProgram,
  getProgramCode,
  listEntries,
  listPrograms,
  type PlanEntry,
} from "./db";
import { type Evaluation, evaluate } from "./progress";
import type { Program } from "./requirements";
import { currentTerm } from "./terms";

// Everything a page needs, read in one place so the tree and the semester
// plan are always two views of the same rows.
export type PlannerView = {
  programs: Program[];
  program: Program | null;
  entries: PlanEntry[];
  choices: Record<string, string>;
  catalogue: Map<string, Course>;
  evaluation: Evaluation | null;
  now: ReturnType<typeof currentTerm>;
};

export function loadView(): PlannerView {
  const code = getProgramCode();
  const program = code ? (getProgram(code) ?? null) : null;
  const entries = listEntries();
  const choices = program ? getChoices(program.code) : {};
  const catalogue = getCatalogue();
  return {
    programs: listPrograms(),
    program,
    entries,
    choices,
    catalogue,
    evaluation: program ? evaluate(program, entries, choices, catalogue) : null,
    now: currentTerm(),
  };
}

// The client script gets the same facts the server rendered from.
export function clientData(view: PlannerView) {
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
    })),
    catalogue: Object.fromEntries(
      [...view.catalogue.values()].map((c) => [
        c.code,
        { title: c.title, min: c.unitsMin, max: c.unitsMax, offered: c.offered, tps: c.transdisciplinary, url: c.url },
      ]),
    ),
  };
}
