import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { catalogue } from "../data/catalogue";
import { programs as seedPrograms } from "../data/programs";
import type { Program } from "./requirements";
import {
  type Course,
  courses,
  type PlanEntry,
  pathwayChoices,
  planEntries,
  profiles,
  programs,
  requirementSelections,
  type Session,
  type Status,
} from "./schema";
import { termOrder } from "./terms";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data); locally it
// defaults to an untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");
client.pragma("foreign_keys = ON");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume. The flow:
// edit src/lib/schema.ts, `pnpm db:generate`, commit the migration.
migrate(db, { migrationsFolder: "./drizzle" });

// Reference data is re-seeded from the committed sources on every boot, so a
// corrected transcription reaches the deployed volume with the next deploy.
// Personal tables are never touched here.
db.transaction((tx) => {
  for (const c of catalogue) {
    tx.insert(courses).values(c).onConflictDoUpdate({ target: courses.code, set: c }).run();
  }
  for (const p of seedPrograms) {
    tx.insert(programs).values(p).onConflictDoUpdate({ target: programs.code, set: p }).run();
  }
});

export type { Course, PlanEntry, Session, Status };

// ---- reference data ----

export function listPrograms(): Program[] {
  return db.select().from(programs).all() as Program[];
}

export function getProgram(code: string): Program | undefined {
  return db.select().from(programs).where(eq(programs.code, code)).get() as Program | undefined;
}

let catalogueCache: Map<string, Course> | null = null;
export function getCatalogue(): Map<string, Course> {
  catalogueCache ??= new Map(
    db
      .select()
      .from(courses)
      .all()
      .map((c) => [c.code, c]),
  );
  return catalogueCache;
}

// ---- personal data: every function takes the authenticated user's id ----

export function getProgramCode(user: number): string | null {
  return db.select().from(profiles).where(eq(profiles.userId, user)).get()?.programCode ?? null;
}

export function setProgram(user: number, code: string) {
  db.insert(profiles)
    .values({ userId: user, programCode: code })
    .onConflictDoUpdate({ target: profiles.userId, set: { programCode: code, updatedAt: sql`(datetime('now'))` } })
    .run();
}

export function listEntries(user: number): PlanEntry[] {
  return db
    .select()
    .from(planEntries)
    .where(eq(planEntries.userId, user))
    .all()
    .sort(
      (a, b) =>
        termOrder(a.year, a.session) - termOrder(b.year, b.session) || a.courseCode.localeCompare(b.courseCode),
    );
}

export function getEntry(user: number, id: number): PlanEntry | undefined {
  return db
    .select()
    .from(planEntries)
    .where(and(eq(planEntries.id, id), eq(planEntries.userId, user)))
    .get();
}

export function findEntry(user: number, courseCode: string): PlanEntry | undefined {
  return db
    .select()
    .from(planEntries)
    .where(and(eq(planEntries.userId, user), eq(planEntries.courseCode, courseCode)))
    .get();
}

export type EntryInput = { courseCode: string; status: Status; year: number; session: Session; units: number };

// Plain insert: the UNIQUE(user_id, course_code) index is the last line of
// defence against a duplicate, so a race surfaces as an error, not a merge.
export function addEntry(user: number, input: EntryInput): PlanEntry {
  return db
    .insert(planEntries)
    .values({ ...input, userId: user })
    .returning()
    .get();
}

export function updateEntry(user: number, id: number, input: Omit<EntryInput, "courseCode">): PlanEntry | undefined {
  return db
    .update(planEntries)
    .set({ ...input, updatedAt: sql`(datetime('now'))` })
    .where(and(eq(planEntries.id, id), eq(planEntries.userId, user)))
    .returning()
    .get();
}

export function deleteEntry(user: number, id: number): boolean {
  const removed = db
    .delete(planEntries)
    .where(and(eq(planEntries.id, id), eq(planEntries.userId, user)))
    .returning()
    .all();
  if (removed.length === 0) return false;
  db.delete(requirementSelections)
    .where(and(eq(requirementSelections.userId, user), eq(requirementSelections.courseCode, removed[0].courseCode)))
    .run();
  return true;
}

export function getChoices(user: number, programCode: string): Record<string, string> {
  const rows = db
    .select()
    .from(pathwayChoices)
    .where(and(eq(pathwayChoices.userId, user), eq(pathwayChoices.programCode, programCode)))
    .all();
  return Object.fromEntries(rows.map((r) => [r.nodeId, r.optionId]));
}

export function setChoice(user: number, programCode: string, nodeId: string, optionId: string | null) {
  const key = and(
    eq(pathwayChoices.userId, user),
    eq(pathwayChoices.programCode, programCode),
    eq(pathwayChoices.nodeId, nodeId),
  );
  if (!optionId) {
    db.delete(pathwayChoices).where(key).run();
    return;
  }
  db.insert(pathwayChoices)
    .values({ userId: user, programCode, nodeId, optionId })
    .onConflictDoUpdate({
      target: [pathwayChoices.userId, pathwayChoices.programCode, pathwayChoices.nodeId],
      set: { optionId },
    })
    .run();
}

export function getSelections(user: number, programCode: string): Record<string, string> {
  const rows = db
    .select()
    .from(requirementSelections)
    .where(and(eq(requirementSelections.userId, user), eq(requirementSelections.programCode, programCode)))
    .all();
  return Object.fromEntries(rows.map((r) => [r.nodeId, r.courseCode]));
}

export function setSelection(user: number, programCode: string, nodeId: string, courseCode: string | null) {
  const key = and(
    eq(requirementSelections.userId, user),
    eq(requirementSelections.programCode, programCode),
    eq(requirementSelections.nodeId, nodeId),
  );
  if (!courseCode) {
    db.delete(requirementSelections).where(key).run();
    return;
  }
  db.insert(requirementSelections)
    .values({ userId: user, programCode, nodeId, courseCode })
    .onConflictDoUpdate({
      target: [requirementSelections.userId, requirementSelections.programCode, requirementSelections.nodeId],
      set: { courseCode },
    })
    .run();
}

export function resetPlan(user: number) {
  db.transaction((tx) => {
    tx.delete(planEntries).where(eq(planEntries.userId, user)).run();
    tx.delete(pathwayChoices).where(eq(pathwayChoices.userId, user)).run();
    tx.delete(requirementSelections).where(eq(requirementSelections.userId, user)).run();
    tx.delete(profiles).where(eq(profiles.userId, user)).run();
  });
}
