import type { APIRoute } from "astro";
import { setProgram } from "../../lib/db";
import { handle, parseProgram } from "../../lib/forms";

export const POST: APIRoute = (ctx) => handle(ctx, (form, user) => setProgram(user, parseProgram(form)));
