import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin to handle external /dist imports during dev
const externalDistPlugin = (): Plugin => {
  const parentDistDir = resolve(__dirname, "..", "dist");
  const parentPackagesDir = resolve(__dirname, "..", "packages");
  const reactAdapterEntry = resolve(parentPackagesDir, "react", "dist", "index.mjs");
  const docsAppRoot = resolve(__dirname, "src", "root.tsx");

  return {
    name: "external-dist",
    enforce: "pre",
    async resolveId(id, importer) {
      // The editor bundles are loaded from a `useEffect`, which never runs while
      // prerendering, so the prerender build must not pull 30+ MB of editor into
      // its server bundle just to throw it away. Vite 8 builds the client and the
      // prerender ("ssr") environment separately, and only the client one is
      // configured below — externalise here instead, where the environment is
      // known, so a missing `environments.ssr` entry can't silently re-bundle it.
      const isEditorBundle =
        id.startsWith("/dist/") || id === "@bloklabs/core" || id === "@bloklabs/core/adapters";
      if (this.environment.name !== "client" && isEditorBundle) {
        return { id, external: true };
      }
      // The workspace adapter bundle lives OUTSIDE the docs project, so its bare
      // `react`/`react-dom` imports would resolve from the repo-root
      // node_modules — a second physical React alongside docs/node_modules/react.
      // Two React copies crash hooks at runtime ("Cannot read properties of null
      // (reading 'useContext')"), and resolve.dedupe is not honored here, so
      // re-resolve every react import from outside the docs dir as if the docs
      // app itself imported it (which also keeps dev-server CJS interop:
      // require.resolve would bypass the dep optimizer and lose named exports).
      if (
        importer?.startsWith(parentPackagesDir) &&
        (id === "react" || id === "react-dom" || id.startsWith("react/") || id.startsWith("react-dom/"))
      ) {
        return this.resolve(id, docsAppRoot, { skipSelf: true });
      }
      // The React adapter moved to its own workspace package; the root build no
      // longer emits dist/react.mjs. Keep the /dist/react.mjs import stable for
      // the demo (and its vitest mock) by aliasing it to the workspace bundle.
      if (id === "/dist/react.mjs") {
        return { id: reactAdapterEntry };
      }
      // The workspace bundle externalizes core as bare specifiers; resolve them
      // to the built dist so the docs bundle shares one core with tools.mjs.
      if (id === "@bloklabs/core") {
        return { id: resolve(parentDistDir, "blok.mjs") };
      }
      if (id === "@bloklabs/core/adapters") {
        return { id: resolve(parentDistDir, "adapters.mjs") };
      }
      // Unaliased, this falls through to the root exports map and the bundler
      // picks its `types` condition — pulling types/view.d.ts into the runtime
      // graph, where its one value re-export cannot resolve. See
      // test/unit/architecture/react-fixture-import-map-law.test.ts.
      if (id === "@bloklabs/core/view") {
        return { id: resolve(parentDistDir, "view.mjs") };
      }
      // Same hazard as /view: the adapter imports @bloklabs/core/locales (the
      // #41 getDirection/normalizeLocale re-export). Unaliased it falls through
      // to the root exports map's `types` condition and drags a .d.ts into the
      // runtime graph. Resolve it to the built locales bundle.
      if (id === "@bloklabs/core/locales") {
        return { id: resolve(parentDistDir, "locales.mjs") };
      }
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
  // reactRouter() owns the build: it emits one HTML file per prerendered route
  // (react-router.config.ts) instead of a single SPA shell, and brings its own
  // React fast-refresh transform, so @vitejs/plugin-react must not be added too.
  plugins: [tailwindcss(), reactRouter(), externalDistPlugin()],
  build: {
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
