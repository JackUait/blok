#!/usr/bin/env node
/**
 * `yarn serve` — the dev playground and the backend it talks to.
 *
 * Starts three things: the document store (in this process), the sync service
 * (a child, built from `packages/server/dotnet`) and Vite (a child). Pass
 * `--no-server` for the frontend alone; every other argument goes to Vite.
 *
 * A machine without .NET degrades to frontend-only rather than failing —
 * `yarn serve` is first of all the editor's dev server, and most sessions never
 * touch the backend.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startDocumentStore } from './dev-doc-store.mjs';
import { playgroundPageSeed, startPageHostNear } from './dev-page-host.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_DIRECTORY = join(ROOT, '.dev');
const BINARY_DIRECTORY = join(DEV_DIRECTORY, 'server-bin');
const BINARY = join(BINARY_DIRECTORY, process.platform === 'win32' ? 'Blok.Server.Host.exe' : 'Blok.Server.Host');
const SERVER_SOURCES = join(ROOT, 'packages/server/dotnet');
const HOST_PROJECT = join(SERVER_SOURCES, 'Blok.Server.Host/Blok.Server.Host.csproj');
const PLAYGROUND_DOCUMENT = join(ROOT, 'playground-document.json');
const PLAYGROUND_PAGES = join(ROOT, 'playground-pages.json');
// Must match the room name `collaborationConfig` in index.html gives a page.
const PAGE_ROOM = '--page--';
const VITE = join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');

const SYNC_PORT = 4000;
const DOCUMENT_PORT = 4500;
const DEFAULT_VITE_PORT = 3303;
const PAGE_HOST_PORT = 4600;
const TICKET_PORT = 4700;

/**
 * Split our own flags from Vite's.
 *
 * `--no-open` is passed on because the `vite --no-open` script this replaced
 * did, and the config's `open: true` would otherwise pop a browser per restart.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {{ noServer: boolean, viteArgs: string[] }}
 */
export function parseDevArgs(argv) {
  const viteArgs = argv.filter((argument) => argument !== '--no-server');

  return {
    noServer: argv.includes('--no-server'),
    viteArgs: viteArgs.includes('--open') ? viteArgs : ['--no-open', ...viteArgs],
  };
}

/**
 * Decide whether the backend runs, and say why when it does not.
 *
 * @param {{ noServer: boolean, hasDotnet: boolean }} options
 * @returns {{ enabled: boolean, reason: 'on' | 'requested-off' | 'no-dotnet' }}
 */
export function resolveBackendMode({ noServer, hasDotnet }) {
  if (noServer) {
    return { enabled: false, reason: 'requested-off' };
  }

  if (!hasDotnet) {
    return { enabled: false, reason: 'no-dotnet' };
  }

  return { enabled: true, reason: 'on' };
}

/**
 * Whether the sync service has to be built again.
 *
 * A no-change `dotnet build` still costs half a minute, so an up-to-date binary
 * must short-circuit or every `yarn serve` pays for it.
 *
 * @param {{ binaryMtimeMs: number | null, newestSourceMtimeMs: number }} options
 * @returns {boolean}
 */
export function isBuildStale({ binaryMtimeMs, newestSourceMtimeMs }) {
  return binaryMtimeMs === null || newestSourceMtimeMs > binaryMtimeMs;
}

/**
 * Newest modification time among the sync service's sources.
 *
 * @param {string} directory Directory to walk.
 * @returns {number} Epoch milliseconds, 0 for an empty tree.
 */
function newestSourceMtime(directory) {
  let newest = 0;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    // bin/ and obj/ are build output: they are newer than the binary by
    // definition and would make every run look stale.
    if (entry.isDirectory()) {
      newest = entry.name === 'bin' || entry.name === 'obj'
        ? newest
        : Math.max(newest, newestSourceMtime(join(directory, entry.name)));
      continue;
    }

    if (entry.name.endsWith('.cs') || entry.name.endsWith('.csproj') || entry.name.endsWith('.props')) {
      newest = Math.max(newest, statSync(join(directory, entry.name)).mtimeMs);
    }
  }

  return newest;
}

/**
 * @returns {boolean} Whether a .NET SDK is on PATH.
 */
function hasDotnet() {
  return spawnSync('dotnet', ['--version'], { stdio: 'ignore' }).status === 0;
}

/**
 * Build the sync service into `.dev/server-bin`, reusing the last build when no
 * source moved.
 *
 * @returns {boolean} Whether a runnable binary is in place.
 */
function buildSyncService() {
  const stale = isBuildStale({
    binaryMtimeMs: existsSync(BINARY) ? statSync(BINARY).mtimeMs : null,
    newestSourceMtimeMs: newestSourceMtime(SERVER_SOURCES),
  });

  if (!stale) {
    return true;
  }

  console.log('[blok] building the sync service (first run takes about half a minute)…');

  // NuGetAudit off on the CLI only: the audit needs nuget.org, and its warning
  // escalates to an error under the projects' TreatWarningsAsErrors, so an
  // offline or firewalled machine cannot build without it.
  const build = spawnSync('dotnet', [
    'build', HOST_PROJECT,
    '--configuration', 'Release',
    '--output', BINARY_DIRECTORY,
    '-p:NuGetAudit=false',
  ], { cwd: ROOT, stdio: 'inherit' });

  return build.status === 0;
}

/**
 * The port Vite will listen on — the origin collaboration is pinned to is built
 * from it, so both spellings of the flag have to be read.
 *
 * @param {string[]} viteArgs Arguments handed to Vite.
 * @returns {number}
 */
export function vitePort(viteArgs) {
  const index = viteArgs.indexOf('--port');
  const inline = viteArgs.find((argument) => argument.startsWith('--port='));
  const value = Number(index === -1 ? inline?.slice('--port='.length) : viteArgs[index + 1]);

  return Number.isInteger(value) ? value : DEFAULT_VITE_PORT;
}

/**
 * The sync service's command line.
 *
 * Ticket mode, so every write is journalled under a user and history can name
 * its authors. The secret goes in BLOK_SECRET, never on the command line.
 *
 * @param {object} options
 * @param {string} options.listen
 * @param {string[]} options.origins Playground origins.
 * @param {string} options.collabDir
 * @param {string} options.docEndpoint
 * @param {string} options.storageDir
 * @returns {string[]}
 */
export function syncServiceArgs({ listen, origins, collabDir, docEndpoint, storageDir }) {
  return [
    '--listen', listen,
    '--auth', 'ticket',
    // Ticket mode defaults to 60 requests a minute; one playground tab uses more.
    '--rate-limit', '0',
    '--collab',
    '--collab-journal',
    '--collab-dir', collabDir,
    '--doc-endpoint', docEndpoint,
    '--allow-origin', origins.join(','),
    '--storage-dir', storageDir,
  ];
}

/**
 * What to log when the ticket mint does not start. Only a Node that cannot
 * load `.ts` gets the version advice; anything else prints as it is.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function mintFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cannotLoadTs = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_UNKNOWN_FILE_EXTENSION';

  return cannotLoadTs
    ? `[blok] the ticket mint did not start (${message}): it imports a .ts file, which needs Node 22.18+. Starting the playground without the backend.`
    : `[blok] the ticket mint did not start (${message}). Starting the playground without the backend.`;
}

/**
 * The first content of each collaboration room: the showcase for the root
 * document, a demo page's own blocks, and nothing for a page the user made.
 *
 * @param {object} options
 * @param {unknown} options.showcase The root document.
 * @param {Record<string, { blocks: unknown[] }>} options.pages Demo pages, by page id.
 * @returns {(id: string) => unknown}
 */
export function playgroundSeedFor({ showcase, pages }) {
  return (id) => {
    const at = id.indexOf(PAGE_ROOM);

    if (at === -1) {
      return showcase;
    }

    return { blocks: pages[id.slice(at + PAGE_ROOM.length)]?.blocks ?? [] };
  };
}

async function main() {
  const { noServer, viteArgs } = parseDevArgs(process.argv.slice(2));
  const mode = resolveBackendMode({ noServer, hasDotnet: noServer ? false : hasDotnet() });

  if (mode.reason === 'no-dotnet') {
    console.log('[blok] no .NET SDK found — starting the playground without the backend (same as --no-server).');
  }

  const children = [];
  let shuttingDown = false;

  const shutdown = (code) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const child of children) {
      child.kill('SIGTERM');
    }
    process.exit(code);
  };

  const supervise = (name, child) => {
    children.push(child);
    child.once('exit', (code) => {
      if (!shuttingDown) {
        console.error(`[blok] ${name} stopped (code ${code ?? 0}) — shutting down.`);
        shutdown(code ?? 1);
      }
    });
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  let backendRunning = false;
  let ticketUrl = null;

  if (mode.enabled && !buildSyncService()) {
    console.error('[blok] the sync service did not build — starting the playground without the backend.');
  } else if (mode.enabled) {
    // The shared document lives exactly as long as this command does, so the
    // playground opens on its showcase again after every restart. The room
    // would otherwise reload its own saved copy and ignore the store.
    rmSync(join(DEV_DIRECTORY, 'collab'), { recursive: true, force: true });

    await startDocumentStore({
      port: DOCUMENT_PORT,
      seedFor: playgroundSeedFor({
        showcase: { blocks: JSON.parse(readFileSync(PLAYGROUND_DOCUMENT, 'utf8')) },
        pages: JSON.parse(readFileSync(PLAYGROUND_PAGES, 'utf8')),
      }),
    });

    const origins = [`http://localhost:${vitePort(viteArgs)}`, `http://127.0.0.1:${vitePort(viteArgs)}`];
    // A new secret per run: passes from an earlier run stop working with it.
    const secret = randomBytes(32).toString('hex');

    // Imported late: on a Node that cannot run .ts the playground still starts.
    ticketUrl = await import('./dev-ticket.mjs')
      .then(({ startTicketMint }) => startTicketMint({ port: TICKET_PORT, secret, origins }))
      .then(({ url }) => url)
      .catch((error) => {
        console.error(mintFailureMessage(error));

        return null;
      });

    if (ticketUrl !== null) {
      supervise('sync service', spawn(BINARY, syncServiceArgs({
        listen: `127.0.0.1:${SYNC_PORT}`,
        origins,
        collabDir: join(DEV_DIRECTORY, 'collab'),
        docEndpoint: `http://127.0.0.1:${DOCUMENT_PORT}/docs`,
        storageDir: join(DEV_DIRECTORY, 'uploads'),
      }), { cwd: ROOT, stdio: 'inherit', env: { ...process.env, BLOK_SECRET: secret } }));

      backendRunning = true;
      console.log(`[blok] collaboration is on — open the playground in two windows to see it. Passes come from ${ticketUrl}.`);
    }
  }

  // The reference page host behind `?host=remote`. Optional: the playground
  // keeps its localStorage registry without it.
  const pageHost = await startPageHostNear({
    from: PAGE_HOST_PORT,
    attempts: 10,
    seed: playgroundPageSeed(JSON.parse(readFileSync(PLAYGROUND_PAGES, 'utf8'))),
  }).catch((error) => {
    console.error(`[blok] the page host did not start (${error.message}) — ?host=remote is unavailable.`);

    return null;
  });

  if (pageHost !== null) {
    console.log(`[blok] page host at ${pageHost.url} — open the playground with ?host=remote to use it.`);
  }

  supervise('vite', spawn(VITE, [
    // Collaboration is pinned to the origin above; letting Vite drift to the
    // next free port would break the socket with no visible cause.
    ...(backendRunning ? ['--strictPort'] : []),
    ...viteArgs,
  ], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      BLOK_DEV_BACKEND: backendRunning ? '1' : '0',
      ...(ticketUrl !== null && { VITE_BLOK_TICKET_URL: ticketUrl }),
      ...(pageHost !== null && { VITE_BLOK_PAGE_HOST_URL: pageHost.url }),
    },
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
