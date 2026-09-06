import { spawn, type ChildProcess } from 'node:child_process';

import { sendRequest } from './http-client';

const HEALTH_REQUEST_TIMEOUT_MS = 250;
const HEALTH_POLL_INTERVAL_MS = 25;
// The first start in a run pays the cold assembly load, and the crash-recovery
// tests start a dozen servers; 5 s was not enough for the first of them.
const STARTUP_TIMEOUT_MS = 20_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

export interface ServerProcessOptions {
  args: string[];
  baseUrl: string;
  command: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunningServerProcess {
  readonly stderr: string;
  /** SIGKILL: no drain, no flush, no shutdown hook — what a crash looks like. */
  kill(): Promise<void>;
  stop(): Promise<void>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);

    child.once('exit', onExit);
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (hasExited(child)) {
    return;
  }

  child.kill('SIGTERM');

  if (await waitForExit(child, SHUTDOWN_TIMEOUT_MS)) {
    return;
  }

  child.kill('SIGKILL');

  if (!await waitForExit(child, SHUTDOWN_TIMEOUT_MS)) {
    throw new Error(`Server process ${child.pid ?? '<unknown>'} did not stop`);
  }
}

async function killProcess(child: ChildProcess): Promise<void> {
  if (hasExited(child)) {
    return;
  }

  child.kill('SIGKILL');

  if (!await waitForExit(child, SHUTDOWN_TIMEOUT_MS)) {
    throw new Error(`Server process ${child.pid ?? '<unknown>'} survived SIGKILL`);
  }
}

async function healthFailure(baseUrl: string): Promise<string | undefined> {
  try {
    const health = await sendRequest('GET', new URL('/health', baseUrl), {
      timeoutMs: HEALTH_REQUEST_TIMEOUT_MS,
    });

    return health.status === 200 ? undefined : `HTTP ${health.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function startServerProcess(options: ServerProcessOptions): Promise<RunningServerProcess> {
  const child = spawn(options.command, options.args, {
    env: options.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let launchError: Error | undefined;
  let stderr = '';

  child.once('error', (error) => {
    launchError = error;
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastHealthError = '';

  while (Date.now() < deadline) {
    if (launchError !== undefined) {
      throw new Error(`Could not launch server: ${launchError.message}${stderr === '' ? '' : `\n${stderr}`}`);
    }

    if (hasExited(child)) {
      throw new Error(
        `Server exited before becoming healthy (code ${child.exitCode ?? 'none'}, signal ${child.signalCode ?? 'none'})` +
          (stderr === '' ? '' : `\n${stderr}`),
      );
    }

    const healthError = await healthFailure(options.baseUrl);

    if (healthError === undefined) {
      return {
        get stderr() {
          return stderr;
        },
        kill: () => killProcess(child),
        stop: () => stopProcess(child),
      };
    }

    lastHealthError = healthError;
    await delay(HEALTH_POLL_INTERVAL_MS);
  }

  await stopProcess(child);

  throw new Error(
    `Server did not become healthy within ${STARTUP_TIMEOUT_MS} ms` +
      (lastHealthError === '' ? '' : `: ${lastHealthError}`) +
      (stderr === '' ? '' : `\n${stderr}`),
  );
}
