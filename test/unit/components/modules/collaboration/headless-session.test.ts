// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HeadlessRoomTerminalError,
  HeadlessRoomTimeoutError,
  openHeadlessRoom,
  type HeadlessRoom
} from '../../../../../src/components/modules/collaboration/headless-session';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { htmlToSegmentsNode } from '../../../../../src/view/rich-text-node';

const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };

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

  public open(protocol: string): void {
    this.readyState = 1;
    this.protocol = protocol;
    this.onopen?.({});
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame).slice().buffer });
  }

  public serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const peerUpdate = (): Uint8Array => {
  const peer = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }));

  peer.fromJSON([{ id: 'p0', type: 'paragraph', data: { text: 'from the room' } }]);
  const update = peer.encodeStateAsUpdate();

  peer.destroy();

  return update;
};

type Script = 'sync' | 'silent' | 'forbidden';

const scripted = (protocol: string, script: Script = 'sync'): { factory: CollabSocketFactory; sockets: ScriptedSocket[] } => {
  const sockets: ScriptedSocket[] = [];
  const factory: CollabSocketFactory = () => {
    const socket = new ScriptedSocket();

    sockets.push(socket);
    queueMicrotask(() => {
      socket.open(protocol);
      if (script === 'forbidden') {
        socket.serverClose(4403, 'forbidden');

        return;
      }
      if (script === 'sync') {
        socket.deliver({ type: 'control', tag: TAG });
        socket.deliver({ type: 'syncStep2', update: peerUpdate() });
      }
    });

    return socket;
  };

  return { factory, sockets };
};

const serializer = (): YBlockSerializer => new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode });

describe('openHeadlessRoom', () => {
  const rooms: HeadlessRoom[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(rooms.splice(0).map((room) => room.close()));
    vi.restoreAllMocks();
  });

  const open = async (protocol: string, script: Script = 'sync', syncTimeoutMs = 15_000): Promise<{ room: HeadlessRoom; sockets: ScriptedSocket[] }> => {
    const { factory, sockets } = scripted(protocol, script);
    const room = await openHeadlessRoom({
      url: 'wss://sync.test/sync/doc-1',
      docId: 'doc-1',
      serializer: serializer(),
      socketFactory: factory,
      writeDenied: false,
      syncTimeoutMs,
    });

    rooms.push(room);

    return { room, sockets };
  };

  it('resolves only after the first sync, with the room content loaded', async () => {
    const { room } = await open('blok-sync.v2');

    expect(room.store.toJSON().map((block) => block.id)).toEqual(['p0']);
    expect(room.protocol).toBe('v2');
    expect(room.ended()).toBeNull();
  });

  it('times out when the room never syncs', async () => {
    await expect(open('blok-sync.v2', 'silent', 50)).rejects.toBeInstanceOf(HeadlessRoomTimeoutError);
  });

  it('fails with the terminal reason when refused before sync', async () => {
    const failure = await open('blok-sync.v2', 'forbidden').then(() => null, (thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(HeadlessRoomTerminalError);
    expect(failure).toMatchObject({ error: 'forbidden' });
  });

  it('stops waiting and closes when its signal aborts before the first sync', async () => {
    const { factory, sockets } = scripted('blok-sync.v2', 'silent');
    const controller = new AbortController();
    const reason = new Error('refused');
    const started = Date.now();
    const opening = openHeadlessRoom({
      url: 'wss://sync.test/sync/doc-1',
      docId: 'doc-1',
      serializer: serializer(),
      socketFactory: factory,
      writeDenied: false,
      syncTimeoutMs: 10_000,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(sockets[0]?.readyState).toBe(1));
    controller.abort(reason);
    const failure = await opening.then(() => null, (thrown: unknown) => thrown);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(failure).toBe(reason);
    expect(sockets[0].readyState).toBe(3);
  }, 15_000);

  it('fails at once when its signal is already aborted', async () => {
    const { factory } = scripted('blok-sync.v2', 'silent');
    const reason = new Error('refused');
    const started = Date.now();
    const failure = await openHeadlessRoom({
      url: 'wss://sync.test/sync/doc-1',
      docId: 'doc-1',
      serializer: serializer(),
      socketFactory: factory,
      writeDenied: false,
      syncTimeoutMs: 10_000,
      signal: AbortSignal.abort(reason),
    }).then(() => null, (thrown: unknown) => thrown);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(failure).toBe(reason);
  }, 15_000);

  it('journals its own local writes into the outbox under v2', async () => {
    const { room } = await open('blok-sync.v2');
    const mark = room.outbox.appendedCount();

    room.store.transact(() => {
      room.store.addBlock({ id: 'a1', type: 'paragraph', data: { text: 'agent' } });
    }, 'local');
    await room.flushAppends();

    expect(room.outbox.idsSince(mark)).toHaveLength(1);
  });

  it('counts a local write the tap could not journal, so it is never reported as sent', async () => {
    const { room } = await open('blok-sync.v2');
    const mark = room.outbox.appendedCount();

    vi.spyOn(room.outbox, 'appendLocal').mockRejectedValueOnce(new Error('disk full'));
    room.store.transact(() => {
      room.store.addBlock({ id: 'a1', type: 'paragraph', data: { text: 'agent' } });
    }, 'local');
    await room.flushAppends();

    expect(room.appendFailures()).toBe(1);
    expect(room.outbox.idsSince(mark)).toEqual([]);
  });

  it('never journals what the room sent (remote updates)', async () => {
    const { room, sockets } = await open('blok-sync.v2');
    const mark = room.outbox.appendedCount();

    sockets[0].deliver({ type: 'update', update: peerUpdate() });
    await room.flushAppends();

    expect(room.outbox.idsSince(mark)).toEqual([]);
  });

  it('does not journal under v1 (the provider sends local edits itself)', async () => {
    const { room, sockets } = await open('blok-sync.v1');

    room.store.transact(() => {
      room.store.addBlock({ id: 'a1', type: 'paragraph', data: { text: 'agent' } });
    }, 'local');
    await room.flushAppends();

    expect(room.outbox.appendedCount()).toBe(0);
    expect(sockets[0].sent.some((frame) => frame.type === 'update')).toBe(true);
  });

  it('ends with reset when the room is reset (4409)', async () => {
    const { room, sockets } = await open('blok-sync.v2');
    const ends: unknown[] = [];

    room.onEnd((end) => ends.push(end));
    sockets[0].serverClose(4409, 'reset');

    // The provider quarantines first (async), then swaps the doc.
    await vi.waitFor(() => expect(room.ended()).toEqual({ reason: 'reset' }));
    expect(ends).toEqual([{ reason: 'reset' }]);
  });

  it('withdraws presence and closes the socket on close', async () => {
    const { room, sockets } = await open('blok-sync.v2');

    await room.close();
    expect(sockets[0].readyState).toBe(3);
  });
});
