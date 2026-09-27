import { Idiomorph } from "idiomorph";
import { type CourseFacts, checkPlacement, type Issue, termsOccupied } from "../lib/checks";
import { type Session, SESSIONS, STATUS_LABEL, type Status, termLabel, termOrder } from "../lib/terms";

// Progressive enhancement over server-rendered pages. Everything here is
// optional: the tree is plain <details>, and every change is a plain form
// POST. This adds motion, the course panel, in-place refreshes, and a live
// link between the signed-in student's own open tabs. The server remains
// the authority: the hints here come from the same rules it enforces.

type Entry = { id: number; course: string; status: Status; year: number; session: Session; units: number; counts: string | null };
type Known = {
  title: string;
  min: number;
  max: number;
  semesters: number;
  semesterNote: string | null;
  offered: Session[];
  tps: boolean | null;
  incompatible: string[];
  incompatibleNote: string | null;
  detailed: boolean;
};
type Data = {
  program: string | null;
  now: { year: number; session: Session };
  entries: Entry[];
  courses: Record<string, Known>;
};
type Existing = { id: number; course: string; status: Status; year: number; session: Session; units: number; where: string };
type Result = {
  ok: boolean;
  code?: string;
  error?: string;
  warnings?: Issue[];
  existing?: Existing;
  removed?: Existing;
  entry?: Existing;
};

const MARK: Record<Status | "none", string> = {
  completed:
    '<svg class="mark mark--completed" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.3 7 10.4 11.2 5.9" fill="none" stroke="var(--surface)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  current:
    '<svg class="mark mark--current" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 1.8a6.2 6.2 0 0 0 0 12.4z" fill="currentColor"/></svg>',
  planned:
    '<svg class="mark mark--planned" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.6 1.9"/></svg>',
  none: '<svg class="mark mark--none" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
};

const CLIENT_ID = crypto.randomUUID();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const narrow = matchMedia("(max-width: 759px)");
let data: Data | null = null;
let focusId: string | null = null;
let opener: HTMLElement | null = null;

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const sessionLabel = (id: string) => SESSIONS.find((s) => s.id === id)?.label ?? id;
const normCode = (raw: string) => raw.toUpperCase().replace(/\s+/g, "");

function readData() {
  const el = document.getElementById("planner-data");
  data = el?.textContent ? (JSON.parse(el.textContent) as Data) : null;
}

// ---- announcements: one polite live region, and a visible toast ----

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function announce(message: string, opts: { tone?: "ok" | "warn" | "error"; action?: { label: string; run: () => void } } = {}) {
  const live = $("#announcer");
  if (live) {
    live.textContent = "";
    requestAnimationFrame(() => (live.textContent = message));
  }
  const toast = $("#toast");
  if (!toast) return;
  toast.className = `toast toast--${opts.tone ?? "ok"}`;
  toast.innerHTML = `<span>${esc(message)}</span>${opts.action ? `<button type="button" class="linkish" data-toast-action>${esc(opts.action.label)}</button>` : ""}`;
  toast.hidden = false;
  const action = $("[data-toast-action]", toast);
  if (action && opts.action) {
    const run = opts.action.run;
    action.addEventListener("click", () => {
      toast.hidden = true;
      run();
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), opts.action ? 9000 : 5000);
}

// ---- the full verified catalogue, fetched once, only for search ----

let fullCatalogue: Promise<Map<string, CourseFacts & { title: string }>> | null = null;
function catalogue() {
  fullCatalogue ??= fetch("/api/catalogue")
    .then((r) => r.json() as Promise<[string, string, number, number, number, Session[]][]>)
    .then(
      (rows) =>
        new Map(
          rows.map(([code, title, unitsMin, unitsMax, semesters, offered]) => [code, { code, title, unitsMin, unitsMax, semesters, offered }]),
        ),
    )
    .catch(() => {
      fullCatalogue = null;
      return new Map();
    });
  return fullCatalogue;
}

async function facts(code: string): Promise<(CourseFacts & { title: string }) | undefined> {
  const k = data?.courses[code];
  if (k) return { code, title: k.title, unitsMin: k.min, unitsMax: k.max, semesters: k.semesters, offered: k.offered };
  return (await catalogue()).get(code);
}

// ---- open state: a per-viewer convenience, so it lives in localStorage ----

const storeKey = () => `planner.open.${data?.program ?? "none"}`;

function saveOpen() {
  if (narrow.matches) return;
  const ids = $$<HTMLDetailsElement>("[data-tree] details[open]").map((d) => d.dataset.node);
  try {
    localStorage.setItem(storeKey(), JSON.stringify(ids));
  } catch {}
}

function restoreOpen() {
  if (narrow.matches) return;
  let ids: string[] = [];
  try {
    ids = JSON.parse(localStorage.getItem(storeKey()) ?? "[]");
  } catch {}
  for (const id of ids) {
    const d = $<HTMLDetailsElement>(`[data-tree] details[data-node="${CSS.escape(id)}"]`);
    if (d) d.open = true;
  }
}

// ---- desktop: animated expand / collapse ----

const bodyOf = (d: HTMLDetailsElement) => $<HTMLElement>(":scope > .group__body", d);

function setOpen(details: HTMLDetailsElement, open: boolean, animate = true) {
  const body = bodyOf(details);
  if (!body || details.open === open) return;
  if (!animate || reduced.matches) {
    details.open = open;
    saveOpen();
    return;
  }
  body.style.overflow = "hidden";
  if (open) {
    details.open = true;
    const height = body.scrollHeight;
    body
      .animate([{ height: "0px", opacity: 0 }, { height: `${height}px`, opacity: 1 }], {
        duration: 280,
        easing: "cubic-bezier(.2,.7,.2,1)",
      })
      .finished.finally(() => (body.style.overflow = ""));
    $$(":scope > .children > li", body).forEach((li, i) =>
      li.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], {
        duration: 240,
        delay: 60 + Math.min(i, 12) * 24,
        easing: "ease-out",
        fill: "backwards",
      }),
    );
  } else {
    const height = body.offsetHeight;
    body
      .animate([{ height: `${height}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 200, easing: "ease-in" })
      .finished.then(() => {
        details.open = false;
        body.style.overflow = "";
        saveOpen();
      });
  }
  saveOpen();
}

// ---- mobile: one level at a time, with a breadcrumb trail ----

function drill(details: HTMLDetailsElement | null, animate = true) {
  const tree = $<HTMLElement>("[data-tree]");
  const crumbs = $<HTMLElement>("[data-crumbs]");
  if (!tree || !crumbs) return;
  for (const li of $$(".is-focus, .is-trail", tree)) li.classList.remove("is-focus", "is-trail");
  focusId = details?.dataset.node ?? null;

  if (!details) {
    delete tree.dataset.focus;
    for (const d of $$<HTMLDetailsElement>("details[open]", tree)) d.open = false;
    crumbs.hidden = true;
    crumbs.innerHTML = "";
    if (animate) tree.scrollIntoView({ block: "start", behavior: reduced.matches ? "auto" : "smooth" });
    return;
  }

  const li = details.closest<HTMLElement>("li.node");
  if (!li) return;
  const trail: HTMLElement[] = [];
  for (let p = li.parentElement?.closest<HTMLElement>("li.node"); p; p = p.parentElement?.closest<HTMLElement>("li.node")) {
    trail.unshift(p);
  }
  li.classList.add("is-focus");
  trail.forEach((t) => t.classList.add("is-trail"));
  const keep = new Set([details, ...trail.map((t) => $<HTMLDetailsElement>(":scope > details", t))]);
  for (const d of $$<HTMLDetailsElement>("details[open]", tree)) if (!keep.has(d)) d.open = false;
  keep.forEach((d) => d && (d.open = true));
  tree.dataset.focus = focusId ?? "";

  const title = (el: HTMLElement) => $(":scope > details > summary .group__title", el)?.firstChild?.textContent?.trim() ?? "";
  crumbs.innerHTML = `<ol>
    <li><button type="button" data-crumb="">All requirements</button></li>
    ${trail.map((t) => `<li><button type="button" data-crumb="${esc($<HTMLDetailsElement>(":scope > details", t)?.dataset.node)}">${esc(title(t))}</button></li>`).join("")}
    <li><span aria-current="location">${esc(title(li))}</span></li>
  </ol>`;
  crumbs.hidden = false;

  if (animate && !reduced.matches) {
    const body = bodyOf(details);
    body?.animate([{ opacity: 0, transform: "translateX(28px)" }, { opacity: 1, transform: "none" }], {
      duration: 260,
      easing: "cubic-bezier(.2,.7,.2,1)",
    });
  }
  crumbs.scrollIntoView({ block: "nearest", behavior: reduced.matches ? "auto" : "smooth" });
}

function applyMode() {
  const tree = $("[data-tree]");
  if (!tree) return;
  if (narrow.matches) {
    const target = focusId ? $<HTMLDetailsElement>(`details[data-node="${CSS.escape(focusId)}"]`, tree) : null;
    drill(target, false);
  } else {
    for (const li of $$(".is-focus, .is-trail", tree)) li.classList.remove("is-focus", "is-trail");
    delete (tree as HTMLElement).dataset.focus;
    const crumbs = $<HTMLElement>("[data-crumbs]");
    if (crumbs) crumbs.hidden = true;
  }
}

// ---- the course panel ----

const dialog = () => $<HTMLDialogElement>("#course-panel");
const panel = () => $<HTMLElement>("[data-panel]");

function defaultTerm(status: Status): { year: number; session: Session } {
  const now = data?.now ?? { year: new Date().getFullYear(), session: "S2" as Session };
  if (status === "current") return now;
  if (status === "completed") return now.session === "S2" ? { year: now.year, session: "S1" } : { year: now.year - 1, session: "S2" };
  return now.session === "S2" ? { year: now.year + 1, session: "S1" } : { year: now.year, session: "S2" };
}

function statusForTerm(year: number, session: Session): Status {
  const now = data?.now;
  if (!now) return "planned";
  const d = termOrder(year, session) - termOrder(now.year, now.session);
  return d < 0 ? "completed" : d === 0 ? "current" : "planned";
}

const whenOf = (e: { year: number; session: Session; course: string }) => {
  const semesters = data?.courses[e.course]?.semesters ?? 1;
  return termsOccupied(e.year, e.session, semesters)
    .map((t) => termLabel(t.year, t.session))
    .join(" – ");
};

// An entry already in the plan that this course can't sit beside.
function clashFor(code: string): Entry | undefined {
  const k = data?.courses[code];
  return data?.entries.find((e) => e.course !== code && (k?.incompatible.includes(e.course) || data?.courses[e.course]?.incompatible.includes(code)));
}

function termFields(opts: { status: Status; year: number; session: Session; units: number; known?: CourseFacts }) {
  const years = Array.from({ length: 17 }, (_, i) => 2018 + i);
  const known = opts.known;
  const variable = known ? known.unitsMin !== known.unitsMax : false;
  const twoSemester = (known?.semesters ?? 1) > 1;
  const sessions = SESSIONS.filter((s) => !twoSemester || s.id === "S1" || s.id === "S2");
  return `
    <fieldset class="seg">
      <legend>Status</legend>
      ${(["completed", "current", "planned"] as Status[])
        .map(
          (s) =>
            `<label class="seg__opt seg__opt--${s}"><input type="radio" name="status" value="${s}" ${opts.status === s ? "checked" : ""} required>${MARK[s]}<span>${STATUS_LABEL[s]}</span></label>`,
        )
        .join("")}
    </fieldset>
    <div class="field-row">
      <label class="field"><span>Year</span><select name="year">${years
        .map((y) => `<option ${y === opts.year ? "selected" : ""}>${y}</option>`)
        .join("")}</select></label>
      <label class="field"><span>${twoSemester ? "Starting session" : "Session"}</span><select name="session" data-session-select>${sessions
        .map((s) => `<option value="${s.id}" ${s.id === opts.session ? "selected" : ""}>${s.label}</option>`)
        .join("")}</select></label>
      <label class="field field--units" ${variable ? "" : "hidden"} data-units-field><span>Units${twoSemester ? " per semester" : ""}</span>
        <input type="number" name="units" value="${opts.units}" min="${known?.unitsMin ?? 0}" max="${known?.unitsMax ?? 24}" step="1" ${variable ? "" : "disabled"}></label>
    </div>
    <ul class="issues" data-issues aria-live="polite"></ul>`;
}

function renderPanel(code: string | null, opts: { year?: number; session?: Session } = {}) {
  const root = panel();
  if (!root || !data) return;
  const known = code ? data.courses[code] : undefined;
  const entry = code ? data.entries.find((e) => e.course === code) : undefined;
  const leaf = code ? $<HTMLElement>(`[data-course="${CSS.escape(code)}"]`) : null;
  const clash = code && !entry ? clashFor(code) : undefined;

  const facts: string[] = [];
  if (known) {
    facts.push(`<div><dt>Unit value</dt><dd>${known.min === known.max ? `${known.min} units` : `${known.min} to ${known.max} units`}${known.semesters > 1 ? " per semester" : ""}</dd></div>`);
    facts.push(`<div><dt>Offered in 2027</dt><dd>${known.offered.length ? esc(known.offered.map((s) => SESSIONS.find((x) => x.id === s)?.official).join(", ")) : "No 2027 offering listed"}</dd></div>`);
    if (known.semesters > 1) facts.push(`<div><dt>Length</dt><dd>Two consecutive semesters. The course page says: “${esc(known.semesterNote)}”</dd></div>`);
    if (known.tps) facts.push("<div><dt>Graduate attributes</dt><dd>Transdisciplinary</dd></div>");
    if (known.incompatibleNote) facts.push(`<div><dt>Incompatibility</dt><dd>“${esc(known.incompatibleNote)}”</dd></div>`);
  }
  if (leaf?.dataset.listed) facts.push(`<div><dt>On the program page</dt><dd>Listed as “${esc(leaf.dataset.listed)}”</dd></div>`);

  let body = "";
  if (entry) {
    body = `
      <section class="panel__current" aria-labelledby="in-plan">
        <h3 class="panel__section" id="in-plan">In your plan</h3>
        <div class="panel__entry">${MARK[entry.status]}
          <span><strong>${STATUS_LABEL[entry.status]}</strong> · ${esc(whenOf(entry))}${known && known.min !== known.max ? ` · ${entry.units} units` : ""}
          <span class="panel__counts">${entry.counts ? `Counts toward ${esc(entry.counts)}` : data.program ? "Doesn't count toward any requirement" : ""}</span></span>
          <form method="post" action="/api/entries/${entry.id}" data-enhance data-astro-reload data-keep-open data-course="${esc(code)}">
            <input type="hidden" name="op" value="delete"><button class="linkish linkish--danger">Remove</button></form>
        </div>
      </section>
      <form class="entry-form" method="post" action="/api/entries/${entry.id}" data-enhance data-astro-reload data-panel-form data-course="${esc(code)}">
        <h3 class="panel__section">Change or move it</h3>
        <input type="hidden" name="op" value="update">
        ${termFields({ status: entry.status, year: entry.year, session: entry.session, units: entry.units, known: code ? toFacts(code) : undefined })}
        <p class="form-error" data-error role="alert"></p>
        <div class="panel__actions"><button class="btn">Save changes</button></div>
      </form>`;
  } else if (clash) {
    body = `
      <div class="conflict" role="note">
        <p><strong>${esc(code)} can't be added alongside ${esc(clash.course)}.</strong> They're incompatible, so only one can count.
        ${esc(clash.course)} is already in your plan (${STATUS_LABEL[clash.status]} · ${esc(whenOf(clash))}).</p>
        ${known?.incompatibleNote || data.courses[clash.course]?.incompatibleNote ? `<p class="conflict__quote">The official course page says: “${esc(known?.incompatibleNote ?? data.courses[clash.course]?.incompatibleNote)}”</p>` : ""}
        <button class="btn btn--quiet" type="button" data-open-course="${esc(clash.course)}">Open ${esc(clash.course)}</button>
      </div>`;
  } else {
    const status: Status = opts.year && opts.session ? statusForTerm(opts.year, opts.session) : "planned";
    let term = opts.year && opts.session ? { year: opts.year, session: opts.session } : defaultTerm(status);
    const semesters = known?.semesters ?? 1;
    if (semesters > 1 && term.session !== "S1" && term.session !== "S2") term = { year: term.year, session: "S2" };
    body = `
      <form class="entry-form" method="post" action="/api/entries" data-enhance data-astro-reload data-panel-form ${code ? `data-course="${esc(code)}"` : ""}>
        <h3 class="panel__section">Add to your plan</h3>
        ${
          code
            ? `<input type="hidden" name="course" value="${esc(code)}">`
            : `<label class="field"><span>Course code or title</span>
                 <input name="course" required list="course-codes" autocomplete="off" spellcheck="false" placeholder="e.g. COMP3320" data-code-input aria-describedby="code-status">
                 <datalist id="course-codes"></datalist></label>
               <div class="field__hint" id="code-status" data-code-status aria-live="polite">Only courses in the 2027 ANU undergraduate catalogue can be added.</div>`
        }
        ${termFields({ status, year: term.year, session: term.session, units: known?.min ?? 6, known: code ? toFacts(code) : undefined })}
        <p class="form-error" data-error role="alert"></p>
        <div class="panel__actions"><button class="btn" ${code ? "" : "disabled"} data-submit>Add to plan</button></div>
      </form>`;
  }

  root.innerHTML = `
    <header class="panel__head">
      <p class="panel__code">${code ? esc(code) : "Add a course"}</p>
      <h2 id="panel-title" class="panel__title" tabindex="-1">${code ? esc(known?.title ?? code) : "Add a course to your plan"}</h2>
      <button class="panel__close" type="button" data-close aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="m4.5 4.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>
    </header>
    ${code ? `<a class="btn btn--official" href="https://programsandcourses.anu.edu.au/2027/course/${esc(code)}" target="_blank" rel="noopener">Open the official course page <span aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>` : ""}
    ${facts.length ? `<dl class="facts">${facts.join("")}</dl>` : ""}
    <div class="panel__alert" data-panel-alert role="alert"></div>
    ${body}`;
  root.dataset.code = code ?? "";
  const form = $<HTMLFormElement>("[data-panel-form]", root);
  if (form) void refreshHints(form);
  if (!code) void fillDatalist();
}

function toFacts(code: string): CourseFacts | undefined {
  const k = data?.courses[code];
  return k ? { code, unitsMin: k.min, unitsMax: k.max, semesters: k.semesters, offered: k.offered } : undefined;
}

async function fillDatalist() {
  const list = $("#course-codes");
  if (!list || list.childElementCount) return;
  const all = await catalogue();
  list.innerHTML = [...all.values()].map((c) => `<option value="${esc(c.code)}">${esc(c.title)}</option>`).join("");
}

// Live hints from the same rules the server applies.
async function refreshHints(form: HTMLFormElement) {
  if (!data) return;
  const fd = new FormData(form);
  const code = normCode(String(fd.get("course") ?? $<HTMLElement>("[data-panel]")?.dataset.code ?? ""));
  const list = $("[data-issues]", form);
  const submit = $<HTMLButtonElement>("[data-submit]", form);
  const status = $("[data-code-status]", form);
  const course = code ? await facts(code) : undefined;

  if (status) {
    let html = "";
    const existing = data.entries.find((e) => e.course === code);
    const clash = course ? clashFor(code) : undefined;
    if (!code) html = "Only courses in the 2027 ANU undergraduate catalogue can be added.";
    else if (!/^[A-Z]{4}\d{4}$/.test(code)) html = "A course code is four letters and four digits.";
    else if (!course) html = `<span class="bad">${esc(code)} isn't in the 2027 ANU undergraduate catalogue, so it can't be added.</span>`;
    else if (existing) {
      const target = { year: Number(fd.get("year")), session: fd.get("session") as Session };
      html = `<span class="bad"><strong>${esc(code)}</strong> is already in your plan (${STATUS_LABEL[existing.status]} · ${esc(whenOf(existing))}). Each course is in your plan once.</span>
        <span class="status-actions"><button type="button" class="btn btn--quiet" data-move-existing="${existing.id}">Move it to ${esc(termLabel(target.year, target.session))}</button>
        <button type="button" class="linkish" data-open-course="${esc(code)}">Open it</button></span>`;
    } else if (clash) {
      html = `<span class="bad">${esc(code)} is incompatible with ${esc(clash.course)}, already in your plan (${STATUS_LABEL[clash.status]} · ${esc(whenOf(clash))}).</span>
        <span class="status-actions"><button type="button" class="linkish" data-open-course="${esc(clash.course)}">Open ${esc(clash.course)}</button></span>`;
    } else html = `<strong>${esc(course.title)}</strong> · ${course.unitsMin === course.unitsMax ? course.unitsMin : `${course.unitsMin}–${course.unitsMax}`} units${course.semesters > 1 ? " per semester, over two semesters" : ""}`;
    // re-render only on change: replacing a button mid-click would swallow the click
    if (status.dataset.html !== html) {
      status.dataset.html = html;
      status.innerHTML = html;
    }
    if (submit) submit.disabled = !course || Boolean(existing) || Boolean(clash);

    // shape the term fields to this course
    const unitsField = $<HTMLElement>("[data-units-field]", form);
    const units = unitsField && $<HTMLInputElement>("input", unitsField);
    if (course && unitsField && units && units.dataset.for !== code) {
      units.dataset.for = code;
      const variable = course.unitsMin !== course.unitsMax;
      unitsField.hidden = !variable;
      units.disabled = !variable;
      units.min = String(course.unitsMin);
      units.max = String(course.unitsMax);
      units.value = String(course.unitsMin);
      const select = $<HTMLSelectElement>("[data-session-select]", form);
      if (select) {
        for (const opt of select.options) opt.disabled = course.semesters > 1 && opt.value !== "S1" && opt.value !== "S2";
        if (select.selectedOptions[0]?.disabled) select.value = "S2";
      }
    }
  }

  if (!list) return;
  if (!course) {
    list.innerHTML = "";
    return;
  }
  const self = data.entries.find((e) => e.course === code);
  const placement = {
    courseCode: code,
    status: String(fd.get("status") ?? "planned") as Status,
    year: Number(fd.get("year")),
    session: String(fd.get("session")) as Session,
    units: Number(fd.get("units") ?? course.unitsMin) || course.unitsMin,
  };
  const others = data.entries
    .filter((e) => e.course !== code && (!self || e.id !== self.id))
    .map((e) => ({ placement: { courseCode: e.course, status: e.status, year: e.year, session: e.session, units: e.units }, semesters: data?.courses[e.course]?.semesters ?? 1 }));
  const issues = checkPlacement(placement, course, data.now, others);
  list.innerHTML = issues
    .map((i) => `<li class="issue issue--${i.level}">${i.level === "block" ? "Can't save: " : ""}${esc(i.message)}</li>`)
    .join("");
  if (submit && issues.some((i) => i.level === "block")) submit.disabled = true;
}

function openPanel(code: string | null, opts: { year?: number; session?: Session } = {}) {
  const d = dialog();
  if (!d) return;
  if (!d.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  renderPanel(code, opts);
  if (!d.open) {
    d.showModal();
    if (!reduced.matches) {
      $(".panel__inner", d)?.animate(
        [{ transform: narrow.matches ? "translateY(40px)" : "translateX(32px)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }
  }
  $<HTMLElement>(code ? "#panel-title" : "[data-code-input]", d)?.focus();
}

function closePanel() {
  const d = dialog();
  if (!d?.open) return;
  if (reduced.matches) return d.close();
  $(".panel__inner", d)
    ?.animate([{ opacity: 1 }, { opacity: 0, transform: narrow.matches ? "translateY(24px)" : "translateX(24px)" }], { duration: 160 })
    .finished.then(() => d.close());
}

// ---- writes and refreshes ----

async function refresh(changed?: string | null) {
  const res = await fetch(location.href, { headers: { accept: "text/html" } }).catch(() => null);
  if (!res?.ok) return;
  if (res.redirected && new URL(res.url).pathname.startsWith("/login")) {
    location.href = res.url;
    return;
  }
  const next = new DOMParser().parseFromString(await res.text(), "text/html");
  const keepOpen = {
    beforeAttributeUpdated: (attr: string, el: Element) => !(attr === "open" && el instanceof HTMLDetailsElement),
  };
  for (const sel of ["main", ".masthead", ".colophon"]) {
    const from = $(sel);
    const to = $(sel, next);
    if (from && to) Idiomorph.morph(from, to, { morphStyle: "outerHTML", callbacks: keepOpen });
  }
  const json = $("#planner-data", next);
  const mine = $("#planner-data");
  if (json && mine) mine.textContent = json.textContent;
  else if (json) document.body.append(json);
  readData();
  applyMode();
  if (changed) {
    for (const el of $$(`[data-course="${CSS.escape(changed)}"], [data-entry-course="${CSS.escape(changed)}"]`)) {
      el.classList.remove("pulse");
      void el.offsetWidth;
      el.classList.add("pulse");
    }
  }
  const code = panel()?.dataset.code;
  if (dialog()?.open && code) renderPanel(code);
}

async function send(url: string, body: FormData): Promise<Result & { status: number }> {
  try {
    const res = await fetch(url, { method: "POST", body, headers: { accept: "application/json", "x-client-id": CLIENT_ID } });
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const result: Result = isJson
      ? await res.json()
      : { ok: false, code: "unexpected", error: `The server sent an unexpected response (HTTP ${res.status}). Nothing was changed.` };
    return { ...result, status: res.status };
  } catch {
    return { ok: false, code: "network", error: "Couldn't reach the server. Check your connection; nothing was changed.", status: 0 };
  }
}

function showError(form: HTMLFormElement, result: Result) {
  const target = form.closest("dialog") ? ($("[data-error]", form) ?? $("[data-panel-alert]")) : null;
  let html = esc(result.error ?? "Something went wrong.");
  if (result.code === "unauthenticated") html += ` <a href="/login/?next=${encodeURIComponent(location.pathname)}">Log in again</a>`;
  if ((result.code === "duplicate" || result.code === "incompatible") && result.existing) {
    const fd = new FormData(form);
    const move =
      result.code === "duplicate" && fd.get("year")
        ? `<button type="button" class="btn btn--quiet" data-move-existing="${result.existing.id}">Move it to ${esc(termLabel(Number(fd.get("year")), fd.get("session") as Session))}</button>`
        : "";
    html += `<span class="status-actions">${move}<button type="button" class="linkish" data-open-course="${esc(result.existing.course)}">Open ${esc(result.existing.course)}</button></span>`;
  }
  if (target) target.innerHTML = html;
  announce(result.error ?? "Something went wrong.", { tone: "error" });
}

async function submit(form: HTMLFormElement, submitter: HTMLElement | null) {
  if (form.dataset.busy) return;
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) return;
  const body = new FormData(form, submitter as HTMLButtonElement | null);
  const url = form.getAttribute("action") ?? location.pathname;
  const buttons = $$<HTMLButtonElement>("button", form);
  form.dataset.busy = "true";
  form.setAttribute("aria-busy", "true");
  buttons.forEach((b) => (b.disabled = true));
  for (const el of $$("[data-error]", form)) el.textContent = "";
  const alert = $("[data-panel-alert]");
  if (alert) alert.textContent = "";
  try {
    const result = await send(url, body);
    if (!result.ok) return showError(form, result);
    const changed = normCode(String(body.get("course") ?? form.dataset.course ?? "")) || null;
    if (form.closest("dialog") && !form.hasAttribute("data-keep-open")) closePanel();
    form.closest<HTMLDetailsElement>("details.menu")?.removeAttribute("open");
    await refresh(changed);
    report(result);
  } finally {
    delete form.dataset.busy;
    form.removeAttribute("aria-busy");
    buttons.forEach((b) => b.isConnected && (b.disabled = false));
  }
}

function report(result: Result) {
  const warnings = result.warnings ?? [];
  if (result.removed) {
    const r = result.removed;
    announce(`Removed ${r.course} (${r.where}) from your plan.`, {
      action: {
        label: "Undo",
        run: async () => {
          const fd = new FormData();
          for (const [k, v] of Object.entries({ course: r.course, status: r.status, year: r.year, session: r.session, units: r.units })) fd.set(k, String(v));
          const again = await send("/api/entries", fd);
          if (!again.ok) return announce(again.error ?? "Couldn't restore it.", { tone: "error" });
          await refresh(r.course);
          announce(`Restored ${r.course}.`);
        },
      },
    });
  } else if (result.entry) {
    const base = `Saved ${result.entry.course}: ${result.entry.where}.`;
    announce(warnings.length ? `${base} Note: ${warnings.map((w) => w.message).join(" ")}` : base, { tone: warnings.length ? "warn" : "ok" });
  } else {
    announce("Saved.");
  }
}

// Move the one existing entry to the term chosen in the add form.
async function moveExisting(id: number, form: HTMLFormElement | null) {
  const entry = data?.entries.find((e) => e.id === id);
  if (!entry) return;
  const fd = new FormData();
  const source = form ? new FormData(form) : null;
  const year = Number(source?.get("year") ?? entry.year);
  const session = (source?.get("session") ?? entry.session) as Session;
  fd.set("op", "update");
  fd.set("status", String(source?.get("status") ?? entry.status));
  fd.set("year", String(year));
  fd.set("session", session);
  fd.set("units", String(entry.units));
  const result = await send(`/api/entries/${id}`, fd);
  if (!result.ok) {
    const alert = $("[data-panel-alert]");
    if (alert) alert.textContent = result.error ?? "Couldn't move it.";
    return announce(result.error ?? "Couldn't move it.", { tone: "error" });
  }
  closePanel();
  await refresh(entry.course);
  report(result);
}

// ---- wiring: delegated once, survives in-place refreshes and navigation ----

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;

  const summary = target.closest<HTMLElement>("[data-tree] summary");
  if (summary) {
    const details = summary.parentElement as HTMLDetailsElement;
    event.preventDefault();
    if (narrow.matches) {
      const isFocus = details.dataset.node === focusId;
      const parent = details.parentElement?.parentElement?.closest("li.node");
      drill(isFocus ? (parent ? $<HTMLDetailsElement>(":scope > details", parent) : null) : details);
    } else setOpen(details, !details.open);
    return;
  }

  const crumb = target.closest<HTMLElement>("[data-crumb]");
  if (crumb) {
    const id = crumb.dataset.crumb;
    drill(id ? $<HTMLDetailsElement>(`[data-tree] details[data-node="${CSS.escape(id)}"]`) : null);
    return;
  }

  const move = target.closest<HTMLElement>("[data-move-existing]");
  if (move) {
    void moveExisting(Number(move.dataset.moveExisting), move.closest("form") ?? $<HTMLFormElement>("[data-panel-form]"));
    return;
  }

  const courseOpener = target.closest<HTMLElement>("[data-open-course]");
  if (courseOpener) {
    openPanel(courseOpener.dataset.openCourse ?? null);
    return;
  }

  const adder = target.closest<HTMLElement>("[data-add-course]");
  if (adder) {
    openPanel(null, { year: Number(adder.dataset.year) || undefined, session: (adder.dataset.session as Session) || undefined });
    return;
  }

  if (target.closest("[data-close]")) return closePanel();
  if (target === dialog()) return closePanel();

  if (target.closest("[data-collapse-all]")) {
    for (const d of $$<HTMLDetailsElement>("[data-tree] details[open]")) setOpen(d, false, false);
    return;
  }
  if (target.closest("[data-reveal-mine]")) {
    for (const leaf of $$('[data-tree] [data-course]:not([data-status="none"])')) {
      for (let d = leaf.closest("details"); d; d = d.parentElement?.closest("details") ?? null) setOpen(d, true, false);
    }
    announce("Opened every requirement that holds one of your courses.");
  }
});

document.addEventListener("submit", (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>("form[data-enhance]");
  if (!form) return;
  event.preventDefault();
  void submit(form, (event as SubmitEvent).submitter);
});

// live hints inside the panel form
document.addEventListener("change", (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-panel-form]");
  if (!form) return;
  const field = event.target as HTMLInputElement;
  if (field.name === "status" && !form.querySelector('input[name="op"]')) {
    const term = defaultTerm(field.value as Status);
    const year = form.elements.namedItem("year") as HTMLSelectElement;
    const session = form.elements.namedItem("session") as HTMLSelectElement;
    year.value = String(term.year);
    if (![...session.options].find((o) => o.value === term.session && !o.disabled)) session.value = "S2";
    else session.value = term.session;
  }
  void refreshHints(form);
});

document.addEventListener("input", (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>("[data-panel-form]");
  if (form) void refreshHints(form);
});

narrow.addEventListener("change", applyMode);

document.addEventListener("astro:page-load", () => {
  readData();
  focusId = null;
  restoreOpen();
  applyMode();
  const d = dialog();
  if (d && !d.dataset.wired) {
    d.dataset.wired = "true";
    // Escape, the close button and a backdrop click all end here: focus goes
    // back to whatever opened the panel.
    d.addEventListener("close", () => {
      if (opener?.isConnected) opener.focus();
      else $("main h1")?.focus();
      opener = null;
    });
  }
  connectEvents();
});

document.addEventListener("astro:before-swap", () => {
  if (dialog()?.open) dialog()?.close();
});

// This account's other tabs changed the plan: refresh from the server.
let events: EventSource | null = null;
function connectEvents() {
  if (events || !document.getElementById("planner-data")) return;
  events = new EventSource("/api/events");
  events.addEventListener("plan", (event) => {
    const { client } = JSON.parse((event as MessageEvent).data) as { client: string };
    if (client !== CLIENT_ID) void refresh();
  });
  events.addEventListener("error", () => {
    // signed out, or the server restarted: stop, and reconnect on next page load
    if (events?.readyState === EventSource.CLOSED) events = null;
  });
}
