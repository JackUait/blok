// @vitest-environment node
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../src/components/modules/collaboration/types';
import { readTicketClaims } from '../../../src/components/utils/access-pass';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';

const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };
const LINEAGE = TAG.lineage;
const caller: Caller = { principal: 'alice', clientName: 'claude', scopes: null };
const ORIGIN = 'https://app.test';

class SyncedSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    decode(ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
  }

  public close(): void {
    this.readyState = 3;
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame).slice().buffer });
  }
}

const seeded = (): Uint8Array => {
  const store = new DocumentStore(new YBlockSerializer());

  store.fromJSON([{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Now' }] } }]);

  return store.encodeStateAsUpdate();
};

const factory: CollabSocketFactory = () => {
  const socket = new SyncedSocket();

  queueMicrotask(() => {
    socket.readyState = 1;
    socket.protocol = 'blok-sync.v2';
    socket.onopen?.({});
    socket.deliver({ type: 'control', tag: TAG });
    socket.deliver({ type: 'syncStep2', update: seeded() });
  });

  return socket;
};

interface Seen { url: string; authorization?: string; origin?: string; method?: string }

/** The sync server's history routes for "doc-1", with one version on each of two lineages. */
const historyServer = (seen: Seen[]): Server => createServer((request: IncomingMessage, response) => {
  seen.push({ url: request.url ?? '', authorization: request.headers.authorization, origin: request.headers.origin, method: request.method });
  const json = (status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  if (request.url === '/sync/doc-1/history' || request.url === '/sync/doc-1/history?group=15') {
    json(200, {
      lineages: [
        { lineage: LINEAGE, epoch: 0, format: 2, createdAt: 10, current: true },
        { lineage: 'f'.repeat(32), epoch: 0, format: 2, createdAt: 5, current: false },
      ],
      versions: [
        { lineage: LINEAGE, sequence: 4, startedAt: 30, savedAt: 40, actors: ['agent:alice:claude'] },
        { lineage: 'f'.repeat(32), sequence: 9, startedAt: null, savedAt: 8, actors: [] },
      ],
    });

    return;
  }
  if (request.url === `/sync/doc-1/history/${LINEAGE}/4`) {
    json(200, { time: 40, blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Then' } }, { id: 'q', type: 'paragraph', data: { text: 'Gone' } }] });

    return;
  }
  const refusal = /^\/sync\/doc-1\/history\/[^/]+\/(\d{3})$/.exec(request.url ?? '');

  if (refusal !== null) {
    response.writeHead(Number(refusal[1]));
    response.end('refused\n');

    return;
  }
  response.writeHead(404);
  response.end('no such version\n');
});

describe('blok-mcp live handles read the sync server version history', () => {
  let server: Server;
  let seen: Seen[];
  let mcp: AssembledMcp;

  beforeEach(async () => {
    vi.clearAllMocks();
    seen = [];
    server = historyServer(seen);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('The history server has no port.');
    }
    const port = address.port;

    mcp = assembleMcp(
      {
        transport: { kind: 'stdio' },
        auth: { kind: 'none' },
        sync: { url: `ws://127.0.0.1:${port}/sync`, origin: ORIGIN },
        tickets: { kind: 'secret', secret: 'x'.repeat(32) },
      },
      { liveSocketFactory: factory, liveSyncTimeoutMs: 1000 },
    );
  });

  afterEach(async () => {
    await mcp.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  const open = async (): Promise<string> => {
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc-1' }, caller);
    const handle = opened.structuredContent.handle;

    if (typeof handle !== 'string') {
      throw new Error(`blok_open failed: ${JSON.stringify(opened.structuredContent)}`);
    }

    return handle;
  };

  const execute = async (handle: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
    (await mcp.dispatch('blok_execute', { handle, commands: [{ name, args }] }, caller)).structuredContent;

  it('lists versions with the room ticket and the configured Origin', async () => {
    const handle = await open();
    const listed = await execute(handle, 'history.versions', { group: 15 });

    expect(listed).toMatchObject({ ok: true, results: [{ versions: [
      { version: `${LINEAGE}:4`, savedAt: 40, startedAt: 30, actors: ['agent:alice:claude'] },
      { version: `${'f'.repeat(32)}:9`, savedAt: 8, startedAt: null, actors: [], beforeReset: true },
    ] }] });
    expect(seen.map((request) => [request.method, request.url, request.origin])).toEqual([['GET', '/sync/doc-1/history?group=15', ORIGIN]]);
    const claims = readTicketClaims(seen[0]?.authorization?.replace(/^Bearer /, '') ?? '');

    expect(claims).toMatchObject({ doc: 'doc-1', user: 'agent:alice:claude' });
  });

  it('reads a version and compares it with the room as it is now', async () => {
    const handle = await open();
    const read = await execute(handle, 'history.read', { version: `${LINEAGE}:4` });
    const changes = await execute(handle, 'history.changes', { from: `${LINEAGE}:4` });

    expect(read).toMatchObject({ ok: true, results: [{
      version: `${LINEAGE}:4`,
      blocks: [{ id: 'p', type: 'paragraph', text: 'Then' }, { id: 'q', type: 'paragraph', text: 'Gone' }],
    }] });
    expect(changes).toMatchObject({ ok: true, results: [{
      from: `${LINEAGE}:4`, to: 'current', added: [],
      removed: [{ id: 'q', text: 'Gone' }],
      changed: [{ id: 'p', before: { text: 'Then' }, after: { text: 'Now' } }],
    }] });
  });

  it('says an unknown version is not there, and never sends a write', async () => {
    const handle = await open();
    const missing = await execute(handle, 'history.read', { version: `${LINEAGE}:99` });

    expect(missing).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', path: '/commands/0/args/version' } });
    expect(seen.every((request) => request.method === 'GET')).toBe(true);
  });

  // The test server answers a read of version "L:<status>" with that status.
  it.each([
    { status: 403, retryable: false },
    { status: 501, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
    { status: 503, retryable: true },
  ])('says a $status from the sync server is retryable: $retryable', async ({ status, retryable }) => {
    const handle = await open();
    const read = await execute(handle, 'history.read', { version: `${LINEAGE}:${status}` });

    expect(read).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', retryable } });
  });

  it('says an unreachable sync server is retryable', async () => {
    const handle = await open();

    const closed = new Promise<void>((resolve) => server.close(() => resolve()));

    server.closeAllConnections();
    await closed;
    const listed = await execute(handle, 'history.versions', {});

    // afterEach closes it again.
    server = historyServer(seen);
    expect(listed).toMatchObject({ ok: false, error: { code: 'TOOL_ACTION_FAILED', retryable: true } });
  });

  it('names the history commands in the listed blok_execute schema', () => {
    const execute = mcp.tools.find((tool) => tool.name === 'blok_execute');

    expect(JSON.stringify(execute?.inputSchema)).toContain('history.changes');
  });
});
