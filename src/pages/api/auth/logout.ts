import type { APIRoute } from "astro";
import { endSession } from "../../../lib/auth";

export const POST: APIRoute = ({ cookies, redirect }) => {
  endSession(cookies);
  return redirect("/", 303);
};
