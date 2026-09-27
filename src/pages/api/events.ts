import type { APIRoute } from "astro";
import { bus } from "../../lib/events";

// Server-sent events, one account at a time: a write to your plan is
// announced only to your own open tabs, so another tab (the tree in one, the
// semester plan in the other) refreshes itself. Nobody else's plan moves.
export const GET: APIRoute = ({ locals }) => {
  const user = locals.user;
  if (!user) return new Response("Log in to receive plan updates.", { status: 401 });
  let onPlan: (event: { user: number; client: string }) => void;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<string>({
    start(controller) {
      // an opening comment so the client sees bytes immediately, and a
      // periodic one so proxies don't drop the connection as idle
      controller.enqueue(": connected\n\n");
      heartbeat = setInterval(() => controller.enqueue(": ping\n\n"), 30_000);
      onPlan = (event) => {
        if (event.user !== user.id) return;
        controller.enqueue(`event: plan\ndata: ${JSON.stringify({ type: "plan", client: event.client })}\n\n`);
      };
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
