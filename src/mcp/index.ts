import { readFile } from 'node:fs/promises';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { getBlokVersion } from '../components/utils/version';

import { loadAuthorizeHook } from './auth/authorize';
import { checkOptionSafety, McpConfigError, parseMcpArgs } from './config';
import { parseCustomToolsFile, parseOverridesFile } from './custom-tools-file';
import { startHttpServer } from './http';
import { DEFAULTS } from './options';
import type { BlokMcpOptions } from './options';
import { buildSdkServer } from './sdk-server';
import { assembleMcp } from './server';

export type { BlokMcpOptions } from './options';

const readJsonFile = async (path: string): Promise<unknown> => {
  const text = await readFile(path, 'utf-8').catch((thrown: unknown) => {
    if (thrown instanceof Error && 'code' in thrown && thrown.code === 'ENOENT') {
      throw new McpConfigError(`Cannot read "${path}": no such file`);
    }
    throw thrown;
  });

  try {
    const value: unknown = JSON.parse(text);

    return value;
  } catch (thrown) {
    if (thrown instanceof SyntaxError) {
      throw new McpConfigError(`Invalid JSON in "${path}": ${thrown.message}`);
    }
    throw thrown;
  }
};

export const createBlokMcpServer = (options: BlokMcpOptions): { start(): Promise<void>; stop(): Promise<void> } => {
  checkOptionSafety(options);

  const assembled = assembleMcp(options);
  const state: { serving?: StdioServerHandle; starting?: Promise<void>; stopping?: Promise<void> } = {};
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
      state.serving = serveStdio(() => buildSdkServer({
        tools: assembled.tools,
        instructions: assembled.instructions,
        dispatch: assembled.dispatch,
        caller: clientName => ({ principal, clientName, scopes: null }),
        version: getBlokVersion(),
      }));
    },
    stop: () => {
      state.stopping ??= (async () => {
        try {
          await state.starting?.catch(() => undefined);
          await state.serving?.close();
        } finally {
          await assembled.stop();
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

export const runCli = async (argv: string[], env: NodeJS.ProcessEnv): Promise<void> => {
  const state: { server?: { stop(): Promise<void> } } = {};

  try {
    const { options, files } = parseMcpArgs(argv, env);

    const authorize = files.authorize === undefined ? undefined : await loadAuthorizeHook(files.authorize);
    const server = createBlokMcpServer({
      ...options,
      ...(authorize !== undefined && { authorize }),
      ...(files.manifest !== undefined && { manifest: parseCustomToolsFile(await readJsonFile(files.manifest)) }),
      ...(files.overrides !== undefined && { overrides: parseOverridesFile(await readJsonFile(files.overrides)) }),
    });

    state.server = server;
    await server.start();
    stopOnShutdown(server, options.transport.kind === 'stdio');
  } catch (thrown) {
    await state.server?.stop();
    if (thrown instanceof McpConfigError) {
      console.error(`blok-mcp: ${thrown.message}`);
      process.exit(2);
    }
    throw thrown;
  }
};
