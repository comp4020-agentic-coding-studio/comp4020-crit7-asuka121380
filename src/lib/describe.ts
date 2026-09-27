import type { Course } from "./schema";
import type { Filter, ReqNode } from "./requirements";
import { courseTarget } from "./progress";

// The short structural line under each group title. It is derived from the
// transcribed structure, never written by hand, so it can't drift from it.

export type Relation = "all" | "choose" | "min" | "max" | "one" | "open";

export function relation(node: ReqNode): Relation {
  if (node.kind === "pick") return node.bound === "exact" ? "choose" : node.bound;
  if (node.kind === "course") return "all";
  return node.kind;
}

export const RELATION_LABEL: Record<Relation, string> = {
  all: "All required",
  choose: "Choose",
  min: "At least",
  max: "Up to",
  one: "One pathway",
  open: "Any that fit",
};

function filterPhrase(filter?: Filter): string {
  if (!filter) return "any ANU courses";
  if (filter.transdisciplinary) return "Transdisciplinary-tagged courses";
  const levels = filter.levels?.map((l) => `${l}000`).join("/");
  const subjects = filter.subjects?.join(" or ") ?? "";
  return [levels && `${levels}-level`, subjects, "courses"].filter(Boolean).join(" ");
}

// [lead, rest]: the lead is the relation in words ("Choose 1 of 2"), bolded
// in the UI; the rest is the size of the requirement.
export function ruleLine(node: ReqNode, catalogue: Map<string, Course>): [string, string] {
  switch (node.kind) {
    case "all": {
      if (node.link) return ["Pathway", `${node.units} units`];
      const n = node.children.length;
      const units = node.units ? `${node.units} units` : "";
      return [n === 1 ? "Required" : `All ${n} required`, units];
    }
    case "pick": {
      const n = node.children.length;
      const single = node.children.every((c) => c.kind === "course" && courseTarget(c, catalogue) === node.units);
      if (node.bound === "exact") return single ? [`Choose 1 of ${n}`, `${node.units} units`] : [`Choose ${node.units} units`, `from ${n} courses`];
      if (node.bound === "min") return [`At least ${node.units} units`, `from ${n} courses`];
      return [`Up to ${node.units} units`, `from ${n} courses · optional`];
    }
    case "one":
      return ["One pathway", `of ${node.options.length} · ${node.units} units`];
    case "open":
      return [`Any ${node.units} units`, `of ${filterPhrase(node.filter)}`];
    case "course":
      return ["", ""];
  }
}
