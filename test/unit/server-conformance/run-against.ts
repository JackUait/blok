import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import { sendRequest, type HttpRequestOptions, type HttpResponse } from './http-client';
import { startServerProcess } from './server-process';

const LOOPBACK_PLACEHOLDER = '127.0.0.1:0';

export interface StartServerOptions {
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export interface RunningServer {
  readonly baseUrl: string;
  request(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  stop(): Promise<void>;
}

export interface RunServerCommandOptions {
  args: string[];
  env?: NodeJS.ProcessEnv;
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

function allocateLoopbackPort(): Promise<number> {
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

    child.once('error', reject);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stderr });
    });
  });
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const command = configuredServerCommand();
  const port = await allocateLoopbackPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = await startServerProcess({
    command,
    args: replaceListenPlaceholder(options.args, port),
    baseUrl,
    env: { ...process.env, ...options.env },
  });

  return {
    baseUrl,
    request: (method, path, requestOptions = {}) => sendRequest(
      method,
      new URL(path, baseUrl),
      requestOptions,
    ),
    stop: () => serverProcess.stop(),
  };
}
