import { build } from 'vite';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(path.resolve(__dirname, '../packages/mcp/package.json'), 'utf-8')).version;

async function buildMcp() {
  console.log('Building MCP server...');

  await build({
    configFile: false,
    build: {
      copyPublicDir: false,
      ssr: true,
      target: 'node20',
      emptyOutDir: true,
      outDir: path.resolve(__dirname, '../packages/mcp/dist'),
      lib: {
        entry: {
          mcp: path.resolve(__dirname, '../src/mcp/index.ts'),
          // The bin must load the guard before importing MCP code.
          'stdout-guard': path.resolve(__dirname, '../src/mcp/stdout-guard.ts'),
        },
        formats: ['es'],
        fileName: (_format, name) => `${name}.mjs`,
      },
      rollupOptions: {
        // Keep this list aligned with the package's runtime dependencies.
        external: [/^node:/, /^@modelcontextprotocol\/server(\/.*)?$/, 'ws'],
      },
    },
    // SSR builds leave npm imports bare; inline all but the externals above,
    // since the package installs only those.
    ssr: { noExternal: true },
    define: { VERSION: JSON.stringify(version) },
  });

  console.log('MCP server built successfully');
}

buildMcp().catch((error) => {
  console.error('Failed to build MCP server:', error);
  process.exit(1);
});
