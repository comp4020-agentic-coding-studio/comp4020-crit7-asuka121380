import detailed from "../../research/2027/courses.json";
import listing from "../../research/2027/ug-catalogue.json";
import { buildRules, type CourseRules } from "../lib/rules";
import type { Session } from "../lib/terms";
import { overrides } from "./rule-overrides";

// The verified catalogue: every 2027 undergraduate course in the official
// catalogue search (1,523 of them), enriched with course-page detail for the
// 98 courses the four programs name. Only these codes can enter a plan.

export type CatalogueCourse = {
  code: string;
  title: string;
  unitsMin: number;
  unitsMax: number;
  // 2027 sessions the course is listed in
  offered: Session[];
  // courses taken over two consecutive semesters, as their pages say
  semesters: number;
  semesterNote: string | null;
  // null: the planner hasn't read this course's page, so the tag is unknown
  transdisciplinary: boolean | null;
  // the course page's rules; null where the planner hasn't read the page
  rules: CourseRules | null;
  detailed: boolean;
  url: string;
};

export const courseUrl = (code: string) => `https://programsandcourses.anu.edu.au/2027/course/${code}`;

const SESSION_NAMES: Record<string, Session> = {
  "Summer Session": "SUM",
  "First Semester": "S1",
  "Autumn Session": "AUT",
  "Winter Session": "WIN",
  "Second Semester": "S2",
  "Spring Session": "SPR",
};

const sessionsOf = (names: string[]) =>
  names.map((n) => SESSION_NAMES[n.replace(/ \d{4}$/, "")]).filter((s): s is Session => Boolean(s));

function unitRange(value: string): [number, number] {
  const range = value.match(/^(\d+) to (\d+) units$/);
  if (range) return [Number(range[1]), Number(range[2])];
  const single = value.match(/^(\d+) units?$/);
  if (!single) throw new Error(`unrecognised unit value: ${value}`);
  return [Number(single[1]), Number(single[1])];
}

type Detail = {
  title: string;
  unitValue: string;
  offered: string[];
  graduateAttributes: string[];
  requisiteText: string;
  assumedKnowledge: string;
  coTaught: string[];
  twoSemesterEvidence?: string;
};

const details = detailed.courses as Record<string, Detail>;

export const catalogue: CatalogueCourse[] = Object.entries(
  listing.courses as Record<string, { title: string; units: number; sessions: string[] }>,
).map(([code, row]) => {
  const d = details[code];
  if (!d) {
    return {
      code,
      title: row.title.replace(/\s+/g, " "),
      unitsMin: row.units,
      unitsMax: row.units,
      offered: sessionsOf(row.sessions),
      semesters: 1,
      semesterNote: null,
      transdisciplinary: null,
      rules: null,
      detailed: false,
      url: courseUrl(code),
    };
  }
  const [unitsMin, unitsMax] = unitRange(d.unitValue);
  return {
    code,
    title: d.title.replace(/\s+/g, " "),
    unitsMin,
    unitsMax,
    offered: sessionsOf(d.offered),
    semesters: d.twoSemesterEvidence ? 2 : 1,
    semesterNote: d.twoSemesterEvidence ?? null,
    transdisciplinary: d.graduateAttributes.includes("Transdisciplinary"),
    rules: buildRules({ code, requisiteText: d.requisiteText, assumedKnowledge: d.assumedKnowledge, coTaught: d.coTaught }, overrides[code]),
    detailed: true,
    url: courseUrl(code),
  };
});

export const retrieved = detailed.retrieved;
