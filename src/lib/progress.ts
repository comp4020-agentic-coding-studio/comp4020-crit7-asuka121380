import type { AllNode, Constraint, CourseRef, OneNode, OpenNode, PickNode, Program, ReqNode } from "./requirements";
import { matches } from "./requirements";
import type { Course, PlanEntry } from "./schema";
import type { Status } from "./terms";
import { termOrder } from "./terms";

// The one place progress is calculated. Every course record credits at most
// one requirement, never more than that requirement (or any group around it)
// can hold; the tree, the headline, the whole-program rules and the semester
// plan all read the result, so they can't disagree. It is a planning
// estimate, not an audit.
//
// Allocation order, across the part of the tree in play (chosen pathways
// only): compulsory courses, then exact "choose" lists, then "at least"
// bands, then "up to" bands, then open requirements with a filter, then
// unrestricted electives. Within a "choose" list the student's selection
// goes first; otherwise completed before current before planned, earliest
// first.

export type Units = { completed: number; current: number; planned: number };
export type Tally = Units & { target: number };
export type Credit = { nodeId: string; title: string; units: number };

export type Evaluation = {
  tally: Map<string, Tally>;
  credit: Map<number, Credit>;
  // what an unchosen pathway would hold if it were chosen
  preview: Map<string, Tally>;
  previewCredit: Map<number, Credit>;
  bestOption: Map<string, string>;
  byCode: Map<string, PlanEntry>;
  selections: Record<string, string>;
  unassigned: PlanEntry[];
  constraints: {
    constraint: Constraint;
    completed: number;
    current: number;
    planned: number;
    unknownTag: number;
    met: boolean;
  }[];
  summary: { target: number; inPlan: Units; counting: Units; notCounting: Units };
};

const STATUS_ORDER: Status[] = ["completed", "current", "planned"];
const zero = (): Units => ({ completed: 0, current: 0, planned: 0 });
export const filled = (t: Units) => t.completed + t.current + t.planned;

export const semestersOf = (code: string, catalogue: Map<string, Course>) => catalogue.get(code)?.semesters ?? 1;
export const entryUnits = (e: PlanEntry, catalogue: Map<string, Course>) => e.units * semestersOf(e.courseCode, catalogue);

export function courseTarget(ref: CourseRef, catalogue: Map<string, Course>): number {
  const c = catalogue.get(ref.code);
  return ref.units ?? (c?.unitsMin ?? 6) * (c?.semesters ?? 1);
}

const targetOf = (node: ReqNode, catalogue: Map<string, Course>): number =>
  node.kind === "course" ? courseTarget(node, catalogue) : node.kind === "all" ? (node.units ?? 0) : node.units;

type Group = AllNode | PickNode | OneNode | OpenNode;
type Slot =
  | { kind: "course"; cls: 0; node: AllNode; code: string; room: number; chain: Group[] }
  | { kind: "pick"; cls: 1 | 2 | 3; node: PickNode; codes: string[]; room: number; chain: Group[] }
  | { kind: "open"; cls: 4 | 5; node: OpenNode; room: number; chain: Group[] };

type Allocation = { credit: Map<number, Credit>; tally: Map<string, Tally> };

function allocate(
  roots: ReqNode[],
  entries: PlanEntry[],
  choices: Record<string, string>,
  selections: Record<string, string>,
  catalogue: Map<string, Course>,
): Allocation {
  const byCode = new Map(entries.map((e) => [e.courseCode, e]));
  const tps = (code: string) => catalogue.get(code)?.transdisciplinary ?? false;
  const slots: Slot[] = [];

  // Remaining capacity of every group with a unit total, shared by the
  // slots beneath it.
  const room = new Map<string, number>();
  const collect = (nodes: ReqNode[], chain: Group[]) => {
    for (const node of nodes) {
      if (node.kind === "course") continue;
      if (node.kind === "one") {
        room.set(node.id, node.units);
        const chosen = node.options.find((o) => o.id === choices[node.id]);
        if (chosen) collect([chosen], [...chain, node]);
        continue;
      }
      const here = [...chain, node];
      if (node.kind === "open") {
        room.set(node.id, node.units);
        slots.push({ kind: "open", cls: node.filter ? 4 : 5, node, room: node.units, chain: here });
      } else if (node.kind === "pick") {
        // "at least N" can take more than N: up to what its group leaves
        // after the fixed parts beside it
        const parent = chain.at(-1);
        let cap = node.units;
        if (node.bound === "min" && parent?.kind === "all" && parent.units) {
          const fixed = parent.children.reduce(
            (n, c) =>
              n +
              (c.kind === "all" || c.kind === "course" || (c.kind === "pick" && c.bound === "exact")
                ? targetOf(c, catalogue)
                : 0),
            0,
          );
          cap = parent.units - fixed;
        }
        room.set(node.id, cap);
        const cls = node.bound === "exact" ? 1 : node.bound === "min" ? 2 : 3;
        const codes = node.children.filter((c): c is CourseRef => c.kind === "course").map((c) => c.code);
        slots.push({ kind: "pick", cls, node, codes, room: cap, chain: here });
      } else {
        if (node.units !== undefined) room.set(node.id, node.units);
        for (const child of node.children) {
          if (child.kind === "course") {
            slots.push({
              kind: "course",
              cls: 0,
              node,
              code: child.code,
              room: courseTarget(child, catalogue),
              chain: here,
            });
          }
        }
        collect(node.children, here);
      }
    }
  };
  collect(roots, []);

  const credit = new Map<number, Credit>();
  const own = new Map<string, Units>();
  const available = (slot: Slot) =>
    Math.min(slot.room, ...slot.chain.map((g) => room.get(g.id) ?? Number.POSITIVE_INFINITY));
  const give = (slot: Slot, e: PlanEntry) => {
    const units = Math.min(entryUnits(e, catalogue), available(slot));
    if (units <= 0) return;
    slot.room -= units;
    for (const g of slot.chain) if (room.has(g.id)) room.set(g.id, (room.get(g.id) ?? 0) - units);
    credit.set(e.id, { nodeId: slot.node.id, title: slot.node.title, units });
    const u = own.get(slot.node.id) ?? zero();
    u[e.status] += units;
    own.set(slot.node.id, u);
  };
  const order = (a: PlanEntry, b: PlanEntry) =>
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
    termOrder(a.year, a.session) - termOrder(b.year, b.session);

  for (const cls of [0, 1, 2, 3] as const) {
    for (const slot of slots.filter((s) => s.cls === cls)) {
      if (slot.kind === "course") {
        const e = byCode.get(slot.code);
        if (e && !credit.has(e.id)) give(slot, e);
      } else if (slot.kind === "pick") {
        const pinned = selections[slot.node.id];
        const candidates = slot.codes
          .map((c) => byCode.get(c))
          .filter((e): e is PlanEntry => e !== undefined && !credit.has(e.id))
          .sort((a, b) => Number(b.courseCode === pinned) - Number(a.courseCode === pinned) || order(a, b));
        for (const e of candidates) {
          if (available(slot) <= 0) break;
          give(slot, e);
        }
      }
    }
  }

  const buckets = slots
    .filter((s): s is Extract<Slot, { kind: "open" }> => s.kind === "open")
    .sort((a, b) => a.cls - b.cls);
  // A course goes whole into the first open requirement with room for all of
  // it; only if none has room does it take a partial place (a course never
  // splits across requirements).
  for (const e of entries.filter((x) => !credit.has(x.id)).sort(order)) {
    const fits = buckets.filter((b) => matches(b.node.filter, e.courseCode, tps(e.courseCode)));
    const slot = fits.find((b) => available(b) >= entryUnits(e, catalogue)) ?? fits.find((b) => available(b) > 0);
    if (slot) give(slot, e);
  }

  // Group tallies: what was credited here plus what the groups inside hold,
  // never more than the group's own total.
  const tally = new Map<string, Tally>();
  const capAt = (u: Units, target: number): Tally => {
    const completed = Math.min(u.completed, target);
    const current = Math.min(u.current, target - completed);
    const planned = Math.min(u.planned, target - completed - current);
    return { target, completed, current, planned };
  };
  const add = (into: Units, t: Units | null) => {
    if (t) for (const s of STATUS_ORDER) into[s] += t[s];
  };
  const score = (node: ReqNode): Tally | null => {
    if (node.kind === "course") return null;
    const sum = { ...(own.get(node.id) ?? zero()) };
    let target = targetOf(node, catalogue);
    if (node.kind === "one") {
      const chosen = node.options.find((o) => o.id === choices[node.id]);
      add(sum, chosen ? score(chosen) : null);
    } else if (node.kind !== "open") {
      for (const child of node.children) add(sum, score(child));
      if (node.kind === "all" && node.units === undefined) {
        target = node.children.reduce((n, c) => n + targetOf(c, catalogue), 0);
      }
    }
    const t = capAt(sum, target);
    tally.set(node.id, t);
    return t;
  };
  roots.forEach(score);
  return { credit, tally };
}

function openIds(nodes: ReqNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: ReqNode[]) => {
    for (const n of list) {
      if (n.kind === "open") ids.add(n.id);
      if (n.kind === "all" || n.kind === "pick") walk(n.children);
      if (n.kind === "one") walk(n.options);
    }
  };
  walk(nodes);
  return ids;
}

export function evaluate(
  program: Program,
  entries: PlanEntry[],
  choices: Record<string, string>,
  selections: Record<string, string>,
  catalogue: Map<string, Course>,
): Evaluation {
  const main = allocate(program.requirements, entries, choices, selections, catalogue);

  // Unchosen pathways: what each would hold if chosen, from the courses the
  // rest of the tree hasn't claimed by name (open requirements give theirs
  // back, since a choice would re-place them).
  const open = openIds(program.requirements);
  const free = entries.filter((e) => {
    const c = main.credit.get(e.id);
    return !c || open.has(c.nodeId);
  });
  const preview = new Map<string, Tally>();
  const previewCredit = new Map<number, Credit>();
  const bestOption = new Map<string, string>();
  const visit = (nodes: ReqNode[]) => {
    for (const node of nodes) {
      if (node.kind === "one") {
        let best: { id: string; filled: number } | null = null;
        for (const option of node.options) {
          if (option.id === choices[node.id]) {
            visit([option]);
            continue;
          }
          const p = allocate([option], free, choices, selections, catalogue);
          for (const [id, t] of p.tally) preview.set(id, t);
          for (const [id, c] of p.credit) if (!previewCredit.has(id)) previewCredit.set(id, c);
          const f = filled(p.tally.get(option.id) ?? zero());
          if (!choices[node.id] && f > 0 && (!best || f > best.filled)) best = { id: option.id, filled: f };
        }
        if (best) bestOption.set(node.id, best.id);
      } else if (node.kind === "all" || node.kind === "pick") visit(node.children);
    }
  };
  visit(program.requirements);

  const inPlan = zero();
  const counting = zero();
  for (const e of entries) {
    inPlan[e.status] += entryUnits(e, catalogue);
    counting[e.status] += main.credit.get(e.id)?.units ?? 0;
  }
  const notCounting = {
    completed: inPlan.completed - counting.completed,
    current: inPlan.current - counting.current,
    planned: inPlan.planned - counting.planned,
  };

  // Whole-program rules measure the units that count toward the degree.
  const constraints = program.constraints.map((constraint) => {
    const u = zero();
    let unknownTag = 0;
    for (const e of entries) {
      const credited = main.credit.get(e.id)?.units ?? 0;
      if (!credited) continue;
      const tag = catalogue.get(e.courseCode)?.transdisciplinary ?? null;
      if (constraint.filter?.transdisciplinary && tag === null) unknownTag += credited;
      if (constraint.kind === "total" || matches(constraint.filter, e.courseCode, tag ?? false)) u[e.status] += credited;
    }
    const t = filled(u);
    return {
      constraint,
      ...u,
      unknownTag,
      met: constraint.kind === "max" ? t <= constraint.units : t >= constraint.units,
    };
  });

  const effective: Record<string, string> = {};
  for (const [nodeId, code] of Object.entries(selections)) {
    const e = entries.find((x) => x.courseCode === code);
    if (e && main.credit.get(e.id)?.nodeId === nodeId) effective[nodeId] = code;
  }

  return {
    tally: main.tally,
    credit: main.credit,
    preview,
    previewCredit,
    bestOption,
    byCode: new Map(entries.map((e) => [e.courseCode, e])),
    selections: effective,
    unassigned: entries.filter((e) => !main.credit.has(e.id)),
    constraints,
    summary: { target: program.units, inPlan, counting, notCounting },
  };
}

// A "choose" list where any one course satisfies it: the case where the
// student can pick which of their courses counts.
export function isChooseOne(node: ReqNode, catalogue: Map<string, Course>): node is PickNode {
  return (
    node.kind === "pick" &&
    node.bound === "exact" &&
    node.children.length > 1 &&
    node.children.every((c) => c.kind === "course" && courseTarget(c, catalogue) === node.units)
  );
}
