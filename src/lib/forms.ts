import { type EntryInput, getCatalogue, getProgram } from "./db";
import { bus } from "./events";
import type { Session, Status } from "./schema";
import { SESSION_IDS, STATUSES, YEARS } from "./terms";

// The system boundary: every write arrives as a form POST (from a plain
// <form>, or the same form sent by fetch), is validated here, then answers
// with a 303 back to the page — or JSON when the client asked for it.

export class BadInput extends Error {}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export function parseProgram(form: FormData): string {
  const code = field(form, "program");
  if (!getProgram(code)) throw new BadInput(`unknown program: ${code}`);
  return code;
}

export function parseTerm(form: FormData): { status: Status; year: number; session: Session } {
  const status = field(form, "status") as Status;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) throw new BadInput("status must be completed, current or planned");
  const year = Number(field(form, "year"));
  if (!Number.isInteger(year) || year < YEARS.min || year > YEARS.max) throw new BadInput("year out of range");
  const session = field(form, "session") as Session;
  if (!SESSION_IDS.includes(session)) throw new BadInput("unknown session");
  return { status, year, session };
}

// Units come from the catalogue; the student only chooses them for a
// variable-unit course, or for an elective the catalogue doesn't carry.
export function parseUnits(form: FormData, courseCode: string): number {
  const known = getCatalogue().get(courseCode);
  const given = field(form, "units");
  if (known && known.unitsMin === known.unitsMax) return known.unitsMin;
  const units = given === "" ? (known?.unitsMin ?? 6) : Number(given);
  const [lo, hi] = known ? [known.unitsMin, known.unitsMax] : [0, 24];
  if (!Number.isInteger(units) || units < lo || units > hi) throw new BadInput(`units must be ${lo}–${hi}`);
  return units;
}

export function parseEntry(form: FormData): EntryInput {
  const courseCode = field(form, "course").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{4}\d{4}$/.test(courseCode)) throw new BadInput("course must be a code like COMP1100");
  return { courseCode, ...parseTerm(form), units: parseUnits(form, courseCode) };
}

// Only same-site paths: never an open redirect.
function back(form: FormData, request: Request): string {
  const target = field(form, "return");
  if (target.startsWith("/") && !target.startsWith("//")) return target;
  const referer = request.headers.get("referer");
  if (referer) {
    const url = new URL(referer);
    if (url.origin === new URL(request.url).origin) return url.pathname + url.search;
  }
  return "/";
}

export async function handle(request: Request, write: (form: FormData) => unknown): Promise<Response> {
  const form = await request.formData();
  const wantsJson = request.headers.get("accept")?.includes("application/json");
  try {
    const result = write(form);
    bus.emit("plan", { client: request.headers.get("x-client-id") ?? "" });
    if (wantsJson) return Response.json({ ok: true, result: result ?? null });
    return new Response(null, { status: 303, headers: { location: back(form, request) } });
  } catch (error) {
    if (!(error instanceof BadInput)) throw error;
    return wantsJson
      ? Response.json({ ok: false, error: error.message }, { status: 400 })
      : new Response(error.message, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
