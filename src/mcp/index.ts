import { setImmediate as afterAnswers } from 'node:timers/promises';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { getBlokVersion } from '../components/utils/version';

import { loadAuthorizeHook } from './auth/authorize';
import { checkOptionSafety, McpConfigError, parseMcpArgs } from './config';
import { readManifestFiles } from './contract-flags';
import { createPageWebhook } from './create-page';
import { createFilesHandleStore } from './handle-store-files';
import { McpListenError, startHttpServer } from './http';
import { DEFAULTS } from './options';
import type { BlokMcpOptions } from './options';
import { buildSdkServer } from './sdk-server';
import { assembleMcp, STOP_DRAIN_MS } from './server';
import { wellFormedIdsStdio } from './wire-ids';

export type {
  BlokDocumentCaller, BlokMcpDocumentSource, BlokMcpHandleLease, BlokMcpHandleRecord, BlokMcpHandleStore, BlokMcpOptions, BlokPageCreateRequest,
} from './options';
export { BlokMcpSourceError } from './sources/custom';
export type { BlokMcpSourceErrorKind } from './sources/custom';
export { createBlok } from './embed';
export type { BlokCallerIdentity, BlokEmbedOptions, BlokMcp, BlokMcpHandlers, BlokMcpHostNames, BlokMcpHostSurface, CreateBlokHooks } from './embed';

// A pipe on macOS takes writes later, so process.exit would cut off an answer the client reads slowly.
const flushStdout = async (graceMs: number): Promise<void> => {
  if (process.stdout.writableLength === 0) {
    return;
  }
  const grace: { timer?: ReturnType<typeof setTimeout> } = {};

  await Promise.race([
    new Promise<void>((resolve) => {
      process.stdout.write('', () => resolve());
    }),
    new Promise<void>((resolve) => {
      grace.timer = setTimeout(resolve, graceMs);
    }),
  ]);
  clearTimeout(grace.timer);
};

export const createBlokMcpServer = (options: BlokMcpOptions): { start(): Promise<void>; stop(): Promise<void> } => {
  checkOptionSafety(options);

  const assembled = assembleMcp(options);
  const state: { serving?: { close(graceMs: number): Promise<void> }; starting?: Promise<void>; stopping?: Promise<void> } = {};
  const principal = options.principal ?? DEFAULTS.principal;

  const startHttp = async (listen: string): Promise<void> => {
    const http = await startHttpServer({
      listen,
      tools: assembled.tools,
      instructions: assembled.instructions,
      dispatch: assembled.dispatch,
      auth: options.auth,
      principal,
      version: getBlokVersion(),
      ...(options.transport.kind === 'http' && options.transport.public === true && { public: true }),
    });

    state.serving = http;
    console.error(`blok-mcp: listening on ${http.url}/mcp`);
  };

  return {
    start: async () => {
      if (state.stopping !== undefined) {
        throw new McpConfigError('This MCP server has stopped');
      }
      if (state.serving !== undefined) {
        return;
      }
      if (options.transport.kind === 'http') {
        state.starting ??= startHttp(options.transport.listen);
        await state.starting;

        return;
      }
      if (options.auth.kind !== 'none') {
        throw new McpConfigError('OAuth authentication needs the HTTP transport (--http)');
      }
      const stdio = serveStdio(() => buildSdkServer({
        tools: assembled.tools,
        instructions: assembled.instructions,
        dispatch: assembled.dispatch,
        caller: clientName => ({ principal, clientName, scopes: null }),
        version: getBlokVersion(),
      }), { transport: wellFormedIdsStdio() });

      state.serving = {
        close: async (graceMs) => {
          await stdio.close();
          await flushStdout(graceMs);
        },
      };
    },
    stop: () => {
      state.stopping ??= (async () => {
        const begun = Date.now();

        // Work first, then the transport: closing it first would drop the answers of calls in flight.
        try {
          await state.starting?.catch(() => undefined);
          await assembled.stop();
          // The SDK writes an answer a few microtasks after its call settles.
          await afterAnswers();
        } finally {
          await state.serving?.close(Math.max(0, STOP_DRAIN_MS - (Date.now() - begun)));
        }
      })();

      return state.stopping;
    },
  };
};

// The first end/SIGINT/SIGTERM stops once; only our own listeners are removed.
// stdin end means the client left only over stdio; an HTTP daemon may run with stdin closed.
const stopOnShutdown = (server: { stop(): Promise<void> }, watchStdin: boolean): void => {
  const shutdown = (): void => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    process.stdin.off('end', shutdown);
    void server.stop().then(() => process.exit(0), () => process.exit(1));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (watchStdin) {
    process.stdin.on('end', shutdown);
  }
};

/** The blok-mcp flags and env as options, with the --authorize and --create-page hooks, the --handle-store and manifest files loaded. */
export const parseBlokMcpArgs = async (argv: string[], env: NodeJS.ProcessEnv): Promise<BlokMcpOptions> => {
  const { options, files } = parseMcpArgs(argv, env);
  const authorize = files.authorize === undefined ? undefined : await loadAuthorizeHook(files.authorize);

  return {
    ...options,
    ...(authorize !== undefined && { authorize }),
    ...(files.createPage !== undefined && { createPage: createPageWebhook(files.createPage) }),
    ...(files.handleStore !== undefined && { handleStore: createFilesHandleStore(files.handleStore) }),
    ...await readManifestFiles(files),
  };
};

export const runCli = async (argv: string[], env: NodeJS.ProcessEnv): Promise<void> => {
  const state: { server?: { stop(): Promise<void> } } = {};

  try {
    const options = await parseBlokMcpArgs(argv, env);
    const server = createBlokMcpServer(options);

    state.server = server;
    await server.start();
    stopOnShutdown(server, options.transport.kind === 'stdio');
  } catch (thrown) {
    await state.server?.stop();
    if (thrown instanceof McpConfigError) {
      console.error(`blok-mcp: ${thrown.message}`);
      process.exit(2);
    }
    if (thrown instanceof McpListenError) {
      console.error(`blok-mcp: ${thrown.message}`);
      process.exit(1);
    }
    throw thrown;
  }
};
