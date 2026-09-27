import { type CourseRules, describe, evaluate, type PlanCourse, type Req } from "./rules";
import { type Session, SESSIONS, type Status, termLabel, termOrder, termShort } from "./terms";

// What the planner says about placing a course, shared by the server (which
// returns it with every save) and the course panel (which shows it live).
//
//   block — a data-integrity problem the server refuses (only invalid units
//           here; duplicates and unknown courses are refused in forms.ts)
//   warn  — a planning concern: shown before saving, never refused
//   info  — context: what the official page says, or what can't be checked
//
// Course history is fact: Completed and Studying now are never warned about
// the course's 2027 rules, only informed. Planned courses get the checks.

export type Issue = { level: "block" | "warn" | "info"; code: string; message: string };

export type CourseFacts = {
  code: string;
  unitsMin: number;
  unitsMax: number;
  semesters: number;
  offered: Session[];
  rules?: CourseRules | null;
};

export type Placement = { courseCode: string; status: Status; year: number; session: Session; units: number };
export type Term = { year: number; session: Session };
export type Other = { placement: Placement; semesters: number; rules?: CourseRules | null };

const official = (s: Session) => SESSIONS.find((x) => x.id === s)?.official ?? s;
const STATUS_WORD: Record<Status, string> = { completed: "Completed", current: "Studying now", planned: "Planned" };

// A two-semester course runs into the next semester after it starts.
const NEXT_SEMESTER: Record<Session, (y: number) => Term> = {
  SUM: (y) => ({ year: y, session: "S1" }),
  S1: (y) => ({ year: y, session: "S2" }),
  AUT: (y) => ({ year: y, session: "S2" }),
  WIN: (y) => ({ year: y, session: "S2" }),
  S2: (y) => ({ year: y + 1, session: "S1" }),
  SPR: (y) => ({ year: y + 1, session: "S1" }),
};

export function termsOccupied(year: number, session: Session, semesters: number): Term[] {
  return semesters < 2 ? [{ year, session }] : [{ year, session }, NEXT_SEMESTER[session](year)];
}

// ANU study periods: 1 = Summer, First Semester, Autumn; 2 = Winter, Second
// Semester, Spring (Student academic study load and progression policy, cl. 2).
export const studyPeriod = (t: Term) => `${t.year}-${["SUM", "S1", "AUT"].includes(t.session) ? 1 : 2}`;

export const STANDARD_LOAD = 24;
export const MAX_LOAD = 36;

const ordinal = (i: number) => ["first", "second", "third", "fourth", "fifth", "sixth"][i] ?? `${i + 1}th`;

// The plan as the rule evaluator sees it: each course with when it starts
// and ends.
export function planCourses(others: Other[]): PlanCourse[] {
  return others.map((o) => {
    const terms = termsOccupied(o.placement.year, o.placement.session, o.semesters);
    const last = terms.at(-1) ?? terms[0];
    return {
      code: o.placement.courseCode,
      units: o.placement.units * o.semesters,
      start: termOrder(o.placement.year, o.placement.session),
      end: termOrder(last.year, last.session),
      label: `${STATUS_WORD[o.placement.status]} · ${termShort(o.placement.year, o.placement.session)}`,
    };
  });
}

// Prerequisite findings, one per top-level group, in the brief's style:
// what the plan shows, what it doesn't, and what can't be checked.
export function prerequisiteFindings(
  req: Req,
  ctx: { plan: PlanCourse[]; before: number; program: string | null; self: string; term: string },
): Issue[] {
  const groups = req.type === "and" ? req.children : [req];
  return groups.map((group, i) => {
    const name = groups.length > 1 ? `the ${ordinal(i)} prerequisite group (${describe(group)})` : `the prerequisite (${describe(group)})`;
    const f = evaluate(group, ctx);
    if (f.state === "met") {
      return { level: "info" as const, code: "prerequisite_group_shown", message: `Your plan shows ${f.detail}, which appears to satisfy ${name}.` };
    }
    if (f.state === "unknown") {
      return { level: "info" as const, code: "prerequisite_unverifiable", message: `The planner can't confirm ${name}: ${f.detail}.` };
    }
    return {
      level: "warn" as const,
      code: "prerequisite_group_not_shown",
      message: `The plan does not yet show ${name} before ${ctx.term}${f.detail && !/^none of these/.test(f.detail) ? ` (${f.detail})` : ""}.`,
    };
  });
}

export function checkPlacement(p: Placement, course: CourseFacts, now: Term, others: Other[], program: string | null = null): Issue[] {
  const issues: Issue[] = [];
  const planned = p.status === "planned";
  const concern = planned ? ("warn" as const) : ("info" as const);

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
      level: concern,
      code: "two_semester_session",
      message: `${course.code} normally runs over two consecutive semesters, starting in Semester 1 or Semester 2.`,
    });
  }

  // study load, by ANU study period
  const terms = termsOccupied(p.year, p.session, course.semesters);
  const load = new Map<string, number>();
  const addLoad = (pl: Placement, semesters: number) => {
    for (const t of termsOccupied(pl.year, pl.session, semesters)) {
      load.set(studyPeriod(t), (load.get(studyPeriod(t)) ?? 0) + pl.units);
    }
  };
  for (const o of others) addLoad(o.placement, o.semesters);
  addLoad(p, course.semesters);
  for (const t of new Map(terms.map((x) => [studyPeriod(x), x])).values()) {
    const units = load.get(studyPeriod(t)) ?? 0;
    const period = `study period ${studyPeriod(t).slice(-1)} of ${t.year}`;
    if (units > MAX_LOAD) {
      issues.push({
        level: concern,
        code: "over_limit",
        message: `That makes ${units} units in ${period}. ANU policy says permission isn't given for more than ${MAX_LOAD} units in a study period.`,
      });
    } else if (units > STANDARD_LOAD) {
      issues.push({
        level: concern,
        code: "heavy_load",
        message: `That makes ${units} units in ${period}, above the standard ${STANDARD_LOAD}-unit load. More needs overload approval.`,
      });
    }
  }

  // status against the calendar
  const start = termOrder(p.year, p.session);
  const last = terms.at(-1) ?? terms[0];
  const end = termOrder(last.year, last.session);
  const current = termOrder(now.year, now.session);
  if (p.status === "completed" && end > current) {
    issues.push({ level: "warn", code: "completed_future", message: `Marked completed, but ${termLabel(last.year, last.session)} hasn't finished yet.` });
  }
  if (planned && start < current) {
    issues.push({ level: "warn", code: "planned_past", message: `Planned for ${termLabel(p.year, p.session)}, which has already passed.` });
  }
  if (p.status === "current" && (start > current || end < current)) {
    issues.push({
      level: "warn",
      code: "current_not_now",
      message: `Marked as studying now, but it isn't placed in the current semester (${termLabel(now.year, now.session)}).`,
    });
  }

  // 2027 offerings apply only to 2027 terms
  for (const t of terms.filter((x) => x.year === 2027)) {
    if (course.offered.length === 0) {
      issues.push({ level: concern, code: "not_offered", message: "The 2027 catalogue lists no offering for this course." });
      break;
    }
    if (!course.offered.includes(t.session)) {
      issues.push({
        level: concern,
        code: "not_offered",
        message: `The 2027 catalogue doesn't list ${official(t.session)} 2027 for this course; it lists ${course.offered.map(official).join(", ")}.`,
      });
    }
  }

  // incompatibilities, in either direction, as each official page states them
  const rules = course.rules;
  for (const o of others) {
    const theirs = o.placement.courseCode;
    const mine = rules?.incompatible.includes(theirs);
    const reverse = o.rules?.incompatible.includes(course.code);
    if (!mine && !reverse) continue;
    const where = `${STATUS_WORD[o.placement.status]} · ${termLabel(o.placement.year, o.placement.session)}`;
    issues.push({
      level: concern,
      code: "incompatible_in_plan",
      message: `The official 2027 course page for ${mine ? course.code : theirs} lists ${mine ? theirs : course.code} as incompatible, and ${theirs} is in your plan (${where}). Only one of them would count toward the degree.`,
    });
  }

  if (!rules) {
    if (planned) {
      issues.push({
        level: "info",
        code: "rules_not_read",
        message: "The planner hasn't read this course's requisites. Check them on the official course page.",
      });
    }
    return issues;
  }

  // prerequisites: checked for planned courses; history is never re-judged
  if (rules.prerequisite && p.status !== "completed") {
    const ctx = { plan: planCourses(others), before: start, program, self: course.code, term: termLabel(p.year, p.session) };
    const findings = prerequisiteFindings(rules.prerequisite, ctx);
    issues.push(...(planned ? findings : findings.map((f) => ({ ...f, level: "info" as const }))));
  }
  if (p.status !== "completed") {
    for (const text of rules.permission) issues.push({ level: "info", code: "permission_required", message: `The official page says: “${text}”` });
    for (const text of rules.programRestrictions) issues.push({ level: "info", code: "program_restriction", message: `The official page says: “${text}”` });
    if (rules.confidence === "partial" || rules.confidence === "wording-only") {
      issues.push({
        level: "info",
        code: "rules_partly_read",
        message: "Some of this course's conditions are shown in their official wording because the planner couldn't interpret every one reliably.",
      });
    }
  }
  return issues;
}
