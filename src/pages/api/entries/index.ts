import type { APIRoute } from "astro";
import { addEntry } from "../../../lib/db";
import { describeEntry, handle, parseCourse, parseTerm, parseUnits, validatePlacement } from "../../../lib/forms";

export const POST: APIRoute = (ctx) =>
  handle(ctx, (form, user) => {
    const course = parseCourse(form);
    const input = { courseCode: course.code, ...parseTerm(form), units: parseUnits(form, course) };
    const warnings = validatePlacement(user, input, course);
    return { entry: describeEntry(addEntry(user, input)), warnings };
  });
