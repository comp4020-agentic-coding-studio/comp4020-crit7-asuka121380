import { createHash, randomBytes } from "node:crypto";
import type { AstroCookies } from "astro";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { sessions, type User, users } from "./schema";

// My Degree Planner's own accounts: a username and password that exist only
// in this app. Nothing here touches, imitates or asks for an ANU identity.

export const COOKIE = "mdp_session";
const SESSION_DAYS = 30;

export type AuthUser = Pick<User, "id" | "username">;

// A real hash to compare against when the username doesn't exist, so a
// failed login takes the same time either way.
const decoy = hashPassword(randomBytes(16).toString("hex"));

export const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const normaliseUsername = (raw: string) => raw.trim().toLowerCase();

export function validateCredentials(username: string, password: string): string | null {
  if (!USERNAME.test(username))
    return "Usernames are 3–32 characters: lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit.";
  if (password.length < 10) return "Use a password of at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

export async function createUser(username: string, password: string): Promise<AuthUser | null> {
  const passwordHash = await hashPassword(password);
  const row = db.insert(users).values({ username, passwordHash }).onConflictDoNothing().returning().get();
  return row ? { id: row.id, username: row.username } : null;
}

// Failed attempts per username, in memory: enough to slow guessing against a
// prototype running on one machine.
const failures = new Map<string, { count: number; since: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export function lockedOut(username: string): boolean {
  const f = failures.get(username);
  if (!f) return false;
  if (Date.now() - f.since > WINDOW_MS) {
    failures.delete(username);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

export async function authenticate(username: string, password: string): Promise<AuthUser | null> {
  const row = db.select().from(users).where(eq(users.username, username)).get();
  const ok = await verifyPassword(password, row?.passwordHash ?? (await decoy));
  if (row && ok) {
    failures.delete(username);
    return { id: row.id, username: row.username };
  }
  const f = failures.get(username);
  failures.set(username, f && Date.now() - f.since <= WINDOW_MS ? { ...f, count: f.count + 1 } : { count: 1, since: Date.now() });
  return null;
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export function startSession(cookies: AstroCookies, user: AuthUser, secure: boolean) {
  const token = randomBytes(32).toString("base64url");
  db.insert(sessions).values({ id: digest(token), userId: user.id, expiresAt: isoIn(SESSION_DAYS) }).run();
  db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
  cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function sessionUser(cookies: AstroCookies): AuthUser | null {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return null;
  const row = db
    .select({ id: users.id, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, digest(token)), gt(sessions.expiresAt, new Date().toISOString())))
    .get();
  return row ?? null;
}

export function endSession(cookies: AstroCookies) {
  const token = cookies.get(COOKIE)?.value;
  if (token) db.delete(sessions).where(eq(sessions.id, digest(token))).run();
  cookies.delete(COOKIE, { path: "/" });
}
