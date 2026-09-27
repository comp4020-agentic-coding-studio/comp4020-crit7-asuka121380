import type { APIRoute } from "astro";
import { setProgram } from "../../lib/db";
import { handle, parseProgram } from "../../lib/forms";

export const POST: APIRoute = ({ request }) => handle(request, (form) => setProgram(parseProgram(form)));
