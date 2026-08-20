import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPayload } from './build-payload.mjs';
import { stagePayload, stageDist } from './sync-core.mjs';
import { createHelperServer, DEFAULT_HELPER_PORT } from './helper-server.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const payloadDir = resolve(root, 'override-extension/payload');
const distDir = resolve(root, 'dist');

const helperPort = Number(process.env.BLOK_OVERRIDE_HELPER_PORT ?? DEFAULT_HELPER_PORT);
const helperToken = randomBytes(16).toString('hex');

// Re-copying 30MB+ of dist on every watch rebuild would dwarf the payload
// build itself; only restage when the source build is actually newer.
const distIsStale = () => {
  const src = join(distDir, 'blok.mjs');
  const dst = join(payloadDir, 'dist', 'blok.mjs');
  if (!existsSync(src)) {
    return false;
  }
  return !existsSync(dst) || statSync(src).mtimeMs > statSync(dst).mtimeMs;
};

const distMeta = () => {
  const staged = join(payloadDir, 'dist', 'blok.mjs');
  if (!existsSync(staged)) {
    return { staged: false };
  }
  const src = join(distDir, 'blok.mjs');
  return { staged: true, builtAt: statSync(existsSync(src) ? src : staged).mtime.toISOString() };
};

const stage = (outDir, version, builtAt, helper = null) => {
  const code = readFileSync(join(outDir, 'blok-override.js'), 'utf8');
  if (distIsStale()) {
    const result = stageDist(payloadDir, distDir);
    console.log(`dist staged for tier-2 routes (${result.files} files)`);
  }
  const dist = distMeta();
  const { file } = stagePayload(payloadDir, code, { version, builtAt, dist, ...(helper ? { helper } : {}) });
  console.log(`payload synced: ${file} (${version})`);
  if (!dist.staged) {
    console.log('no dist/ build found — tier-2 CDN routes stay disabled until `yarn build` runs once');
  }
};

// A stale helper from a dead session can still hold the port; syncing must
// keep working without the rebuild trigger rather than crash on EADDRINUSE.
const listenSafely = (server) => {
  server.on('error', (error) => {
    console.warn(`rebuild trigger disabled — port ${helperPort} unavailable (${error.code ?? error.message})`);
  });
  server.listen(helperPort, '127.0.0.1');
};

const watchMode = process.argv.includes('--watch');
const serveMode = process.argv.includes('--serve');

if (watchMode) {
  const helper = { port: helperPort, token: helperToken };
  const { result, outDir, version, builtAt } = await buildPayload({ watch: {} });
  let inflight = Promise.resolve();
  let settle = null;
  result.on('event', (event) => {
    if (event.code === 'START') {
      inflight = new Promise((resolveBuild) => {
        settle = resolveBuild;
      });
    }
    if (event.code === 'END') {
      stage(outDir, version, builtAt, helper);
      settle?.();
    }
    if (event.code === 'ERROR') {
      console.error(event.error);
      settle?.();
    }
  });
  // Watch keeps the payload fresh on its own; a popup-triggered "build" only
  // needs to wait out whatever rebuild is already in flight.
  listenSafely(createHelperServer({
    token: helperToken,
    runBuild: () => inflight,
    readCurrent: () => JSON.parse(readFileSync(join(payloadDir, 'current.json'), 'utf8')),
  }));
  console.log(`watching src/ — payload re-syncs on change; rebuild trigger on 127.0.0.1:${helperPort}; Ctrl-C to stop`);
} else if (serveMode) {
  const helper = { port: helperPort, token: helperToken };
  const rebuild = async () => {
    const { outDir, version, builtAt } = await buildPayload();
    stage(outDir, version, builtAt, helper);
  };
  await rebuild();
  listenSafely(createHelperServer({
    token: helperToken,
    runBuild: rebuild,
    readCurrent: () => JSON.parse(readFileSync(join(payloadDir, 'current.json'), 'utf8')),
  }));
  console.log(`serving rebuild trigger on 127.0.0.1:${helperPort} — the extension popup's Rebuild button uses it; Ctrl-C to stop`);
} else {
  const { outDir, version, builtAt } = await buildPayload();
  stage(outDir, version, builtAt);
}
