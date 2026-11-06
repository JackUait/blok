import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';

import { adoptChild } from '../server-conformance/server-process';

// A port that never answers must fail the case, not hang the suite.
export const READ_TIMEOUT_MS = 20_000;
const EXIT_TIMEOUT_MS = 15_000;
const LISTENING = /listening on (\S+)/;

/** The binary under test: argv[0] plus any leading args, from the runner. */
export const conformanceCommand = (): string[] | undefined => {
  const raw = process.env.BLOK_MCP_CONFORMANCE_COMMAND;

  if (raw === undefined || raw === '') {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part) => typeof part === 'string')) {
    throw new Error('BLOK_MCP_CONFORMANCE_COMMAND must be a JSON array of strings.');
  }

  return parsed;
};

/** The parent's env minus every BLOK_ variable, so a case sees only what it sets. */
export const caseEnv = (env: Record<string, string>): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BLOK_'))),
  ...env,
});

const hasExited = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null;

export interface Exit { code: number | null; signal: string | null }

const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<Exit | undefined> => {
  if (hasExited(child)) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(undefined);
    }, timeoutMs);
    const onExit = (code: number | null, signal: string | null): void => {
      clearTimeout(timer);
      resolve({ code, signal });
    };

    child.once('exit', onExit);
  });
};

const kill = async (child: ChildProcess): Promise<void> => {
  if (!hasExited(child)) {
    child.kill('SIGKILL');
    await waitForExit(child, EXIT_TIMEOUT_MS);
  }
};

interface Spawned {
  child: ChildProcess;
  readonly stderr: string;
  launchError(): Error | undefined;
}

const spawnChild = (command: string[], argv: string[], env: NodeJS.ProcessEnv, cwd: string): Spawned => {
  const child = spawn(command[0], [...command.slice(1), ...argv], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let launchError: Error | undefined;

  adoptChild(child);
  child.once('error', (error) => {
    launchError = error;
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  // A process that exits early closes stdin; writes after that must not crash the worker.
  child.stdin?.on('error', () => undefined);

  return { child, get stderr() { return stderr; }, launchError: () => launchError };
};

export interface JsonMessage { [key: string]: unknown }

export interface StdioServer {
  send(message: JsonMessage): void;
  /** The next JSON-RPC message the server wrote, in order. */
  next(timeoutMs?: number): Promise<JsonMessage>;
  /** Sends a signal; waitExit then waits for the process to end. */
  signal(name: NodeJS.Signals): void;
  waitExit(timeoutMs: number): Promise<Exit | undefined>;
  /** Ends stdin and waits for the process to exit by itself. */
  closeInput(): Promise<Exit>;
  readonly stderr: string;
  kill(): Promise<void>;
}

const parseLine = (line: string): JsonMessage | Error => {
  try {
    const parsed: unknown = JSON.parse(line);

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonMessage;
    }
  } catch {
    // Reported below.
  }

  return new Error(`stdout carried a line that is not a JSON-RPC message: ${JSON.stringify(line)}`);
};

export const startStdio = (command: string[], argv: string[], env: NodeJS.ProcessEnv, cwd: string): StdioServer => {
  const spawned = spawnChild(command, argv, env, cwd);
  const { child } = spawned;
  const queue: JsonMessage[] = [];
  const waiters: Array<(message: JsonMessage | Error) => void> = [];
  let buffer = '';
  let failure: Error | undefined;

  const push = (item: JsonMessage | Error): void => {
    if (item instanceof Error) {
      failure ??= item;
    }
    const waiter = waiters.shift();

    if (waiter !== undefined) {
      waiter(item);
    } else if (!(item instanceof Error)) {
      queue.push(item);
    }
  };

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');

    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');

      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line !== '') {
        push(parseLine(line));
      }
    }
  });
  child.once('exit', () => {
    while (waiters.length > 0) {
      waiters.shift()?.(new Error(`the server exited (code ${child.exitCode}, signal ${child.signalCode}) before answering.\nstderr:\n${spawned.stderr}`));
    }
  });

  return {
    send: (message) => {
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    },
    next: (timeoutMs = READ_TIMEOUT_MS) => {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      const queued = queue.shift();

      if (queued !== undefined) {
        return Promise.resolve(queued);
      }
      if (hasExited(child) || spawned.launchError() !== undefined) {
        return Promise.reject(new Error(`the server is not running (code ${child.exitCode}): ${spawned.launchError()?.message ?? ''}\nstderr:\n${spawned.stderr}`));
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(settle);

          if (index >= 0) {
            waiters.splice(index, 1);
          }
          reject(new Error(`no message from the server within ${timeoutMs} ms.\nstderr:\n${spawned.stderr}`));
        }, timeoutMs);
        const settle = (item: JsonMessage | Error): void => {
          clearTimeout(timer);
          if (item instanceof Error) {
            reject(item);
          } else {
            resolve(item);
          }
        };

        waiters.push(settle);
      });
    },
    closeInput: async () => {
      child.stdin?.end();
      const exit = await waitForExit(child, EXIT_TIMEOUT_MS);

      if (exit === undefined) {
        await kill(child);
        throw new Error(`the server did not exit within ${EXIT_TIMEOUT_MS} ms of stdin closing.\nstderr:\n${spawned.stderr}`);
      }

      return exit;
    },
    get stderr() {
      return spawned.stderr;
    },
    signal: (name) => {
      child.kill(name);
    },
    waitExit: (timeoutMs) => waitForExit(child, timeoutMs),
    kill: () => kill(child),
  };
};

export interface HttpAnswer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpRequestSpec {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs?: number;
}

/** node:http, because fetch will not send a Host header of the test's choosing. */
export const sendHttp = (baseUrl: string, spec: HttpRequestSpec): Promise<HttpAnswer> => {
  const url = new URL(spec.path, baseUrl);

  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: spec.method,
      headers: spec.body === undefined ? spec.headers : { 'content-length': String(spec.body.length), ...spec.headers },
      timeout: spec.timeoutMs ?? READ_TIMEOUT_MS,
    }, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value ?? ''])),
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error(`no HTTP answer within ${spec.timeoutMs ?? READ_TIMEOUT_MS} ms`)));
    // The server may answer 413 and close while the body is still going out.
    req.on('error', (error: NodeJS.ErrnoException) => {
      reject(error);
    });
    req.end(spec.body);
  });
};

export interface HttpServer {
  /** The URL the server printed: `http://<host>:<port>/mcp`. */
  url: string;
  port: string;
  readonly stderr: string;
  signal(name: NodeJS.Signals): void;
  waitExit(timeoutMs: number): Promise<Exit | undefined>;
  stop(): Promise<void>;
}

export const startHttp = async (command: string[], argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<HttpServer> => {
  const spawned = spawnChild(command, argv, env, cwd);
  const { child } = spawned;
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error(`no "listening on <url>" line on stderr within ${READ_TIMEOUT_MS} ms.\nstderr:\n${spawned.stderr}`));
    }, READ_TIMEOUT_MS);
    const onData = (): void => {
      const match = LISTENING.exec(spawned.stderr);

      if (match !== null) {
        finish(match[1]);
      }
    };
    const onExit = (): void => finish(new Error(`the server exited (code ${child.exitCode}) before listening.\nstderr:\n${spawned.stderr}`));
    const finish = (result: string | Error): void => {
      clearTimeout(timer);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      if (result instanceof Error) {
        void kill(child);
        reject(result);
      } else {
        resolve(result);
      }
    };

    child.stderr?.on('data', onData);
    child.once('exit', onExit);
    onData();
  });

  return {
    url,
    port: new URL(url).port,
    get stderr() {
      return spawned.stderr;
    },
    signal: (name) => {
      child.kill(name);
    },
    waitExit: (timeoutMs) => waitForExit(child, timeoutMs),
    stop: async () => {
      if (!hasExited(child)) {
        child.kill('SIGTERM');
        if (await waitForExit(child, EXIT_TIMEOUT_MS) === undefined) {
          await kill(child);
        }
      }
    },
  };
};

export interface CliRun extends Exit {
  stdout: string;
  stderr: string;
}

/** Starts the binary with stdin already closed and waits for it to exit. */
export const runToExit = async (command: string[], argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<CliRun> => {
  const spawned = spawnChild(command, argv, env, cwd);
  let stdout = '';

  spawned.child.stdout?.setEncoding('utf8');
  spawned.child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  spawned.child.stdin?.end();
  const exit = await waitForExit(spawned.child, EXIT_TIMEOUT_MS);

  if (exit === undefined) {
    await kill(spawned.child);
    throw new Error(`the process did not exit within ${EXIT_TIMEOUT_MS} ms with stdin closed.\nstderr:\n${spawned.stderr}`);
  }
  if (spawned.launchError() !== undefined) {
    throw new Error(`could not launch ${command[0]}: ${spawned.launchError()?.message}`);
  }

  return { ...exit, stdout, stderr: spawned.stderr };
};
