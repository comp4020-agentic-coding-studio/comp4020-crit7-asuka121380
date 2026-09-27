import type { APIRoute } from "astro";
import { clientData, loadView } from "../../lib/view";

// The persisted plan as JSON: what the client script and the spec read back.
export const GET: APIRoute = () => {
  const view = loadView();
  const { catalogue: _, ...state } = clientData(view);
  return Response.json({ ...state, choices: view.choices });
};
