import type { APIRoute } from "astro";
import { getProgram, getProgramCode, setChoice } from "../../lib/db";
import { BadInput, handle } from "../../lib/forms";
import { type OneNode, walk } from "../../lib/requirements";

// Choosing (or clearing) a pathway in a "one of the following" requirement.
export const POST: APIRoute = ({ request }) =>
  handle(request, (form) => {
    const program = getProgram(getProgramCode() ?? "");
    if (!program) throw new BadInput("choose a program first");
    const nodeId = String(form.get("node") ?? "");
    const optionId = String(form.get("option") ?? "");
    let node: OneNode | undefined;
    walk(program.requirements, (n) => {
      if (n.kind === "one" && n.id === nodeId) node = n;
    });
    if (!node) throw new BadInput("unknown requirement");
    if (optionId && !node.options.some((o) => o.id === optionId)) throw new BadInput("unknown pathway");
    setChoice(program.code, nodeId, optionId || null);
  });
