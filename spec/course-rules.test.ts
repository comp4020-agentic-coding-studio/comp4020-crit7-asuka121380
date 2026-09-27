import { describe, expect, it } from "vitest";
import research from "../research/2027/courses.json";
import { catalogue as seed } from "../src/data/catalogue";
import { programByCode } from "../src/data/programs";
import { overrides } from "../src/data/rule-overrides";
import { checkPlacement, type Other, type Placement } from "../src/lib/checks";
import { evaluate as evaluatePlan, filled } from "../src/lib/progress";
import { buildRules, classify, type Req } from "../src/lib/rules";
import type { Course, PlanEntry } from "../src/lib/schema";
import type { Session, Status } from "../src/lib/terms";

// Course-page rules: the parser on representative official structures, a
// validator over every course the catalogue carries (the repeatable check a
// data refresh must pass), and how the rules are applied by status.

const catalogue = new Map<string, Course>(seed.map((c) => [c.code, c as Course]));
const official = research.courses as Record<string, { requisiteText: string; assumedKnowledge: string; coTaught: string[] }>;
const build = (code: string, requisiteText: string, extra: Partial<{ assumedKnowledge: string; coTaught: string[] }> = {}) =>
  buildRules({ code, requisiteText, assumedKnowledge: extra.assumedKnowledge ?? "", coTaught: extra.coTaught ?? [] });
const rulesOf = (code: string) => {
  const r = catalogue.get(code)?.rules;
  if (!r) throw new Error(`no rules for ${code}`);
  return r;
};
const codesIn = (req: Req | null): string[] =>
  !req
    ? []
    : req.type === "course"
      ? [req.code]
      : req.type === "units"
        ? [...(req.courses ?? []), ...(req.exclude ?? [])]
        : req.type === "and" || req.type === "or"
          ? req.children.flatMap(codesIn)
          : [];
const course = (code: string, extra = {}) => ({ type: "course", code, ...extra });

describe("reading official rule structures", () => {
  it("reads a page with no requisites as having none", () => {
    const r = build("ENGN1211", "");
    expect([r.prerequisite, r.incompatible, r.confidence]).toEqual([null, [], "none"]);
  });

  it("reads one simple prerequisite", () => {
    expect(build("ENGN2218", "To enrol in this course you must have completed ENGN1218.").prerequisite).toEqual(course("ENGN1218"));
  });

  it("reads an OR group", () => {
    expect(build("X", "To enrol in this course you must have completed:\nCOMP1100 OR COMP1130 OR COMP1730.").prerequisite).toEqual({
      type: "or",
      children: [course("COMP1100"), course("COMP1130"), course("COMP1730")],
    });
  });

  it("reads groups joined by AND without flattening them", () => {
    const r = build("COMP2310", official.COMP2310.requisiteText);
    expect(r.prerequisite).toEqual({
      type: "and",
      children: [
        { type: "or", children: [course("COMP1110"), course("COMP1140")] },
        { type: "or", children: [course("COMP2300"), course("ENGN2219")] },
      ],
    });
  });

  it("keeps nested AND inside OR", () => {
    expect(rulesOf("COMP4670").prerequisite).toEqual({
      type: "or",
      children: [
        course("COMP3670"),
        {
          type: "and",
          children: [
            { type: "or", children: [course("COMP1110"), course("COMP1140")] },
            { type: "or", children: [course("MATH1014"), course("MATH1115"), course("MATH1116")] },
          ],
        },
      ],
    });
  });

  it("reads a unit-based subject requirement, with its exclusion", () => {
    const group = (rulesOf("COMP3320").prerequisite as Extract<Req, { type: "and" }>).children[1];
    expect(group).toEqual({ type: "or", children: [course("COMP1600"), { type: "units", units: 6, subjects: ["MATH"], exclude: ["MATH1003"] }] });
    expect(rulesOf("COMP3310").prerequisite).toMatchObject({ type: "and", children: [{}, { type: "units", units: 6, subjects: ["COMP"], levels: [2] }] });
  });

  it("takes incompatibilities only from incompatibility clauses", () => {
    expect(rulesOf("COMP3320").incompatible).toEqual(["COMP6464"]);
    expect(rulesOf("COMP3425").incompatible).toEqual(["COMP3420", "COMP8400", "COMP8410", "COMP8910"]);
    expect(rulesOf("COMP2400").incompatible).toEqual(["COMP6240"]);
    expect(rulesOf("MATH1013").incompatible).toEqual(["MATH1113", "MATH1115"]);
  });

  it("reads 'completed or currently studying' as a co-requisite option", () => {
    expect(rulesOf("COMP2120").prerequisite).toEqual(course("COMP2100", { concurrent: true }));
    expect(rulesOf("COMP3620").prerequisite).toMatchObject({ type: "and", children: [{}, course("COMP2620", { concurrent: true })] });
  });

  it("keeps program restrictions as program conditions, not course prerequisites", () => {
    expect(rulesOf("COMP2550").prerequisite).toMatchObject({ type: "and", children: [{ type: "program", programs: ["AACRD"] }, {}] });
    expect(rulesOf("COMP2100").programRestrictions[0]).toMatch(/Bachelor of Science/);
    expect(codesIn(rulesOf("COMP2100").prerequisite)).not.toContain("COMP1600");
  });

  it("keeps a conditional permission as permission, not an incompatibility", () => {
    const r = rulesOf("MATH1115");
    expect(r.incompatible).toEqual([]);
    expect(r.permission[0]).toMatch(/permission of the course convener/);
    expect(rulesOf("COMP4011").permission[0]).toMatch(/permission code/);
  });

  it("stores assumed knowledge separately, as advice", () => {
    const r = rulesOf("COMP3320");
    expect(r.assumedKnowledge).toMatch(/C\/C\+\+/);
    expect(codesIn(r.prerequisite)).not.toContain("C");
  });

  it("marks ambiguous wording instead of guessing a structure", () => {
    const r = rulesOf("INFS3059");
    expect(r.confidence).toBe("wording-only");
    expect(r.prerequisite?.type).toBe("text");
  });

  it("keeps co-taught courses as co-taught, never as incompatible by themselves", () => {
    const r = rulesOf("COMP4650");
    expect(r.coTaught).toEqual(["COMP8490"]);
    expect(r.incompatible).toEqual(["COMP6490"]);
  });

  it("keeps mark thresholds on the right courses", () => {
    expect(rulesOf("MATH1116").prerequisite).toEqual({
      type: "or",
      children: [course("MATH1115", { minMark: 60 }), course("MATH1113", { minMark: 80 })],
    });
    const math2222 = rulesOf("MATH2222").prerequisite as Extract<Req, { type: "or" }>;
    expect(math2222.children.filter((c) => c.type === "course" && c.minMark === 80).map((c) => (c as { code: string }).code)).toEqual(["MATH1013", "MATH1014"]);
  });

  it("splits clauses that share a line without a full stop", () => {
    expect(classify(official.COMP3320.requisiteText).map((c) => c.kind)).toEqual(["prerequisite", "incompatible"]);
  });
});

describe("catalogue validation (every course the planner has read)", () => {
  const detailed = [...catalogue.values()].filter((c) => c.detailed);

  it("has rules for every detailed course, built from the current official text", () => {
    expect(detailed).toHaveLength(98);
    for (const c of detailed) expect(c.rules?.officialText, c.code).toBe(official[c.code].requisiteText);
  });

  it("applies every hand review to the exact wording it was made against", () => {
    for (const [code, o] of Object.entries(overrides)) {
      expect(o.reviewedText, `${code}: the official text changed since review; re-review it`).toBe(official[code].requisiteText);
      expect(rulesOf(code).review, code).toBe("hand-reviewed");
    }
  });

  it("never marks a course incompatible unless an incompatibility clause names it", () => {
    for (const c of detailed) {
      const r = c.rules;
      if (!r) continue;
      const clauses = r.clauses.filter((k) => k.kind === "incompatible").map((k) => k.text).join("\n");
      for (const code of r.incompatible) expect(clauses, `${c.code} → ${code}`).toContain(code);
    }
  });

  it("never lists one course as both a prerequisite and an incompatibility", () => {
    for (const c of detailed) {
      const r = c.rules;
      if (!r) continue;
      const prereq = new Set(codesIn(r.prerequisite));
      for (const code of r.incompatible) expect(prereq.has(code), `${c.code}: ${code}`).toBe(false);
    }
  });

  it("only names courses in a prerequisite that the official wording names", () => {
    for (const c of detailed) {
      const r = c.rules;
      if (!r) continue;
      // the page's own abbreviations: "COMP 1030", "COMP1110/1140"
      const text = r.officialText.replace(/([A-Z]{4}) (\d{4})/g, "$1$2").replace(/([A-Z]{4})(\d{4})\/(\d{4})/g, "$1$2 $1$3");
      for (const code of codesIn(r.prerequisite)) expect(text, `${c.code}: ${code}`).toContain(code);
    }
  });

  it("calls a rule complete only when nothing in it is left as wording", () => {
    const hasText = (q: Req | null): boolean => !!q && (q.type === "text" || ((q.type === "and" || q.type === "or") && q.children.some(hasText)));
    for (const c of detailed) if (c.rules?.confidence === "complete") expect(hasText(c.rules.prerequisite), c.code).toBe(false);
  });

  it("leaves courses whose pages weren't read without invented rules", () => {
    expect(catalogue.get("PHIL1004")?.rules).toBeNull();
  });
});

// ---- applying rules ----

const now = { year: 2026, session: "S2" as Session };
const at = (courseCode: string, status: Status, year: number, session: Session): Placement => ({
  courseCode,
  status,
  year,
  session,
  units: catalogue.get(courseCode)?.unitsMin ?? 6,
});
const other = (p: Placement): Other => ({
  placement: p,
  semesters: catalogue.get(p.courseCode)?.semesters ?? 1,
  rules: catalogue.get(p.courseCode)?.rules ?? null,
});
const check = (p: Placement, others: Placement[], program = "AACOM") =>
  checkPlacement(p, catalogue.get(p.courseCode) as Course, now, others.map(other), program);
const codes = (issues: { code: string; level: string }[], level?: string) =>
  issues.filter((i) => !level || i.level === level).map((i) => i.code);

describe("COMP3320, the regression example", () => {
  it("reads COMP2100 as one option of the first prerequisite group and COMP6464 as the incompatible course", () => {
    const r = rulesOf("COMP3320");
    expect(r.prerequisite).toEqual({
      type: "and",
      children: [
        { type: "or", children: [course("COMP2100"), course("COMP2300"), course("ENGN2219")] },
        { type: "or", children: [course("COMP1600"), { type: "units", units: 6, subjects: ["MATH"], exclude: ["MATH1003"] }] },
      ],
    });
    expect(r.incompatible).toEqual(["COMP6464"]);
    for (const code of ["COMP2100", "COMP2300", "ENGN2219", "COMP1600", "MATH1003"]) expect(r.incompatible).not.toContain(code);
  });

  it("says COMP2100 satisfies the first group and the second group is still missing", () => {
    const issues = check(at("COMP3320", "planned", 2027, "S1"), [at("COMP2100", "completed", 2026, "S1")]);
    const shown = issues.find((i) => i.code === "prerequisite_group_shown");
    const missing = issues.find((i) => i.code === "prerequisite_group_not_shown");
    expect(shown?.message).toMatch(/COMP2100.*first prerequisite group/);
    expect(missing?.level).toBe("warn");
    expect(missing?.message).toMatch(/second prerequisite group \(COMP1600 or 6 units of MATH courses \(excluding MATH1003\)\)/);
    expect(codes(issues)).not.toContain("incompatible_in_plan");
  });

  it("counts eligible MATH units for the second group, but not the excluded course", () => {
    const withMath = check(at("COMP3320", "planned", 2027, "S1"), [at("COMP2100", "completed", 2026, "S1"), at("MATH1005", "completed", 2025, "S1")]);
    expect(codes(withMath, "warn")).not.toContain("prerequisite_group_not_shown");
    const excluded = check(at("COMP3320", "planned", 2027, "S1"), [at("COMP2100", "completed", 2026, "S1"), at("MATH1003", "completed", 2025, "S1")]);
    expect(codes(excluded, "warn")).toContain("prerequisite_group_not_shown");
  });

  it("only credits prerequisites taken before the planned course", () => {
    const later = check(at("COMP3320", "planned", 2027, "S1"), [at("COMP2100", "planned", 2027, "S2"), at("COMP1600", "completed", 2025, "S2")]);
    expect(later.find((i) => i.code === "prerequisite_group_not_shown")?.message).toMatch(/COMP2100 is in your plan .* but not before this course/);
  });
});

describe("rules by status", () => {
  const missingPrereq = at("COMP3320", "completed", 2026, "S1");

  it("never warns about a Completed course's prerequisites", () => {
    const issues = check(missingPrereq, []);
    expect(codes(issues).filter((c) => c.startsWith("prerequisite"))).toEqual([]);
    expect(codes(issues, "block")).toEqual([]);
  });

  it("only notes an incompatible course next to a Completed one", () => {
    const issues = check(at("COMP1130", "completed", 2025, "S1"), [at("COMP1100", "completed", 2024, "S1")]);
    expect(issues.find((i) => i.code === "incompatible_in_plan")?.level).toBe("info");
    expect(codes(issues, "warn")).toEqual([]);
  });

  it("keeps Studying now findings informational", () => {
    const issues = check(at("COMP3320", "current", 2026, "S2"), [at("COMP6464", "completed", 2025, "S1")]);
    expect(codes(issues, "warn")).toEqual([]);
    expect(codes(issues, "info")).toEqual(expect.arrayContaining(["incompatible_in_plan", "prerequisite_group_not_shown"]));
  });

  it("gives a Planned course specific warnings, none of which block", () => {
    const issues = check(at("COMP3320", "planned", 2027, "S2"), [at("COMP6464", "completed", 2025, "S1")]);
    expect(codes(issues, "warn")).toEqual(expect.arrayContaining(["incompatible_in_plan", "prerequisite_group_not_shown"]));
    expect(codes(issues, "block")).toEqual([]);
    expect(issues.find((i) => i.code === "incompatible_in_plan")?.message).toMatch(/official 2027 course page for COMP3320 lists COMP6464 as incompatible/);
  });

  it("checks program restrictions against the selected program", () => {
    const aacrd = check(at("COMP2550", "planned", 2027, "S1"), [at("COMP1110", "completed", 2025, "S2")], "AACRD");
    const aacom = check(at("COMP2550", "planned", 2027, "S1"), [at("COMP1110", "completed", 2025, "S2")], "AACOM");
    expect(codes(aacrd, "warn")).not.toContain("prerequisite_group_not_shown");
    expect(aacom.find((i) => i.code === "prerequisite_group_not_shown")?.message).toMatch(/Research and Development.*selected program is AACOM/);
  });

  it("shows what can't be checked (marks, eligibility) as notes", () => {
    const issues = check(at("MATH1116", "planned", 2027, "S2"), [at("MATH1115", "completed", 2027, "S1")]);
    expect(issues.find((i) => i.code === "prerequisite_unverifiable")?.message).toMatch(/mark of at least 60/);
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
const run = (entries: PlanEntry[], selections = {}) =>
  evaluatePlan(programByCode.get("AACOM") as never, entries, {}, selections, catalogue);

describe("course history versus requirement allocation", () => {
  it("records both incompatible alternatives but credits only one, and nothing else", () => {
    const a = entry("COMP1100", "completed", 2024);
    const b = entry("COMP1130", "completed", 2025);
    const e = run([a, b]);
    expect(e.credit.get(a.id)?.nodeId).toBe("prog1");
    expect(e.credit.get(b.id)).toBeUndefined();
    expect(e.withheld.get(b.id)).toBe("COMP1100");
    expect(e.tally.get("prog1")).toMatchObject({ target: 6, completed: 6 });
    expect(filled(e.summary.counting)).toBe(6);
    expect(filled(e.summary.notCounting)).toBe(6);
  });

  it("switches which alternative counts when the student selects the other", () => {
    const a = entry("COMP1100", "completed", 2024);
    const b = entry("COMP1130", "completed", 2025);
    const e = run([a, b], { prog1: "COMP1130" });
    expect(e.credit.get(b.id)?.nodeId).toBe("prog1");
    expect(e.withheld.get(a.id)).toBe("COMP1130");
    expect(filled(e.summary.counting)).toBe(6);
  });

  it("lets a compatible second option count where the program allows it (electives)", () => {
    const a = entry("MATH1005", "completed", 2024);
    const b = entry("MATH2222", "completed", 2025);
    const e = run([a, b]);
    expect(e.credit.get(b.id)?.nodeId).toBe("electives");
    expect(e.tally.get("maths")).toMatchObject({ target: 6, completed: 6 });
  });
});
