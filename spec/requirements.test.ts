import { describe, expect, it } from "vitest";
import { catalogue as seed } from "../src/data/catalogue";
import { programByCode, programs } from "../src/data/programs";
import { courseTarget, evaluate } from "../src/lib/progress";
import { courseCodes, type ReqNode, walk } from "../src/lib/requirements";
import type { PlanEntry, Session, Status } from "../src/lib/schema";

// Two promises that hold without a server: the transcribed requirements add
// up the way the official pages say they do, and the evaluation that both
// views read places courses the way the README describes.

const catalogue = new Map(seed.map((c) => [c.code, c]));

const target = (node: ReqNode): number =>
  node.kind === "course" ? courseTarget(node, catalogue) : node.kind === "all" ? (node.units ?? 0) : node.units;

describe("transcribed requirements", () => {
  it("names only courses that exist in the scraped 2027 catalogue", () => {
    for (const p of programs) {
      for (const code of courseCodes(p.requirements)) expect(catalogue.has(code), `${p.code}: ${code}`).toBe(true);
    }
  });

  it("adds each program's requirements up to its official total", () => {
    for (const p of programs) {
      const sum = p.requirements.reduce((n, node) => n + target(node), 0);
      expect(sum, p.code).toBe(p.units);
      expect(p.constraints.find((c) => c.kind === "total")?.units, p.code).toBe(p.units);
    }
  });

  it("adds every fixed group's parts up to the units its official wording states", () => {
    for (const p of programs) {
      walk(p.requirements, (node) => {
        if (node.kind !== "all" || node.units === undefined) return;
        // min/max bands inside a group are ranges, so only fixed groups add up exactly
        if (node.children.some((c) => c.kind === "pick" && c.bound !== "exact")) return;
        const sum = node.children.reduce((n, c) => n + target(c), 0);
        expect(sum, `${p.code} ${node.id}`).toBe(node.units);
      });
    }
  });

  it("gives every node a unique id within its program", () => {
    for (const p of programs) {
      const ids: string[] = [];
      walk(p.requirements, (node) => node.kind !== "course" && ids.push(node.id));
      expect(new Set(ids).size, p.code).toBe(ids.length);
    }
  });
});

let nextId = 1;
const entry = (courseCode: string, status: Status, year: number, session: Session = "S1"): PlanEntry => ({
  id: nextId++,
  userId: 1,
  courseCode,
  status,
  year,
  session,
  units: catalogue.get(courseCode)?.unitsMin ?? 6,
  updatedAt: "",
});

const program = (code: string) => {
  const p = programByCode.get(code);
  if (!p) throw new Error(code);
  return p;
};

describe("evaluation", () => {
  it("shows a named course's status on its leaf and fills its group", () => {
    const e = evaluate(program("AACOM"), [entry("COMP1100", "completed", 2025)], {}, catalogue);
    expect(e.leaf.get("COMP1100")?.status).toBe("completed");
    expect(e.tally.get("prog1")).toMatchObject({ target: 6, completed: 6 });
  });

  it("caps a choose-one group: both alternatives done still fills 6 of 6", () => {
    const e = evaluate(
      program("AACOM"),
      [entry("COMP1100", "completed", 2025), entry("COMP1130", "completed", 2025, "S2")],
      {},
      catalogue,
    );
    expect(e.tally.get("prog1")).toMatchObject({ target: 6, completed: 6, current: 0, planned: 0 });
  });

  it("counts one semester of an annual course as half of it", () => {
    const e = evaluate(program("AACOM"), [entry("COMP4550", "planned", 2027)], { final: "final.research" }, catalogue);
    expect(e.leaf.get("COMP4550")?.status).toBe("planned");
    expect(e.tally.get("final.research")).toMatchObject({ target: 24, planned: 12 });
  });

  it("lets a course named only in an unchosen pathway count as an elective", () => {
    const e = evaluate(program("BCOMP"), [entry("COMP3320", "completed", 2026)], {}, catalogue);
    expect(e.bucket.get("electives")?.map((x) => x.courseCode)).toEqual(["COMP3320"]);
    expect(e.unassigned).toEqual([]);
  });

  it("keeps a course inside the pathway once that pathway is chosen", () => {
    const e = evaluate(program("BCOMP"), [entry("COMP3320", "completed", 2026)], { computing: "COMS-MAJ" }, catalogue);
    expect(e.tally.get("COMS-MAJ.a")).toMatchObject({ completed: 6 });
    expect(e.bucket.get("electives")).toEqual([]);
  });

  it("fills a filtered bucket before unrestricted electives", () => {
    const e = evaluate(program("AACOM"), [entry("COMP3320", "planned", 2027)], {}, catalogue);
    expect(e.bucket.get("comp34")?.map((x) => x.courseCode)).toEqual(["COMP3320"]);
    expect(e.bucket.get("electives")).toEqual([]);
  });

  it("flags a whole-program maximum when the plan exceeds it", () => {
    const firstYear = ["COMP1100", "COMP1110", "COMP1600", "MATH1005", "MATH1013", "MATH1014", "MATH1115", "MATH1116"];
    const extra = ["STAT1003", "STAT1008", "ENGN1211"];
    const entries = [...firstYear, ...extra].map((c, i) => entry(c, "completed", 2020 + Math.floor(i / 4), i % 2 ? "S2" : "S1"));
    const e = evaluate(program("AACOM"), entries, {}, catalogue);
    const cap = e.constraints.find((c) => c.constraint.id === "level1");
    expect(cap?.completed).toBe(66);
    expect(cap?.met).toBe(false);
  });
});
