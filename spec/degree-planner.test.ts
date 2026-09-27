import axe from "axe-core";
import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";

// Crit 7's contract, asserted against the running app over HTTP:
// the planner models real ANU program requirements, every course links to
// its official page, and a student's plan persists — create it, reload, and
// both the requirements tree and the semester plan still show it.
// Hooks are data-* attributes, so the tests survive a redesign.
const baseUrl = inject("baseUrl");

const PROGRAMS = {
  BCOMP: "Bachelor of Computing",
  AACOM: "Bachelor of Advanced Computing (Honours)",
  AACRD: "Bachelor of Advanced Computing (Research and Development) (Honours)",
  AENSE: "Bachelor of Engineering (Honours) in Software Engineering",
} as const;

const load = async (path: string): Promise<Document> => {
  const res = await fetch(new URL(path, baseUrl));
  expect(res.status, `GET ${path}`).toBe(200);
  return new JSDOM(await res.text()).window.document;
};

// Astro refuses cross-origin form POSTs; a browser sends Origin for free.
const post = (path: string, fields: Record<string, string>) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });

type Entry = { id: number; course: string; status: string; year: number; session: string };
const state = async (): Promise<{ program: string | null; entries: Entry[] }> =>
  (await fetch(new URL("/api/state", baseUrl))).json();

const leaf = (doc: Document, code: string) => doc.querySelector(`[data-course="${code}"]`);

describe("degree planner", () => {
  it("offers the four supported programs by their official names", async () => {
    const doc = await load("/");
    const text = doc.body.textContent ?? "";
    for (const name of Object.values(PROGRAMS)) expect(text).toContain(name);
  });

  it("persists the chosen program across a fresh load", async () => {
    const res = await post("/api/profile", { program: "AACOM" });
    expect(res.status).toBe(303);
    const doc = await load("/");
    expect(doc.querySelector("[data-program]")?.getAttribute("data-program")).toBe("AACOM");
    expect((await state()).program).toBe("AACOM");
  });

  it("starts with every requirement group collapsed", async () => {
    const doc = await load("/");
    const groups = doc.querySelectorAll("details[data-node]");
    expect(groups.length).toBeGreaterThan(0);
    expect(doc.querySelectorAll("details[data-node][open]").length).toBe(0);
  });

  it("shows the program's whole-program constraints with the official numbers", async () => {
    const doc = await load("/");
    const constraints = doc.querySelector("[data-constraints]")?.textContent ?? "";
    expect(constraints).toContain("192");
    expect(constraints).toContain("60 units may come from completion of 1000-level courses");
  });

  for (const [code, name] of Object.entries(PROGRAMS)) {
    it(`links every course in the ${code} tree to its official ANU course page`, async () => {
      await post("/api/profile", { program: code });
      const doc = await load("/");
      expect(doc.body.textContent).toContain(name);
      const courses = [...doc.querySelectorAll("[data-course]")];
      expect(courses.length).toBeGreaterThan(10);
      for (const node of courses) {
        const course = node.getAttribute("data-course");
        const link = node.querySelector<HTMLAnchorElement>(
          `a[href="https://programsandcourses.anu.edu.au/2027/course/${course}"]`,
        );
        expect(link, `${course} has no link to its official page`).not.toBeNull();
      }
    });
  }

  // The invariants see "/" in whatever state the other tests left it; this
  // runs the same accessibility floor on a populated tree and semester plan.
  it("keeps the populated tree and semester plan above the accessibility floor", async () => {
    await post("/api/profile", { program: "AACOM" });
    await post("/api/entries", { course: "COMP2100", status: "completed", year: "2025", session: "S2" });
    await post("/api/choices", { node: "specialisation", option: "ARIN-SPEC" });
    for (const path of ["/", "/plan/"]) {
      const html = await (await fetch(new URL(path, baseUrl))).text();
      const dom = new JSDOM(html, { url: new URL(path, baseUrl).href, runScripts: "outside-only", pretendToBeVisual: true });
      for (const d of dom.window.document.querySelectorAll("details")) d.setAttribute("open", "");
      const win = dom.window as unknown as { eval: (s: string) => void; axe: typeof axe };
      win.eval(axe.source);
      const results = await win.axe.run(dom.window.document, {
        rules: { "color-contrast": { enabled: false }, "link-in-text-block": { enabled: false } },
      });
      expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`)).toEqual([]);
    }
  });

  it("rejects malformed plan entries", async () => {
    await post("/api/profile", { program: "AACOM" });
    const bad = [
      { course: "not a code", status: "planned", year: "2027", session: "S1" },
      { course: "COMP4550", status: "maybe", year: "2027", session: "S1" },
      { course: "COMP4550", status: "planned", year: "2027", session: "S9" },
    ];
    for (const fields of bad) expect((await post("/api/entries", fields)).status).toBe(400);
  });

  it("persists a planned course into both the tree and the semester plan", async () => {
    await post("/api/profile", { program: "AACOM" });
    const res = await post("/api/entries", {
      course: "COMP4550",
      status: "planned",
      year: "2027",
      session: "S1",
    });
    expect(res.status).toBe(303);

    const tree = await load("/");
    const node = leaf(tree, "COMP4550");
    expect(node?.getAttribute("data-status")).toBe("planned");
    expect(node?.textContent).toContain("2027");

    const plan = await load("/plan/");
    const term = plan.querySelector('[data-term="2027-S1"]');
    expect(term?.querySelector('[data-entry-course="COMP4550"]')).not.toBeNull();
  });

  it("persists status changes and removals", async () => {
    await post("/api/profile", { program: "AACOM" });
    await post("/api/entries", { course: "COMP1100", status: "completed", year: "2025", session: "S1" });
    await post("/api/entries", { course: "COMP3320", status: "current", year: "2026", session: "S2" });

    const tree = await load("/");
    expect(leaf(tree, "COMP1100")?.getAttribute("data-status")).toBe("completed");

    const entry = (await state()).entries.find((e) => e.course === "COMP1100");
    if (!entry) throw new Error("COMP1100 entry was not persisted");
    await post(`/api/entries/${entry.id}`, { action: "update", status: "current", year: "2026", session: "S2" });
    expect(leaf(await load("/"), "COMP1100")?.getAttribute("data-status")).toBe("current");
    expect((await load("/plan/")).querySelector('[data-term="2026-S2"] [data-entry-course="COMP1100"]')).not.toBeNull();

    await post(`/api/entries/${entry.id}`, { action: "delete" });
    expect(leaf(await load("/"), "COMP1100")?.getAttribute("data-status")).toBe("none");
    expect((await load("/plan/")).querySelector('[data-entry-course="COMP1100"]')).toBeNull();
  });

  it("broadcasts plan changes to other open tabs over the event stream", async () => {
    const stream = await fetch(new URL("/api/events", baseUrl));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("no response body");

    await post("/api/entries", { course: "COMP3600", status: "planned", year: "2027", session: "S2" });

    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("data:")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before the event arrived");
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(received).toContain("plan");
  }, 10_000);
});
