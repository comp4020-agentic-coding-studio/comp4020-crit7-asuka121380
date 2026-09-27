import type { APIRoute } from "astro";
import { deleteEntry, listEntries, updateEntry } from "../../../lib/db";
import { BadInput, handle, parseTerm, parseUnits } from "../../../lib/forms";

// One entry, changed in place. HTML forms only speak POST, so the action
// field says whether this is an update or a delete.
export const POST: APIRoute = ({ request, params }) =>
  handle(request, (form) => {
    const entry = listEntries().find((e) => e.id === Number(params.id));
    if (!entry) throw new BadInput("no such entry");
    if (form.get("action") === "delete") return deleteEntry(entry.id);
    return updateEntry(entry.id, { ...parseTerm(form), units: parseUnits(form, entry.courseCode) });
  });
