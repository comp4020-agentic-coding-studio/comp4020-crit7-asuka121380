import { sql } from "drizzle-orm";
import { int, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Constraint, Program, ReqNode } from "./requirements";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts). Never edit the database by hand.

// ---- reference data: official ANU information, re-seeded on every boot ----

export const courses = sqliteTable("courses", {
  code: text().primaryKey(),
  title: text().notNull(),
  unitsMin: int("units_min").notNull(),
  unitsMax: int("units_max").notNull(),
  offered: text({ mode: "json" }).$type<string[]>().notNull(),
  transdisciplinary: int({ mode: "boolean" }).notNull(),
  url: text().notNull(),
});

export const programs = sqliteTable("programs", {
  code: text().primaryKey(),
  name: text().notNull(),
  year: int().notNull(),
  units: int().notNull(),
  duration: text().notNull(),
  url: text().notNull(),
  summary: text().notNull(),
  requirements: text({ mode: "json" }).$type<ReqNode[]>().notNull(),
  constraints: text({ mode: "json" }).$type<Constraint[]>().notNull(),
  untracked: text({ mode: "json" }).$type<Program["untracked"]>().notNull(),
});

// ---- personal planning state: written only by the student ----

export const users = sqliteTable("users", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
});

export const profiles = sqliteTable("profiles", {
  userId: int("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  programCode: text("program_code")
    .notNull()
    .references(() => programs.code),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Entries are not tied to a program: they're the student's own history and
// plan, so switching program re-reads the same courses against new rules.
// course_code is deliberately not a foreign key — a student can plan an
// elective the seeded catalogue doesn't carry.
export const planEntries = sqliteTable(
  "plan_entries",
  {
    id: int().primaryKey({ autoIncrement: true }),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseCode: text("course_code").notNull(),
    status: text({ enum: ["completed", "current", "planned"] }).notNull(),
    year: int().notNull(),
    session: text({ enum: ["SUM", "S1", "AUT", "WIN", "S2", "SPR"] }).notNull(),
    units: int().notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("plan_entries_user_course_term").on(t.userId, t.courseCode, t.year, t.session)],
);

export const pathwayChoices = sqliteTable(
  "pathway_choices",
  {
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    programCode: text("program_code")
      .notNull()
      .references(() => programs.code),
    nodeId: text("node_id").notNull(),
    optionId: text("option_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.programCode, t.nodeId] })],
);

export type Course = typeof courses.$inferSelect;
export type PlanEntry = typeof planEntries.$inferSelect;
export type Status = PlanEntry["status"];
export type Session = PlanEntry["session"];
