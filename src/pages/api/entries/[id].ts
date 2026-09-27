import type { APIRoute } from "astro";
import { deleteEntry, getCatalogue, getEntry, updateEntry } from "../../../lib/db";
import { ApiError, describeEntry, handle, parseTerm, parseUnits, validatePlacement } from "../../../lib/forms";

// One entry, changed in place. HTML forms only speak POST, so `op` says
// whether this is an update or a delete. The entry is looked up by id AND
// the signed-in account, so someone else's id is simply not found.
export const POST: APIRoute = (ctx) =>
  handle(ctx, (form, user) => {
    const entry = getEntry(user, Number(ctx.params.id));
    if (!entry) {
      throw new ApiError(404, "not_found", "That enrolment isn't in your plan any more. It may have been changed in another tab.");
    }
    const op = String(form.get("op") ?? "");
    if (op === "delete") {
      deleteEntry(user, entry.id);
      return { removed: describeEntry(entry) };
    }
    if (op !== "update") throw new ApiError(400, "bad_request", "Unknown operation.");
    const course = getCatalogue().get(entry.courseCode);
    if (!course) throw new ApiError(404, "unknown_course", `${entry.courseCode} is no longer in the catalogue.`);
    const input = { ...parseTerm(form), units: parseUnits(form, course) };
    const warnings = validatePlacement(user, { courseCode: entry.courseCode, ...input }, course, { ignoreId: entry.id });
    const updated = updateEntry(user, entry.id, input);
    if (!updated) throw new ApiError(404, "not_found", "That enrolment isn't in your plan any more.");
    return { entry: describeEntry(updated), warnings };
  });
