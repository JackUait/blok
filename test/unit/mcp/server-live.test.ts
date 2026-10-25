// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../src/components/modules/collaboration/types';
import { readTicketClaims } from '../../../src/components/utils/access-pass';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
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
