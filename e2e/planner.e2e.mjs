// Browser checks for what only a real browser can show: the enhanced forms,
// the course panel, live refreshes, focus, mobile and reduced motion. Run
// against a running server (dev or built):
//
//   BASE=http://localhost:4321 CHROME=/path/to/chrome pnpm e2e
//
// It creates two throwaway accounts and exits non-zero on the first failure.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:4321";
const browser = await chromium.launch({ executablePath: process.env.CHROME, channel: process.env.CHROME ? undefined : "chrome" });
const stamp = Date.now().toString(36);
const PASSWORD = "e2e-planner-password";
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (error) {
    results.push(`✗ ${name}\n    ${error.message.split("\n")[0]}`);
    console.log(results.join("\n"));
    await browser.close();
    process.exit(1);
  }
}

async function account(name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const username = `${name}-${stamp}`;
  await page.goto(`${BASE}/signup/`);
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="confirm"]', PASSWORD);
  await page.click('button:has-text("Create account")');
  await page.waitForURL(`${BASE}/`);
  return { ctx, page, username, errors };
}

const settle = (page) => page.waitForTimeout(700);
const status = (page, code) => page.getAttribute(`[data-tree] [data-course="${code}"]`, "data-status");
const toast = (page) => page.textContent("#toast");

async function addFromTree(page, node, code, statusValue, year, session) {
  if (!(await page.$eval(`details[data-node="${node}"]`, (d) => d.open))) await page.click(`details[data-node="${node}"] > summary`);
  await page.click(`details[data-node="${node}"] [data-open-course="${code}"]`);
  await page.click(`.seg__opt--${statusValue}`);
  await page.selectOption('[data-panel-form] select[name="year"]', String(year));
  await page.selectOption('[data-panel-form] select[name="session"]', session);
  await page.click('[data-panel-form] button:has-text("Add to plan")');
  await settle(page);
}

const A = await account("e2e-a");
const B = await account("e2e-b");

await step("1–2. two accounts choose different degrees", async () => {
  await A.page.click('button:has-text("Bachelor of Advanced Computing (Honours)")');
  await B.page.click('button:has-text("Bachelor of Computing")');
  await settle(A.page);
  await settle(B.page);
  assert.equal(await A.page.getAttribute("main", "data-program"), "AACOM");
  assert.equal(await B.page.getAttribute("main", "data-program"), "BCOMP");
});

await step("5. add COMP1100 once from the tree", async () => {
  await addFromTree(A.page, "prog1", "COMP1100", "completed", 2025, "S1");
  assert.equal(await status(A.page, "COMP1100"), "completed");
  assert.match(await toast(A.page), /Saved COMP1100/);
});

await step("3. the other account doesn't see it, and wasn't refreshed by it", async () => {
  await B.page.waitForTimeout(500);
  assert.equal(await status(B.page, "COMP1100"), "none");
  await B.page.reload();
  assert.equal(await status(B.page, "COMP1100"), "none");
});

await step("5–6. a second COMP1100 is refused; the existing one moves instead", async () => {
  await A.page.goto(`${BASE}/plan/`);
  await A.page.click('[data-term="2026-S1"] [data-add-course]');
  await A.page.fill("[data-code-input]", "COMP1100");
  await A.page.waitForSelector("[data-move-existing]");
  assert.match(await A.page.textContent("[data-code-status]"), /already in your plan/);
  assert.equal(await A.page.isDisabled("[data-submit]"), true);
  await A.page.click("[data-move-existing]");
  await settle(A.page);
  assert.equal(await A.page.$$eval('[data-entry-course="COMP1100"]', (els) => els.length), 1);
  assert.ok(await A.page.$('[data-term="2026-S1"] [data-entry-course="COMP1100"]'));
});

await step("7. edit a course between Completed, Studying now and Planned", async () => {
  for (const [s, year, session] of [
    ["current", "2026", "S2"],
    ["planned", "2027", "S2"],
    ["completed", "2026", "S1"],
  ]) {
    await A.page.click('[data-entry-course="COMP1100"] .entry__main');
    await A.page.click(`.seg__opt--${s}`);
    await A.page.selectOption('[data-panel-form] select[name="year"]', year);
    await A.page.selectOption('[data-panel-form] select[name="session"]', session);
    await A.page.click('button:has-text("Save changes")');
    await settle(A.page);
    assert.equal(await A.page.getAttribute('[data-entry-course="COMP1100"]', "data-status"), s);
    assert.ok(await A.page.$(`[data-term="${year}-${session}"] [data-entry-course="COMP1100"]`), `moved to ${year}-${session}`);
  }
});

await step("8. remove a course: every view updates, and Undo restores it", async () => {
  await A.page.click('[data-entry-course="COMP1100"] .entry__main');
  await A.page.click('.panel__current button:has-text("Remove")');
  await settle(A.page);
  assert.match(await toast(A.page), /Removed COMP1100/);
  await A.page.keyboard.press("Escape");
  assert.equal(await A.page.$('[data-entry-course="COMP1100"]'), null);
  await A.page.click('[data-toast-action]');
  await settle(A.page);
  assert.ok(await A.page.$('[data-entry-course="COMP1100"]'));
  await A.page.goto(`${BASE}/`);
  assert.equal(await status(A.page, "COMP1100"), "completed");
});

await step("9–10. both options of a choose-one list: only one counts, and the student can switch", async () => {
  await addFromTree(A.page, "maths", "MATH1005", "completed", 2025, "S1");
  await addFromTree(A.page, "maths", "MATH2222", "completed", 2025, "S2");
  const counts = (code) => A.page.getAttribute(`details[data-node="maths"] [data-course="${code}"]`, "data-counts");
  assert.equal(await counts("MATH1005"), "here");
  assert.equal(await counts("MATH2222"), "elsewhere");
  assert.equal((await A.page.textContent('details[data-node="maths"] .group__fraction')).replace(/\s/g, ""), "6/6");
  await A.page.click('details[data-node="maths"] [data-course="MATH2222"] button:has-text("Count this one here")');
  await settle(A.page);
  assert.equal(await counts("MATH2222"), "here");
  assert.equal(await counts("MATH1005"), "elsewhere");
});

await step("9. an officially incompatible alternative is explained, not added", async () => {
  await A.page.click('details[data-node="prog1"] [data-open-course="COMP1130"]');
  assert.match(await A.page.textContent(".conflict"), /can't be added alongside COMP1100/);
  assert.equal(await A.page.$("[data-panel-form]"), null);
  await A.page.keyboard.press("Escape");
});

await step("11. duplicates can't inflate the total: headline matches the whole-program rule", async () => {
  const headline = await A.page.textContent("[data-counting]");
  const rule = await A.page.textContent('[data-rule="total"] .rule__value');
  assert.equal(headline.trim(), rule.trim());
  assert.equal(headline.trim(), "18");
});

await step("12. an unknown course code can't be added", async () => {
  await A.page.goto(`${BASE}/plan/`);
  await A.page.click('[data-term="2027-S1"] [data-add-course]');
  await A.page.fill("[data-code-input]", "COMP0721");
  await A.page.waitForFunction(() => document.querySelector("[data-code-status]")?.textContent?.includes("isn't in the 2027"));
  assert.equal(await A.page.isDisabled("[data-submit]"), true);
  await A.page.keyboard.press("Escape");
});

await step("13. failed requests explain themselves", async () => {
  await A.page.click('[data-entry-course="COMP1100"] .entry__main');
  await A.ctx.setOffline(true);
  await A.page.click('button:has-text("Save changes")');
  await A.page.waitForTimeout(300);
  assert.match(await A.page.textContent("[data-panel-form] [data-error]"), /Couldn't reach the server/);
  await A.ctx.setOffline(false);
  await A.page.keyboard.press("Escape");
});

await step("14. keyboard: Escape closes the panel and focus returns to its opener", async () => {
  await A.page.focus('[data-entry-course="MATH1005"] .entry__main');
  await A.page.keyboard.press("Enter");
  await A.page.waitForSelector("#course-panel[open]");
  assert.equal(await A.page.evaluate(() => document.activeElement?.id), "panel-title");
  await A.page.keyboard.press("Escape");
  await A.page.waitForTimeout(300);
  assert.equal(await A.page.evaluate(() => document.activeElement?.closest("[data-entry-course]")?.dataset.entryCourse), "MATH1005");
});

await step("11. program switcher options have screen-reader names", async () => {
  await A.page.goto(`${BASE}/`);
  const labels = await A.page.$$eval(".switcher__option", (els) => els.map((e) => e.getAttribute("aria-label")));
  assert.equal(labels.length, 4);
  for (const l of labels) assert.match(l, /^(Switch to .+ \((BCOMP|AACOM|AACRD|AENSE)\)|.+ \((BCOMP|AACOM|AACRD|AENSE)\), your current program)$/);
});

await step("15. Reset clears only the signed-in account", async () => {
  await B.page.goto(`${BASE}/`);
  await addFromTree(B.page, "lists", "COMP1600", "completed", 2025, "S2").catch(() => {});
  const bBefore = await B.page.request.get(`${BASE}/api/state`).then((r) => r.json());
  A.page.once("dialog", (d) => d.accept());
  await A.page.click('button:has-text("Reset my plan")');
  await settle(A.page);
  const aAfter = await A.page.request.get(`${BASE}/api/state`).then((r) => r.json());
  const bAfter = await B.page.request.get(`${BASE}/api/state`).then((r) => r.json());
  assert.equal(aAfter.entries.length, 0);
  assert.deepEqual(bAfter.entries, bBefore.entries);
});

await step("4. logging out and back in restores the plan", async () => {
  await B.page.click(".account > summary");
  await B.page.click('button:has-text("Log out")');
  await B.page.waitForURL(`${BASE}/`);
  assert.equal(await B.page.$("[data-tree]"), null);
  await B.page.goto(`${BASE}/login/`);
  await B.page.fill('input[name="username"]', B.username);
  await B.page.fill('input[name="password"]', PASSWORD);
  await B.page.click('button:has-text("Log in")');
  await B.page.waitForURL(`${BASE}/`);
  assert.equal(await B.page.getAttribute("main", "data-program"), "BCOMP");
});

await step("14. mobile with reduced motion: drill-down and bottom sheet, no sideways scroll", async () => {
  const m = await account("e2e-m", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await m.page.tap('button:has-text("Bachelor of Computing")');
  await settle(m.page);
  await m.page.tap('details[data-node="lists"] > summary');
  await m.page.tap('details[data-node="compulsory"] > summary');
  assert.match(await m.page.textContent("[data-crumbs]"), /All requirements.*Computing requirements.*Compulsory courses/s);
  await m.page.tap('[data-open-course="COMP2100"]');
  await m.page.waitForSelector("#course-panel[open]");
  assert.equal(await m.page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(m.errors, []);
});

assert.deepEqual([...A.errors, ...B.errors], [], "no uncaught page errors");
console.log(results.join("\n"));
await browser.close();
