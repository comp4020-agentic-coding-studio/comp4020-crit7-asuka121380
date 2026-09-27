import type { APIRoute } from "astro";
import { resetPlan } from "../../lib/db";
import { handle } from "../../lib/forms";

export const POST: APIRoute = (ctx) => handle(ctx, (_form, user) => resetPlan(user));
