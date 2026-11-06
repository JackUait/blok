import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { expect } from 'vitest';

import { type BearerSpec, type FakeHost, type RouteTable, signAccessToken, startFakeHost } from './fake-host';
import {
  caseEnv, type HttpAnswer, type HttpServer, type JsonMessage, runToExit, sendHttp, startHttp, startStdio, type StdioServer,
} from './mcp-process';

/**
 * The fixture format. Every fixture file is `{ "description", "defaults"?, "cases": [Case] }`;
 * `defaults` is merged under each case (shallow, per key).
 *
 * Case:
 *   name        unique in the file.
 *   transport   "stdio" | "http" | "cli".
 *               stdio: spawn, run the steps over stdin/stdout, then close stdin
 *                      and record the exit (`expectExit`).
 *               http:  the argv must carry `--http 127.0.0.1:0`; the URL comes from
 *                      the `listening on <url>` stderr line. Steps POST to it.
 *               cli:   spawn with stdin closed, no steps, record the exit.
 *   argv, env   flags and env vars, with ${placeholders}. The binary sees no
 *               other BLOK_* variable.
 *   files       written under ${dir} before spawning: {"<name>": {"json": v} |
 *               {"text": s} | {"link": "<target name>"}}, plus "mtimeAgoSeconds". json is
 *               written compact.
 *   hosts       a route table for the fake host (fake-host.ts) at ${host}, plus
 *               "$upgradeStatus" for the sync upgrade it refuses.
 *   session     {"protocolVersion", "capabilities"?, "clientName"?, "headers"?}: the
 *               harness opens the session the way the SDK client does.
 *               2025 versions: initialize + notifications/initialized first, and
 *               HTTP requests then carry MCP-Protocol-Version.
 *               2026-07-28: no handshake; every request gets params._meta
 *               (protocolVersion, clientInfo, clientCapabilities) and, over HTTP,
 *               the Mcp-Method / Mcp-Name / MCP-Protocol-Version headers.
 *               A step with "raw": true gets none of this.
 *   steps       see Step.
 *   watchFiles  names under ${dir} whose exact bytes are recorded as expectFiles.
 *   stderrPattern  a regular expression the failed process's stderr must match,
 *               recorded instead of the exact text.
 *   fsVariants  true when the answer depends on whether the temp disk ignores letter
 *               case. Expectations then live in "variants": {"caseInsensitiveFs": …,
 *               "caseSensitiveFs": …}, each recorded on such a disk (set TMPDIR).
 *   expect*     recorded by --update from Node; never hand-written.
 *
 * Step (one of send / notify / http):
 *   send        a JSON-RPC request; "id" is filled in when left out. The answer
 *               is the message with the same id.
 *   notify      a JSON-RPC notification; no answer is read (HTTP records the status).
 *   http        a raw request {method, path, headers, body | bodyText | bodyRepeat}.
 *   headers     extra HTTP headers for send/notify; null removes a default.
 *   serverRequests  stdio only: server-to-client requests expected while the
 *               answer is pending, in order, each with the "reply" to send back.
 *   capture     {"name": "/json/pointer"}, {"name": {"keyOf": "/pointer"}} (the first key
 *               there) or {"name": {"pointer", "optional": true}} (no error when absent):
 *               a string from the answer, usable as ${name} later. A captured value
 *               is recorded as its placeholder, so random handles compare equal.
 *   mask        pointers into the answer whose values vary run to run.
 *   expectSavedVersion  {"file", "pointer"}: the answer's value there must be the
 *               SHA-256 hex of that file's bytes. Checked on every run.
 *
 * Answers are compared as parsed JSON (key order ignored, array order kept).
 * A text content item that holds JSON is parsed into {"type":"text","json":…} and
 * must equal structuredContent. Placeholders: ${dir}, ${host}, ${mcpUrl},
 * ${mcpPort}, ${version} (packages/mcp/package.json) and captured names.
 * Inputs may use {"$bearer": BearerSpec} for an OAuth access token and
 * {"$repeat": {"text", "count"}} for a long string.
 */

export interface FileSpec { json?: unknown; text?: string; link?: string; mtimeAgoSeconds?: number }

export interface ServerRequestSpec { expect?: unknown; reply: Record<string, unknown> }

export interface Step {
  note?: string;
  send?: JsonMessage;
  notify?: JsonMessage;
  http?: { method: string; path: string; headers?: Record<string, unknown>; body?: unknown; bodyText?: string; bodyRepeat?: { text: string; count: number } };
  raw?: boolean;
  headers?: Record<string, unknown>;
  serverRequests?: ServerRequestSpec[];
  capture?: Record<string, CaptureSource>;
  mask?: string[];
  expectSavedVersion?: { file: string; pointer: string };
  expect?: unknown;
  expectHttp?: unknown;
  notifications?: unknown[];
}

export type CaptureSource = string | { keyOf: string } | { pointer: string; optional: true };

export interface Session {
  protocolVersion: string;
  capabilities?: Record<string, unknown>;
  clientName?: string;
  headers?: Record<string, unknown>;
}

export interface FixtureCase {
  name: string;
  transport: 'stdio' | 'http' | 'cli';
  argv?: string[];
  env?: Record<string, string>;
  files?: Record<string, FileSpec>;
  hosts?: RouteTable & { $upgradeStatus?: number };
  session?: Session;
  steps?: Step[];
  watchFiles?: string[];
  fsVariants?: boolean;
  stderrPattern?: string;
  variants?: Record<string, Partial<FixtureCase>>;
  expectExit?: unknown;
  expectFiles?: Record<string, FileSpec | null>;
  expectHostRequests?: unknown;
}

export interface FixtureFile { description?: string; defaults?: Partial<FixtureCase>; cases: FixtureCase[] }

const MODERN = '2026-07-28';
const RECORDED_RESPONSE_HEADERS = ['allow', 'www-authenticate', 'mcp-session-id', 'access-control-allow-origin'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const packageVersion = (): string => {
  const pkg: unknown = JSON.parse(readFileSync(resolve(__dirname, '../../../packages/mcp/package.json'), 'utf8'));

  if (!isRecord(pkg) || typeof pkg.version !== 'string') {
    throw new Error('packages/mcp/package.json has no version');
  }

  return pkg.version;
};

type Vars = Map<string, string>;

const substituteString = (text: string, vars: Vars): string =>
  text.replace(/\$\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name: string) => vars.get(name) ?? whole);

/** Fills ${placeholders}, $bearer and $repeat in a case input. */
const materialize = (value: unknown, vars: Vars): unknown => {
  if (typeof value === 'string') {
    return substituteString(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => materialize(item, vars));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (isRecord(value.$bearer)) {
    const spec: unknown = materialize(value.$bearer, vars);

    return `Bearer ${signAccessToken(spec as BearerSpec)}`;
  }
  if (isRecord(value.$repeat)) {
    return String(value.$repeat.text).repeat(Number(value.$repeat.count));
  }

  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, materialize(inner, vars)]));
};

/** Turns run-specific values back into placeholders before an answer is recorded. */
const placeholdersFor = (value: unknown, vars: Vars): unknown => {
  const known = [...vars.entries()].sort((a, b) => b[1].length - a[1].length);
  const walk = (inner: unknown): unknown => {
    if (typeof inner === 'string') {
      const exact = known.find(([, v]) => v === inner);

      if (exact !== undefined) {
        return `\${${exact[0]}}`;
      }

      return known.reduce((text, [name, v]) => (v.length >= 8 ? text.split(v).join(`\${${name}}`) : text), inner);
    }
    if (Array.isArray(inner)) {
      return inner.map(walk);
    }
    if (isRecord(inner)) {
      return Object.fromEntries(Object.entries(inner).map(([key, v]) => [key, walk(v)]));
    }

    return inner;
  };

  return walk(value);
};

const expected = (value: unknown, vars: Vars): unknown => materialize(value, vars);

const pointerParts = (pointer: string): string[] =>
  pointer === '' ? [] : pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));

const at = (value: unknown, pointer: string): unknown => pointerParts(pointer).reduce<unknown>((node, part) => {
  if (Array.isArray(node)) {
    return node[Number(part)];
  }

  return isRecord(node) ? node[part] : undefined;
}, value);

const maskAt = (value: unknown, pointer: string): void => {
  const parts = pointerParts(pointer);
  const parent = at(value, `/${parts.slice(0, -1).join('/')}`.replace(/^\/$/, ''));
  const last = parts.at(-1);

  if (last !== undefined && (isRecord(parent) || Array.isArray(parent)) && last in parent) {
    (parent as Record<string, unknown>)[last] = '<masked>';
  }
};

/**
 * Parses JSON text content so ports are free in key order and escaping, and
 * checks that text and structuredContent say the same thing.
 */
const normalize = (value: unknown, label: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item, label));
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, normalize(inner, label)]));

  if (Array.isArray(out.content)) {
    out.content = out.content.map((item: unknown) => {
      if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') {
        return item;
      }
      try {
        const parsed: unknown = JSON.parse(item.text);

        if (!isRecord(parsed) && !Array.isArray(parsed)) {
          return item;
        }
        const { text: _text, ...rest } = item;

        return { ...rest, json: parsed };
      } catch {
        return item;
      }
    });
    const json = out.content.find((item: unknown): item is { json: unknown } => isRecord(item) && 'json' in item)?.json;

    if (json !== undefined && 'structuredContent' in out) {
      expect(json, `${label}: the text content differs from structuredContent`).toEqual(out.structuredContent);
    }
  }

  return out;
};

const captured = (answer: unknown, source: CaptureSource): unknown => {
  if (typeof source === 'string') {
    return at(answer, source);
  }
  if ('pointer' in source) {
    return at(answer, source.pointer);
  }
  const container = at(answer, source.keyOf);

  return Object.keys(isRecord(container) ? container : {})[0];
};

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const parseHttpMessages = (answer: HttpAnswer): JsonMessage[] => {
  const type = (answer.headers['content-type'] ?? '').split(';')[0].trim();

  if (type === 'application/json' && answer.body !== '') {
    const parsed: unknown = JSON.parse(answer.body);

    return (Array.isArray(parsed) ? parsed : [parsed]).filter(isRecord);
  }
  if (type === 'text/event-stream') {
    return answer.body.split(/\r?\n\r?\n/).flatMap((event) => {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');

      if (data === '') {
        return [];
      }
      const parsed: unknown = JSON.parse(data);

      return isRecord(parsed) ? [parsed] : [];
    });
  }

  return [];
};

const httpSummary = (answer: HttpAnswer): Record<string, unknown> => ({
  status: answer.status,
  contentType: answer.headers['content-type'] === undefined ? null : answer.headers['content-type'].split(';')[0].trim(),
  headers: Object.fromEntries(RECORDED_RESPONSE_HEADERS.map((name) => [name, answer.headers[name] ?? null])),
});

const httpBody = (answer: HttpAnswer): unknown => {
  if (answer.body === '') {
    return null;
  }
  try {
    return { json: JSON.parse(answer.body) };
  } catch {
    return { text: answer.body };
  }
};

const writeFiles = (dir: string, files: Record<string, FileSpec>, vars: Vars): void => {
  for (const [name, spec] of Object.entries(files)) {
    const path = join(dir, name);

    mkdirSync(dirname(path), { recursive: true });
    if (spec.link !== undefined) {
      symlinkSync(spec.link, path);
    } else if (spec.text !== undefined) {
      writeFileSync(path, spec.text);
    } else {
      writeFileSync(path, JSON.stringify(materialize(spec.json, vars)));
    }
    if (spec.mtimeAgoSeconds !== undefined) {
      const when = new Date(Date.now() - spec.mtimeAgoSeconds * 1000);

      utimesSync(path, when, when);
    }
  }
};

const withMeta = (message: JsonMessage, session: Session | undefined, raw: boolean): JsonMessage => {
  if (raw || session?.protocolVersion !== MODERN) {
    return message;
  }
  const params = isRecord(message.params) ? message.params : {};
  const meta = isRecord(params._meta) ? params._meta : {};

  return {
    ...message,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN,
        'io.modelcontextprotocol/clientInfo': { name: session.clientName ?? 'conformance', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': session.capabilities ?? {},
        ...meta,
      },
    },
  };
};

const BASE_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

const sessionHeaders = (session: Session | undefined, message: JsonMessage, raw: boolean): Record<string, string> => {
  if (raw || session === undefined) {
    return { ...BASE_HEADERS };
  }
  const name = isRecord(message.params) ? message.params.name : undefined;
  const named = typeof name === 'string' && (message.method === 'tools/call' || message.method === 'prompts/get');
  const modern = session.protocolVersion === MODERN && typeof message.method === 'string';

  return {
    ...BASE_HEADERS,
    'mcp-protocol-version': session.protocolVersion,
    ...(modern && { 'mcp-method': String(message.method) }),
    ...(modern && named && { 'mcp-name': name }),
  };
};

/** Lowercases names; a null value removes that header. */
const mergeHeaders = (base: Record<string, string>, extra: unknown, vars: Vars): Record<string, string> => {
  const filled = isRecord(extra) ? materialize(extra, vars) : {};
  const entries = Object.entries(isRecord(filled) ? filled : {}).map(([name, value]) => [name.toLowerCase(), value] as const);
  const removed = new Set(entries.filter(([, value]) => value === null).map(([name]) => name));

  const kept: Array<[string, string]> = Object.entries(base).filter(([name]) => !removed.has(name));
  const added: Array<[string, string]> = entries.flatMap(([name, value]): Array<[string, string]> =>
    (value === null ? [] : [[name, typeof value === 'string' ? value : JSON.stringify(value)]]));

  return Object.fromEntries([...kept, ...added]);
};

const requestBody = (spec: NonNullable<Step['http']>): Buffer | undefined => {
  if (spec.bodyRepeat !== undefined) {
    return Buffer.from(spec.bodyRepeat.text.repeat(spec.bodyRepeat.count));
  }
  if (spec.bodyText !== undefined) {
    return Buffer.from(spec.bodyText);
  }

  return spec.body === undefined ? undefined : Buffer.from(JSON.stringify(spec.body));
};

/**
 * stderr is part of the contract only when the process failed. `pattern` stands in
 * for text a port cannot match byte for byte (a JSON parser's own message).
 */
const exitRecord = (code: number | null, signal: string | null, stderr: string, pattern?: string): Record<string, unknown> => {
  if (code === 0) {
    return { code };
  }
  if (pattern === undefined) {
    return { code, signal, stderr };
  }
  expect(stderr, 'stderr').toMatch(new RegExp(pattern));

  return { code, signal, stderr: { pattern } };
};

const readFileSpec = (path: string): FileSpec | null => (existsSync(path) ? { text: readFileSync(path, 'utf8') } : null);

type Holder = Record<string, unknown>;

/** One case against one binary: checks each answer, or records it under --update. */
class CaseRun {
  public readonly vars: Vars;
  public readonly recorded: FixtureCase;
  private nextId = 1;

  public constructor(
    private readonly c: FixtureCase,
    private readonly record: boolean,
    public readonly dir: string,
    root: string
  ) {
    this.vars = new Map([['dir', dir], ['root', root], ['version', packageVersion()]]);
    this.recorded = structuredClone(c);
  }

  public stepHolder(index: number): Holder {
    const steps = this.recorded.steps ?? [];

    return steps[index] as unknown as Holder;
  }

  public check(holder: Holder, key: string, actual: unknown, label: string): void {
    if (this.record) {
      Reflect.set(holder, key, placeholdersFor(actual, this.vars));

      return;
    }
    if (!(key in holder)) {
      throw new Error(`${label}: no recorded "${key}". Run the suite with --target node --update.`);
    }
    expect(actual, label).toEqual(expected(holder[key], this.vars));
  }

  public checkCase(key: string, actual: unknown, label: string): void {
    this.check(this.recorded as unknown as Holder, key, actual, label);
  }

  private finishStep(step: Step, holder: Holder, answer: unknown, label: string): void {
    const masked = structuredClone(answer);

    (step.mask ?? []).forEach((pointer) => maskAt(masked, pointer));
    for (const [name, source] of Object.entries(step.capture ?? {})) {
      const value = captured(answer, source);

      if (typeof source !== 'string' && 'optional' in source && value === undefined) {
        continue;
      }
      if (typeof value !== 'string') {
        throw new Error(`${label}: capture ${name} found no string in ${JSON.stringify(answer)}`);
      }
      this.vars.set(name, value);
    }
    if (step.expectSavedVersion !== undefined) {
      const bytes = readFileSync(join(this.dir, step.expectSavedVersion.file));

      expect(at(answer, step.expectSavedVersion.pointer), `${label}: the saved version is not the SHA-256 of the file`).toBe(sha256(bytes));
    }
    this.check(holder, 'expect', masked, label);
  }

  private replyToServer(server: StdioServer, incoming: JsonMessage, spec: ServerRequestSpec | undefined, label: string): ServerRequestSpec {
    if (spec === undefined) {
      throw new Error(`${label}: unexpected server request ${JSON.stringify(incoming)}`);
    }
    const copy: ServerRequestSpec = { ...spec };

    this.check(copy as unknown as Holder, 'expect', normalize({ ...incoming, id: '<server>' }, label), `${label} server request`);
    server.send({ jsonrpc: '2.0', id: incoming.id, ...materialize(spec.reply, this.vars) as JsonMessage });

    return copy;
  }

  public async stdioStep(server: StdioServer, step: Step, holder: Holder, label: string): Promise<void> {
    const raw = step.raw === true;

    if (step.notify !== undefined) {
      server.send(withMeta({ jsonrpc: '2.0', ...materialize(step.notify, this.vars) as JsonMessage }, this.c.session, raw));

      return;
    }
    const message = materialize(step.send, this.vars) as JsonMessage;
    const id = message.id ?? this.nextId++;
    const wanted = step.serverRequests ?? [];
    const seen: ServerRequestSpec[] = [];
    const notifications: unknown[] = [];

    server.send(withMeta({ jsonrpc: '2.0', ...message, id }, this.c.session, raw));
    let incoming = await server.next();

    while (!(incoming.id === id && ('result' in incoming || 'error' in incoming))) {
      if (typeof incoming.method === 'string' && incoming.id !== undefined) {
        seen.push(this.replyToServer(server, incoming, wanted[seen.length], label));
      } else {
        notifications.push(normalize(incoming, label));
      }
      incoming = await server.next();
    }
    expect(seen.length, `${label}: server requests`).toBe(wanted.length);
    if (wanted.length > 0) {
      Reflect.set(holder, 'serverRequests', seen);
    }
    if (notifications.length > 0 || 'notifications' in step) {
      this.check(holder, 'notifications', notifications, `${label} notifications`);
    }
    this.finishStep(step, holder, normalize(incoming, label), label);
  }

  public async httpStep(server: HttpServer, step: Step, holder: Holder, label: string): Promise<void> {
    if (step.http !== undefined) {
      const spec = materialize(step.http, this.vars) as NonNullable<Step['http']>;
      const answer = await sendHttp(server.url, { method: spec.method, path: spec.path, headers: mergeHeaders({}, spec.headers, this.vars), body: requestBody(spec) });

      this.check(holder, 'expectHttp', httpSummary(answer), `${label} http`);
      this.finishStep(step, holder, normalize(httpBody(answer), label), label);

      return;
    }
    const raw = step.raw === true;
    const isNotify = step.notify !== undefined;
    const base = materialize(isNotify ? step.notify : step.send, this.vars) as JsonMessage;
    const id = isNotify ? undefined : base.id ?? this.nextId++;
    const message = withMeta({ jsonrpc: '2.0', ...base, ...(id !== undefined && { id }) }, this.c.session, raw);
    const headers = mergeHeaders(mergeHeaders(sessionHeaders(this.c.session, message, raw), this.c.session?.headers, this.vars), step.headers, this.vars);
    const answer = await sendHttp(server.url, { method: 'POST', path: new URL(server.url).pathname, headers, body: Buffer.from(JSON.stringify(message)) });

    this.check(holder, 'expectHttp', httpSummary(answer), `${label} http`);
    if (isNotify) {
      return;
    }
    const messages = parseHttpMessages(answer);
    const reply = messages.find((m) => m.id === id) ?? (messages.length === 1 ? messages[0] : undefined);

    this.finishStep(step, holder, reply === undefined ? null : normalize(reply, label), label);
  }

  /** The SDK client's opening exchange for a 2025 session; 2026 has none. */
  public async handshake(send: (message: JsonMessage) => Promise<JsonMessage | undefined>): Promise<void> {
    const session = this.c.session;

    if (session === undefined || session.protocolVersion === MODERN) {
      return;
    }
    const answer = await send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: session.protocolVersion, capabilities: session.capabilities ?? {}, clientInfo: { name: session.clientName ?? 'conformance', version: '1' } },
    });

    if (answer === undefined || !isRecord(answer.result)) {
      throw new Error(`initialize failed: ${JSON.stringify(answer)}`);
    }
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }
}

const withHost = async (c: FixtureCase, run: CaseRun, body: () => Promise<void>): Promise<void> => {
  if (c.hosts === undefined) {
    await body();

    return;
  }
  const { $upgradeStatus, ...routes } = c.hosts;
  const host: FakeHost = await startFakeHost(routes, { secret: c.env?.BLOK_SECRET, upgradeStatus: $upgradeStatus });

  run.vars.set('host', host.url);
  try {
    await body();
    run.checkCase('expectHostRequests', host.requests, `${c.name} host requests`);
  } finally {
    await host.close();
  }
};

const runStdio = async (run: CaseRun, c: FixtureCase, launch: Launch): Promise<void> => {
  const server = startStdio(launch.command, launch.argv, launch.env, launch.cwd);

  try {
    await run.handshake(async (message) => {
      server.send(message);

      return message.id === undefined ? undefined : server.next();
    });
    for (const [index, step] of (c.steps ?? []).entries()) {
      await run.stdioStep(server, step, run.stepHolder(index), `${c.name} step ${index}`);
    }
    const exit = await server.closeInput();

    run.checkCase('expectExit', exitRecord(exit.code, exit.signal, server.stderr, c.stderrPattern), `${c.name} exit`);
  } finally {
    await server.kill();
  }
};

const runHttp = async (run: CaseRun, c: FixtureCase, launch: Launch): Promise<void> => {
  const server = await startHttp(launch.command, launch.argv, launch.env, launch.cwd);

  run.vars.set('mcpUrl', server.url);
  run.vars.set('mcpPort', server.port);
  try {
    await run.handshake(async (message) => {
      const headers = message.id === undefined ? sessionHeaders(c.session, message, false) : { ...BASE_HEADERS };
      const answer = await sendHttp(server.url, {
        method: 'POST',
        path: new URL(server.url).pathname,
        headers: mergeHeaders(headers, c.session?.headers, run.vars),
        body: Buffer.from(JSON.stringify(message)),
      });

      return parseHttpMessages(answer)[0];
    });
    for (const [index, step] of (c.steps ?? []).entries()) {
      await run.httpStep(server, step, run.stepHolder(index), `${c.name} step ${index}`);
    }
  } finally {
    await server.stop();
  }
};

interface Launch { command: string[]; argv: string[]; env: NodeJS.ProcessEnv; cwd: string }

/**
 * Runs one case against the binary. In record mode it returns the case with
 * every expectation filled from what the binary answered; otherwise it checks.
 */
export const runCase = async (command: string[], c: FixtureCase, record: boolean): Promise<FixtureCase> => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'blok-mcp-case-')));
  const dir = join(root, 'docs');
  const run = new CaseRun(c, record, dir, root);

  mkdirSync(dir);
  try {
    await withHost(c, run, async () => {
      writeFiles(dir, c.files ?? {}, run.vars);
      const launch: Launch = {
        command,
        argv: (c.argv ?? []).map((arg) => substituteString(arg, run.vars)),
        env: caseEnv(Object.fromEntries(Object.entries(c.env ?? {}).map(([key, value]) => [key, substituteString(value, run.vars)]))),
        cwd: root,
      };

      if (c.transport === 'cli') {
        const exit = await runToExit(command, launch.argv, launch.env, root);

        run.checkCase('expectExit', exitRecord(exit.code, exit.signal, exit.stderr, c.stderrPattern), `${c.name} exit`);
      } else if (c.transport === 'stdio') {
        await runStdio(run, c, launch);
      } else {
        await runHttp(run, c, launch);
      }
      if (c.watchFiles !== undefined) {
        run.checkCase('expectFiles', Object.fromEntries(c.watchFiles.map((name) => [name, readFileSpec(join(dir, name))])), `${c.name} files`);
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  return run.recorded;
};
