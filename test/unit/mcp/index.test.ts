// @vitest-environment node
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { setImmediate as dispatchCheckpoint } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpConfigError } from '../../../src/mcp/config';
import { createBlokMcpServer, runCli } from '../../../src/mcp/index';
import * as assembly from '../../../src/mcp/server';

import type * as FsModule from 'node:fs/promises';
import type * as StdioModule from '@modelcontextprotocol/server/stdio';

import type { AssembledMcp } from '../../../src/mcp/server';
import type { HandleSession } from '../../../src/mcp/session';
import type { BlokCustomToolsFile, ManifestOverrides } from '../../../types/tool-manifest';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof FsModule>();

  return { ...original, readFile: vi.fn<typeof original.readFile>(original.readFile) };
});

vi.mock('@modelcontextprotocol/server/stdio', async importOriginal => {
  const original = await importOriginal<typeof StdioModule>();

  return { ...original, serveStdio: vi.fn<typeof original.serveStdio>() };
});

const DEADLINE_MS = 5_000;
const REQUEST = { timeout: DEADLINE_MS, maxTotalTimeout: DEADLINE_MS };
const owned: AssembledMcp[] = [];
const assembleOriginal = assembly.assembleMcp;
let signalsBefore = {
  SIGINT: process.rawListeners('SIGINT'),
  SIGTERM: process.rawListeners('SIGTERM'),
};
let stdinEndBefore = process.stdin.rawListeners('end');

class CliExit extends Error {
  constructor(public readonly code: number | string | null | undefined) {
    super('CLI requested exit');
  }
}

const within = async <T>(work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Entrypoint fixture deadline exceeded')), DEADLINE_MS);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

const barrier = () => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });

  if (release === undefined) {
    throw new Error('Barrier was not initialized');
  }

  return { wait, release };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.readFile).mockReset();
  signalsBefore = {
    SIGINT: process.rawListeners('SIGINT'),
    SIGTERM: process.rawListeners('SIGTERM'),
  };
  stdinEndBefore = process.stdin.rawListeners('end');
  vi.mocked(serveStdio).mockReturnValue({ close: vi.fn(async () => undefined) });
  vi.spyOn(assembly, 'assembleMcp').mockImplementation((options, dependencies) => {
    const assembled = assembleOriginal(options, dependencies);

    vi.spyOn(assembled, 'dispatch');
    owned.push(assembled);

    return assembled;
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new CliExit(code);
  });
});

afterEach(async () => {
  try {
    const stopped = await within(Promise.allSettled(owned.splice(0).map(server => server.stop())));

    expect(stopped.every(result => result.status === 'fulfilled')).toBe(true);
  } finally {
    const restoreSignalListeners = (event: string): void => {
      const original = event === 'SIGINT' ? signalsBefore.SIGINT : signalsBefore.SIGTERM;

      for (const listener of process.rawListeners(event)) {
        if (!original.includes(listener)) {
          process.removeListener(event, listener);
        }
      }
    };
    const restoreStdinListeners = (): void => {
      for (const listener of process.stdin.rawListeners('end')) {
        if (!stdinEndBefore.includes(listener)) {
          process.stdin.removeListener('end', listener);
        }
      }
    };

    for (const event of ['SIGINT', 'SIGTERM']) {
      restoreSignalListeners(event);
    }
    restoreStdinListeners();
    vi.restoreAllMocks();
  }
});

describe('createBlokMcpServer', () => {
  it('refuses an unsafe public configuration before assembling resources', () => {
    expect(() => createBlokMcpServer({
      transport: { kind: 'http', listen: '0.0.0.0:0' },
      auth: { kind: 'none' },
    })).toThrow(McpConfigError);
    expect(assembly.assembleMcp).not.toHaveBeenCalled();
    expect(serveStdio).not.toHaveBeenCalled();
  });

  it('serves loopback HTTP, names its URL on stderr, and stops listening on stop', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = createBlokMcpServer({
      transport: { kind: 'http', listen: '127.0.0.1:0' },
      auth: { kind: 'none' },
      authorize: async () => true,
    });

    try {
      await within(server.start());
      const line = stderr.mock.calls.map((call) => String(call[0])).find((text) => text.includes('listening on'));
      const url = line?.match(/http:\/\/\S+/)?.[0];

      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      const response = await within(fetch(url ?? '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'index-test', version: '0' } },
        }),
      }));

      expect(response.status).toBe(200);
      expect(serveStdio).not.toHaveBeenCalled();
      await within(server.stop());
      await expect(fetch(url ?? '')).rejects.toThrow();
    } finally {
      await within(server.stop());
    }
  });

  it('leaves Host to the proxy when --public, so a proxied request reaches the OAuth gate', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = createBlokMcpServer({
      transport: { kind: 'http', listen: '127.0.0.1:0', public: true },
      auth: { kind: 'oauth', issuer: 'https://id.test', audience: 'https://mcp.test', jwksUrl: 'https://id.test/jwks' },
      authorize: async () => true,
    });

    try {
      await within(server.start());
      const line = stderr.mock.calls.map((call) => String(call[0])).find((text) => text.includes('listening on'));
      const url = new URL(line?.match(/http:\/\/\S+/)?.[0] ?? '');
      const status = await within(new Promise<number | undefined>((resolve, reject) => {
        const client = httpRequest(url, { method: 'POST', headers: { Host: 'mcp.test' } }, (response) => {
          resolve(response.statusCode);
          response.resume();
        });

        client.on('error', reject);
        client.end();
      }));

      expect(status).toBe(401);
    } finally {
      await within(server.stop());
    }
  });

  it.each(['session', 'transport'])('waits for %s cleanup before stop resolves', async held => {
    const started = barrier();
    const release = barrier();
    const closeTransport = vi.fn(async () => {
      if (held === 'transport') {
        started.release();
        await release.wait;
      }
    });

    vi.mocked(serveStdio).mockReturnValue({ close: closeTransport });
    const server = createBlokMcpServer({ transport: { kind: 'stdio' }, auth: { kind: 'none' } });
    let stopping: Promise<void> | undefined;
    let stopped = false;

    try {
      await within(server.start());
      const assembled = owned[0];

      if (assembled === undefined) {
        throw new Error('Missing assembled server');
      }
      const closeSession = vi.fn<HandleSession['close']>(async () => {
        if (held === 'session') {
          started.release();
          await release.wait;
        }

        return { unsavedBatches: 0, hostRecordLags: false };
      });
      const handleSession: HandleSession = {
        mode: 'stored',
        write: true,
        durability: 'saved-on-execute',
        contractRevision: 'contract-r1',
        read: async () => { throw new Error('Unused read dependency'); },
        describe: () => { throw new Error('Unused describe dependency'); },
        execute: async () => { throw new Error('Unused execute dependency'); },
        close: closeSession,
      };

      assembled.handles.add('local', 'notes', handleSession);
      const stoppingWork = server.stop().then(() => { stopped = true; });

      stopping = stoppingWork;
      void stoppingWork.catch(() => undefined);
      await within(started.wait);
      await within(dispatchCheckpoint());
      expect(stopped).toBe(false);
      release.release();
      await within(stoppingWork);
      expect(closeSession).toHaveBeenCalledExactlyOnceWith('closed');
      expect(closeTransport).toHaveBeenCalledTimes(1);
      expect(assembled.handles.count('local')).toBe(0);
    } finally {
      release.release();
      if (stopping !== undefined) {
        await within(Promise.allSettled([stopping]));
      }
      await within(server.stop());
    }
  });
});

describe('runCli', () => {
  it('loads and validates the supplied JSON files before serving', async () => {
    const manifest: BlokCustomToolsFile = { formatVersion: 1, blocks: [] };
    const overrides: ManifestOverrides = { paragraph: { guidance: 'Keep paragraphs short.' } };
    const read = vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify(manifest))
      .mockResolvedValueOnce(JSON.stringify(overrides));

    await within(runCli([
      '--manifest', 'manifest.json',
      '--manifest-overrides', 'overrides.json',
      '--principal', 'host-user',
      '--schema', 'full',
    ], {}));

    expect(assembly.assembleMcp).toHaveBeenCalledWith(expect.objectContaining({
      manifest,
      overrides,
      principal: 'host-user',
      schema: 'full',
      transport: { kind: 'stdio' },
    }));
    expect(read).toHaveBeenNthCalledWith(1, 'manifest.json', 'utf-8');
    expect(read).toHaveBeenNthCalledWith(2, 'overrides.json', 'utf-8');
    expect(serveStdio).toHaveBeenCalledTimes(1);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('serves with the configured local principal and cleaned SDK client name', async () => {
    await within(runCli(['--principal', 'host-user'], {}));
    const invocation = vi.mocked(serveStdio).mock.calls[0];
    const assembled = owned[0];

    if (invocation === undefined || assembled === undefined) {
      throw new Error('Missing serving factory or assembly');
    }
    const server = await within(Promise.resolve(invocation[0]({ era: 'legacy' })));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'Entry/client', version: '1' });

    try {
      await within(server.connect(serverSide));
      await within(client.connect(clientSide, REQUEST));
      const result = await within(client.callTool({ name: 'blok_list_documents' }, REQUEST));

      expect(assembled.dispatch).toHaveBeenCalledExactlyOnceWith('blok_list_documents', {}, {
        principal: 'host-user',
        clientName: 'Entry-client',
        scopes: null,
      }, { signal: expect.any(AbortSignal) });
      expect(result.structuredContent).toEqual({ documents: [], nextCursor: null, supported: false });
    } finally {
      const closed = await within(Promise.allSettled([
        client.close(), server.close(), clientSide.close(), serverSide.close(),
      ]));

      expect(closed.every(result => result.status === 'fulfilled')).toBe(true);
    }
  });

  it('exits 2 with a blok-mcp message on malformed --rich-text-fields JSON', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(within(runCli(['--rich-text-fields', '{'], {}))).rejects.toMatchObject({ code: 2 });
    expect(stderr.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^blok-mcp: --rich-text-fields/)]);
    expect(assembly.assembleMcp).not.toHaveBeenCalled();
  });

  it('exits 2 when HTTP would serve a document source with no --authorize', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(within(runCli(['--http', '127.0.0.1:0', '--source', 'files:./docs'], {}))).rejects.toMatchObject({ code: 2 });
    expect(stderr.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^blok-mcp: HTTP needs a per-document check/)]);
    expect(assembly.assembleMcp).not.toHaveBeenCalled();
  });

  it('rejects an invalid manifest before assembling or serving', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ formatVersion: 2, blocks: [] }));

    await expect(within(runCli(['--manifest', 'invalid.json'], {}))).rejects.toMatchObject({ code: 2 });
    expect(assembly.assembleMcp).not.toHaveBeenCalled();
    expect(serveStdio).not.toHaveBeenCalled();
  });

  it.each([
    ['--manifest', 'missing-manifest.json'],
    ['--manifest-overrides', 'missing-overrides.json'],
  ])('exits 2 with a blok-mcp message when the %s file does not exist', async (name, path) => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missing = Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });

    vi.mocked(fs.readFile).mockRejectedValue(missing);
    await expect(within(runCli([name, path], {}))).rejects.toMatchObject({ code: 2 });
    expect(stderr.mock.calls.map((call) => String(call[0]))).toEqual([`blok-mcp: Cannot read "${path}": no such file`]);
    expect(assembly.assembleMcp).not.toHaveBeenCalled();
  });

  it('does not start after a JSON file read fails', async () => {
    const failure = new Error('fixture read failure');

    vi.mocked(fs.readFile).mockRejectedValue(failure);
    await expect(within(runCli(['--manifest', 'missing.json'], {}))).rejects.toBe(failure);
    expect(assembly.assembleMcp).not.toHaveBeenCalled();
    expect(serveStdio).not.toHaveBeenCalled();
  });
});

type ShutdownEvent = 'end' | 'SIGINT' | 'SIGTERM';

const makeShutdownSession = (close: HandleSession['close']): HandleSession => ({
  mode: 'stored',
  write: true,
  durability: 'saved-on-execute',
  contractRevision: 'contract-r1',
  read: async () => { throw new Error('Unused read dependency'); },
  describe: () => { throw new Error('Unused describe dependency'); },
  execute: async () => { throw new Error('Unused execute dependency'); },
  close,
});

const captureCliLifecycle = (onExit: () => void = () => undefined) => {
  const signals = new EventEmitter();
  const stdin = new EventEmitter();
  const unrelatedInt = (): void => undefined;
  const unrelatedTerm = (): void => undefined;
  const unrelatedEnd = (): void => undefined;
  const exited = barrier();
  const exitDescriptor = Object.getOwnPropertyDescriptor(process, 'exit');

  if (exitDescriptor === undefined) {
    throw new Error('Missing process.exit descriptor');
  }
  signals.on('SIGINT', unrelatedInt);
  signals.on('SIGTERM', unrelatedTerm);
  stdin.on('end', unrelatedEnd);
  const exit = vi.fn(() => {
    onExit();
    exited.release();
  });
  const signalOn = process.on.bind(process);
  const signalOnce = process.once.bind(process);
  const signalOff = process.off.bind(process);
  const signalRemove = process.removeListener.bind(process);
  const signalRemoveAll = process.removeAllListeners.bind(process);
  const stdinOn = process.stdin.on.bind(process.stdin);
  const stdinOnce = process.stdin.once.bind(process.stdin);
  const stdinOff = process.stdin.off.bind(process.stdin);
  const stdinRemove = process.stdin.removeListener.bind(process.stdin);
  const stdinRemoveAll = process.stdin.removeAllListeners.bind(process.stdin);
  const isSignal = (event: string | symbol): boolean => event === 'SIGINT' || event === 'SIGTERM';
  const listenerSpies = [
    vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      if (isSignal(event)) {
        signals.on(event, listener);
      } else {
        signalOn(event, listener);
      }

      return process;
    }),
    vi.spyOn(process, 'once').mockImplementation((event, listener) => {
      if (isSignal(event)) {
        signals.once(event, listener);
      } else {
        signalOnce(event, listener);
      }

      return process;
    }),
    vi.spyOn(process, 'off').mockImplementation((event, listener) => {
      if (isSignal(event)) {
        signals.off(event, listener);
      } else {
        signalOff(event, listener);
      }

      return process;
    }),
    vi.spyOn(process, 'removeListener').mockImplementation((event, listener) => {
      if (isSignal(event)) {
        signals.removeListener(event, listener);
      } else {
        signalRemove(event, listener);
      }

      return process;
    }),
    vi.spyOn(process, 'removeAllListeners').mockImplementation(event => {
      if (event === undefined) {
        signals.removeAllListeners();
      } else if (isSignal(event)) {
        signals.removeAllListeners(event);
      } else {
        signalRemoveAll(event);
      }

      return process;
    }),
    vi.spyOn(process.stdin, 'on').mockImplementation((event, listener) => {
      if (event === 'end') {
        stdin.on(event, listener);
      } else {
        stdinOn(event, listener);
      }

      return process.stdin;
    }),
    vi.spyOn(process.stdin, 'once').mockImplementation((event, listener) => {
      if (event === 'end') {
        stdin.once(event, listener);
      } else {
        stdinOnce(event, listener);
      }

      return process.stdin;
    }),
    vi.spyOn(process.stdin, 'off').mockImplementation((event, listener) => {
      if (event === 'end') {
        stdin.off(event, listener);
      } else {
        stdinOff(event, listener);
      }

      return process.stdin;
    }),
    vi.spyOn(process.stdin, 'removeListener').mockImplementation((event, listener) => {
      if (event === 'end') {
        stdin.removeListener(event, listener);
      } else {
        stdinRemove(event, listener);
      }

      return process.stdin;
    }),
    vi.spyOn(process.stdin, 'removeAllListeners').mockImplementation(event => {
      if (event === undefined) {
        stdin.removeAllListeners();
      } else if (event === 'end') {
        stdin.removeAllListeners(event);
      } else {
        stdinRemoveAll(event);
      }

      return process.stdin;
    }),
  ];

  // A returning exit double lets detached shutdown promises settle safely.
  Object.defineProperty(process, 'exit', { ...exitDescriptor, value: exit });

  return {
    exit,
    exited: exited.wait,
    emit: (event: ShutdownEvent): void => {
      if (event === 'end') {
        stdin.emit(event);
      } else {
        signals.emit(event);
      }
    },
    expectListenersReleased: (): void => {
      expect(signals.listeners('SIGINT')).toEqual([unrelatedInt]);
      expect(signals.listeners('SIGTERM')).toEqual([unrelatedTerm]);
      expect(stdin.listeners('end')).toEqual([unrelatedEnd]);
    },
    restore: (): void => {
      Object.defineProperty(process, 'exit', exitDescriptor);
      for (const spy of listenerSpies) {
        spy.mockRestore();
      }
    },
  };
};

describe('runCli shutdown lifecycle', () => {
  it('keeps an HTTP server running when stdin ends, and stops it on SIGTERM', async () => {
    const lifecycle = captureCliLifecycle();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // Live-only behind the host's ticket route: a per-document gate without --authorize.
      await within(runCli(['--http', '127.0.0.1:0', '--ticket-url', 'https://app.example.com/tickets'], { BLOK_MCP_HOST_TOKEN: 'host-token' }));
      lifecycle.emit('end');
      await dispatchCheckpoint();
      expect(lifecycle.exit).not.toHaveBeenCalled();
      lifecycle.emit('SIGTERM');
      await within(lifecycle.exited);
      expect(lifecycle.exit).toHaveBeenCalledWith(0);
      expect(stderr.mock.calls.some((call) => String(call[0]).includes('listening on'))).toBe(true);
    } finally {
      lifecycle.restore();
    }
  });

  it.each([
    { event: 'end', held: 'session' },
    { event: 'end', held: 'transport' },
    { event: 'SIGINT', held: 'session' },
    { event: 'SIGINT', held: 'transport' },
    { event: 'SIGTERM', held: 'session' },
    { event: 'SIGTERM', held: 'transport' },
  ] satisfies Array<{ event: ShutdownEvent; held: 'session' | 'transport' }>)(
    '$event waits for accepted work and $held cleanup before exiting',
    async ({ event, held }) => {
      const acceptedStarted = barrier();
      const acceptedRelease = barrier();
      const queuedStarted = barrier();
      const queuedRelease = barrier();
      const cleanupStarted = barrier();
      const cleanupRelease = barrier();
      const work: Promise<void>[] = [];
      let acceptedDone = false;
      let queuedDone = false;
      let sessionClosed = false;
      let otherSessionClosed = false;
      let transportClosed = false;
      const statesAtExit: Array<{
        acceptedDone: boolean;
        queuedDone: boolean;
        sessionClosed: boolean;
        otherSessionClosed: boolean;
        transportClosed: boolean;
      }> = [];
      const lifecycle = captureCliLifecycle(() => {
        statesAtExit.push({ acceptedDone, queuedDone, sessionClosed, otherSessionClosed, transportClosed });
      });
      const closeTransport = vi.fn(async () => {
        if (held === 'transport') {
          cleanupStarted.release();
          await cleanupRelease.wait;
        }
        transportClosed = true;
      });
      const closeSession = vi.fn<HandleSession['close']>(async () => {
        if (held === 'session') {
          cleanupStarted.release();
          await cleanupRelease.wait;
        }
        sessionClosed = true;

        return { unsavedBatches: 0, hostRecordLags: false };
      });
      const closeOtherSession = vi.fn<HandleSession['close']>(async () => {
        otherSessionClosed = true;

        return { unsavedBatches: 0, hostRecordLags: false };
      });

      vi.mocked(serveStdio).mockReturnValue({ close: closeTransport });
      try {
        await within(runCli([], {}));
        const assembled = owned[0];

        if (assembled === undefined) {
          throw new Error('Missing assembled server');
        }
        const handle = assembled.handles.add('local', 'notes', makeShutdownSession(closeSession));

        assembled.handles.add('other-user', 'other-notes', makeShutdownSession(closeOtherSession));
        const accepted = assembled.handles.use(handle, 'local', async () => {
          acceptedStarted.release();
          await acceptedRelease.wait;
          acceptedDone = true;
        });

        work.push(accepted);
        void accepted.catch(() => undefined);
        await within(acceptedStarted.wait);
        const queued = assembled.handles.use(handle, 'local', async () => {
          queuedStarted.release();
          await queuedRelease.wait;
          queuedDone = true;
        });

        work.push(queued);
        void queued.catch(() => undefined);
        lifecycle.emit(event);
        await within(dispatchCheckpoint());
        expect(lifecycle.exit).not.toHaveBeenCalled();
        expect(closeSession).not.toHaveBeenCalled();
        acceptedRelease.release();
        await within(accepted);
        await within(queuedStarted.wait);
        await within(dispatchCheckpoint());
        expect(lifecycle.exit).not.toHaveBeenCalled();
        expect(closeSession).not.toHaveBeenCalled();
        queuedRelease.release();
        await within(queued);
        await within(dispatchCheckpoint());
        expect(held === 'session' ? closeSession : closeTransport).toHaveBeenCalled();
        await within(cleanupStarted.wait);
        await within(dispatchCheckpoint());
        expect(lifecycle.exit).not.toHaveBeenCalled();
        cleanupRelease.release();
        await within(lifecycle.exited);
        await within(dispatchCheckpoint());
        expect(statesAtExit).toEqual([{
          acceptedDone: true,
          queuedDone: true,
          sessionClosed: true,
          otherSessionClosed: true,
          transportClosed: true,
        }]);
        expect(lifecycle.exit).toHaveBeenCalledTimes(1);
        expect(closeSession).toHaveBeenCalledExactlyOnceWith('closed');
        expect(closeOtherSession).toHaveBeenCalledExactlyOnceWith('closed');
        expect(closeTransport).toHaveBeenCalledTimes(1);
        expect(assembled.handles.count('local')).toBe(0);
        expect(assembled.handles.count('other-user')).toBe(0);
        lifecycle.expectListenersReleased();
      } finally {
        acceptedRelease.release();
        queuedRelease.release();
        cleanupRelease.release();
        try {
          await within(Promise.allSettled(work));
          await within(dispatchCheckpoint());
        } finally {
          lifecycle.restore();
        }
      }
    },
  );

  it.each(['end', 'SIGINT', 'SIGTERM'] satisfies ShutdownEvent[])(
    'coalesces repeated events after %s and releases only its listeners',
    async firstEvent => {
      const cleanupStarted = barrier();
      const cleanupRelease = barrier();
      const lifecycle = captureCliLifecycle();
      const closeTransport = vi.fn(async () => {
        cleanupStarted.release();
        await cleanupRelease.wait;
      });
      const closeSession = vi.fn<HandleSession['close']>(async () => ({
        unsavedBatches: 0,
        hostRecordLags: false,
      }));

      vi.mocked(serveStdio).mockReturnValue({ close: closeTransport });
      try {
        await within(runCli([], {}));
        const assembled = owned[0];

        if (assembled === undefined) {
          throw new Error('Missing assembled server');
        }
        assembled.handles.add('local', 'notes', makeShutdownSession(closeSession));
        lifecycle.emit(firstEvent);
        lifecycle.emit(firstEvent);
        lifecycle.emit('end');
        lifecycle.emit('SIGINT');
        lifecycle.emit('SIGTERM');
        lifecycle.emit('end');
        lifecycle.emit('SIGINT');
        lifecycle.emit('SIGTERM');
        await within(dispatchCheckpoint());
        expect(closeTransport).toHaveBeenCalled();
        await within(cleanupStarted.wait);
        await within(dispatchCheckpoint());
        expect(lifecycle.exit).not.toHaveBeenCalled();
        cleanupRelease.release();
        await within(lifecycle.exited);
        await within(dispatchCheckpoint());
        expect(lifecycle.exit).toHaveBeenCalledTimes(1);
        expect(closeSession).toHaveBeenCalledExactlyOnceWith('closed');
        expect(closeTransport).toHaveBeenCalledTimes(1);
        expect(assembled.handles.count('local')).toBe(0);
        lifecycle.expectListenersReleased();
        lifecycle.emit('end');
        lifecycle.emit('SIGINT');
        lifecycle.emit('SIGTERM');
        await within(dispatchCheckpoint());
        expect(lifecycle.exit).toHaveBeenCalledTimes(1);
        expect(closeSession).toHaveBeenCalledTimes(1);
        expect(closeTransport).toHaveBeenCalledTimes(1);
      } finally {
        cleanupRelease.release();
        try {
          await within(dispatchCheckpoint());
        } finally {
          lifecycle.restore();
        }
      }
    },
  );

  it.each(['unexpected', 'configuration'])(
    'cleans accepted handles and listeners after a %s startup failure',
    async kind => {
      const failure = kind === 'configuration'
        ? new McpConfigError('fixture startup failure')
        : new Error('fixture startup failure');
      const cleanupStarted = barrier();
      const cleanupRelease = barrier();
      let sessionClosed = false;
      let settled = false;
      let failureSeen: unknown;
      const closedAtExit: boolean[] = [];
      const lifecycle = captureCliLifecycle(() => {
        closedAtExit.push(sessionClosed);
      });
      const closeSession = vi.fn<HandleSession['close']>(async () => {
        cleanupStarted.release();
        await cleanupRelease.wait;
        sessionClosed = true;

        return { unsavedBatches: 0, hostRecordLags: false };
      });

      vi.mocked(assembly.assembleMcp).mockImplementation((options, dependencies) => {
        const assembled = assembleOriginal(options, dependencies);

        assembled.handles.add('local', 'notes', makeShutdownSession(closeSession));
        owned.push(assembled);

        return assembled;
      });
      vi.mocked(serveStdio).mockImplementation(() => {
        throw failure;
      });
      const starting = runCli([], {}).then(
        () => { settled = true; },
        (thrown: unknown) => {
          settled = true;
          failureSeen = thrown;
        },
      );

      try {
        await within(dispatchCheckpoint());
        expect(settled).toBe(false);
        expect(closeSession).toHaveBeenCalled();
        await within(cleanupStarted.wait);
        await within(dispatchCheckpoint());
        expect(lifecycle.exit).not.toHaveBeenCalled();
        expect(settled).toBe(false);
        cleanupRelease.release();
        await within(starting);
        await within(dispatchCheckpoint());
        expect(closeSession).toHaveBeenCalledExactlyOnceWith('closed');
        const assembled = owned[0];

        if (assembled === undefined) {
          throw new Error('Missing assembled server');
        }
        expect(assembled.handles.count('local')).toBe(0);
        lifecycle.expectListenersReleased();
        if (kind === 'configuration') {
          expect(closedAtExit).toEqual([true]);
          expect(lifecycle.exit).toHaveBeenCalledTimes(1);
          expect(console.error).toHaveBeenCalledWith(expect.stringContaining(failure.message));
        } else {
          expect(failureSeen).toBe(failure);
          expect(lifecycle.exit).not.toHaveBeenCalled();
        }
        lifecycle.emit('end');
        lifecycle.emit('SIGINT');
        lifecycle.emit('SIGTERM');
        await within(dispatchCheckpoint());
        expect(closeSession).toHaveBeenCalledTimes(1);
        expect(lifecycle.exit).toHaveBeenCalledTimes(kind === 'configuration' ? 1 : 0);
      } finally {
        cleanupRelease.release();
        try {
          await within(Promise.allSettled([starting]));
          await within(dispatchCheckpoint());
        } finally {
          lifecycle.restore();
        }
      }
    },
  );
});
