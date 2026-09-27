import research from "../../research/2027/courses.json";

// The seeded course catalogue is the scraped research file itself, normalised:
// no title, unit value or offering is typed in by hand.

export type CatalogueCourse = {
  code: string;
  title: string;
  unitsMin: number;
  unitsMax: number;
  offered: string[];
  transdisciplinary: boolean;
  url: string;
};

export const courseUrl = (code: string) => `https://programsandcourses.anu.edu.au/2027/course/${code}`;

function units(value: string): [number, number] {
  const range = value.match(/^(\d+) to (\d+) units$/);
  if (range) return [Number(range[1]), Number(range[2])];
  const single = value.match(/^(\d+) units?$/);
  if (!single) throw new Error(`unrecognised unit value: ${value}`);
  return [Number(single[1]), Number(single[1])];
}

export const catalogue: CatalogueCourse[] = Object.entries(research.courses).map(([code, c]) => {
  const [unitsMin, unitsMax] = units(c.unitValue);
  return {
    code,
    title: c.title.replace(/\s+/g, " "),
    unitsMin,
    unitsMax,
    offered: c.offered,
    transdisciplinary: (c.graduateAttributes as string[]).includes("Transdisciplinary"),
    url: courseUrl(code),
  };
});

export const retrieved = research.retrieved;
