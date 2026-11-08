// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Caller } from '../../../src/mcp/dispatcher';
import { createFilesHandleStore } from '../../../src/mcp/handle-store-files';
import { createMemoryHandleStore } from '../../../src/mcp/handle-store';
import { HandleRegistry } from '../../../src/mcp/handles';
import type { BlokDocumentCaller, BlokMcpDocumentSource, BlokMcpHandleStore, BlokMcpOptions } from '../../../src/mcp/options';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';
import type { HandleSession } from '../../../src/mcp/session';
import { SharedHandles } from '../../../src/mcp/shared-handles';

const alice: Caller = { principal: 'alice', clientName: 'e2e', scopes: null };
const bob: Caller = { principal: 'bob', clientName: 'e2e', scopes: null };

const paragraph = (id: string, text: string): Record<string, unknown> => ({ name: 'block.insert', args: { type: 'paragraph', id, data: { text } } });

describe('stored handles in a shared handle store', () => {
  let docs: string;
  let stores: string;
  const servers: AssembledMcp[] = [];

  const start = (extra: Partial<BlokMcpOptions> = {}, store: BlokMcpHandleStore = createFilesHandleStore(stores)): AssembledMcp => {
    const server = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir: docs }, handleStore: store, ...extra,
    });

    servers.push(server);

    return server;
  };
  const answer = async (server: AssembledMcp, name: string, args: Record<string, unknown>, who: Caller = alice): Promise<Record<string, unknown>> =>
    (await server.dispatch(name, args, who)).structuredContent;
  const open = async (server: AssembledMcp, documentId = 'doc', who: Caller = alice): Promise<string> => {
    const opened = await answer(server, 'blok_open', { documentId, write: true }, who);

    expect(typeof opened.handle).toBe('string');

    return opened.handle as string;
  };
  const execute = (server: AssembledMcp, handle: string, commands: unknown[], who: Caller = alice): Promise<Record<string, unknown>> =>
    answer(server, 'blok_execute', { handle, commands }, who);
  const errorCode = (outcome: Record<string, unknown>): unknown => (outcome.error as { code?: unknown } | undefined)?.code;
  const texts = (): string[] => {
    const parsed = JSON.parse(readFileSync(join(docs, 'doc.json'), 'utf8')) as { blocks: Array<{ data: { text: unknown } }> };

    return parsed.blocks.map((block) => JSON.stringify(block.data.text));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    docs = mkdtempSync(join(tmpdir(), 'blok-shared-docs-'));
    stores = mkdtempSync(join(tmpdir(), 'blok-shared-handles-'));
    writeFileSync(join(docs, 'doc.json'), JSON.stringify({ blocks: [] }));
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
    rmSync(docs, { recursive: true, force: true });
    rmSync(stores, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('opens on one server and executes on the other, saving to the source', async () => {
    const [a, b] = [start(), start()];
    const handle = await open(a);

    expect(await execute(b, handle, [paragraph('p1', 'Hello')])).toMatchObject({ ok: true, delivery: { durable: true } });
    expect(texts()).toHaveLength(1);
    expect(await answer(a, 'blok_read', { handle })).toMatchObject({ blocks: [{ id: 'p1' }] });
  });

  it('undoes on one server the batch the other server ran', async () => {
    const [a, b] = [start(), start()];
    const handle = await open(a);

    await execute(a, handle, [paragraph('p1', 'Hello')]);
    expect(await execute(b, handle, [{ name: 'history.undo', args: {} }])).toMatchObject({ ok: true });
    expect(texts()).toEqual([]);
    expect(await execute(a, handle, [{ name: 'history.redo', args: {} }])).toMatchObject({ ok: true });
    expect(texts()).toHaveLength(1);
  });

  it('refuses a write after someone else saved, and has nothing to undo after the reload', async () => {
    const [a, b] = [start(), start()];
    const first = await open(a);

    await execute(a, first, [paragraph('p1', 'Mine')]);
    const second = await open(b);

    expect(await execute(b, second, [paragraph('p2', 'Theirs')])).toMatchObject({ ok: true });
    expect(errorCode(await execute(b, first, [paragraph('p3', 'Late')]))).toBe('DOCUMENT_CHANGED');
    expect(errorCode(await execute(a, first, [{ name: 'history.undo', args: {} }]))).toBe('NOTHING_TO_UNDO');
  });

  it('refuses the save of an undo that is the first call after someone else saved', async () => {
    const [a, b] = [start(), start()];
    const first = await open(a);

    await execute(a, first, [paragraph('p1', 'Mine')]);
    const second = await open(b);

    expect(await execute(b, second, [paragraph('p2', 'Theirs')])).toMatchObject({ ok: true });
    expect(errorCode(await execute(b, first, [{ name: 'history.undo', args: {} }]))).toBe('DOCUMENT_CHANGED');
    expect(texts()).toHaveLength(2);
  });

  it('closes on one server for all of them', async () => {
    const [a, b] = [start(), start()];
    const handle = await open(a);

    expect(await answer(b, 'blok_close', { handle })).toMatchObject({ closed: true });
    expect(errorCode(await answer(a, 'blok_read', { handle }))).toBe('UNKNOWN_HANDLE');
  });

  it('counts the per-principal cap across servers', async () => {
    const [a, b] = [start({ maxHandlesPerPrincipal: 2 }), start({ maxHandlesPerPrincipal: 2 })];

    await open(a);
    await open(b);
    expect(errorCode(await answer(a, 'blok_open', { documentId: 'doc', write: true }))).toBe('HANDLE_LIMIT');
    expect(errorCode(await answer(b, 'blok_open', { documentId: 'doc', write: true }))).toBe('HANDLE_LIMIT');
    expect(typeof (await answer(b, 'blok_open', { documentId: 'doc', write: true }, bob)).handle).toBe('string');
  });

  it('answers UNKNOWN_HANDLE to another principal, and leaves the handle to its owner', async () => {
    const [a, b] = [start(), start()];
    const handle = await open(a);

    expect(errorCode(await answer(b, 'blok_read', { handle }, bob))).toBe('UNKNOWN_HANDLE');
    expect(errorCode(await answer(b, 'blok_close', { handle }, bob))).toBe('UNKNOWN_HANDLE');
    expect(await answer(b, 'blok_read', { handle })).toMatchObject({ blocks: [] });
  });

  it('answers VERSION_SKEW on a server with another tool contract, and still closes the handle there', async () => {
    const a = start();
    const b = start({ pageTitles: 'page-map' });
    const handle = await open(a);

    expect(errorCode(await answer(b, 'blok_read', { handle }))).toBe('VERSION_SKEW');
    expect(await answer(b, 'blok_close', { handle })).toMatchObject({ closed: true });
    expect(errorCode(await answer(a, 'blok_read', { handle }))).toBe('UNKNOWN_HANDLE');
  });

  it('runs two writes on two servers one after the other, losing neither', async () => {
    const [a, b] = [start(), start()];
    const handle = await open(a);
    const [first, second] = await Promise.all([
      execute(a, handle, [paragraph('p1', 'One')]),
      execute(b, handle, [paragraph('p2', 'Two')]),
    ]);

    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(texts()).toHaveLength(2);
  });

  it('expires an idle handle for every server, and use keeps it alive', async () => {
    const [a, b] = [start({ handleIdleMs: 300 }), start({ handleIdleMs: 300 })];
    const kept = await open(a);
    const idle = await open(a);

    for (const server of [b, a, b, a]) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await answer(server, 'blok_read', { handle: kept })).toMatchObject({ blocks: [] });
    }
    expect(errorCode(await answer(b, 'blok_read', { handle: idle }))).toBe('UNKNOWN_HANDLE');
  });

  it('keeps the handles in the store when a server stops', async () => {
    const [a, b] = [start(), start()];
    const handle = await open(a);

    await a.stop();
    expect(await answer(b, 'blok_read', { handle })).toMatchObject({ blocks: [] });
  });

  it('answers the saved batch, logs, and forgets the handle when the store write fails after the save', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const inner = createMemoryHandleStore();
    const failing: BlokMcpHandleStore = {
      ...inner,
      acquire: async (...args) => {
        const lease = await inner.acquire(...args);

        return typeof lease === 'string' ? lease : { ...lease, save: () => Promise.reject(new Error('store down')) };
      },
    };
    const a = start({}, failing);
    const handle = await open(a);

    expect(await execute(a, handle, [paragraph('p1', 'Hello')])).toMatchObject({ ok: true, delivery: { durable: true } });
    expect(texts()).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
    expect(errorCode(await answer(a, 'blok_read', { handle }))).toBe('UNKNOWN_HANDLE');
  });

  it('answers SOURCE_UNAVAILABLE when the store breaks, and logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const inner = createMemoryHandleStore();
    const a = start({}, { ...inner, acquire: () => Promise.reject(new Error('store down')) });
    const handle = await open(a);
    const read = await answer(a, 'blok_read', { handle });

    expect(read.error).toMatchObject({ code: 'SOURCE_UNAVAILABLE', retryable: true });
    expect(logged).toHaveBeenCalled();
  });

  it('answers SOURCE_UNAVAILABLE while another call holds the handle past the wait', async () => {
    const inner = createMemoryHandleStore();
    const a = start({}, { ...inner, acquire: () => Promise.resolve('busy' as const) });
    const handle = await open(a);

    expect((await answer(a, 'blok_read', { handle })).error).toMatchObject({ code: 'SOURCE_UNAVAILABLE', retryable: true });
  });

  it('works on the opener\'s caller from the record, not the current call\'s', async () => {
    const seen: BlokDocumentCaller[] = [];
    const texts = new Map<string, { documentText: string; version: string }>();
    const source: BlokMcpDocumentSource = {
      load: (who, id) => {
        seen.push(who);

        return Promise.resolve(texts.get(id) ?? null);
      },
      save: (who, id, documentText) => {
        seen.push(who);
        texts.set(id, { documentText, version: String(texts.size + 1) });

        return Promise.resolve({ version: String(texts.size) });
      },
    };
    const [a, b] = [start({ source: { kind: 'custom', source } }), start({ source: { kind: 'custom', source } })];
    const handle = await open(a, 'doc', { principal: 'alice', clientName: 'opener', scopes: ['blok.read', 'blok.write'] });

    await execute(b, handle, [paragraph('p1', 'Hello')], { principal: 'alice', clientName: 'later', scopes: null });
    expect(seen.map((who) => [who.clientName, who.scopes])).toEqual([['opener', ['blok.read', 'blok.write']], ['opener', ['blok.read', 'blok.write']]]);
    expect(seen[1].actor).toEqual(seen[0].actor);
  });

  it('answers CONFLICT to an undo whose carried steps were taken on other content', async () => {
    const a = start();
    const handle = await open(a);

    await execute(a, handle, [paragraph('p1', 'Hello')]);
    const recordPath = join(stores, `${handle}.record.json`);
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { document: { blocks: unknown[] } };

    writeFileSync(recordPath, JSON.stringify({ ...record, document: { blocks: [] } }));
    expect(errorCode(await execute(a, handle, [{ name: 'history.undo', args: {} }]))).toBe('CONFLICT');
  });

  it('leaves the handle to the process that took over a paused call\'s lease', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gate: { open?: () => void; reached?: () => void } = {};
    const reached = new Promise<void>((resolve) => {
      gate.reached = resolve;
    });
    const opened = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    const source: BlokMcpDocumentSource = {
      load: () => Promise.resolve(null),
      save: async () => {
        gate.reached?.();
        await opened;

        return { version: 'v1' };
      },
    };
    const options = { leaseStaleMs: 200, heartbeatMs: 60_000 };
    const a = start({ source: { kind: 'custom', source } }, createFilesHandleStore(stores, options));
    const b = start({ source: { kind: 'custom', source } }, createFilesHandleStore(stores, options));
    const handle = await open(a);
    const paused = execute(a, handle, [paragraph('p1', 'Hello')]);

    await reached;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await answer(b, 'blok_read', { handle })).toMatchObject({ blocks: [] });
    gate.open?.();
    expect(await paused).toMatchObject({ ok: true });
    expect(await answer(b, 'blok_read', { handle })).toMatchObject({ blocks: [] });
  });

  it.each([['../x'], ['a/b'], ['x'.repeat(129)], ['h\u0000']])('answers UNKNOWN_HANDLE for the handle %j without asking the store', async (handle) => {
    const store = createMemoryHandleStore();
    const acquire = vi.spyOn(store, 'acquire');
    const a = start({}, store);

    expect(errorCode(await answer(a, 'blok_read', { handle }))).toBe('UNKNOWN_HANDLE');
    expect(errorCode(await answer(a, 'blok_close', { handle }))).toBe('UNKNOWN_HANDLE');
    expect(acquire).not.toHaveBeenCalled();
  });

  it('asks the store about a handle of the minted shape it does not know', async () => {
    const store = createMemoryHandleStore();
    const acquire = vi.spyOn(store, 'acquire');
    const a = start({}, store);

    expect(errorCode(await answer(a, 'blok_read', { handle: 'A-_'.repeat(42) + 'zz' }))).toBe('UNKNOWN_HANDLE');
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('answers SOURCE_UNAVAILABLE to a close whose lease the store refuses, and logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const inner = createMemoryHandleStore();
    const lost: BlokMcpHandleStore = {
      ...inner,
      acquire: async (...args) => {
        const lease = await inner.acquire(...args);

        return typeof lease === 'string' ? lease : { ...lease, remove: () => Promise.reject(new Error('the lease was lost')) };
      },
    };
    const a = start({}, lost);
    const handle = await open(a);

    expect((await answer(a, 'blok_close', { handle })).error).toMatchObject({ code: 'SOURCE_UNAVAILABLE', retryable: true });
    expect(logged).toHaveBeenCalled();
    expect(await answer(a, 'blok_read', { handle })).toMatchObject({ blocks: [] });
  });

  it('keeps live handles out of the store: a cap of one counts the stored handle', async () => {
    const store = createMemoryHandleStore();
    const a = start({ maxHandlesPerPrincipal: 1 }, store);

    await open(a);
    expect(await store.count('alice', 600_000)).toBe(1);
    expect(a.handles.count('alice')).toBe(0);
  });
});

describe('SharedHandles with live handles', () => {
  const liveSession = (): HandleSession => ({
    mode: 'live', write: true, durability: 'acknowledged', contractRevision: 'live',
    read: vi.fn(() => Promise.resolve({ blocks: [] } as never)),
    describe: vi.fn(() => ({}) as never),
    execute: vi.fn(() => Promise.reject(new Error('unused'))),
    close: vi.fn(() => Promise.resolve({ unsavedBatches: 0, hostRecordLags: false })),
  });
  const make = (store: BlokMcpHandleStore, local: HandleRegistry<HandleSession>): SharedHandles => new SharedHandles({
    local, store, idleMs: 600_000, maxPerPrincipal: 2, contractRevision: 'c1', restore: () => Promise.reject(new Error('unused')),
  });
  const registry = (): HandleRegistry<HandleSession> => new HandleRegistry<HandleSession>({ idleMs: 600_000, maxPerPrincipal: 2, onExpire: () => Promise.resolve() });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a live handle in this process, out of the store, and counts both under one cap', async () => {
    const store = createMemoryHandleStore();
    const local = registry();
    const table = make(store, local);
    const live = await table.add('alice', 'doc', liveSession());

    expect(local.has(live)).toBe(true);
    expect(await store.count('alice', 600_000)).toBe(0);
    await store.tryAdd('stored', { v: 1, contractRevision: 'c1', principal: 'alice', clientName: 'c', scopes: null, actor: { id: 'a', name: 'a', kind: 'agent' }, documentId: 'doc', write: true, version: null, stale: false, document: { blocks: [] }, history: {} }, 2, 600_000);
    await expect(table.assertRoom('alice')).rejects.toMatchObject({ agentError: { code: 'HANDLE_LIMIT' } });
    await expect(table.add('alice', 'doc', liveSession())).rejects.toMatchObject({ agentError: { code: 'HANDLE_LIMIT' } });
    expect(await table.use(live, 'alice', (session) => session.read({}))).toEqual({ blocks: [] });
  });

  it('sweeps the store on a timer with the idle time, and stops at shutdown', async () => {
    const store = createMemoryHandleStore();
    const sweep = vi.spyOn(store, 'sweep');
    const table = new SharedHandles({
      local: registry(), store, idleMs: 600_000, maxPerPrincipal: 2, contractRevision: 'c1', restore: () => Promise.reject(new Error('unused')), sweepMs: 20,
    });

    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(sweep).toHaveBeenCalledWith(600_000);
    await table.closeAll(() => Promise.resolve());
    const swept = sweep.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(sweep).toHaveBeenCalledTimes(swept);
  });

  it('logs a failed sweep and keeps sweeping', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createMemoryHandleStore();
    const sweep = vi.spyOn(store, 'sweep').mockRejectedValue(new Error('store down'));
    const table = new SharedHandles({
      local: registry(), store, idleMs: 600_000, maxPerPrincipal: 2, contractRevision: 'c1', restore: () => Promise.reject(new Error('unused')), sweepMs: 20,
    });

    await new Promise((resolve) => setTimeout(resolve, 110));
    await table.closeAll(() => Promise.resolve());
    expect(sweep.mock.calls.length).toBeGreaterThan(1);
    expect(logged).toHaveBeenCalled();
  });

  it('closes only this process\'s live handles at shutdown and leaves the store alone', async () => {
    const store = createMemoryHandleStore();
    const local = registry();
    const table = make(store, local);
    const session = liveSession();
    const closed: HandleSession[] = [];

    await table.add('alice', 'doc', session);
    await store.tryAdd('stored', { v: 1, contractRevision: 'c1', principal: 'alice', clientName: 'c', scopes: null, actor: { id: 'a', name: 'a', kind: 'agent' }, documentId: 'doc', write: true, version: null, stale: false, document: { blocks: [] }, history: {} }, 2, 600_000);
    await table.closeAll(async (each) => {
      closed.push(each);
    });
    expect(closed).toEqual([session]);
    expect(await store.count('alice', 600_000)).toBe(1);
    await expect(table.assertRoom('alice')).rejects.toMatchObject({ agentError: { code: 'SOURCE_UNAVAILABLE' } });
  });
});
