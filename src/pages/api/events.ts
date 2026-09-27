import type { APIRoute } from "astro";
import { bus } from "../../lib/events";

// Server-sent events: every write to the plan is announced here, so another
// open tab (the tree in one, the semester plan in the other) refreshes
// itself from the database. One-directional plain HTTP is all this needs.
export const GET: APIRoute = () => {
  let onPlan: (event: { client: string }) => void;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<string>({
    start(controller) {
      // an opening comment so the client (and the post-deploy CI probe) sees
      // bytes immediately, and a periodic one so proxies don't drop it idle
      controller.enqueue(": connected\n\n");
      heartbeat = setInterval(() => controller.enqueue(": ping\n\n"), 30_000);
      onPlan = (event) => controller.enqueue(`event: plan\ndata: ${JSON.stringify({ type: "plan", ...event })}\n\n`);
      bus.on("plan", onPlan);
    },
    cancel() {
      clearInterval(heartbeat);
      bus.off("plan", onPlan);
    },
  });

  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
};
