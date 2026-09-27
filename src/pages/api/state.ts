import type { APIRoute } from "astro";
import { loadView } from "../../lib/view";

// The signed-in student's plan as JSON: what the client script and the spec
// read back.
export const GET: APIRoute = ({ locals }) => {
  if (!locals.user) return Response.json({ ok: false, code: "unauthenticated" }, { status: 401 });
  const view = loadView(locals.user.id);
  return Response.json({
    user: locals.user.username,
    program: view.program?.code ?? null,
    entries: view.entries.map((e) => ({ id: e.id, course: e.courseCode, status: e.status, year: e.year, session: e.session, units: e.units })),
    choices: view.choices,
    selections: view.selections,
    summary: view.evaluation?.summary ?? null,
  });
};
