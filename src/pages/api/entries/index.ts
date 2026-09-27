import type { APIRoute } from "astro";
import { addEntry, db, deleteEntry, getEntry } from "../../../lib/db";
import { ApiError, describeEntry, handle, parseCourse, parseTerm, parseUnits, validatePlacement } from "../../../lib/forms";

// Adds a course. With `replace`, it swaps one of the student's own entries
// for this course in a single transaction: how "use COMP1130 instead of
// COMP1100" for a choose-one requirement is done.
export const POST: APIRoute = (ctx) =>
  handle(ctx, (form, user) => {
    const course = parseCourse(form);
    const input = { courseCode: course.code, ...parseTerm(form), units: parseUnits(form, course) };
    const replaceId = form.get("replace") ? Number(form.get("replace")) : undefined;
    const replaced = replaceId !== undefined ? getEntry(user, replaceId) : undefined;
    if (replaceId !== undefined && !replaced) {
      throw new ApiError(404, "not_found", "The course you're replacing isn't in your plan any more.");
    }
    const warnings = validatePlacement(user, input, course, { replacing: replaced?.id });
    const entry = db.transaction(() => {
      if (replaced) deleteEntry(user, replaced.id);
      return addEntry(user, input);
    });
    return { entry: describeEntry(entry), warnings, ...(replaced ? { replaced: describeEntry(replaced) } : {}) };
  });
