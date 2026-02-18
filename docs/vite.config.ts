import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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
        return fs.readFileSync(id, "utf-8");
      }
      return null;
    },
    configureServer(server) {
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
  plugins: [react(), externalDistPlugin()],
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
