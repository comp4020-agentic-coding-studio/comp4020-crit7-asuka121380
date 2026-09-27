// The grammar every program requirement is transcribed into. Each group node
// carries the official sentence verbatim in `text`; `title` is only a short
// navigation label for what the node lists.

export type Filter = {
  subjects?: string[];
  levels?: number[];
  transdisciplinary?: boolean;
};

export type CourseRef = {
  kind: "course";
  id: string;
  code: string;
  // annual courses that must be completed twice, in consecutive semesters
  enrolments?: number;
  // the units this requirement needs from the course, when the listing says
  units?: number;
  // the title printed on the program page, when it differs from the course page
  listedAs?: string;
};

type Group = { id: string; title: string; text: string; notes?: string[] };

export type AllNode = Group & {
  kind: "all";
  units?: number;
  link?: { label: string; url: string };
  children: ReqNode[];
};

export type PickNode = Group & {
  kind: "pick";
  units: number;
  // exact: exactly this many units; min: at least; max: at most (optional)
  bound: "exact" | "min" | "max";
  children: ReqNode[];
};

export type OneNode = Group & {
  kind: "one";
  units: number;
  options: (AllNode | OpenNode)[];
};

export type OpenNode = Group & {
  kind: "open";
  units: number;
  filter?: Filter;
};

export type ReqNode = CourseRef | AllNode | PickNode | OneNode | OpenNode;

export type Constraint = {
  id: string;
  text: string;
  kind: "total" | "min" | "max";
  units: number;
  filter?: Filter;
};

export type Program = {
  code: string;
  name: string;
  year: number;
  units: number;
  duration: string;
  url: string;
  summary: string;
  constraints: Constraint[];
  // official rules this planner shows but deliberately doesn't evaluate
  untracked: { title: string; text: string[] }[];
  requirements: ReqNode[];
};

export const course = (code: string, extra: Omit<CourseRef, "kind" | "id" | "code"> = {}): CourseRef => ({
  kind: "course",
  id: code,
  code,
  ...extra,
});

export const courses = (...codes: string[]): CourseRef[] => codes.map((code) => course(code));

export function matches(filter: Filter | undefined, code: string, transdisciplinary: boolean): boolean {
  if (!filter) return true;
  if (filter.subjects && !filter.subjects.includes(code.slice(0, 4))) return false;
  if (filter.levels && !filter.levels.includes(Number(code[4]))) return false;
  if (filter.transdisciplinary && !transdisciplinary) return false;
  return true;
}

export function walk(nodes: ReqNode[], visit: (node: ReqNode, parents: ReqNode[]) => void, parents: ReqNode[] = []) {
  for (const node of nodes) {
    visit(node, parents);
    if (node.kind === "all" || node.kind === "pick") walk(node.children, visit, [...parents, node]);
    if (node.kind === "one") walk(node.options, visit, [...parents, node]);
  }
}

export function courseCodes(nodes: ReqNode[]): string[] {
  const codes = new Set<string>();
  walk(nodes, (node) => {
    if (node.kind === "course") codes.add(node.code);
  });
  return [...codes];
}
