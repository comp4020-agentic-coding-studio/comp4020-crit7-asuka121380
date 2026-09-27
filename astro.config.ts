import node from "@astrojs/node";
import { defineConfig, fontProviders, passthroughImageService } from "astro/config";

// Server-rendered output: pages render per request so they can read the
// database, and `astro build` emits the Node server the Dockerfile runs.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  security: {
    // Fly's proxy terminates TLS, so naming the deploy domain is what lets
    // Astro trust x-forwarded-proto and accept same-origin form POSTs.
    allowedDomains: [{ hostname: "**.fly.dev", protocol: "https" }],
  },
  // README screenshots are already sized and compressed; passing them through
  // avoids the native sharp dependency the default image service needs.
  image: { service: passthroughImageService() },
  fonts: [
    { name: "Public Sans", cssVariable: "--font-sans", provider: fontProviders.google(), weights: ["300 800"] },
    { name: "Source Serif 4", cssVariable: "--font-serif", provider: fontProviders.google(), weights: ["400 700"] },
    {
      name: "IBM Plex Mono",
      cssVariable: "--font-mono",
      provider: fontProviders.google(),
      weights: ["400", "500", "600"],
      styles: ["normal"],
    },
  ],
});
