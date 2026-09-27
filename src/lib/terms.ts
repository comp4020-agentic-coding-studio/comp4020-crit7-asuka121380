import type { Session, Status } from "./schema";

// ANU's teaching periods in calendar order within a year.
export const SESSIONS = [
  { id: "SUM", label: "Summer Session", short: "Summer", official: "Summer Session" },
  { id: "S1", label: "Semester 1", short: "S1", official: "First Semester" },
  { id: "AUT", label: "Autumn Session", short: "Autumn", official: "Autumn Session" },
  { id: "WIN", label: "Winter Session", short: "Winter", official: "Winter Session" },
  { id: "S2", label: "Semester 2", short: "S2", official: "Second Semester" },
  { id: "SPR", label: "Spring Session", short: "Spring", official: "Spring Session" },
] as const satisfies readonly { id: Session; label: string; short: string; official: string }[];

export const SESSION_IDS = SESSIONS.map((s) => s.id) as Session[];
export const STATUSES = ["completed", "current", "planned"] as const satisfies readonly Status[];

export const STATUS_LABEL: Record<Status | "none", string> = {
  completed: "Completed",
  current: "Studying now",
  planned: "Planned",
  none: "Not in plan",
};

export const YEARS = { min: 2018, max: 2034 };

const session = (id: Session) => SESSIONS.find((s) => s.id === id) ?? SESSIONS[1];

export const termKey = (year: number, s: Session) => `${year}-${s}`;
export const termLabel = (year: number, s: Session) => `${year} ${session(s).label}`;
export const termShort = (year: number, s: Session) => `${year} ${session(s).short}`;
export const termOrder = (year: number, s: Session) => year * 10 + SESSION_IDS.indexOf(s);

// The semester the student is in right now, by the calendar in Canberra —
// only a default for new entries and the "now" marker on the timeline.
export function currentTerm(now = new Date()): { year: number; session: Session } {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Canberra", year: "numeric", month: "numeric" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return { year: Number(parts.year), session: Number(parts.month) <= 6 ? "S1" : "S2" };
}

// "First Semester 2027" → { year: 2027, session: "S1" }
export function parseOffering(text: string): { year: number; session: Session } | null {
  const match = text.match(/^(.*) (\d{4})$/);
  const found = match && SESSIONS.find((s) => s.official === match[1]);
  return found && match ? { year: Number(match[2]), session: found.id } : null;
}
