import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { sendRequest, type HttpRequestOptions, type HttpResponse } from './http-client';
import { startServerProcess } from './server-process';

const LOOPBACK_PLACEHOLDER = '127.0.0.1:0';
// A port is allocated by binding and closing, so another worker's server can
// take it in the gap before ours binds. Linux hands out ephemeral ports from a
// randomised offset, so a run of this suite collides every so often; macOS
// counts up and practically never does.
const START_ATTEMPTS = 3;

export interface StartServerOptions {
  /** Test seam: the port source, so a lost race can be staged. */
  allocatePort?: () => Promise<number>;
  args: string[];
  command?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunningServer {
  readonly baseUrl: string;
  /** SIGKILL, for the crash-recovery tests; `stop` is the graceful SIGTERM drain. */
  kill(): Promise<void>;
  request(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  stop(): Promise<void>;
}

export interface RunServerCommandOptions {
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface ServerCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

function configuredServerCommand(): string {
  const command = process.env.BLOK_CONFORMANCE_SERVER;

  if (command === undefined || command === '') {
    throw new Error('BLOK_CONFORMANCE_SERVER must point at a built server executable');
  }

  return command;
}

export function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const allocator = createServer();

    allocator.once('error', reject);
    allocator.listen(0, '127.0.0.1', () => {
      const address = allocator.address();

      if (address === null || typeof address === 'string') {
        allocator.close();
        reject(new Error('Could not allocate a loopback port'));
        return;
      }

      allocator.close((error) => {
        if (error === undefined) {
          resolve(address.port);
        } else {
          reject(error);
        }
      });
    });
  });
}

function replaceListenPlaceholder(args: string[], port: number): string[] {
  const listen = `127.0.0.1:${port}`;
  const replaced = [...args];
  const flagIndex = replaced.findIndex(
    (arg, index) => arg === '--listen' && replaced[index + 1] === LOOPBACK_PLACEHOLDER,
  );

  if (flagIndex >= 0) {
    replaced[flagIndex + 1] = listen;
    return replaced;
  }

  const inlineFlagIndex = replaced.indexOf(`--listen=${LOOPBACK_PLACEHOLDER}`);

  if (inlineFlagIndex >= 0) {
    replaced[inlineFlagIndex] = `--listen=${listen}`;
    return replaced;
  }

  throw new Error(`Server args must include --listen ${LOOPBACK_PLACEHOLDER}`);
}

export function runServerCommand(options: RunServerCommandOptions): Promise<ServerCommandResult> {
  const command = configuredServerCommand();

  return new Promise((resolve, reject) => {
    const child = spawn(command, options.args, {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    const timeoutMs = options.timeoutMs ?? 10_000;
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error('Server command did not exit within ' + timeoutMs + ' ms'));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(deadline);
      resolve({ exitCode, signal, stderr });
    });
  });
}

function lostThePort(error: unknown): boolean {
  return error instanceof Error && error.message.includes('address already in use');
}

async function startOnPort(
  options: StartServerOptions,
  command: string,
  port: number,
): Promise<RunningServer> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = await startServerProcess({
    command,
    args: replaceListenPlaceholder(options.args, port),
    baseUrl,
    env: { ...process.env, ...options.env },
  });

  return {
    baseUrl,
    kill: () => serverProcess.kill(),
    request: (method, path, requestOptions = {}) => sendRequest(
      method,
      new URL(path, baseUrl),
      requestOptions,
    ),
    stop: () => serverProcess.stop(),
  };
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const command = options.command ?? configuredServerCommand();
  const allocate = options.allocatePort ?? allocateLoopbackPort;
  let lastError: unknown = new Error('No start was attempted');

  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    const port = await allocate();
    const outcome = await startOnPort(options, command, port).then(
      (server) => ({ server, error: undefined }),
      (error: unknown) => ({ server: undefined, error }),
    );

    if (outcome.server !== undefined) {
      return outcome.server;
    }

    lastError = outcome.error;

    if (!lostThePort(lastError)) {
      break;
    }
  }

  throw lastError;
}
