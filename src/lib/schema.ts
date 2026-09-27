import { sql } from "drizzle-orm";
import { int, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Constraint, Program, ReqNode } from "./requirements";
import type { CourseRules } from "./rules";
import type { Session, Status } from "./terms";

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
  offered: text({ mode: "json" }).$type<Session[]>().notNull(),
  semesters: int().notNull().default(1),
  semesterNote: text("semester_note"),
  // null when the planner hasn't read the course page, so the tag is unknown
  transdisciplinary: int({ mode: "boolean" }),
  // the course page's rules, structured where reliable (see src/lib/rules.ts)
  rules: text({ mode: "json" }).$type<CourseRules>(),
  detailed: int({ mode: "boolean" }).notNull().default(false),
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

// ---- accounts: My Degree Planner's own, never an ANU identity ----

export const users = sqliteTable("users", {
  id: int().primaryKey({ autoIncrement: true }),
  username: text().notNull().unique(),
  // scrypt, salted; never the password itself
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// The cookie holds a random token; only its SHA-256 is stored, so a leaked
// database can't be replayed as a session.
export const sessions = sqliteTable("sessions", {
  id: text().primaryKey(),
  userId: int("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---- personal planning state: every row belongs to one account ----

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

// Entries are not tied to a program: they're the student's own record, so
// switching program re-reads the same courses against new rules. Only codes
// in the verified catalogue can be planned (the foreign key enforces it).
export const planEntries = sqliteTable(
  "plan_entries",
  {
    id: int().primaryKey({ autoIncrement: true }),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseCode: text("course_code")
      .notNull()
      .references(() => courses.code),
    status: text({ enum: ["completed", "current", "planned"] }).notNull(),
    year: int().notNull(),
    session: text({ enum: ["SUM", "S1", "AUT", "WIN", "S2", "SPR"] }).notNull(),
    units: int().notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  // One record per course per student: a course is in the plan once, in one
  // place. A two-semester course is still one record, starting in `session`.
  (t) => [uniqueIndex("plan_entries_user_course").on(t.userId, t.courseCode)],
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

// Which of the student's courses satisfies a "choose" requirement, when
// they'd rather pick than accept the planner's default.
export const requirementSelections = sqliteTable(
  "requirement_selections",
  {
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    programCode: text("program_code")
      .notNull()
      .references(() => programs.code),
    nodeId: text("node_id").notNull(),
    courseCode: text("course_code").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.programCode, t.nodeId] })],
);

export type Course = typeof courses.$inferSelect;
export type PlanEntry = typeof planEntries.$inferSelect;
export type User = typeof users.$inferSelect;
export type { Session, Status };
