import type { APIContext } from "astro";
import { checkPlacement, type Issue } from "./checks";
import { type Course, type EntryInput, getCatalogue, getProgram, listEntries, type PlanEntry } from "./db";
import { bus } from "./events";
import type { Session, Status } from "./schema";
import { currentTerm, SESSION_IDS, STATUSES, termLabel, YEARS } from "./terms";
import { STATUS_LABEL } from "./terms";

// The system boundary. Every write arrives as a form POST (a plain <form>, or
// the same form sent by fetch), is checked here against the signed-in
// account, and answers with a 303 back to the page — or JSON, with a status
// and a machine-readable code, when the client asks for it.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export function parseProgram(form: FormData): string {
  const code = field(form, "program");
  if (!getProgram(code)) throw new ApiError(400, "unknown_program", "That isn't one of the programs this planner covers.");
  return code;
}

export function parseCourse(form: FormData): Course {
  const code = field(form, "course").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{4}\d{4}$/.test(code)) throw new ApiError(400, "invalid_course", "Enter a course code like COMP1100.");
  const course = getCatalogue().get(code);
  if (!course) {
    throw new ApiError(
      404,
      "unknown_course",
      `${code} isn't in the 2027 ANU undergraduate catalogue, so it can't be added. Check the code on Programs & Courses.`,
    );
  }
  return course;
}

export function parseTerm(form: FormData): { status: Status; year: number; session: Session } {
  const status = field(form, "status") as Status;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new ApiError(400, "invalid_status", "Choose Completed, Studying now or Planned.");
  }
  const year = Number(field(form, "year"));
  if (!Number.isInteger(year) || year < YEARS.min || year > YEARS.max) {
    throw new ApiError(400, "invalid_year", `Choose a year between ${YEARS.min} and ${YEARS.max}.`);
  }
  const session = field(form, "session") as Session;
  if (!SESSION_IDS.includes(session)) throw new ApiError(400, "invalid_session", "Choose a teaching session.");
  return { status, year, session };
}

// Units come from the catalogue; they're only chosen for a variable-unit course.
export function parseUnits(form: FormData, course: Course): number {
  if (course.unitsMin === course.unitsMax) return course.unitsMin;
  const given = field(form, "units");
  const units = given === "" ? course.unitsMin : Number(given);
  if (!Number.isInteger(units) || units < course.unitsMin || units > course.unitsMax) {
    throw new ApiError(400, "invalid_units", `${course.code} can be taken for ${course.unitsMin} to ${course.unitsMax} units.`);
  }
  return units;
}

export const describeEntry = (e: PlanEntry) => ({
  id: e.id,
  course: e.courseCode,
  status: e.status,
  year: e.year,
  session: e.session,
  units: e.units,
  where: `${STATUS_LABEL[e.status]} · ${termLabel(e.year, e.session)}`,
});

// Checks one placement against the student's other entries; throws on a
// block, returns the warnings.
export function validatePlacement(user: number, input: EntryInput, course: Course, ignoreId?: number): Issue[] {
  const catalogue = getCatalogue();
  const others = listEntries(user).filter((e) => e.id !== ignoreId);

  if (ignoreId === undefined) {
    const existing = others.find((e) => e.courseCode === course.code);
    if (existing) {
      throw new ApiError(
        409,
        "duplicate",
        `${course.code} is already in your plan (${describeEntry(existing).where}). Move or edit that entry instead of adding another.`,
        { existing: describeEntry(existing) },
      );
    }
  }
  const clash = others.find(
    (e) => course.incompatible.includes(e.courseCode) || catalogue.get(e.courseCode)?.incompatible.includes(course.code),
  );
  if (clash) {
    const note = course.incompatible.includes(clash.courseCode) ? course.incompatibleNote : catalogue.get(clash.courseCode)?.incompatibleNote;
    throw new ApiError(
      409,
      "incompatible",
      `${course.code} and ${clash.courseCode} are incompatible, so they can't both count. The official course page says: "${note}" ${clash.courseCode} is already in your plan (${describeEntry(clash).where}).`,
      { existing: describeEntry(clash) },
    );
  }

  const issues = checkPlacement(
    input,
    course,
    currentTerm(),
    others.map((e) => ({ placement: e, semesters: catalogue.get(e.courseCode)?.semesters ?? 1 })),
  );
  const block = issues.find((i) => i.level === "block");
  if (block) throw new ApiError(block.code === "invalid_units" ? 400 : 422, block.code, block.message);
  return issues.filter((i) => i.level === "warn");
}

// Only same-site paths: never an open redirect.
export function safeReturn(target: string | null | undefined, fallback = "/"): string {
  return target?.startsWith("/") && !target.startsWith("//") ? target : fallback;
}

function back(form: FormData, request: Request): string {
  const explicit = field(form, "return");
  if (explicit) return safeReturn(explicit);
  const referer = request.headers.get("referer");
  if (referer) {
    const url = new URL(referer);
    if (url.origin === new URL(request.url).origin) return url.pathname + url.search;
  }
  return "/";
}

type Write = (form: FormData, user: number) => { warnings?: Issue[]; [key: string]: unknown } | void;

export async function handle({ request, locals }: APIContext, write: Write): Promise<Response> {
  const wantsJson = request.headers.get("accept")?.includes("application/json");
  const fail = (e: ApiError) =>
    wantsJson
      ? Response.json({ ok: false, code: e.code, error: e.message, ...e.extra }, { status: e.status })
      : new Response(e.message, { status: e.status, headers: { "content-type": "text/plain; charset=utf-8" } });

  const user = locals.user;
  if (!user) return fail(new ApiError(401, "unauthenticated", "Your session has ended. Log in again to keep planning."));
  const form = await request.formData().catch(() => null);
  if (!form) return fail(new ApiError(400, "bad_request", "Expected a form submission."));

  try {
    const result = write(form, user.id) ?? {};
    bus.emit("plan", { user: user.id, client: request.headers.get("x-client-id") ?? "" });
    if (wantsJson) return Response.json({ ok: true, warnings: [], ...result });
    return new Response(null, { status: 303, headers: { location: back(form, request) } });
  } catch (error) {
    if (error instanceof ApiError) return fail(error);
    // The unique index is the last word on duplicates, even under a race.
    if (error instanceof Error && /UNIQUE constraint failed: plan_entries/.test(error.message)) {
      return fail(new ApiError(409, "duplicate", "That course is already in your plan."));
    }
    console.error(error);
    return fail(new ApiError(500, "server_error", "Something failed on the server, and nothing was changed. Try again."));
  }
}
