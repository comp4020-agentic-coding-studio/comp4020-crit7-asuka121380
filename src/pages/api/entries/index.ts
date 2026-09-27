import type { APIRoute } from "astro";
import { addEntry } from "../../../lib/db";
import { handle, parseEntry } from "../../../lib/forms";

export const POST: APIRoute = ({ request }) => handle(request, (form) => addEntry(parseEntry(form)));
