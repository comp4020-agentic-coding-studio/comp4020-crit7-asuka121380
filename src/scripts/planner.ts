import { Idiomorph } from "idiomorph";

// Progressive enhancement over server-rendered pages. Everything here is
// optional: the tree is plain <details>, and every change is a plain form
// POST. This adds motion, the course panel, in-place refreshes, and a live
// link between open tabs.

type Status = "completed" | "current" | "planned";
type Entry = { id: number; course: string; status: Status; year: number; session: string; units: number };
type Known = { title: string; min: number; max: number; offered: string[]; tps: boolean; url: string };
type Data = {
  program: string | null;
  now: { year: number; session: string };
  entries: Entry[];
  catalogue: Record<string, Known>;
};

const SESSIONS = [
  ["SUM", "Summer Session", "Summer Session"],
  ["S1", "Semester 1", "First Semester"],
  ["AUT", "Autumn Session", "Autumn Session"],
  ["WIN", "Winter Session", "Winter Session"],
  ["S2", "Semester 2", "Second Semester"],
  ["SPR", "Spring Session", "Spring Session"],
] as const;
const STATUS_LABEL: Record<Status, string> = { completed: "Completed", current: "Studying now", planned: "Planned" };
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

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const order = (year: number, session: string) => year * 10 + SESSIONS.findIndex((s) => s[0] === session);
const sessionLabel = (id: string) => SESSIONS.find((s) => s[0] === id)?.[1] ?? id;

function readData() {
  const el = document.getElementById("planner-data");
  data = el?.textContent ? (JSON.parse(el.textContent) as Data) : null;
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

function defaultTerm(status: Status) {
  const now = data?.now ?? { year: new Date().getFullYear(), session: "S2" };
  if (status === "current") return now;
  if (status === "completed") return now.session === "S2" ? { year: now.year, session: "S1" } : { year: now.year - 1, session: "S2" };
  return now.session === "S2" ? { year: now.year + 1, session: "S1" } : { year: now.year, session: "S2" };
}

function statusForTerm(year: number, session: string): Status {
  const now = data?.now;
  if (!now) return "planned";
  const d = order(year, session) - order(now.year, now.session);
  return d < 0 ? "completed" : d === 0 ? "current" : "planned";
}

function offerHint(code: string, year: number, session: string): string {
  const known = data?.catalogue[code];
  if (!known) return "This course isn't in the planner's catalogue, so offerings aren't shown. Check the official page.";
  if (year !== 2027) return known.offered.length ? `2027 offerings: ${known.offered.join(", ")}. Other years aren't shown here.` : "";
  const official = SESSIONS.find((s) => s[0] === session)?.[2];
  if (!known.offered.length) return "No 2027 offering is listed on the course page.";
  return known.offered.includes(`${official} 2027`)
    ? `Offered in ${official} 2027.`
    : `Not listed for ${official} 2027. Listed: ${known.offered.join(", ")}.`;
}

function entryForm(opts: { code: string | null; entry?: Entry; status: Status; year: number; session: string }) {
  const { code, entry } = opts;
  const known = code ? data?.catalogue[code] : undefined;
  const variable = !known || known.min !== known.max;
  const years = Array.from({ length: 17 }, (_, i) => 2018 + i);
  const units = entry?.units ?? known?.min ?? 6;
  return `<form class="entry-form" method="post" action="${entry ? `/api/entries/${entry.id}` : "/api/entries"}" data-enhance data-astro-reload data-panel-form>
    <h3 class="panel__section">${entry ? "Change this enrolment" : "Add to your plan"}</h3>
    ${entry ? '<input type="hidden" name="action" value="update">' : ""}
    ${
      code
        ? `<input type="hidden" name="course" value="${esc(code)}">`
        : `<label class="field"><span>Course code</span>
             <input name="course" required pattern="[A-Za-z]{4}\\s?[0-9]{4}" placeholder="e.g. COMP3320" list="course-codes" autocomplete="off" data-code-input>
             <datalist id="course-codes">${Object.entries(data?.catalogue ?? {})
               .map(([c, k]) => `<option value="${esc(c)}">${esc(k.title)}</option>`)
               .join("")}</datalist>
             <span class="field__hint" data-code-title></span></label>`
    }
    <fieldset class="seg">
      <legend>Status</legend>
      ${(["completed", "current", "planned"] as Status[])
        .map(
          (s) => `<label class="seg__opt seg__opt--${s}"><input type="radio" name="status" value="${s}" ${opts.status === s ? "checked" : ""} required>${MARK[s]}<span>${STATUS_LABEL[s]}</span></label>`,
        )
        .join("")}
    </fieldset>
    <div class="field-row">
      <label class="field"><span>Year</span><select name="year">${years
        .map((y) => `<option ${y === opts.year ? "selected" : ""}>${y}</option>`)
        .join("")}</select></label>
      <label class="field"><span>Session</span><select name="session">${SESSIONS.map(
        ([id, label]) => `<option value="${id}" ${id === opts.session ? "selected" : ""}>${label}</option>`,
      ).join("")}</select></label>
      <label class="field field--units" ${variable ? "" : "hidden"} data-units-field><span>Units</span>
        <input type="number" name="units" value="${units}" min="${known?.min ?? 0}" max="${known?.max ?? 24}" step="1" ${variable ? "" : "disabled"}></label>
    </div>
    <p class="field__hint" data-offer-hint aria-live="polite">${code ? esc(offerHint(code, opts.year, opts.session)) : ""}</p>
    <p class="form-error" data-error role="alert"></p>
    <div class="panel__actions">
      <button class="btn">${entry ? "Save changes" : "Add to plan"}</button>
      ${entry ? '<button class="btn btn--quiet" type="button" data-cancel-edit>Cancel</button>' : ""}
    </div>
  </form>`;
}

function renderPanel(code: string | null, opts: { editId?: number; year?: number; session?: string } = {}) {
  const panel = $("[data-panel]");
  if (!panel || !data) return;
  const known = code ? data.catalogue[code] : undefined;
  const leaf = code ? $<HTMLElement>(`[data-course="${CSS.escape(code)}"]`) : null;
  const entries = code ? data.entries.filter((e) => e.course === code) : [];
  const editing = entries.find((e) => e.id === opts.editId);

  let status: Status;
  let term: { year: number; session: string };
  if (editing) {
    status = editing.status;
    term = editing;
  } else if (opts.year && opts.session) {
    term = { year: opts.year, session: opts.session };
    status = statusForTerm(term.year, term.session);
  } else {
    status = "planned";
    term = defaultTerm(status);
    // an annual course with one semester planned: suggest the next one
    const last = entries.at(-1);
    if (last && entries.length < Number(leaf?.dataset.enrolments ?? 1)) {
      status = last.status === "completed" ? "current" : "planned";
      term = last.session === "S1" ? { year: last.year, session: "S2" } : { year: last.year + 1, session: "S1" };
    }
  }

  const facts: string[] = [];
  if (known) {
    facts.push(`<div><dt>Unit value</dt><dd>${known.min === known.max ? `${known.min} units` : `${known.min} to ${known.max} units`}</dd></div>`);
    facts.push(`<div><dt>Offered in 2027</dt><dd>${known.offered.length ? esc(known.offered.join(", ")) : "No 2027 offering listed"}</dd></div>`);
    if (known.tps) facts.push("<div><dt>Graduate attributes</dt><dd>Transdisciplinary</dd></div>");
  }
  if (leaf?.dataset.listed) facts.push(`<div><dt>On the program page</dt><dd>Listed as “${esc(leaf.dataset.listed)}”</dd></div>`);
  const enrolments = Number(leaf?.dataset.enrolments ?? 1);
  if (enrolments > 1)
    facts.push(
      `<div><dt>This requirement</dt><dd>Completed ${enrolments === 2 ? "twice" : `${enrolments} times`}, in consecutive semesters. ${entries.length} of ${enrolments} in your plan.</dd></div>`,
    );

  panel.innerHTML = `
    <header class="panel__head">
      ${code ? `<p class="panel__code">${esc(code)}</p>` : '<p class="panel__code">New course</p>'}
      <h2 id="panel-title" class="panel__title">${code ? esc(known?.title ?? "Not in the planner's catalogue") : "Add a course to your plan"}</h2>
      <button class="panel__close" type="button" data-close aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="m4.5 4.5 9 9m0-9-9 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>
    </header>
    ${
      code
        ? `<a class="btn btn--official" href="https://programsandcourses.anu.edu.au/2027/course/${esc(code)}" target="_blank" rel="noopener">
            Open the official course page <span aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a>`
        : ""
    }
    ${facts.length ? `<dl class="facts">${facts.join("")}</dl>` : ""}
    ${
      code
        ? `<section><h3 class="panel__section">In your plan</h3>${
            entries.length
              ? `<ul class="panel__entries" role="list">${entries
                  .map(
                    (e) => `<li class="panel__entry${e.id === editing?.id ? " is-editing" : ""}">${MARK[e.status]}
                      <span><strong>${STATUS_LABEL[e.status]}</strong> · ${e.year} ${esc(sessionLabel(e.session))}${known && known.min === known.max ? "" : ` · ${e.units} units`}</span>
                      <button class="linkish" type="button" data-edit-entry="${e.id}">Edit</button>
                      <form method="post" action="/api/entries/${e.id}" data-enhance data-astro-reload data-keep-open>
                        <input type="hidden" name="action" value="delete"><button class="linkish linkish--danger">Remove</button></form></li>`,
                  )
                  .join("")}</ul>`
              : '<p class="panel__empty">Not in your plan yet.</p>'
          }</section>`
        : ""
    }
    ${entryForm({ code, entry: editing, status, year: term.year, session: term.session })}`;
  panel.dataset.code = code ?? "";
}

function openPanel(code: string | null, opts: { editId?: number; year?: number; session?: string } = {}) {
  const d = dialog();
  if (!d) return;
  renderPanel(code, opts);
  if (!d.open) {
    d.showModal();
    if (!reduced.matches) {
      const fromSide = !narrow.matches;
      $(".panel__inner", d)?.animate(
        [{ transform: fromSide ? "translateX(32px)" : "translateY(40px)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 260, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }
  }
  $<HTMLElement>(code ? "[data-panel-form] input[name=status]:checked" : "[data-code-input]", d)?.focus();
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
  const res = await fetch(location.href, { headers: { accept: "text/html" } });
  if (!res.ok) return;
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
  const panel = $("[data-panel]");
  if (dialog()?.open && panel?.dataset.code) renderPanel(panel.dataset.code);
}

async function submit(form: HTMLFormElement, submitter: HTMLElement | null) {
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) return;
  const body = new FormData(form, submitter as HTMLButtonElement | null);
  const error = $("[data-error]", form);
  form.setAttribute("aria-busy", "true");
  try {
    const res = await fetch(form.action, {
      method: "POST",
      body,
      headers: { accept: "application/json", "x-client-id": CLIENT_ID },
    });
    const result = await res.json().catch(() => ({ ok: false, error: "Something went wrong. Try again." }));
    if (!result.ok) {
      if (error) error.textContent = result.error;
      return;
    }
    const changed = String(body.get("course") ?? $<HTMLElement>("[data-panel]")?.dataset.code ?? "").toUpperCase().replace(/\s+/g, "") || null;
    if (form.closest("dialog") && !form.hasAttribute("data-keep-open")) closePanel();
    if (form.closest(".switcher")) form.closest<HTMLDetailsElement>(".switcher")?.removeAttribute("open");
    await refresh(changed);
  } finally {
    form.removeAttribute("aria-busy");
  }
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

  const opener = target.closest<HTMLElement>("[data-open-course]");
  if (opener) {
    openPanel(opener.dataset.openCourse ?? null, { editId: Number(opener.dataset.entry) || undefined });
    return;
  }

  const adder = target.closest<HTMLElement>("[data-add-course]");
  if (adder) {
    openPanel(null, { year: Number(adder.dataset.year) || undefined, session: adder.dataset.session });
    return;
  }

  const edit = target.closest<HTMLElement>("[data-edit-entry]");
  if (edit) return renderPanel($("[data-panel]")?.dataset.code ?? null, { editId: Number(edit.dataset.editEntry) });
  if (target.closest("[data-cancel-edit]")) return renderPanel($("[data-panel]")?.dataset.code ?? null);
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
  const year = form.elements.namedItem("year") as HTMLSelectElement;
  const session = form.elements.namedItem("session") as HTMLSelectElement;
  if (field.name === "status" && !form.querySelector('input[name="action"]')) {
    const term = defaultTerm(field.value as Status);
    year.value = String(term.year);
    session.value = term.session;
  }
  const code = String(new FormData(form).get("course") ?? "").toUpperCase().replace(/\s+/g, "");
  const hint = $("[data-offer-hint]", form);
  if (hint && code) hint.textContent = offerHint(code, Number(year.value), session.value);
});

document.addEventListener("input", (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-code-input]");
  if (!input) return;
  const form = input.form;
  const code = input.value.toUpperCase().replace(/\s+/g, "");
  const known = data?.catalogue[code];
  const title = form && $("[data-code-title]", form);
  if (title) title.textContent = known ? known.title : /^[A-Z]{4}\d{4}$/.test(code) ? "Not in the planner's catalogue: set its units below." : "";
  const unitsField = form && $<HTMLElement>("[data-units-field]", form);
  const units = unitsField && $<HTMLInputElement>("input", unitsField);
  if (unitsField && units) {
    const variable = !known || known.min !== known.max;
    unitsField.hidden = !variable;
    units.disabled = !variable;
    units.min = String(known?.min ?? 0);
    units.max = String(known?.max ?? 24);
    units.value = String(known?.min ?? 6);
  }
});

narrow.addEventListener("change", applyMode);

document.addEventListener("astro:page-load", () => {
  readData();
  focusId = null;
  restoreOpen();
  applyMode();
});

document.addEventListener("astro:before-swap", () => {
  if (dialog()?.open) dialog()?.close();
});

// Another tab (or another person on the shared demo) changed the plan.
const events = new EventSource("/api/events");
events.addEventListener("plan", (event) => {
  const { client } = JSON.parse((event as MessageEvent).data) as { client: string };
  if (client !== CLIENT_ID) void refresh();
});
