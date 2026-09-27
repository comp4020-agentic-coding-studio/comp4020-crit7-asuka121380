import { defineMiddleware } from "astro:middleware";
import { sessionUser } from "./lib/auth";

// Every request learns who is signed in from the session cookie, and only
// from it: no route trusts a user id sent by the browser.
const PUBLIC = [/^\/$/, /^\/login\/?$/, /^\/signup\/?$/, /^\/readme\/?$/, /^\/api\/catalogue\/?$/, /^\/_/, /\.[a-z0-9]+$/i];

export const onRequest = defineMiddleware(async (ctx, next) => {
  ctx.locals.user = sessionUser(ctx.cookies);
  const path = ctx.url.pathname;
  if (!ctx.locals.user && !PUBLIC.some((p) => p.test(path))) {
    if (path.startsWith("/api/")) {
      // the route itself answers 401 in its own format
      return next();
    }
    return ctx.redirect(`/login/?next=${encodeURIComponent(path + ctx.url.search)}`, 303);
  }
  const res = await next();
  // pages show personal data: never let a shared cache keep them
  if (ctx.locals.user && !path.startsWith("/_")) res.headers.set("cache-control", "private, no-store");
  return res;
});
