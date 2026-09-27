import detailed from "../../research/2027/courses.json";
import listing from "../../research/2027/ug-catalogue.json";
import type { Session } from "../lib/terms";

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
  incompatible: string[];
  incompatibleNote: string | null;
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

// "Incompatible with COMP1130." / "You are not able to enrol in this course
// if you have completed COMP1140 ..." — the official sentence, and the codes in it.
function incompatibility(text: string): { codes: string[]; note: string | null } {
  const sentences = text.match(
    /[^.]*(incompatib|not able to enrol in this course if you have completed|cannot enrol in this course if you have completed)[^.]*\.?/gi,
  );
  if (!sentences) return { codes: [], note: null };
  const note = sentences.map((s) => s.trim().replace(/\s+([,.])/g, "$1")).join(" ");
  return { codes: [...new Set(note.match(/[A-Z]{4}\d{4}/g) ?? [])], note };
}

type Detail = {
  title: string;
  unitValue: string;
  offered: string[];
  graduateAttributes: string[];
  requisiteAndIncompatibility?: string;
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
      incompatible: [],
      incompatibleNote: null,
      detailed: false,
      url: courseUrl(code),
    };
  }
  const [unitsMin, unitsMax] = unitRange(d.unitValue);
  const incompatible = incompatibility(d.requisiteAndIncompatibility ?? "");
  return {
    code,
    title: d.title.replace(/\s+/g, " "),
    unitsMin,
    unitsMax,
    offered: sessionsOf(d.offered),
    semesters: d.twoSemesterEvidence ? 2 : 1,
    semesterNote: d.twoSemesterEvidence ?? null,
    transdisciplinary: d.graduateAttributes.includes("Transdisciplinary"),
    incompatible: incompatible.codes.filter((c) => c !== code),
    incompatibleNote: incompatible.note,
    detailed: true,
    url: courseUrl(code),
  };
});

export const retrieved = detailed.retrieved;
