import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// תמצית, lecture summaries for a study group. One page (index.html) served
// at the root of its own domain; the server side is api/study/*, Vercel
// functions.

declare const process: { env: Record<string, string | undefined> };

/** The commit the page was built from, for the deploy smoke test: the
 *  script's hash can't say, because Vercel bakes the Supabase keys in. */
function buildStamp(): Plugin {
  return {
    name: "build-stamp",
    transformIndexHtml(html) {
      const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "dev";
      return html.replace("%BUILD%", sha);
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), buildStamp()],
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      input: { main: "index.html" },
      output: {
        // React and the Supabase client in chunks of their own, as they were
        // when other apps shared this build: the app's entry chunk stays its
        // own code (tools/study-bundle.mjs holds it under 400 kB), and a new
        // deploy does not make phones download the libraries again.
        manualChunks(id) {
          if (!/\/node_modules\//.test(id)) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (/\/node_modules\/@supabase\//.test(id)) return "supabase";
          return undefined;
        },
      },
    },
  },
});
