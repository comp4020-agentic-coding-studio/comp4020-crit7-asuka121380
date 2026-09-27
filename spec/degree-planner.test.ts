import axe from "axe-core";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, inject, it } from "vitest";

// Crit 7's contract, asserted against the running app over HTTP. Each
// student has a private My Degree Planner account; every read and write is
// scoped to the signed-in account by the server; a course is in a plan once;
// and progress is credited once. Hooks are data-* attributes, so the tests
// survive a redesign.
const baseUrl = inject("baseUrl");

const PROGRAMS = {
  BCOMP: "Bachelor of Computing",
  AACOM: "Bachelor of Advanced Computing (Honours)",
  AACRD: "Bachelor of Advanced Computing (Research and Development) (Honours)",
  AENSE: "Bachelor of Engineering (Honours) in Software Engineering",
} as const;

const PASSWORD = "planner-test-password";
const unique = (name: string) => `${name}-${process.hrtime.bigint().toString(36)}`.slice(0, 32);

type Entry = { id: number; course: string; status: string; year: number; session: string; units: number };
type State = {
  user: string;
  program: string | null;
  entries: Entry[];
  selections: Record<string, string>;
  summary: { target: number; inPlan: Record<string, number>; counting: Record<string, number> } | null;
};
type Result = { status: number; body: Record<string, unknown> & { ok?: boolean; code?: string } };

// Astro refuses cross-origin form POSTs; a browser sends Origin for free.
const raw = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  fetch(new URL(path, baseUrl), {
    ...init,
    redirect: "manual",
    headers: { origin: baseUrl, ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) },
  });

class Student {
  constructor(
    readonly username: string,
    public cookie: string,
  ) {}

  static async signup(name: string): Promise<Student> {
    const username = unique(name);
    const res = await raw("/signup/", { method: "POST", body: new URLSearchParams({ username, password: PASSWORD, confirm: PASSWORD }) });
    expect(res.status, "signup").toBe(303);
    return new Student(username, cookieFrom(res));
  }

  page = async (path: string): Promise<Document> => {
    const res = await raw(path, { cookie: this.cookie });
    expect(res.status, `GET ${path}`).toBe(200);
    return new JSDOM(await res.text()).window.document;
  };

  // form POST that asks for JSON, as the enhanced client does
  send = async (path: string, fields: Record<string, string>): Promise<Result> => {
    const res = await raw(path, {
      method: "POST",
      cookie: this.cookie,
      headers: { accept: "application/json" },
      body: new URLSearchParams(fields),
    });
    return { status: res.status, body: await res.json() };
  };

  state = async (): Promise<State> => (await raw("/api/state", { cookie: this.cookie })).json();
  entry = async (course: string) => (await this.state()).entries.find((e) => e.course === course);
  add = (course: string, status: string, year: number, session: string, extra: Record<string, string> = {}) =>
    this.send("/api/entries", { course, status, year: String(year), session, ...extra });
  program = (program: string) => this.send("/api/profile", { program });
}

function cookieFrom(res: Response): string {
  const set = res.headers.getSetCookie().find((c) => c.startsWith("mdp_session="));
  if (!set) throw new Error("no session cookie set");
  return set.split(";")[0];
}

const leaf = (doc: Document, code: string) => doc.querySelector(`[data-course="${code}"]`);

describe("signed out", () => {
  it("offers a landing page that says this isn't an ANU account", async () => {
    const res = await raw("/");
    expect(res.status).toBe(200);
    const text = new JSDOM(await res.text()).window.document.body.textContent ?? "";
    expect(text).toContain("This is a My Degree Planner account, not your ANU account.");
    expect(text).toContain("Never enter your ANU password here.");
  });

  it("sends private pages to the login page and refuses API access", async () => {
    const plan = await raw("/plan/");
    expect(plan.status).toBe(303);
    expect(plan.headers.get("location")).toMatch(/^\/login\//);
    expect((await raw("/api/state")).status).toBe(401);
    expect((await raw("/api/events")).status).toBe(401);
    const write = await raw("/api/entries", {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams({ course: "COMP1100", status: "planned", year: "2027", session: "S1" }),
    });
    expect(write.status).toBe(401);
  });
});

describe("accounts", () => {
  it("rejects weak passwords and taken usernames", async () => {
    const weak = await raw("/signup/", { method: "POST", body: new URLSearchParams({ username: unique("weak"), password: "short", confirm: "short" }) });
    expect(weak.status).toBe(400);
    const a = await Student.signup("taken");
    const again = await raw("/signup/", { method: "POST", body: new URLSearchParams({ username: a.username, password: PASSWORD, confirm: PASSWORD }) });
    expect(again.status).toBe(400);
    expect(await again.text()).toContain("taken");
  });

  it("logs in with the right password only, and logging out ends the session", async () => {
    const a = await Student.signup("login");
    const wrong = await raw("/login/", { method: "POST", body: new URLSearchParams({ username: a.username, password: "not-the-password" }) });
    expect(wrong.status).toBe(400);
    const right = await raw("/login/", { method: "POST", body: new URLSearchParams({ username: a.username, password: PASSWORD }) });
    expect(right.status).toBe(303);
    const session = cookieFrom(right);
    expect((await raw("/api/state", { cookie: session })).status).toBe(200);
    await raw("/api/auth/logout", { method: "POST", cookie: session });
    expect((await raw("/api/state", { cookie: session })).status).toBe(401);
  });

  it("restores the same plan after logging out and back in", async () => {
    const a = await Student.signup("restore");
    await a.program("AENSE");
    await a.add("COMP1100", "completed", 2025, "S1");
    await raw("/api/auth/logout", { method: "POST", cookie: a.cookie });
    const back = await raw("/login/", { method: "POST", body: new URLSearchParams({ username: a.username, password: PASSWORD }) });
    a.cookie = cookieFrom(back);
    const state = await a.state();
    expect(state.program).toBe("AENSE");
    expect(state.entries.map((e) => e.course)).toEqual(["COMP1100"]);
  });
});

describe("isolation between accounts", () => {
  let a: Student;
  let b: Student;
  beforeAll(async () => {
    a = await Student.signup("iso-a");
    b = await Student.signup("iso-b");
    await a.program("AACOM");
    await b.program("BCOMP");
    await a.add("COMP1100", "completed", 2025, "S1");
    await b.add("COMP1130", "completed", 2025, "S1");
  });

  it("shows each student only their own program and courses", async () => {
    expect((await a.state()).program).toBe("AACOM");
    expect((await b.state()).program).toBe("BCOMP");
    expect((await a.state()).entries.map((e) => e.course)).toEqual(["COMP1100"]);
    expect((await b.state()).entries.map((e) => e.course)).toEqual(["COMP1130"]);
    expect(leaf(await b.page("/"), "COMP1100")?.getAttribute("data-status")).toBe("none");
  });

  it("won't let one student change or remove another's entry", async () => {
    const theirs = await b.entry("COMP1130");
    if (!theirs) throw new Error("setup");
    const edit = await a.send(`/api/entries/${theirs.id}`, { op: "update", status: "planned", year: "2027", session: "S1" });
    expect(edit.status).toBe(404);
    const del = await a.send(`/api/entries/${theirs.id}`, { op: "delete" });
    expect(del.status).toBe(404);
    expect(await b.entry("COMP1130")).toMatchObject({ status: "completed", year: 2025 });
  });

  it("resets only the signed-in student's plan", async () => {
    const c = await Student.signup("iso-c");
    await c.add("COMP1110", "completed", 2025, "S2");
    expect((await c.send("/api/reset", {})).status).toBe(200);
    expect((await c.state()).entries).toEqual([]);
    expect((await b.state()).entries.map((e) => e.course)).toEqual(["COMP1130"]);
  });

  it("sends live updates only to the account that changed", async () => {
    const listen = async (s: Student) => {
      const res = await raw("/api/events", { cookie: s.cookie });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no body");
      let text = "";
      const decoder = new TextDecoder();
      const done = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          text += decoder.decode(value, { stream: true });
        }
      })();
      return { read: () => text, stop: () => reader.cancel().then(() => done) };
    };
    const aStream = await listen(a);
    const bStream = await listen(b);
    await a.add("MATH1005", "completed", 2025, "S1");
    await new Promise((r) => setTimeout(r, 400));
    expect(aStream.read()).toContain("event: plan");
    expect(bStream.read()).not.toContain("event: plan");
    await aStream.stop();
    await bStream.stop();
  }, 10_000);
});

describe("one record per course", () => {
  let s: Student;
  beforeAll(async () => {
    s = await Student.signup("dup");
    await s.program("AACOM");
  });

  it("refuses a second entry for the same course, and says where the first one is", async () => {
    expect((await s.add("COMP1100", "completed", 2024, "S1")).status).toBe(200);
    const again = await s.add("COMP1100", "completed", 2026, "S1");
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("duplicate");
    expect(again.body.existing).toMatchObject({ course: "COMP1100", year: 2024, session: "S1" });
    expect((await s.state()).entries.filter((e) => e.course === "COMP1100")).toHaveLength(1);
  });

  it("moves the existing record instead", async () => {
    const e = await s.entry("COMP1100");
    const moved = await s.send(`/api/entries/${e?.id}`, { op: "update", status: "completed", year: "2025", session: "S1" });
    expect(moved.status).toBe(200);
    expect(await s.entry("COMP1100")).toMatchObject({ year: 2025, session: "S1" });
  });

  it("refuses a course that's officially incompatible with one already planned", async () => {
    const clash = await s.add("COMP1130", "completed", 2025, "S1");
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("incompatible");
    expect(String(clash.body.error)).toContain("Incompatible with COMP1100");
  });

  it("refuses codes that aren't in the verified 2027 catalogue", async () => {
    const fake = await s.add("COMP0721", "completed", 2026, "S1");
    expect(fake.status).toBe(404);
    expect(fake.body.code).toBe("unknown_course");
    expect((await s.add("not a code", "planned", 2027, "S1")).status).toBe(400);
  });
});

describe("editing and removing", () => {
  let s: Student;
  beforeAll(async () => {
    s = await Student.signup("edit");
    await s.program("AACOM");
    await s.add("COMP3630", "planned", 2027, "S1");
  });

  it("moves a course between Completed, Studying now and Planned", async () => {
    const id = (await s.entry("COMP3630"))?.id;
    for (const [status, year, session] of [
      ["current", "2026", "S2"],
      ["completed", "2026", "S1"],
      ["planned", "2027", "S1"],
    ]) {
      const res = await s.send(`/api/entries/${id}`, { op: "update", status, year, session });
      expect(res.status, status).toBe(200);
      expect(await s.entry("COMP3630")).toMatchObject({ status, year: Number(year), session });
    }
    const tree = await s.page("/");
    expect(leaf(tree, "COMP3630")?.getAttribute("data-status")).toBe("planned");
    expect((await s.page("/plan/")).querySelector('[data-term="2027-S1"] [data-entry-course="COMP3630"]')).not.toBeNull();
  });

  it("answers each kind of bad edit with its own status and code", async () => {
    const id = (await s.entry("COMP3630"))?.id;
    const bad = async (fields: Record<string, string>) => (await s.send(`/api/entries/${id}`, { op: "update", ...fields })).body.code;
    expect(await bad({ status: "maybe", year: "2027", session: "S1" })).toBe("invalid_status");
    expect(await bad({ status: "planned", year: "1990", session: "S1" })).toBe("invalid_year");
    expect(await bad({ status: "planned", year: "2027", session: "S9" })).toBe("invalid_session");
    await s.add("ENGN4300", "planned", 2028, "S1");
    const engn = (await s.entry("ENGN4300"))?.id;
    const units = await s.send(`/api/entries/${engn}`, { op: "update", status: "planned", year: "2028", session: "S1", units: "30" });
    expect([units.status, units.body.code]).toEqual([400, "invalid_units"]);
    const winter = await s.send(`/api/entries/${engn}`, { op: "update", status: "planned", year: "2028", session: "WIN" });
    expect([winter.status, winter.body.code]).toEqual([422, "invalid_session"]);
  });

  it("removes a course from every view, and a second removal is not found", async () => {
    const id = (await s.entry("COMP3630"))?.id;
    const res = await s.send(`/api/entries/${id}`, { op: "delete" });
    expect(res.status).toBe(200);
    expect(res.body.removed).toMatchObject({ course: "COMP3630" });
    expect(leaf(await s.page("/"), "COMP3630")?.getAttribute("data-status")).toBe("none");
    expect((await s.page("/plan/")).querySelector('[data-entry-course="COMP3630"]')).toBeNull();
    expect((await s.send(`/api/entries/${id}`, { op: "delete" })).status).toBe(404);
  });

  it("warns above a 24-unit study period and refuses more than 36", async () => {
    const t = await Student.signup("load");
    for (const c of ["COMP2100", "COMP2300", "COMP2400", "MATH1005"]) expect((await t.add(c, "planned", 2027, "S1")).status).toBe(200);
    const fifth = await t.add("PHIL1004", "planned", 2027, "S1");
    expect(fifth.status).toBe(200);
    expect((fifth.body.warnings as { code: string }[]).map((w) => w.code)).toContain("heavy_load");
    await t.add("STAT1003", "planned", 2027, "S1");
    const seventh = await t.add("COMP1100", "planned", 2027, "S1");
    expect([seventh.status, seventh.body.code]).toEqual([422, "over_limit"]);
  });
});

describe("requirements and progress", () => {
  it("offers the four programs by their official names", async () => {
    const s = await Student.signup("programs");
    const text = (await s.page("/")).body.textContent ?? "";
    for (const name of Object.values(PROGRAMS)) expect(text).toContain(name);
  });

  it("credits only one option of a choose-one requirement, and lets the student pick which", async () => {
    const s = await Student.signup("choose");
    await s.program("AACOM");
    await s.add("MATH1005", "completed", 2025, "S1");
    await s.add("MATH2222", "completed", 2025, "S2");
    const maths = (doc: Document) => doc.querySelector('details[data-node="maths"]');
    let tree = await s.page("/");
    expect(maths(tree)?.querySelector('[data-course="MATH1005"]')?.getAttribute("data-counts")).toBe("here");
    expect(maths(tree)?.querySelector('[data-course="MATH2222"]')?.getAttribute("data-counts")).toBe("elsewhere");
    expect(maths(tree)?.querySelector(".group__fraction")?.textContent?.replace(/\s/g, "")).toBe("6/6");

    expect((await s.send("/api/selections", { node: "maths", course: "MATH2222" })).status).toBe(200);
    tree = await s.page("/");
    expect(maths(tree)?.querySelector('[data-course="MATH2222"]')?.getAttribute("data-counts")).toBe("here");
    expect(maths(tree)?.querySelector('[data-course="MATH1005"]')?.getAttribute("data-counts")).toBe("elsewhere");
    expect((await s.state()).selections).toEqual({ maths: "MATH2222" });

    expect((await s.send("/api/selections", { node: "maths", course: "COMP1100" })).body.code).toBe("not_an_option");
    expect((await s.send("/api/selections", { node: "prog1", course: "COMP1130" })).body.code).toBe("not_in_plan");
  });

  it("never lets the headline exceed the program, and agrees with the whole-program total", async () => {
    const s = await Student.signup("total");
    await s.program("AACOM");
    const courses = ["COMP1100", "COMP1110", "COMP2100", "COMP2120", "COMP2300", "COMP2310", "COMP2400", "COMP3600"];
    for (const [i, c] of courses.entries()) await s.add(c, "completed", 2023 + Math.floor(i / 4), i % 4 < 2 ? "S1" : "S2");
    const state = await s.state();
    const counting = Object.values(state.summary?.counting ?? {}).reduce((a, b) => a + b, 0);
    expect(counting).toBe(48);
    const tree = await s.page("/");
    expect(tree.querySelector("[data-counting]")?.textContent?.trim()).toBe("48");
    const totalRule = tree.querySelector('[data-rule="total"] .rule__value')?.textContent?.trim();
    expect(totalRule).toBe("48");
  });

  it("starts with every requirement group collapsed and quotes the official rules", async () => {
    const s = await Student.signup("collapsed");
    await s.program("AACOM");
    const doc = await s.page("/");
    expect(doc.querySelectorAll("details[data-node]").length).toBeGreaterThan(0);
    expect(doc.querySelectorAll("details[data-node][open]").length).toBe(0);
    const rules = doc.querySelector("[data-constraints]")?.textContent ?? "";
    expect(rules).toContain("192");
    expect(rules).toContain("60 units may come from completion of 1000-level courses");
  });

  for (const [code, name] of Object.entries(PROGRAMS)) {
    it(`links every course in the ${code} tree to its official ANU course page`, async () => {
      const s = await Student.signup(`links-${code}`);
      await s.program(code);
      const doc = await s.page("/");
      expect(doc.body.textContent).toContain(name);
      const courses = [...doc.querySelectorAll("[data-course]")];
      expect(courses.length).toBeGreaterThan(10);
      for (const node of courses) {
        const course = node.getAttribute("data-course");
        expect(node.querySelector(`a[href="https://programsandcourses.anu.edu.au/2027/course/${course}"]`), course ?? "").not.toBeNull();
      }
    });
  }

  it("keeps the populated tree, semester plan and login pages above the accessibility floor", async () => {
    const s = await Student.signup("axe");
    await s.program("AACOM");
    await s.add("COMP2100", "completed", 2025, "S2");
    await s.add("MATH1005", "completed", 2025, "S1");
    await s.add("MATH2222", "planned", 2027, "S1");
    await s.send("/api/choices", { node: "specialisation", option: "ARIN-SPEC" });
    for (const path of ["/", "/plan/", "/login/", "/signup/"]) {
      const res = await raw(path, { cookie: path.startsWith("/log") || path.startsWith("/sign") ? undefined : s.cookie });
      const dom = new JSDOM(await res.text(), { url: new URL(path, baseUrl).href, runScripts: "outside-only", pretendToBeVisual: true });
      expect(dom.window.document.querySelectorAll("h1").length, `${path} has one h1`).toBe(1);
      expect(dom.window.document.documentElement.lang, `${path} declares its language`).toBeTruthy();
      for (const d of dom.window.document.querySelectorAll("details")) d.setAttribute("open", "");
      const win = dom.window as unknown as { eval: (src: string) => void; axe: typeof axe };
      win.eval(axe.source);
      const results = await win.axe.run(dom.window.document, {
        rules: { "color-contrast": { enabled: false }, "link-in-text-block": { enabled: false } },
      });
      expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`)).toEqual([]);
    }
  });
});
