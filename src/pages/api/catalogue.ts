import type { APIRoute } from "astro";
import { getCatalogue } from "../../lib/db";

// The verified catalogue for the add-course search, fetched only when the
// panel needs it. Public ANU data, so no session is required.
export const GET: APIRoute = () =>
  Response.json(
    [...getCatalogue().values()].map((c) => [c.code, c.title, c.unitsMin, c.unitsMax, c.semesters, c.offered]),
    { headers: { "cache-control": "public, max-age=3600" } },
  );
