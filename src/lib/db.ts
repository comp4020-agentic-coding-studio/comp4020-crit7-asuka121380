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
  type Session,
  type Status,
  users,
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

// ANU SSO is out of scope: every request acts as one already-signed-in
// student. Personal rows still carry user_id so real auth would slot in.
export const DEMO_USER = 1;

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
    const row = { ...p };
    tx.insert(programs).values(row).onConflictDoUpdate({ target: programs.code, set: row }).run();
  }
  tx.insert(users).values({ id: DEMO_USER, name: "Demo student" }).onConflictDoNothing().run();
});

export type { Course, PlanEntry, Session, Status };

export function listPrograms(): Program[] {
  return db.select().from(programs).all() as Program[];
}

export function getProgram(code: string): Program | undefined {
  return db.select().from(programs).where(eq(programs.code, code)).get() as Program | undefined;
}

export function getCatalogue(): Map<string, Course> {
  return new Map(
    db
      .select()
      .from(courses)
      .all()
      .map((c) => [c.code, c]),
  );
}

export function getProgramCode(user = DEMO_USER): string | null {
  return db.select().from(profiles).where(eq(profiles.userId, user)).get()?.programCode ?? null;
}

export function setProgram(code: string, user = DEMO_USER) {
  db.insert(profiles)
    .values({ userId: user, programCode: code })
    .onConflictDoUpdate({ target: profiles.userId, set: { programCode: code, updatedAt: sql`(datetime('now'))` } })
    .run();
}

export function listEntries(user = DEMO_USER): PlanEntry[] {
  return db
    .select()
    .from(planEntries)
    .where(eq(planEntries.userId, user))
    .all()
    .sort((a, b) => termOrder(a.year, a.session) - termOrder(b.year, b.session) || a.courseCode.localeCompare(b.courseCode));
}

export type EntryInput = { courseCode: string; status: Status; year: number; session: Session; units: number };

// The same course twice in one term is one enrolment, so a repeat add
// updates it rather than failing.
export function addEntry(input: EntryInput, user = DEMO_USER): PlanEntry {
  const set = { status: input.status, units: input.units, updatedAt: sql`(datetime('now'))` };
  return db
    .insert(planEntries)
    .values({ ...input, userId: user })
    .onConflictDoUpdate({ target: [planEntries.userId, planEntries.courseCode, planEntries.year, planEntries.session], set })
    .returning()
    .get();
}

export function updateEntry(id: number, input: Omit<EntryInput, "courseCode">, user = DEMO_USER): PlanEntry | undefined {
  return db
    .update(planEntries)
    .set({ ...input, updatedAt: sql`(datetime('now'))` })
    .where(and(eq(planEntries.id, id), eq(planEntries.userId, user)))
    .returning()
    .get();
}

export function deleteEntry(id: number, user = DEMO_USER) {
  db.delete(planEntries)
    .where(and(eq(planEntries.id, id), eq(planEntries.userId, user)))
    .run();
}

export function getChoices(programCode: string, user = DEMO_USER): Record<string, string> {
  const rows = db
    .select()
    .from(pathwayChoices)
    .where(and(eq(pathwayChoices.userId, user), eq(pathwayChoices.programCode, programCode)))
    .all();
  return Object.fromEntries(rows.map((r) => [r.nodeId, r.optionId]));
}

export function setChoice(programCode: string, nodeId: string, optionId: string | null, user = DEMO_USER) {
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
    .onConflictDoUpdate({ target: [pathwayChoices.userId, pathwayChoices.programCode, pathwayChoices.nodeId], set: { optionId } })
    .run();
}

export function resetPlan(user = DEMO_USER) {
  db.transaction((tx) => {
    tx.delete(planEntries).where(eq(planEntries.userId, user)).run();
    tx.delete(pathwayChoices).where(eq(pathwayChoices.userId, user)).run();
    tx.delete(profiles).where(eq(profiles.userId, user)).run();
  });
}
