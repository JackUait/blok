// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../src/components/modules/collaboration/types';
import { readTicketClaims } from '../../../src/components/utils/access-pass';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { readPageFields } from '../../../src/components/modules/yjs/page-fields';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';

const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };
const caller: Caller = { principal: 'alice', clientName: 'claude', scopes: null };

class ScriptedSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public sent: SyncWireFrame[] = [];
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const frame = decode(bytes);

    if (frame.type !== 'unknown' && frame.type !== 'malformed') {
      this.sent.push(frame);
    }
  }

  public close(): void {
    this.readyState = 3;
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame).slice().buffer });
  }
}

class AckSocket extends ScriptedSocket {
  private sequence = 0;

  public override send(data: ArrayBufferLike | ArrayBufferView): void {
    super.send(data);
    const frame = this.sent.at(-1);

    if (frame?.type === 'operation') {
      this.sequence += 1;
      const ack: SyncWireFrame = { type: 'acknowledgement', lineage: frame.lineage, operationId: frame.operationId, serverSequence: String(this.sequence) };

      queueMicrotask(() => this.deliver(ack));
    }
  }
}

describe('assembleMcp with a sync URL', () => {
  let sockets: ScriptedSocket[];
  let offered: string[][];
  let mcp: AssembledMcp;

  const factory: CollabSocketFactory = (_url, protocols) => {
    const socket = new ScriptedSocket();

    sockets.push(socket);
    offered.push([...protocols]);
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.protocol = 'blok-sync.v2';
      socket.onopen?.({});
      socket.deliver({ type: 'control', tag: TAG });
      socket.deliver({ type: 'syncStep2', update: new Uint8Array([0, 0]) });
    });

    return socket;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sockets = [];
    offered = [];
    mcp = assembleMcp(
      { transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync' } },
      { liveSocketFactory: factory, liveSyncTimeoutMs: 1000 },
    );
  });

  afterEach(async () => {
    await mcp.stop();
    vi.restoreAllMocks();
  });

  it('auto mode opens a live, acknowledged handle once the room synced', async () => {
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc 1', write: true }, caller);

    expect(opened.structuredContent).toMatchObject({ mode: 'live', write: true, durability: 'acknowledged' });
    expect(sockets).toHaveLength(1);
  });

  it('refuses stored mode next to the sync service', async () => {
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc', mode: 'stored' }, caller);

    expect(opened.structuredContent).toEqual({ error: expect.objectContaining({ code: 'STORED_WRITE_FORBIDDEN' }) });
    expect(sockets).toHaveLength(0);
  });

  it('offers a signing-secret ticket whose user is the agent and whose doc is the opened one', async () => {
    await mcp.stop();
    mcp = assembleMcp(
      {
        transport: { kind: 'stdio' },
        auth: { kind: 'none' },
        sync: { url: 'wss://sync.test/sync' },
        tickets: { kind: 'secret', secret: 'x'.repeat(32) },
      },
      { liveSocketFactory: factory, liveSyncTimeoutMs: 1000 },
    );
    const opened = await mcp.dispatch('blok_open', { documentId: 'doc-1', write: false }, caller);
    const claims = (offered[0] ?? []).map((protocol) => readTicketClaims(protocol)).find((value) => value !== null);

    expect(opened.structuredContent).toMatchObject({ mode: 'live', write: false });
    expect(claims).toMatchObject({ user: 'agent:alice:claude', doc: 'doc-1', write: false });
  });
});

describe('assembleMcp with a sync URL and page-map', () => {
  let sockets: AckSocket[];
  let mcp: AssembledMcp;
  // Inserting a page block needs the page backend, so the room starts with one that points at itself.
  const seeded = (): Uint8Array => {
    const store = new DocumentStore(new YBlockSerializer());

    store.fromJSON([{ id: 'pb', type: 'page', data: { pageId: 'doc' } }]);

    return store.encodeStateAsUpdate();
  };

  const factory: CollabSocketFactory = () => {
    const socket = new AckSocket();

    sockets.push(socket);
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.protocol = 'blok-sync.v2';
      socket.onopen?.({});
      socket.deliver({ type: 'control', tag: TAG });
      socket.deliver({ type: 'syncStep2', update: seeded() });
    });

    return socket;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sockets = [];
    mcp = assembleMcp(
      { transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync' }, pageTitles: 'page-map' },
      { liveSocketFactory: factory, liveSyncTimeoutMs: 1000 },
    );
  });

  afterEach(async () => {
    await mcp.stop();
    vi.restoreAllMocks();
  });

  it('refuses page.rename on a page block that points at the open document', async () => {
    const handle = (await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, caller)).structuredContent.handle;
    const renamed = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'page.rename', args: { id: 'pb', title: 'x' } }] }, caller);

    expect(renamed.structuredContent).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', details: { pageId: 'doc' } } });
    expect(sockets).toHaveLength(1);
  }, 5_000);
});

/** A sync service with one room per document id, that keeps and acknowledges what each room receives. */
class RoomSocket extends ScriptedSocket {
  private sequence = 0;

  public constructor(private readonly room: DocumentStore) {
    super();
  }

  public override send(data: ArrayBufferLike | ArrayBufferView): void {
    super.send(data);
    const frame = this.sent.at(-1);

    if (frame?.type === 'operation') {
      this.room.applyRemoteUpdate(frame.update, 'client');
      this.sequence += 1;
      const ack: SyncWireFrame = { type: 'acknowledgement', lineage: frame.lineage, operationId: frame.operationId, serverSequence: String(this.sequence) };

      queueMicrotask(() => this.deliver(ack));
    }
  }
}

describe('assembleMcp with a sync URL and page-map creates sub-pages', () => {
  let rooms: Map<string, DocumentStore>;
  let joins: Array<{ docId: string; socket: RoomSocket; protocols: string[] }>;
  let mcp: AssembledMcp;
  // When set, every new room already holds someone's document.
  let occupied: boolean;

  const roomFor = (docId: string): DocumentStore => {
    const existing = rooms.get(docId);

    if (existing !== undefined) {
      return existing;
    }
    const created = new DocumentStore(new YBlockSerializer());

    if (occupied) {
      created.fromJSON([{ id: 'theirs', type: 'page', data: { pageId: 'elsewhere' } }]);
    }
    rooms.set(docId, created);

    return created;
  };
  const factory: CollabSocketFactory = (url, protocols) => {
    const docId = decodeURIComponent(url.split('/').at(-1) ?? '');
    const room = roomFor(docId);
    const socket = new RoomSocket(room);

    joins.push({ docId, socket, protocols: [...protocols] });
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.protocol = 'blok-sync.v2';
      socket.onopen?.({});
      socket.deliver({ type: 'control', tag: TAG });
      socket.deliver({ type: 'syncStep2', update: room.encodeStateAsUpdate() });
    });

    return socket;
  };
  const live = (extra: Record<string, unknown> = {}): AssembledMcp => assembleMcp(
    {
      transport: { kind: 'stdio' },
      auth: { kind: 'none' },
      sync: { url: 'wss://sync.test/sync' },
      tickets: { kind: 'secret', secret: 'x'.repeat(32) },
      pageTitles: 'page-map',
      ...extra,
    },
    { liveSocketFactory: factory, liveSyncTimeoutMs: 1000 },
  );
  const open = async (documentId: string): Promise<unknown> =>
    (await mcp.dispatch('blok_open', { documentId, write: true }, caller)).structuredContent.handle;
  const run = async (handle: unknown, commands: unknown[]): Promise<Record<string, unknown>> =>
    (await mcp.dispatch('blok_execute', { handle, commands }, caller)).structuredContent;
  const pageIdOf = (docId: string, blockId: string): unknown =>
    rooms.get(docId)?.toJSON().find((block) => block.id === blockId)?.data.pageId;

  beforeEach(() => {
    vi.clearAllMocks();
    rooms = new Map();
    joins = [];
    occupied = false;
  });

  afterEach(async () => {
    await mcp.stop();
    vi.restoreAllMocks();
  });

  it('inserting a page block joins the new room once, and that sub-page can then be written and named live', async () => {
    mcp = live();
    const parent = await open('doc');
    const inserted = await run(parent, [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }]);
    const pageId = pageIdOf('doc', 'np');

    expect(inserted).toMatchObject({ ok: true, delivery: { durable: true } });
    expect(typeof pageId).toBe('string');
    expect(pageId).not.toBe('doc');
    const created = joins.filter((join) => join.docId === pageId);
    const claims = (created[0]?.protocols ?? []).map((protocol) => readTicketClaims(protocol)).find((value) => value !== null);

    expect(created).toHaveLength(1);
    expect(claims).toMatchObject({ doc: pageId, write: true });
    expect(created[0]?.socket.readyState).toBe(3);

    const child = await open(String(pageId));

    expect(await run(child, [
      { name: 'block.insert', args: { type: 'paragraph', id: 'p1', data: { text: [{ text: 'Inside' }] } } },
    ])).toMatchObject({ ok: true, delivery: { durable: true } });
    expect(await run(child, [{ name: 'doc.setTitle', args: { title: 'Fresh' } }])).toMatchObject({ ok: true });
    const room = rooms.get(String(pageId));

    expect(room?.toJSON().map((block) => block.id)).toEqual(['p1']);
    expect(room === undefined ? undefined : readPageFields(room.page).title).toBe('Fresh');
  }, 5_000);

  it('creates nothing when authorize does not let the caller write the new id', async () => {
    mcp = live({ authorize: async (_principal: string, documentId: string) => documentId === 'doc' });
    const outcome = await run(await open('doc'), [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }]);

    expect(outcome).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', details: { pageId: expect.any(String) } } });
    expect(joins.map((join) => join.docId)).toEqual(['doc']);
    expect(rooms.get('doc')?.toJSON()).toEqual([]);
  }, 5_000);

  it('refuses a new id whose room already holds a document, and leaves that room as it was', async () => {
    mcp = live();
    const parent = await open('doc');

    occupied = true;
    const outcome = await run(parent, [{ name: 'block.insert', args: { type: 'page', id: 'np', position: 'end' } }]);

    expect(outcome).toMatchObject({ ok: false, error: { code: 'SOURCE_UNAVAILABLE', details: { pageId: expect.any(String) } } });
    const theirs = joins.at(-1);

    expect(theirs?.docId).not.toBe('doc');
    expect(rooms.get(theirs?.docId ?? '')?.toJSON().map((block) => block.id)).toEqual(['theirs']);
    expect(theirs?.socket.sent.some((frame) => frame.type === 'operation')).toBe(false);
    expect(theirs?.socket.readyState).toBe(3);
    expect(rooms.get('doc')?.toJSON()).toEqual([]);
  }, 5_000);
});
