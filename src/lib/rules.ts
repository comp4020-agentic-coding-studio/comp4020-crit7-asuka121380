// Course-page rules: what an official "Requisite and Incompatibility" block
// actually says, kept as structure where it can be read reliably and as the
// official wording where it can't.
//
// The block mixes different kinds of statement: prerequisites (with nested
// AND/OR groups, unit counts, exclusions, marks), co-requisites ("completed
// or currently studying"), program restrictions, permission requirements,
// incompatibilities, and plain advice. The parser first splits it into
// clauses by their opening words, then reads a prerequisite expression only
// if every token is understood. Anything else stays as wording, flagged, and
// is never turned into a harder rule than the page states.

export type Req =
  | { type: "and"; children: Req[] }
  | { type: "or"; children: Req[] }
  // concurrent: "completed or currently studying" (a co-requisite option)
  | { type: "course"; code: string; concurrent?: boolean; minMark?: number }
  | {
      type: "units";
      units: number;
      subjects?: string[];
      levels?: number[];
      courses?: string[];
      exclude?: string[];
      // any course at all ("72 units of tertiary study")
      any?: boolean;
    }
  | { type: "program"; programs: string[]; label: string }
  | { type: "text"; text: string };

export type ClauseKind = "prerequisite" | "incompatible" | "program" | "permission" | "note";
export type Clause = { kind: ClauseKind; text: string };

export type Confidence = "complete" | "partial" | "wording-only" | "none";

export type CourseRules = {
  code: string;
  year: number;
  sourceUrl: string;
  officialText: string;
  assumedKnowledge: string;
  coTaught: string[];
  prerequisite: Req | null;
  incompatible: string[];
  programRestrictions: string[];
  permission: string[];
  otherConditions: string[];
  clauses: Clause[];
  confidence: Confidence;
  review: "parser" | "hand-reviewed";
};

const CODES = /\b[A-Z]{4}\d{4}\b/g;

// ---------------------------------------------------------------- clauses

// Where one statement ends and another begins: a new line, or a sentence
// that opens with a recognisable lead-in.
const LEAD =
  /(?<=[.)])\s+(?=(?:Incompatible|It is incompatible|You are not able|You cannot|You may not|You must also|To enrol|Students|Additional|Competitive|Finding|We recommend|It should be noted|If you have|All other|In addition)\b)/g;

export function splitClauses(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => line.split(LEAD))
    .map((s) => s.trim())
    .filter(Boolean);
}

const isIncompatible = (s: string) =>
  /^(?:it is )?incompatible\b/i.test(s) ||
  /^you (?:are not able to|cannot|may not) enrol in (?:this course|[A-Z]{4}\d{4})\b[^.]*\bif\b/i.test(s);
const isPrerequisiteStart = (s: string) =>
  /^to enrol\b/i.test(s) || /^\d+ units? of\b/i.test(s) || /^all other students may enrol\b/i.test(s);
const isProgram = (s: string) => /^you (?:must )?also (?:must )?be studying\b/i.test(s) || /^students enrolled in a bachelor\b/i.test(s);
const isPermission = (s: string) =>
  /permission code|permission of the (?:course )?conven[eo]r|permission to enrol|consent of the conven[eo]r|with the permission/i.test(s);
const isContinuation = (s: string) =>
  /^(?:AND|OR|and|or)$/.test(s) ||
  /^[([]/.test(s) ||
  /^[•*-]/.test(s) ||
  /^(?:AND|OR)\b/.test(s) ||
  /^[A-Z]{4}\d{4}\b/.test(s) ||
  /^\d+ units?\b/i.test(s) ||
  /^(?:have|be|find|completed|a|at least)\b/i.test(s) ||
  /^(?:Bachelor|Computer Science Honours|\(Bachelor)/.test(s);

export function classify(text: string): Clause[] {
  const clauses: Clause[] = [];
  let inPrerequisite = false;
  for (const s of splitClauses(text)) {
    let kind: ClauseKind;
    if (isIncompatible(s)) kind = "incompatible";
    else if (isPrerequisiteStart(s)) kind = "prerequisite";
    else if (isProgram(s)) kind = inPrerequisite ? "prerequisite" : "program";
    else if (inPrerequisite && isContinuation(s)) kind = "prerequisite";
    else if (isPermission(s)) kind = "permission";
    else kind = "note";
    inPrerequisite = kind === "prerequisite";
    const last = clauses.at(-1);
    if (last && last.kind === kind && kind === "prerequisite") last.text += `\n${s}`;
    else clauses.push({ kind, text: s });
  }
  return clauses;
}

// Codes a clause names as incompatible: everything it lists except the
// course itself.
export function incompatibleCodes(clause: string, self: string): string[] {
  return [...new Set(clause.match(CODES) ?? [])].filter((c) => c !== self);
}

// ---------------------------------------------------------------- expressions

type Tok =
  | { t: "code"; code: string; concurrent?: boolean; minMark?: number }
  | { t: "units"; req: Extract<Req, { type: "units" }> }
  | { t: "and" | "or" | "ANDLINE" | "ORLINE" | "(" | ")" | "," };

class Unparsed extends Error {}

const LEVELS = /(\d)000(?:\s*-?\s*(?:and\/or|\/|or|-)\s*(\d)000)?\s*-?\s*levels?/i;

function unitsPhrase(units: number, phrase: string): Extract<Req, { type: "units" }> {
  const req: Extract<Req, { type: "units" }> = { type: "units", units };
  const excl = phrase.match(/\(?\s*excluding\s+([A-Z]{4}\d{4}(?:\s*(?:,|or|and)\s*[A-Z]{4}\d{4})*)\s*\)?/i);
  if (excl) {
    req.exclude = excl[1].match(CODES) ?? [];
    phrase = phrase.replace(excl[0], " ");
  }
  const lv = phrase.match(LEVELS);
  if (lv) {
    req.levels = [Number(lv[1]), ...(lv[2] ? [Number(lv[2])] : [])];
    phrase = phrase.replace(lv[0], " ");
  }
  const codes = phrase.match(CODES);
  if (codes) {
    req.courses = codes;
    phrase = phrase.replace(CODES, " ");
  }
  const subjects = [...new Set((phrase.match(/\b[A-Z]{4}\b/g) ?? []).map((s) => (s === "MATHS" ? "MATH" : s)))].filter(
    (s) => s !== "COMP" || /COMP/.test(phrase),
  );
  if (/\bmathematics\b/i.test(phrase) && !subjects.includes("MATH")) subjects.push("MATH");
  if (subjects.length) req.subjects = subjects;
  if (/tertiary|university courses|towards (?:an ANU |a )?degree/i.test(phrase) && !req.subjects && !req.courses && !req.levels) req.any = true;
  const leftover = phrase
    .replace(/\b[A-Z]{4}\b/g, " ")
    .replace(/\b(?:of|from|units?|courses?|coded|code|the|a|and|or|OR|AND|tertiary|study|university|towards|an|ANU|degree|mathematics|at|level|levels)\b/gi, " ")
    .replace(/[()/,;:.-]/g, " ")
    .trim();
  if (leftover) throw new Unparsed(`units phrase: ${leftover}`);
  if (!req.subjects && !req.courses && !req.any && !req.levels) throw new Unparsed("units of what?");
  return req;
}

function tokenize(block: string): Tok[] {
  const toks: Tok[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (/^(?:AND|and)$/.test(line)) {
      toks.push({ t: "ANDLINE" });
      continue;
    }
    if (/^(?:OR|or)$/.test(line)) {
      toks.push({ t: "ORLINE" });
      continue;
    }
    let s = line
      .replace(/(\d),(\d{3})/g, "$1$2")
      .replace(/\bMATHS\b/g, "MATH")
      .replace(/\b([A-Z]{4})(\d{4})\/(?:\1)?(\d{4})\b/g, "$1$2 or $1$3")
      .replace(/\b([A-Z]{4}) (\d{4})\b/g, "$1$2")
      .replace(/\s*\.\s*$/, "")
      .replace(/^[•*-]\s*/, "");
    while (s.length) {
      s = s.replace(/^\s+/, "");
      if (!s) break;
      let m: RegExpMatchArray | null;
      if ((m = s.match(/^\(/))) {
        // "units of (A or B or C)" is part of the units phrase, not a group
        toks.push({ t: "(" });
      } else if ((m = s.match(/^\)/))) toks.push({ t: ")" });
      else if ((m = s.match(/^(?:AND|and)\b/))) toks.push({ t: "and" });
      else if ((m = s.match(/^;\s*(?:AND|and)?/))) toks.push({ t: "and" });
      else if ((m = s.match(/^(?:OR|or)\b/))) toks.push({ t: "or" });
      else if ((m = s.match(/^,\s*(?:(or|and|OR|AND)\b)?/))) toks.push(m[1] ? { t: m[1].toLowerCase() as "and" | "or" } : { t: "," });
      else if ((m = s.match(/^(?:have |has )?(?:successfully )?completed or (?:be )?currently (?:studying|enrolled in) ([A-Z]{4}\d{4})/i))) {
        toks.push({ t: "code", code: m[1], concurrent: true });
      } else if ((m = s.match(/^([A-Z]{4}\d{4})(?:\s+with a mark of (?:at least )?(\d+)(?: or above)?)?/))) {
        toks.push({ t: "code", code: m[1], ...(m[2] ? { minMark: Number(m[2]) } : {}) });
      } else if ((m = s.match(/^(?:at least |a minimum of )?(\d+) units? (?:of |from )\(?((?:[A-Z]{4}\d{4})(?:\s*(?:,|or|OR)\s*[A-Z]{4}\d{4})+)\)?/))) {
        toks.push({ t: "units", req: { type: "units", units: Number(m[1]), courses: m[2].match(CODES) ?? [] } });
      } else if ((m = s.match(/^(?:at least |a minimum of )?(?:a further )?(\d+) units? (?:of |from |in )?(\([^)]*\)[^(]*?|[^()]*?(?:\([^)]*\))?[^()]*?)(?=\s+(?:AND|OR|and|or)\s+(?:\(|[A-Z]{4}\d{4}|\d+ units?|have|be|you)|\s+(?:AND|OR|and|or)\s*$|,\s*(?:and|or)\s|\s*;|\s*\)|$)/))) {
        toks.push({ t: "units", req: unitsPhrase(Number(m[1]), m[2]) });
      } else if ((m = s.match(/^(?:(?:you|students) must )?(?:have |has )?(?:successfully )?(?:completed|complete)(?! or)(?: all of the following| the following| either)?\s*:?/i)) && m[0].trim()) {
        // a repeated lead-in inside the block ("... and have completed X")
      } else {
        throw new Unparsed(`unexpected: ${s.slice(0, 40)}`);
      }
      s = s.slice(m[0].length);
    }
  }
  return toks;
}

function parseTokens(toks: Tok[]): Req {
  let i = 0;
  const peek = () => toks[i];
  const flat = (type: "and" | "or", parts: Req[]): Req =>
    parts.length === 1 ? parts[0] : { type, children: parts.flatMap((p) => (p.type === type ? p.children : [p])) };

  // precedence, loosest first: a line saying only "OR", a line saying only
  // "AND", then "and" inside a line, then "or" inside a line
  const orLine = (): Req => {
    const parts = [andLine()];
    while (peek()?.t === "ORLINE") {
      i++;
      parts.push(andLine());
    }
    return flat("or", parts);
  };
  const andLine = (): Req => {
    const parts = [seq()];
    while (peek()?.t === "ANDLINE") {
      i++;
      parts.push(seq());
    }
    return flat("and", parts);
  };
  const seq = (): Req => {
    const parts = [group()];
    while (peek()?.t === "and") {
      i++;
      parts.push(group());
    }
    return flat("and", parts);
  };
  const group = (): Req => {
    const parts = [atom()];
    while (peek()?.t === "or" || peek()?.t === ",") {
      i++;
      parts.push(atom());
    }
    return flat("or", parts);
  };
  const atom = (): Req => {
    const tok = toks[i++];
    if (!tok) throw new Unparsed("ended early");
    if (tok.t === "(") {
      const inner = orLine();
      if (toks[i++]?.t !== ")") throw new Unparsed("unbalanced parentheses");
      return inner;
    }
    if (tok.t === "code") {
      const node: Req = { type: "course", code: tok.code };
      if (tok.concurrent) node.concurrent = true;
      if (tok.minMark) node.minMark = tok.minMark;
      return node;
    }
    if (tok.t === "units") return tok.req;
    throw new Unparsed(`unexpected ${tok.t}`);
  };
  const expr = orLine();
  if (i !== toks.length) throw new Unparsed("trailing tokens");
  return expr;
}

const LEAD_IN =
  /^(?:to enrol(?: in this course)?,? (?:you|students) must(?: have)?(?: successfully)?(?: completed(?! or be))?(?: the following)?(?: either)?(?:\s*:)?|all other students may enrol in this course if they have completed)\s*/i;

// Reads a prerequisite block into an expression, or returns null when any
// part of it isn't understood.
export function parsePrerequisite(block: string): Req | null {
  const body = block.replace(LEAD_IN, "").trim();
  if (!body) return null;
  try {
    return parseTokens(tokenize(body));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- building

export type OfficialCourse = { code: string; requisiteText: string; assumedKnowledge: string; coTaught: string[] };
export type Override = Partial<Pick<CourseRules, "prerequisite" | "programRestrictions" | "permission" | "otherConditions" | "incompatible" | "confidence">> & {
  // the official wording this review was made against; a change invalidates it
  reviewedText: string;
  note?: string;
};

export function buildRules(course: OfficialCourse, override?: Override): CourseRules {
  const clauses = classify(course.requisiteText);
  const prereqClauses = clauses.filter((c) => c.kind === "prerequisite");
  const prerequisite = prereqClauses.length === 1 ? parsePrerequisite(prereqClauses[0].text) : null;
  const incompatible = [...new Set(clauses.filter((c) => c.kind === "incompatible").flatMap((c) => incompatibleCodes(c.text, course.code)))];
  const unread = clauses.some((c) => c.kind === "note");
  let confidence: Confidence = !course.requisiteText
    ? "none"
    : prereqClauses.length && !prerequisite
      ? "wording-only"
      : unread || prereqClauses.length > 1
        ? "partial"
        : "complete";
  const rules: CourseRules = {
    code: course.code,
    year: 2027,
    sourceUrl: `https://programsandcourses.anu.edu.au/2027/course/${course.code}`,
    officialText: course.requisiteText,
    assumedKnowledge: course.assumedKnowledge,
    coTaught: course.coTaught,
    prerequisite: prerequisite ?? (prereqClauses.length ? { type: "text", text: prereqClauses.map((c) => c.text).join("\n") } : null),
    incompatible,
    programRestrictions: clauses.filter((c) => c.kind === "program").map((c) => c.text),
    permission: clauses.filter((c) => c.kind === "permission").map((c) => c.text),
    otherConditions: clauses.filter((c) => c.kind === "note").map((c) => c.text),
    clauses,
    confidence,
    review: "parser",
  };
  if (override && override.reviewedText === course.requisiteText) {
    const { reviewedText: _, note: __, ...fields } = override;
    Object.assign(rules, fields, { review: "hand-reviewed" as const });
    confidence = rules.confidence;
  }
  return rules;
}

// ---------------------------------------------------------------- reading

export function describe(req: Req, top = true): string {
  switch (req.type) {
    case "course":
      return `${req.code}${req.concurrent ? " (completed or studied at the same time)" : ""}${req.minMark ? ` with a mark of at least ${req.minMark}` : ""}`;
    case "units": {
      const what = req.courses
        ? `from ${listOf(req.courses, "or")}`
        : req.any
          ? "of courses at any level"
          : `of ${req.levels ? `${req.levels.map((l) => `${l}000`).join("/")}-level ` : ""}${req.subjects ? req.subjects.join(" or ") : ""} courses`.replace("  ", " ");
      return `${req.units} units ${what}${req.exclude ? ` (excluding ${req.exclude.join(", ")})` : ""}`;
    }
    case "program":
      return req.label;
    case "text":
      return req.text;
    case "and":
    case "or": {
      const parts = req.children.map((c) =>
        c.type === "and" || c.type === "or" || (c.type === "units" && c.courses) ? `(${describe(c, false)})` : describe(c, false),
      );
      const s = parts.join(req.type === "and" ? " and " : " or ");
      return top ? s : s;
    }
  }
}

const listOf = (items: string[], word: string) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ${word} ${items.at(-1)}`;

// ---------------------------------------------------------------- checking

export type PlanCourse = { code: string; units: number; start: number; end: number; label: string };
export type Finding = { state: "met" | "unmet" | "unknown"; detail: string };

// Evaluates a requirement against the courses the plan shows before a term
// starts (or alongside it, for "currently studying" options).
export function evaluate(req: Req, ctx: { plan: PlanCourse[]; before: number; program: string | null; self: string }): Finding {
  const prior = ctx.plan.filter((p) => p.code !== ctx.self && p.end < ctx.before);
  switch (req.type) {
    case "course": {
      const p = ctx.plan.find((x) => x.code === req.code);
      const ok = p && (req.concurrent ? p.start <= ctx.before : p.end < ctx.before);
      if (!p) return { state: "unmet", detail: `${req.code} isn't in your plan` };
      if (!ok) return { state: "unmet", detail: `${req.code} is in your plan (${p.label}) but not before this course` };
      if (req.minMark) return { state: "unknown", detail: `${req.code} (${p.label}) needs a mark of at least ${req.minMark}, which the planner doesn't record` };
      return { state: "met", detail: `${req.code} (${p.label})` };
    }
    case "units": {
      const qualifies = (code: string) =>
        !req.exclude?.includes(code) &&
        (req.courses
          ? req.courses.includes(code)
          : (req.any || !req.subjects || req.subjects.includes(code.slice(0, 4))) &&
            (!req.levels || req.levels.includes(Number(code[4]))));
      const counted = prior.filter((p) => qualifies(p.code));
      const units = counted.reduce((n, p) => n + p.units, 0);
      return units >= req.units
        ? { state: "met", detail: `${units} qualifying units (${counted.map((p) => p.code).join(", ")})` }
        : { state: "unmet", detail: `${units} of ${req.units} qualifying units shown` };
    }
    case "program":
      return req.programs.includes(ctx.program ?? "")
        ? { state: "met", detail: `your selected program is ${ctx.program}` }
        : { state: "unmet", detail: `your selected program is ${ctx.program ?? "not chosen"}` };
    case "text":
      return { state: "unknown", detail: "a condition the planner can't check" };
    case "and": {
      const r = req.children.map((c) => evaluate(c, ctx));
      const state = r.some((x) => x.state === "unmet") ? "unmet" : r.every((x) => x.state === "met") ? "met" : "unknown";
      return { state, detail: r.map((x) => x.detail).join("; ") };
    }
    case "or": {
      const r = req.children.map((c) => evaluate(c, ctx));
      const met = r.find((x) => x.state === "met");
      if (met) return met;
      const unknown = r.find((x) => x.state === "unknown");
      if (unknown) return unknown;
      const later = r.filter((x) => /but not before/.test(x.detail));
      return { state: "unmet", detail: later.length ? later.map((x) => x.detail).join("; ") : "none of these is shown yet" };
    }
  }
}
