/**
 * Host model for a CLI the user already logged in to. No API key is read,
 * written, or sent. Blok tools are described to the CLI and returned as
 * tool_use blocks; this module never runs them.
 */

import type {
  AgentModel,
  AgentModelContentBlock,
  AgentModelMessage,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelTool,
} from '../../types/api';

export type CliCommand = 'claude' | 'codex';

export interface CliStatus {
  command: CliCommand;
  installed: boolean;
  connected: boolean;
  /** First line of `--version`. Empty when the CLI is not installed. */
  version: string;
}

export const CLI_COMMANDS: readonly CliCommand[] = ['codex', 'claude'];

const EDITOR_TOOLS = ['blok_read', 'blok_describe', 'blok_execute'] as const;
const FRESH_MS = 5000;
const CATALOG_MS = 15000;
const MODEL_MS = 180000;

export const providerLabel = (command: CliCommand): string => (command === 'codex' ? 'Codex' : 'Claude Code');

const unavailable = (command: CliCommand): AgentModelResponse => ({
  content: [{ type: 'text', text: `The ${command} CLI is not available.` }],
  stop_reason: 'end_turn',
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

interface Io {
  write(data: string): void;
  end(): void;
}

interface SpawnError extends Error {
  code?: string;
}

interface Child {
  stdin: Io | null;
  stdout: AsyncIterable<Uint8Array | string> | null;
  stderr: AsyncIterable<Uint8Array | string> | null;
  once(event: 'error', listener: (error: SpawnError) => void): void;
  once(event: 'close', listener: (code: number | null) => void): void;
}

interface Spawn {
  (command: string, args: readonly string[], options: { signal: AbortSignal; stdio: ['pipe', 'pipe', 'pipe'] }): Child;
}

interface NodeIo {
  spawn: Spawn;
  mkdtemp: (prefix: string) => Promise<string>;
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
  tmpdir: () => string;
  join: (...parts: string[]) => string;
}

const asFn = <T>(value: unknown): T | null => (typeof value === 'function' ? value as T : null);

const readExport = (mod: unknown, key: string): unknown => (isRecord(mod) ? mod[key] : undefined);

const bindNode = (child: unknown, fs: unknown, os: unknown, path: unknown): NodeIo | null => {
  const spawn = asFn<Spawn>(readExport(child, 'spawn'));
  const mkdtemp = asFn<NodeIo['mkdtemp']>(readExport(fs, 'mkdtemp'));
  const readFile = asFn<NodeIo['readFile']>(readExport(fs, 'readFile'));
  const rm = asFn<NodeIo['rm']>(readExport(fs, 'rm'));
  const tmpdir = asFn<NodeIo['tmpdir']>(readExport(os, 'tmpdir'));
  const join = asFn<NodeIo['join']>(readExport(path, 'join'));

  if (spawn === null || mkdtemp === null || readFile === null || rm === null || tmpdir === null || join === null) {
    return null;
  }

  return { spawn, mkdtemp, readFile, rm, tmpdir, join };
};

const nodeGate: { pending: Promise<NodeIo | null> | null } = { pending: null };

const loadNode = (): Promise<NodeIo | null> => {
  if (nodeGate.pending === null) {
    const childSpec = 'node:child_process';
    const fsSpec = 'node:fs/promises';
    const osSpec = 'node:os';
    const pathSpec = 'node:path';

    nodeGate.pending = Promise.all([
      import(/* @vite-ignore */ childSpec) as Promise<unknown>,
      import(/* @vite-ignore */ fsSpec) as Promise<unknown>,
      import(/* @vite-ignore */ osSpec) as Promise<unknown>,
      import(/* @vite-ignore */ pathSpec) as Promise<unknown>,
    ]).then(([child, fs, os, path]) => bindNode(child, fs, os, path)).catch(() => null);
  }

  return nodeGate.pending;
};

interface Captured {
  code: number | null;
  stdout: string;
  stderr: string;
  missing: boolean;
  aborted: boolean;
  timedOut: boolean;
}

const decodeStream = async (stream: AsyncIterable<Uint8Array | string>): Promise<string> => {
  const decoder = new TextDecoder();
  const parts: string[] = [];

  for await (const chunk of stream) {
    parts.push(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  }

  parts.push(decoder.decode());

  return parts.join('');
};

const linked = (parent: AbortSignal, ms: number): { signal: AbortSignal; stop: () => void; timedOut: () => boolean } => {
  const controller = new AbortController();
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, ms);
  const onParent = (): void => {
    clearTimeout(timer);
    controller.abort(parent.reason);
  };

  if (parent.aborted) onParent();
  else parent.addEventListener('abort', onParent, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => state.timedOut,
    stop: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onParent);
    },
  };
};

const writeInput = (stdin: Io, input: string | null): void => {
  try {
    if (input !== null) stdin.write(input);
    stdin.end();
  } catch {
    stdin.end();
  }
};

const runCapture = (
  node: NodeIo,
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  input: string | null,
): Promise<Omit<Captured, 'aborted' | 'timedOut'>> => new Promise((resolve) => {
  const child = node.spawn(command, args, { signal, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { settled: false };
  const finish = (result: Omit<Captured, 'aborted' | 'timedOut'>): void => {
    if (state.settled) return;
    state.settled = true;
    resolve(result);
  };

  child.once('error', (error) => {
    finish({
      code: null,
      stdout: '',
      stderr: '',
      missing: error.code === 'ENOENT' || error.code === 'ENOTDIR',
    });
  });

  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderr = child.stderr;

  if (stdin === null || stdout === null || stderr === null) {
    finish({ code: null, stdout: '', stderr: '', missing: true });

    return;
  }

  writeInput(stdin, input);

  const out = decodeStream(stdout);
  const err = decodeStream(stderr);

  child.once('close', (code) => {
    void Promise.all([out, err]).then(([stdoutText, stderrText]) => {
      finish({ code, stdout: stdoutText, stderr: stderrText, missing: false });
    }, () => {
      finish({ code, stdout: '', stderr: '', missing: true });
    });
  });
});

const runLimited = async (
  node: NodeIo,
  command: string,
  args: readonly string[],
  user: AbortSignal,
  input: string | null,
  ms: number,
): Promise<Captured> => {
  const gate = linked(user, ms);

  try {
    const captured = await runCapture(node, command, args, gate.signal, input);

    return { ...captured, aborted: user.aborted, timedOut: gate.timedOut() && !user.aborted };
  } finally {
    gate.stop();
  }
};

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

const abortError = (signal: AbortSignal, error: unknown): Error => {
  if (error instanceof Error && (signal.aborted || isAbort(error))) return error;
  if (signal.reason instanceof Error) return signal.reason;

  return new DOMException('The run was stopped.', 'AbortError');
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw abortError(signal, signal.reason);
};

const firstLine = (stdout: string, stderr: string): string => {
  const line = `${stdout}\n${stderr}`.split('\n').map((item) => item.trim()).find((item) => item !== '');

  return line ?? '';
};

const recordLoggedIn = (value: unknown): boolean => isRecord(value) && value.loggedIn === true;

/**
 * Codex prints "logged in" when the account is connected. "not logged in"
 * contains the same words and is not a connection.
 */
export const outputSaysConnected = (command: CliCommand, output: string): boolean => {
  if (command === 'codex') return /logged in/i.test(output) && !/not\s+logged\s+in/i.test(output);

  if (recordLoggedIn(parseJson(output.trim()))) return true;

  return output.split('\n').some((line) => recordLoggedIn(parseJson(line.trim())));
};

const statusArgs = (command: CliCommand): readonly string[] => (
  command === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json']
);

const absent = (command: CliCommand): CliStatus => ({ command, installed: false, connected: false, version: '' });

interface Probe {
  status: CliStatus;
  skipCache: boolean;
}

const probe = async (node: NodeIo, command: CliCommand, signal: AbortSignal): Promise<Probe> => {
  const version = await runLimited(node, command, ['--version'], signal, null, CATALOG_MS);

  if (version.aborted || version.timedOut) return { status: absent(command), skipCache: true };
  if (version.missing || version.code !== 0) return { status: absent(command), skipCache: false };

  const login = await runLimited(node, command, statusArgs(command), signal, null, CATALOG_MS);

  if (login.aborted || login.timedOut) return { status: absent(command), skipCache: true };

  const connected = !login.missing && outputSaysConnected(command, `${login.stdout}\n${login.stderr}`);

  return {
    skipCache: false,
    status: { command, installed: true, connected, version: firstLine(version.stdout, version.stderr) },
  };
};

const catalog = new Map<CliCommand, { at: number; status: CliStatus }>();

/** Drop a cached install/login check. Call it after a login attempt. */
export const invalidateCli = (command?: CliCommand): void => {
  if (command === undefined) catalog.clear();
  else catalog.delete(command);
};

/**
 * Whether the CLI binary runs, and whether its own login says it is connected.
 * Nothing from the CLI is written to disk by this check.
 */
export const inspectCli = async (command: CliCommand, signal?: AbortSignal, fresh = false): Promise<CliStatus> => {
  const hit = catalog.get(command);

  if (!fresh && hit !== undefined && Date.now() - hit.at < FRESH_MS) return hit.status;

  const user = signal ?? new AbortController().signal;
  const node = await loadNode();

  if (node === null) {
    const status = absent(command);

    catalog.set(command, { at: Date.now(), status });

    return status;
  }

  const result = await probe(node, command, user);

  if (!result.skipCache) catalog.set(command, { at: Date.now(), status: result.status });

  return result.status;
};

const pump = async (stream: AsyncIterable<Uint8Array | string>, onChunk: (text: string) => void): Promise<void> => {
  const decoder = new TextDecoder();

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });

    if (text !== '') onChunk(text);
  }

  const rest = decoder.decode();

  if (rest !== '') onChunk(rest);
};

const streamLogin = (
  node: NodeIo,
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  onOutput: (chunk: string) => void,
): Promise<void> => new Promise((resolve) => {
  const child = node.spawn(command, args, { signal, stdio: ['pipe', 'pipe', 'pipe'] });
  const state = { settled: false };
  const finish = (): void => {
    if (state.settled) return;
    state.settled = true;
    resolve();
  };
  const emit = (chunk: string): void => {
    try {
      onOutput(chunk);
    } catch {
      // A listener must not keep the login process open.
    }
  };

  const stdout = child.stdout;
  const stderr = child.stderr;
  const drained = Promise.all([
    stdout === null ? Promise.resolve() : pump(stdout, emit),
    stderr === null ? Promise.resolve() : pump(stderr, emit),
  ]);

  if (child.stdin !== null) child.stdin.end();

  child.once('error', () => {
    void drained.then(finish, finish);
  });
  child.once('close', () => {
    void drained.then(finish, finish);
  });
});

/**
 * Start `codex login --device-auth` or `claude auth login`. Output is only
 * handed to `onOutput`. It is not stored.
 */
export const startCliLogin = (
  command: CliCommand,
  onOutput: (chunk: string) => void,
): { done: Promise<void>; stop: () => void } => {
  const controller = new AbortController();
  const args = command === 'codex' ? ['login', '--device-auth'] : ['auth', 'login'];
  const done = loadNode().then((node) => {
    if (node === null || controller.signal.aborted) return undefined;

    return streamLogin(node, command, args, controller.signal, onOutput);
  }).then(() => undefined, () => undefined);

  return { done, stop: () => controller.abort() };
};

const blockLine = (block: AgentModelContentBlock): string => {
  if (block.type === 'text' && typeof block.text === 'string') return block.text;
  if (block.type === 'tool_use' && typeof block.name === 'string') {
    return JSON.stringify({ type: 'tool_use', name: block.name, input: 'input' in block ? block.input : {} });
  }
  if (block.type === 'tool_result' && typeof block.content === 'string') {
    const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';

    return `tool_result ${id}: ${block.content}`;
  }

  return '';
};

const bodyOf = (content: AgentModelMessage['content']): string => (
  typeof content === 'string' ? content : content.map(blockLine).filter((line) => line !== '').join('\n')
);

const promptFor = (request: AgentModelRequest): string => {
  const names = [...new Set<string>([...EDITOR_TOOLS, ...request.tools.map((tool: AgentModelTool) => tool.name)])];
  const transcript = request.messages.map((message) => `${message.role}:\n${bodyOf(message.content)}`);

  return [
    request.system,
    '',
    `Tools: ${names.join(', ')}.`,
    'Do not run these tools. To ask the editor to run one, reply with only {"type":"tool_use","name":"TOOL","input":{}}.',
    'TOOL is one of the tool names. Otherwise reply with plain text.',
    '',
    ...transcript,
  ].join('\n');
};

const objectSlices = (text: string): string[] => {
  const slices: string[] = [];
  const state = { i: 0, depth: 0, quote: false, escape: false };
  const consume = (char: string): void => {
    if (state.quote) {
      if (state.escape) {
        state.escape = false;

        return;
      }
      if (char === '\\') {
        state.escape = true;

        return;
      }
      if (char === '"') state.quote = false;

      return;
    }
    if (char === '"') {
      state.quote = true;

      return;
    }
    if (char === '{') state.depth += 1;
    if (char === '}') state.depth -= 1;
  };
  const take = (): number | null => {
    state.depth = 0;
    state.quote = false;
    state.escape = false;

    while (state.i < text.length) {
      const char = text[state.i] ?? '';

      state.i += 1;
      consume(char);
      if (state.depth === 0 && !state.quote) return state.i;
    }

    return null;
  };

  while (state.i < text.length) {
    if (text[state.i] !== '{') {
      state.i += 1;
      continue;
    }

    const start = state.i;
    const end = take();

    if (end === null) {
      state.i = start + 1;
      continue;
    }

    slices.push(text.slice(start, end));
    state.i = end;
  }

  return slices;
};

interface ToolCall {
  id?: string;
  name: string;
  input: unknown;
}

const asToolCall = (value: unknown, allowed: ReadonlySet<string>): ToolCall | null => {
  if (!isRecord(value)) return null;

  const record = isRecord(value.tool_use) ? value.tool_use : value;
  const name = typeof record.name === 'string' ? record.name : '';

  if (!allowed.has(name)) return null;

  const hasPayload = 'input' in record || 'arguments' in record;

  if (record.type !== 'tool_use' && record.type !== 'function' && !hasPayload) return null;

  const raw = 'input' in record ? record.input : record.arguments;
  const input = typeof raw === 'string' ? parseJson(raw) ?? {} : raw ?? {};
  const id = typeof record.id === 'string' ? record.id : undefined;

  return id === undefined ? { name, input } : { name, input, id };
};

const callsIn = (text: string, allowed: ReadonlySet<string>): ToolCall[] => {
  const seen = new Set<string>();

  return objectSlices(text).flatMap((slice) => {
    const call = asToolCall(parseJson(slice), allowed);

    if (call === null) return [];

    const key = `${call.name}:${JSON.stringify(call.input)}`;

    if (seen.has(key)) return [];

    seen.add(key);

    return [call];
  });
};

const stripCalls = (text: string, allowed: ReadonlySet<string>): string => {
  const slices = objectSlices(text).filter((slice) => asToolCall(parseJson(slice), allowed) !== null);

  return slices.reduce((rest, slice) => rest.split(slice).join(''), text).trim();
};

const responseFrom = (text: string, tools: readonly AgentModelTool[]): AgentModelResponse => {
  const allowed = new Set<string>([...EDITOR_TOOLS, ...tools.map((tool) => tool.name)]);
  const calls = callsIn(text, allowed);
  const prose = stripCalls(text, allowed);
  const textBlocks: AgentModelContentBlock[] = prose === '' ? [] : [{ type: 'text', text: prose }];
  const uses: AgentModelContentBlock[] = calls.map((call, index) => ({
    type: 'tool_use',
    id: call.id ?? `toolu_${index}_${crypto.randomUUID()}`,
    name: call.name,
    input: call.input,
  }));
  const content = [...textBlocks, ...uses];

  return {
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    stop_reason: uses.length > 0 ? 'tool_use' : 'end_turn',
  };
};

const claudeResult = (stdout: string): string => {
  const direct = parseJson(stdout.trim());

  if (isRecord(direct) && typeof direct.result === 'string') return direct.result;

  const nested = objectSlices(stdout).map((slice) => parseJson(slice)).find((value) => isRecord(value) && typeof value.result === 'string');

  return isRecord(nested) && typeof nested.result === 'string' ? nested.result : stdout;
};

const execArgs = (command: CliCommand, dir: string, outputFile: string): readonly string[] => (
  command === 'codex'
    ? ['exec', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '-C', dir, '--output-last-message', outputFile, '-']
    : ['--print', '--tools', '', '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'json']
);

const replyText = async (node: NodeIo, command: CliCommand, captured: Captured, outputFile: string | null): Promise<string> => {
  if (command === 'claude') return claudeResult(captured.stdout);
  if (outputFile === null) return captured.stdout;

  const file = await node.readFile(outputFile, 'utf8').catch(() => '');

  return file.trim() !== '' ? file : captured.stdout;
};

/**
 * One model call through the logged-in `claude` or `codex` binary.
 * The prompt is stdin. A missing binary or a non-zero exit is a short text reply.
 * `request.signal` aborts the process. Tool calls in the reply are returned, not run.
 */
export const createCliAgentModel = ({ command }: { command: CliCommand }): AgentModel => async (request) => {
  throwIfAborted(request.signal);

  const node = await loadNode();

  if (node === null) return unavailable(command);

  const dir = command === 'codex' ? await node.mkdtemp(node.join(node.tmpdir(), 'blok-agent-')).catch(() => null) : null;

  if (command === 'codex' && dir === null) return unavailable(command);

  const outputFile = dir === null ? null : node.join(dir, 'last-message.txt');

  try {
    const captured = await runLimited(node, command, execArgs(command, dir ?? '', outputFile ?? ''), request.signal, promptFor(request), MODEL_MS);

    throwIfAborted(request.signal);
    if (captured.missing || captured.timedOut || captured.code !== 0) return unavailable(command);

    return responseFrom(await replyText(node, command, captured, outputFile), request.tools);
  } catch (error) {
    if (request.signal.aborted || isAbort(error)) throw abortError(request.signal, error);

    return unavailable(command);
  } finally {
    if (dir !== null) await node.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};
