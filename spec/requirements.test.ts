import { describe, expect, it } from "vitest";
import { catalogue as seed } from "../src/data/catalogue";
import { programByCode, programs } from "../src/data/programs";
import { checkPlacement } from "../src/lib/checks";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { courseTarget, evaluate, filled } from "../src/lib/progress";
import { courseCodes, type ReqNode, walk } from "../src/lib/requirements";
import type { Course, PlanEntry } from "../src/lib/schema";
import type { Session, Status } from "../src/lib/terms";

// Promises that hold without a server: the transcription and catalogue are
// faithful to the official pages, and the one evaluation every view reads
// credits each course once, never beyond what a requirement can hold.

const catalogue = new Map<string, Course>(seed.map((c) => [c.code, c as Course]));

const target = (node: ReqNode): number =>
  node.kind === "course" ? courseTarget(node, catalogue) : node.kind === "all" ? (node.units ?? 0) : node.units;

describe("verified catalogue", () => {
  it("holds the official 2027 undergraduate list, with page detail for every course a program names", () => {
    expect(catalogue.size).toBe(1523);
    for (const p of programs) {
      for (const code of courseCodes(p.requirements)) expect(catalogue.get(code)?.detailed, `${p.code}: ${code}`).toBe(true);
    }
    expect(catalogue.has("COMP0721")).toBe(false);
  });

  it("marks exactly the courses whose pages say they run over two semesters", () => {
    const twoSemester = [...catalogue.values()].filter((c) => c.semesters === 2).map((c) => c.code);
    expect(twoSemester.sort()).toEqual(["COMP3500", "COMP3770", "COMP4500", "COMP4550", "ENGN4300", "ENGN4350"]);
  });
});

describe("transcribed requirements", () => {
  it("adds each program's requirements up to its official total", () => {
    for (const p of programs) {
      expect(p.requirements.reduce((n, node) => n + target(node), 0), p.code).toBe(p.units);
      expect(p.constraints.find((c) => c.kind === "total")?.units, p.code).toBe(p.units);
    }
  });

  it("adds every fixed group's parts up to the units its official wording states", () => {
    for (const p of programs) {
      walk(p.requirements, (node) => {
        if (node.kind !== "all" || node.units === undefined) return;
        if (node.children.some((c) => c.kind === "pick" && c.bound !== "exact")) return;
        expect(node.children.reduce((n, c) => n + target(c), 0), `${p.code} ${node.id}`).toBe(node.units);
      });
    }
  });

  it("gives every group a unique id within its program", () => {
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
const run = (code: string, entries: PlanEntry[], choices = {}, selections = {}) =>
  evaluate(program(code), entries, choices, selections, catalogue);
const creditOf = (e: ReturnType<typeof run>, x: PlanEntry) => e.credit.get(x.id)?.nodeId;

describe("allocation", () => {
  it("credits a named course to its listing", () => {
    const c = entry("COMP1100", "completed", 2025);
    const e = run("AACOM", [c]);
    expect(creditOf(e, c)).toBe("prog1");
    expect(e.tally.get("prog1")).toMatchObject({ target: 6, completed: 6 });
  });

  it("never credits a choose-one requirement twice: the second option goes elsewhere", () => {
    const a = entry("MATH1005", "completed", 2025);
    const b = entry("MATH2222", "completed", 2025, "S2");
    const e = run("AACOM", [a, b]);
    expect(e.tally.get("maths")).toMatchObject({ target: 6, completed: 6 });
    expect(creditOf(e, a)).toBe("maths");
    expect(creditOf(e, b)).toBe("electives");
  });

  it("lets the student pick which option satisfies a choose-one requirement", () => {
    const a = entry("MATH1005", "completed", 2025);
    const b = entry("MATH2222", "completed", 2025, "S2");
    const e = run("AACOM", [a, b], {}, { maths: "MATH2222" });
    expect(creditOf(e, b)).toBe("maths");
    expect(creditOf(e, a)).toBe("electives");
    expect(e.selections).toEqual({ maths: "MATH2222" });
  });

  it("credits a course listed in two places only once", () => {
    const c = entry("COMP3630", "completed", 2026);
    const e = run("AACOM", [c], { specialisation: "THCS-SPEC" });
    expect(creditOf(e, c)).toBe("compulsory");
    expect(filled(e.tally.get("THCS-SPEC.b") ?? { completed: 0, current: 0, planned: 0 })).toBe(0);
    expect(filled(e.summary.counting)).toBe(6);
  });

  it("treats a two-semester course as one record worth both semesters", () => {
    const c = entry("COMP4550", "planned", 2027);
    const e = run("AACOM", [c], { final: "final.research" });
    expect(e.tally.get("final.research")).toMatchObject({ target: 24, planned: 24 });
    expect(e.summary.inPlan.planned).toBe(24);
  });

  it("previews an unchosen pathway without counting it, and lets its courses count as electives meanwhile", () => {
    const c = entry("COMP3320", "completed", 2026);
    const e = run("BCOMP", [c]);
    expect(creditOf(e, c)).toBe("electives");
    expect(e.preview.get("COMS-MAJ.a")).toMatchObject({ completed: 6 });
    expect(e.preview.get("comp48")).toMatchObject({ completed: 6 });
    expect(["comp48", "COMS-MAJ"]).toContain(e.bestOption.get("computing"));
    const chosen = run("BCOMP", [c], { computing: "COMS-MAJ" });
    expect(creditOf(chosen, c)).toBe("COMS-MAJ.a");
  });

  it("puts a course whole into an open requirement that can hold it, rather than part of it into one that can't", () => {
    const c = entry("COMP4550", "planned", 2028);
    const e = run("AACOM", [c]);
    expect(e.credit.get(c.id)).toMatchObject({ nodeId: "electives", units: 24 });
    expect(filled(e.summary.notCounting)).toBe(0);
  });

  it("fills a filtered requirement before unrestricted electives", () => {
    const c = entry("COMP3320", "planned", 2027);
    expect(creditOf(run("AACOM", [c]), c)).toBe("comp34");
  });

  it("keeps the headline, the tree and the total-units rule on the same number, capped at the program", () => {
    const many = [...catalogue.values()]
      .filter((c) => c.code.startsWith("COMP") && c.semesters === 1 && c.unitsMin === 6)
      .slice(0, 45)
      .map((c, i) => entry(c.code, "completed", 2015 + Math.floor(i / 6), i % 2 ? "S2" : "S1"));
    const e = run("AACOM", many);
    const top = program("AACOM").requirements.reduce((n, node) => n + filled(e.tally.get(node.id) ?? { completed: 0, current: 0, planned: 0 }), 0);
    expect(filled(e.summary.counting)).toBe(top);
    expect(filled(e.summary.counting)).toBeLessThanOrEqual(192);
    expect(e.constraints.find((c) => c.constraint.kind === "total")?.completed).toBe(top);
    expect(filled(e.summary.inPlan)).toBe(filled(e.summary.counting) + filled(e.summary.notCounting));
  });

  it("flags a whole-program maximum when the plan exceeds it", () => {
    // eleven 1000-level courses, none incompatible with another
    const codes = ["COMP1100", "COMP1110", "COMP1600", "COMP1720", "MATH1005", "MATH1013", "MATH1014", "STAT1003", "ENGN1211", "INFS1001", "PHIL1004"];
    const entries = codes.map((c, i) => entry(c, "completed", 2020 + Math.floor(i / 4), i % 2 ? "S2" : "S1"));
    const cap = run("AACOM", entries).constraints.find((c) => c.constraint.id === "level1");
    expect(cap?.completed).toBeGreaterThan(60);
    expect(cap?.met).toBe(false);
  });
});

describe("consistency checks", () => {
  const facts = (code: string) => {
    const c = catalogue.get(code);
    if (!c) throw new Error(code);
    return c;
  };
  const now = { year: 2026, session: "S2" as Session };
  const at = (courseCode: string, status: Status, year: number, session: Session, units = 6) => ({ courseCode, status, year, session, units });
  const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

  it("warns about status and term contradictions without blocking them", () => {
    expect(codes(checkPlacement(at("COMP1100", "completed", 2027, "S1"), facts("COMP1100"), now, []))).toContain("completed_future");
    expect(codes(checkPlacement(at("COMP1100", "planned", 2025, "S1"), facts("COMP1100"), now, []))).toContain("planned_past");
    expect(codes(checkPlacement(at("COMP1100", "current", 2027, "S1"), facts("COMP1100"), now, []))).toContain("current_not_now");
    expect(checkPlacement(at("COMP1100", "current", 2026, "S2"), facts("COMP1100"), now, []).every((i) => i.level === "warn")).toBe(true);
  });

  it("warns above the standard 24-unit load, and more strongly above the 36-unit policy maximum", () => {
    const others = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ placement: at(`COMP${2100 + i}`, "planned", 2027, "S1"), semesters: 1 }));
    expect(codes(checkPlacement(at("COMP1100", "planned", 2027, "S1"), facts("COMP1100"), now, others(4)))).toContain("heavy_load");
    const over = checkPlacement(at("COMP1100", "planned", 2027, "S1"), facts("COMP1100"), now, others(6));
    expect(over.find((i) => i.code === "over_limit")?.level).toBe("warn");
  });

  it("warns when a 2027 session isn't one the course is listed for", () => {
    const c = facts("COMP1600");
    expect(c.offered).toEqual(["S2"]);
    expect(codes(checkPlacement(at("COMP1600", "planned", 2027, "S1"), c, now, []))).toContain("not_offered");
  });

  it("blocks units outside the official range, and only warns about a two-semester course outside a semester", () => {
    expect(checkPlacement(at("ENGN4300", "planned", 2027, "S1", 13), facts("ENGN4300"), now, []).find((i) => i.code === "invalid_units")?.level).toBe("block");
    expect(checkPlacement(at("COMP4550", "planned", 2027, "WIN", 12), facts("COMP4550"), now, []).find((i) => i.code === "two_semester_session")?.level).toBe("warn");
  });
});

describe("passwords", () => {
  it("are stored salted and hashed, never as the password", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toContain("correct horse battery");
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong horse battery", a)).toBe(false);
  });
});
