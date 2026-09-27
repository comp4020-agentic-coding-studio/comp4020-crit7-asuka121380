import type { APIRoute } from "astro";
import { findEntry, getCatalogue, getProgram, getProgramCode, setSelection } from "../../lib/db";
import { ApiError, handle } from "../../lib/forms";
import { isChooseOne } from "../../lib/progress";
import { type PickNode, walk } from "../../lib/requirements";

// Which of the student's courses satisfies a "choose one" requirement. The
// server checks the requirement is in their program, the course is one of
// its options, and the course is actually in their plan.
export const POST: APIRoute = (ctx) =>
  handle(ctx, (form, user) => {
    const program = getProgram(getProgramCode(user) ?? "");
    if (!program) throw new ApiError(400, "no_program", "Choose a program first.");
    const nodeId = String(form.get("node") ?? "");
    const code = String(form.get("course") ?? "").toUpperCase();
    let node: PickNode | undefined;
    walk(program.requirements, (n) => {
      if (n.id === nodeId && isChooseOne(n, getCatalogue())) node = n as PickNode;
    });
    if (!node) throw new ApiError(404, "unknown_requirement", "That isn't a choose-one requirement in your program.");
    if (code) {
      if (!node.children.some((c) => c.kind === "course" && c.code === code)) {
        throw new ApiError(400, "not_an_option", `${code} isn't one of the options for this requirement.`);
      }
      if (!findEntry(user, code)) throw new ApiError(404, "not_in_plan", `${code} isn't in your plan yet.`);
    }
    setSelection(user, program.code, nodeId, code || null);
  });
