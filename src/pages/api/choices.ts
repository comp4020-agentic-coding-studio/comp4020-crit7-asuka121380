import type { APIRoute } from "astro";
import { getProgram, getProgramCode, setChoice } from "../../lib/db";
import { ApiError, handle } from "../../lib/forms";
import { type OneNode, walk } from "../../lib/requirements";

// Choosing (or clearing) a pathway in a "one of the following" requirement.
export const POST: APIRoute = (ctx) =>
  handle(ctx, (form, user) => {
    const program = getProgram(getProgramCode(user) ?? "");
    if (!program) throw new ApiError(400, "no_program", "Choose a program first.");
    const nodeId = String(form.get("node") ?? "");
    const optionId = String(form.get("option") ?? "");
    let node: OneNode | undefined;
    walk(program.requirements, (n) => {
      if (n.kind === "one" && n.id === nodeId) node = n;
    });
    if (!node) throw new ApiError(404, "unknown_requirement", "That requirement isn't part of your program.");
    if (optionId && !node.options.some((o) => o.id === optionId)) {
      throw new ApiError(400, "unknown_pathway", "That pathway isn't an option for this requirement.");
    }
    setChoice(user, program.code, nodeId, optionId || null);
  });
