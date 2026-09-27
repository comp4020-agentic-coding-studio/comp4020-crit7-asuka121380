import type { AllNode, Constraint, CourseRef, OpenNode, Program, ReqNode } from "./requirements";
import { matches } from "./requirements";
import type { Course, PlanEntry, Status } from "./schema";
import { termOrder } from "./terms";

// Reads a student's entries against one program's requirement tree. This is
// a planning estimate, not an audit: courses listed by name count wherever
// they're listed, and everything else is placed greedily into the first open
// bucket ("any 18 units of 3000/4000-level COMP", electives, ...) that fits.

export type Tally = { target: number; completed: number; current: number; planned: number };
export type LeafStatus = Status | "none";

export type Evaluation = {
  tally: Map<string, Tally>;
  leaf: Map<string, { status: LeafStatus; entries: PlanEntry[] }>;
  bucket: Map<string, PlanEntry[]>;
  bestOption: Map<string, string>;
  countsToward: Map<number, string[]>;
  unassigned: PlanEntry[];
  constraints: { constraint: Constraint; completed: number; current: number; planned: number; met: boolean }[];
};

const STATUS_ORDER: Status[] = ["completed", "current", "planned"];

const empty = (target: number): Tally => ({ target, completed: 0, current: 0, planned: 0 });

function cap(raw: Tally, target: number): Tally {
  const completed = Math.min(raw.completed, target);
  const current = Math.min(raw.current, target - completed);
  const planned = Math.min(raw.planned, target - completed - current);
  return { target, completed, current, planned };
}

const add = (a: Tally, b: Tally): Tally => ({
  target: a.target + b.target,
  completed: a.completed + b.completed,
  current: a.current + b.current,
  planned: a.planned + b.planned,
});

export const filled = (t: Tally) => t.completed + t.current + t.planned;

export function courseTarget(ref: CourseRef, catalogue: Map<string, Course>): number {
  return ref.units ?? (catalogue.get(ref.code)?.unitsMin ?? 6) * (ref.enrolments ?? 1);
}

export function evaluate(
  program: Program,
  entries: PlanEntry[],
  choices: Record<string, string>,
  catalogue: Map<string, Course>,
): Evaluation {
  const tps = (code: string) => catalogue.get(code)?.transdisciplinary ?? false;
  const byCode = new Map<string, PlanEntry[]>();
  for (const e of entries) byCode.set(e.courseCode, [...(byCode.get(e.courseCode) ?? []), e]);

  // Courses named anywhere still in play are "claimed" by that listing and
  // never leak into an open bucket.
  const claimed = new Set<string>();
  const buckets: OpenNode[] = [];
  const countsToward = new Map<number, string[]>();
  const credit = (code: string, label: string) => {
    for (const e of byCode.get(code) ?? []) {
      const labels = countsToward.get(e.id) ?? [];
      if (!labels.includes(label)) countsToward.set(e.id, [...labels, label]);
    }
  };

  const scan = (nodes: ReqNode[], label: string, active: boolean) => {
    for (const node of nodes) {
      if (node.kind === "course") {
        claimed.add(node.code);
        if (active) credit(node.code, label);
      } else if (node.kind === "open") {
        if (active) buckets.push(node);
      } else if (node.kind === "one") {
        const chosen = choices[node.id];
        for (const option of node.options) {
          const isActive = active && option.id === chosen;
          if (chosen && option.id !== chosen) continue;
          if (option.kind === "open") {
            if (isActive) buckets.push(option);
          } else scan(option.children, option.title, isActive);
        }
      } else scan(node.children, node.title, active);
    }
  };
  scan(program.requirements, "", true);

  // Open buckets with a filter fill before the unrestricted elective ones.
  const ordered = [...buckets.filter((b) => b.filter), ...buckets.filter((b) => !b.filter)];
  const room = new Map(ordered.map((b) => [b.id, b.units]));
  const bucket = new Map<string, PlanEntry[]>(ordered.map((b) => [b.id, []]));
  const unassigned: PlanEntry[] = [];
  const free = entries
    .filter((e) => !claimed.has(e.courseCode))
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        termOrder(a.year, a.session) - termOrder(b.year, b.session),
    );
  for (const e of free) {
    const target = ordered.find((b) => (room.get(b.id) ?? 0) > 0 && matches(b.filter, e.courseCode, tps(e.courseCode)));
    if (!target) {
      unassigned.push(e);
      continue;
    }
    room.set(target.id, (room.get(target.id) ?? 0) - e.units);
    bucket.get(target.id)?.push(e);
    countsToward.set(e.id, [target.title]);
  }

  const tally = new Map<string, Tally>();
  const leaf = new Map<string, { status: LeafStatus; entries: PlanEntry[] }>();
  const bestOption = new Map<string, string>();

  const raw = (list: PlanEntry[], target: number): Tally => {
    const t = empty(target);
    for (const e of list) t[e.status] += e.units;
    return t;
  };

  const score = (node: ReqNode): Tally => {
    switch (node.kind) {
      case "course": {
        const target = courseTarget(node, catalogue);
        const list = byCode.get(node.code) ?? [];
        const r = raw(list, target);
        const has = (st: Status) => list.some((e) => e.status === st);
        // a 0-unit course (ENGN3100) is done when an enrolment is completed
        const done = target > 0 ? r.completed >= target : has("completed");
        const status: LeafStatus =
          list.length === 0 ? "none" : done ? "completed" : has("current") ? "current" : has("planned") ? "planned" : "completed";
        leaf.set(node.code, { status, entries: list });
        return cap(r, target);
      }
      case "open": {
        const t = cap(raw(bucket.get(node.id) ?? [], node.units), node.units);
        tally.set(node.id, t);
        return t;
      }
      case "one": {
        const scored = node.options.map((o) => ({ o, t: score(o) }));
        const chosen = scored.find((s) => s.o.id === choices[node.id]);
        const best = chosen ?? scored.reduce((a, b) => (filled(b.t) > filled(a.t) ? b : a));
        if (!chosen && filled(best.t) > 0) bestOption.set(node.id, best.o.id);
        const t = cap(best.t, node.units);
        tally.set(node.id, t);
        return t;
      }
      default: {
        const sum = node.children.map(score).reduce(add, empty(0));
        const target = node.units ?? (node as AllNode).children.reduce((n, c) => n + targetOf(c), 0);
        const t = cap(sum, target);
        tally.set(node.id, t);
        return t;
      }
    }
  };
  const targetOf = (node: ReqNode): number =>
    node.kind === "course" ? courseTarget(node, catalogue) : node.kind === "all" ? (node.units ?? 0) : node.units;
  for (const node of program.requirements) score(node);

  const constraints = program.constraints.map((constraint) => {
    const t = empty(constraint.units);
    for (const e of entries) {
      if (constraint.kind === "total" || matches(constraint.filter, e.courseCode, tps(e.courseCode))) t[e.status] += e.units;
    }
    const total = filled(t);
    return { constraint, ...t, met: constraint.kind === "max" ? total <= constraint.units : total >= constraint.units };
  });

  return { tally, leaf, bucket, bestOption, countsToward, unassigned, constraints };
}
