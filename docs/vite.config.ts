import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin to handle external /dist imports during dev
const externalDistPlugin = (): Plugin => {
  const parentDistDir = resolve(__dirname, "..", "dist");

  return {
    name: "external-dist",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith("/dist/")) {
        return { id: resolve(parentDistDir, id.slice("/dist/".length)) };
      }
      return null;
    },
    load(id) {
      if (id.startsWith(parentDistDir)) {
        // Mark the bundle file as a watched dependency so a rebuild invalidates
        // this module instead of serving the cached copy (see configureServer).
        this.addWatchFile(id);
        return fs.readFileSync(id, "utf-8");
      }
      return null;
    },
    configureServer(server) {
      // The Blok editor bundle in ../dist is produced by a SEPARATE build and
      // lives outside the docs project root, so vite's watcher never sees it.
      // Without this, the first `import("/dist/full.mjs")` is cached in the
      // module graph for the life of the dev server: the page keeps running a
      // stale editor even after `vite build` regenerates dist, so editor fixes
      // silently never appear. Watch dist explicitly and, on any change,
      // invalidate every cached /dist module and force a full reload so the
      // page always runs the freshly-built editor.
      server.watcher.add(parentDistDir);
      const reloadOnDistChange = (file: string) => {
        if (!file.startsWith(parentDistDir)) return;
        server.moduleGraph.idToModuleMap.forEach((mod, id) => {
          if (id.startsWith(parentDistDir)) {
            server.moduleGraph.invalidateModule(mod);
          }
        });
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("change", reloadOnDistChange);
      server.watcher.on("add", reloadOnDistChange);
      server.watcher.on("unlink", reloadOnDistChange);

      // Serve the parent directory files (CHANGELOG.md, etc.)
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";

        // Handle CHANGELOG.md from parent directory
        const changelogPath = resolve(__dirname, "..", "CHANGELOG.md");
        if (url.startsWith("/CHANGELOG.md") && fs.existsSync(changelogPath)) {
          res.setHeader("Content-Type", "text/markdown; charset=utf-8");
          res.setHeader("Access-Control-Allow-Origin", "*");
          fs.createReadStream(changelogPath).pipe(res);
          return;
        }

        // Handle /dist/ directory
        if (!url.startsWith("/dist/")) {
          next();
          return;
        }

        const filePath = resolve(parentDistDir, url.slice("/dist/".length));
        if (!fs.existsSync(filePath)) {
          const notFoundRes = res as typeof res & {
            statusCode: number;
            end: (data: string) => void;
          };
          notFoundRes.statusCode = 404;
          notFoundRes.end(`Not found: ${url}`);
          return;
        }

        const ext = filePath.slice(filePath.lastIndexOf("."));
        const getContentType = (extension: string): string => {
          if (extension === ".mjs" || extension === ".js") {
            return "application/javascript; charset=utf-8";
          }
          if (extension === ".css") {
            return "text/css; charset=utf-8";
          }
          return "text/plain; charset=utf-8";
        };

        const contentType = getContentType(ext);

        res.setHeader("Content-Type", contentType);
        res.setHeader("Access-Control-Allow-Origin", "*");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
};

export default defineConfig({
  plugins: [react(), tailwindcss(), externalDistPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: ["/dist/full.mjs"],
    },
  },
  server: {
    port: 5174,
    fs: {
      // Allow serving files from parent directory
      allow: [".."],
    },
  },
  optimizeDeps: {
    // Don't pre-bundle /dist imports
    exclude: ["/dist/full.mjs"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
