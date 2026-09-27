import { type Session, SESSIONS, type Status, termLabel, termOrder } from "./terms";

// Consistency rules for placing a course in the plan, shared by the server
// (which enforces them) and the course panel (which shows them live).
// "block" is a data-integrity or policy impossibility; "warn" is unusual but
// possible, e.g. with approval, so the student decides.

export type Issue = { level: "block" | "warn"; code: string; message: string };

export type CourseFacts = {
  code: string;
  unitsMin: number;
  unitsMax: number;
  semesters: number;
  offered: Session[];
};

export type Placement = { courseCode: string; status: Status; year: number; session: Session; units: number };
export type Term = { year: number; session: Session };

const official = (s: Session) => SESSIONS.find((x) => x.id === s)?.official ?? s;

// A two-semester course runs in consecutive semesters: S1 → S2, S2 → next S1.
export function termsOccupied(year: number, session: Session, semesters: number): Term[] {
  if (semesters < 2) return [{ year, session }];
  const second: Term = session === "S1" ? { year, session: "S2" } : { year: year + 1, session: "S1" };
  return [{ year, session }, second];
}

// ANU study periods: 1 = Summer, First Semester, Autumn; 2 = Winter, Second
// Semester, Spring (Student academic study load and progression policy, cl. 2).
export const studyPeriod = (t: Term) => `${t.year}-${["SUM", "S1", "AUT"].includes(t.session) ? 1 : 2}`;

export const STANDARD_LOAD = 24;
export const MAX_LOAD = 36;

export function checkPlacement(
  p: Placement,
  course: CourseFacts,
  now: Term,
  others: { placement: Placement; semesters: number }[],
): Issue[] {
  const issues: Issue[] = [];

  if (!Number.isInteger(p.units) || p.units < course.unitsMin || p.units > course.unitsMax) {
    issues.push({
      level: "block",
      code: "invalid_units",
      message:
        course.unitsMin === course.unitsMax
          ? `${course.code} is a ${course.unitsMin}-unit course.`
          : `${course.code} can be taken for ${course.unitsMin} to ${course.unitsMax} units.`,
    });
  }
  if (course.semesters > 1 && p.session !== "S1" && p.session !== "S2") {
    issues.push({
      level: "block",
      code: "invalid_session",
      message: `${course.code} runs over two consecutive semesters, so it has to start in Semester 1 or Semester 2.`,
    });
  }

  const terms = termsOccupied(p.year, p.session, course.semesters);
  const load = new Map<string, number>();
  const addLoad = (pl: Placement, semesters: number) => {
    for (const t of termsOccupied(pl.year, pl.session, semesters)) {
      load.set(studyPeriod(t), (load.get(studyPeriod(t)) ?? 0) + pl.units);
    }
  };
  for (const o of others) addLoad(o.placement, o.semesters);
  addLoad(p, course.semesters);
  for (const t of terms) {
    const units = load.get(studyPeriod(t)) ?? 0;
    const period = `study period ${studyPeriod(t).slice(-1)} of ${t.year}`;
    if (units > MAX_LOAD) {
      issues.push({
        level: "block",
        code: "over_limit",
        message: `That makes ${units} units in ${period}. ANU policy doesn't permit more than ${MAX_LOAD} units in a study period.`,
      });
    } else if (units > STANDARD_LOAD) {
      issues.push({
        level: "warn",
        code: "heavy_load",
        message: `That makes ${units} units in ${period}, above the standard ${STANDARD_LOAD}-unit load. Taking more needs overload approval.`,
      });
    }
  }

  const start = termOrder(p.year, p.session);
  const last = terms.at(-1) ?? terms[0];
  const end = termOrder(last.year, last.session);
  const current = termOrder(now.year, now.session);
  if (p.status === "completed" && end > current) {
    issues.push({ level: "warn", code: "completed_future", message: `Marked completed, but ${termLabel(last.year, last.session)} hasn't finished yet.` });
  }
  if (p.status === "planned" && start < current) {
    issues.push({ level: "warn", code: "planned_past", message: `Planned for ${termLabel(p.year, p.session)}, which has already passed.` });
  }
  if (p.status === "current" && (start > current || end < current)) {
    issues.push({
      level: "warn",
      code: "current_not_now",
      message: `Marked as studying now, but it isn't placed in the current semester (${termLabel(now.year, now.session)}).`,
    });
  }

  for (const t of terms.filter((x) => x.year === 2027)) {
    if (course.offered.length === 0) {
      issues.push({ level: "warn", code: "not_offered", message: "The 2027 catalogue lists no offering for this course." });
      break;
    }
    if (!course.offered.includes(t.session)) {
      issues.push({
        level: "warn",
        code: "not_offered",
        message: `Not listed for ${official(t.session)} 2027. The 2027 catalogue lists ${course.offered.map(official).join(", ")}.`,
      });
    }
  }
  return issues;
}
