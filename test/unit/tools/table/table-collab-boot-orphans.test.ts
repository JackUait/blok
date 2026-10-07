/**
 * A collaboration session boots read-only and lifts the veto while the first
 * sync's window is still open. A table converts its legacy cell strings into
 * child blocks at that moment. The new children reach the shared document;
 * the table's cell references must reach it too, or every later boot sees the
 * strings again and adds another full set of orphaned children.
 *
 * Only tools that toggle read-only in place are registered: that is the path a
 * real editor with core tools takes when the veto lifts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import type { CollaborationConfig } from '../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import type { OutputBlockData } from '../../../../types';
import type { BlockToolConstructable } from '../../../../types/tools';

const LINEAGE = '0123456789abcdef0123456789abcdef';

/**
 * A read-only capable tool with no `setReadOnly`. One such tool turns every
 * read-only change into the full save/clear/render instead of the in-place
 * toggle — what a host with any third-party tool gets.
 */
class PlainTool {
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public render(): HTMLElement {
    return document.createElement('div');
  }

  public save(): Record<string, never> {
    return {};
  }
}

class MockSocket {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public readonly sent: Uint8Array[] = [];

  public constructor(public readonly url: string, public readonly protocols: string[]) {}

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer));
  }

  public close(): void {
    this.readyState = 3;
  }

  public open(): void {
    this.protocol = 'blok-sync.v1';
    this.readyState = 1;
    this.onopen?.({});
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }
}

const holders: HTMLElement[] = [];
const booted: Core[] = [];

const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as { markDestroyed?: () => void } | null | undefined;

    instance?.markDestroyed?.();
  });
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as { destroy?: () => void; listeners?: { removeAll?: () => void } } | null | undefined;

    instance?.destroy?.();
    instance?.listeners?.removeAll?.();
  });
};

const waitFor = async (predicate: () => boolean, label: string, timeoutMs = 3000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** Lets every pending save, parent sync and RAF tail land. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
};

interface LiveClient {
  core: Core;
  /** Writes everything the client has sent so far into the server document. */
  flushTo: (server: DocumentStore) => void;
  /** Delivers a peer's update, as the server relays it. */
  receive: (update: Uint8Array) => void;
}

/**
 * Boots an editor against a server holding `server` and waits for the veto to
 * lift.
 * @param server - the room's document
 */
const bootLive = async (server: DocumentStore, options: { plainTool?: boolean } = {}): Promise<LiveClient> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const sockets: MockSocket[] = [];
  const collaboration: CollaborationConfig = {
    doc: 'doc-1',
    socketFactory: (url, protocols) => {
      const socket = new MockSocket(url, protocols);

      sockets.push(socket);

      return socket;
    },
  };

  const core = new Core({
    holder,
    minHeight: 50,
    tools: {
      // The `server` shorthand fills in a bookmark endpoint, so it needs a class.
      bookmark: { class: Bookmark },
      paragraph: { class: Paragraph },
      table: { class: Table as unknown as BlockToolConstructable },
      ...(options.plainTool === true ? { plain: { class: PlainTool as unknown as BlockToolConstructable } } : {}),
    },
    server: 'https://sync.test/api/',
    collaboration,
  });

  await core.isReady;
  booted.push(core);

  const socket = sockets.at(-1);

  if (socket === undefined) {
    throw new Error('no socket was opened');
  }

  socket.open();
  socket.deliver({ type: 'control', tag: { format: 2, epoch: 0, lineage: LINEAGE } });
  socket.deliver({
    type: 'syncStep2',
    update: server.encodeStateAsUpdate(core.moduleInstances.YjsManager.getStateVector()),
  });

  await waitFor(() => !core.moduleInstances.ReadOnly.isEnabled, 'the veto to lift');
  await settle();

  let flushed = 0;

  return {
    core,
    flushTo: (target) => {
      for (const bytes of socket.sent.slice(flushed)) {
        const frame = decode(bytes);

        if (frame.type === 'update') {
          target.applyRemoteUpdate(frame.update);
        }
      }
      flushed = socket.sent.length;
    },
    receive: (update) => socket.deliver({ type: 'update', update }),
  };
};

/**
 * Boots an editor, writes its updates back into `server` and destroys it.
 * @param server - the room's document, written into by this boot
 * @returns whether the boot left an undo step behind
 */
const bootAgainst = async (server: DocumentStore, options: { plainTool?: boolean } = {}): Promise<{ canUndo: boolean }> => {
  const client = await bootLive(server, options);
  const canUndo = client.core.moduleInstances.YjsManager.canUndo();

  client.flushTo(server);
  destroyCore(client.core);
  booted.splice(booted.indexOf(client.core), 1);

  return { canUndo };
};

const roomWith = (blocks: OutputBlockData[]): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());

  store.fromJSON(blocks.map((block) => ({ id: block.id ?? '', type: block.type, data: block.data })));

  return store;
};

const roomWithParents = (blocks: OutputBlockData[]): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());

  store.fromJSON(blocks.map((block) => ({ id: block.id ?? '', type: block.type, data: block.data, parent: block.parent })));

  return store;
};

const childrenOf = (server: DocumentStore, parentId: string): string[] =>
  server.toJSON().filter((block) => block.parent === parentId).map((block) => block.id ?? '');

const referencedIds = (server: DocumentStore, tableId: string): string[] => {
  const table = server.toJSON().find((block) => block.id === tableId);
  const content = (table?.data as { content?: unknown[][] } | undefined)?.content ?? [];

  return content.flat().flatMap((cell) => {
    const blocks = (cell as { blocks?: unknown } | null)?.blocks;

    return Array.isArray(blocks) ? blocks.filter((id): id is string => typeof id === 'string') : [];
  });
};

describe('table — collaborative boot writes its cell references', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  it('a second boot of a legacy-string table adds no new cell blocks', async () => {
    const server = roomWith([
      {
        id: 'table-1',
        type: 'table',
        data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
      },
    ]);

    await bootAgainst(server);
    const afterFirstBoot = childrenOf(server, 'table-1');

    await bootAgainst(server);
    const afterSecondBoot = childrenOf(server, 'table-1');

    expect(afterSecondBoot).toEqual(afterFirstBoot);
    expect(afterFirstBoot).toHaveLength(4);
    expect([...referencedIds(server, 'table-1')].sort()).toEqual([...afterFirstBoot].sort());

    server.destroy();
  });

  it('a second boot adds no new cell blocks when a tool forces the full re-render', async () => {
    const server = roomWith([
      {
        id: 'table-1',
        type: 'table',
        data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
      },
    ]);

    await bootAgainst(server, { plainTool: true });
    const afterFirstBoot = childrenOf(server, 'table-1');

    await bootAgainst(server, { plainTool: true });

    expect(childrenOf(server, 'table-1')).toEqual(afterFirstBoot);
    expect([...referencedIds(server, 'table-1')].sort()).toEqual([...afterFirstBoot].sort());

    server.destroy();
  });

  it('a second boot of a table whose cells reference missing blocks adds no new cell blocks', async () => {
    const server = roomWith([
      {
        id: 'table-1',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['gone-1'] }, { blocks: ['gone-2'] }]] },
      },
    ]);

    await bootAgainst(server);
    const afterFirstBoot = childrenOf(server, 'table-1');

    await bootAgainst(server);

    expect(childrenOf(server, 'table-1')).toEqual(afterFirstBoot);
    expect(referencedIds(server, 'table-1')).toEqual(expect.arrayContaining(afterFirstBoot));

    server.destroy();
  });

  it('a legacy-string table arriving from a peer is synced with the cells it gets', async () => {
    const server = roomWith([{ id: 'p-1', type: 'paragraph', data: { text: 'hi' } }]);
    const client = await bootLive(server);
    const peer = new DocumentStore(new YBlockSerializer());

    peer.applyRemoteUpdate(server.encodeStateAsUpdate());
    const before = peer.getStateVector();

    peer.addBlockAt(
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [['A', 'B']] } },
      { parentId: null, afterId: 'p-1' }
    );
    const update = peer.encodeStateAsUpdate(before);

    server.applyRemoteUpdate(update);
    client.receive(update);
    await settle();
    client.flushTo(server);
    expect([...referencedIds(server, 'table-1')].sort()).toEqual([...childrenOf(server, 'table-1')].sort());

    peer.destroy();
    server.destroy();
  });

  it('converting legacy cells on a collaborative boot leaves nothing to undo', async () => {
    const server = roomWith([
      {
        id: 'table-1',
        type: 'table',
        data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] },
      },
    ]);

    const { canUndo } = await bootAgainst(server);

    expect(canUndo).toBe(false);

    server.destroy();
  });

  describe('a table child no cell references', () => {
    const ghostRoom = (): DocumentStore => roomWithParents([
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] } },
      { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'table-1' },
      { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'table-1' },
      { id: 'ghost', type: 'paragraph', data: { text: 'Ghost text' }, parent: 'table-1' },
      { id: 'empty-ghost', type: 'paragraph', data: { text: '' }, parent: 'table-1' },
    ]);

    const ghostIn = (blocks: OutputBlockData[]): OutputBlockData[] => blocks.filter((block) => block.id === 'ghost');

    it('a collaborative boot moves one with text to the root in the shared doc and drops an empty one', async () => {
      const server = ghostRoom();

      await bootAgainst(server);

      const ghosts = ghostIn(server.toJSON());

      expect(ghosts).toHaveLength(1);
      expect(ghosts[0].parent ?? null).toBeNull();
      expect(ghosts[0].data).toEqual(expect.objectContaining({ text: 'Ghost text' }));
      expect(server.toJSON().map((block) => block.id)).not.toContain('empty-ghost');

      server.destroy();
    });

    it('two peers booting the same doc keep it exactly once, at the root', async () => {
      const server = ghostRoom();
      const first = await bootLive(server);
      const second = await bootLive(server);

      first.flushTo(server);
      second.flushTo(server);

      // The server relays the merged state; a client ignores what it already has.
      const merged = server.encodeStateAsUpdate();

      first.receive(merged);
      second.receive(merged);
      await settle();
      first.flushTo(server);
      second.flushTo(server);

      for (const blocks of [
        server.toJSON(),
        first.core.moduleInstances.YjsManager.toJSON(),
        second.core.moduleInstances.YjsManager.toJSON(),
      ]) {
        const ghosts = ghostIn(blocks);

        expect(ghosts).toHaveLength(1);
        expect(ghosts[0].parent ?? null).toBeNull();
        expect(blocks.filter((block) => (block.parent ?? null) === null).map((block) => block.id)).toEqual(['table-1', 'ghost']);
      }

      for (const client of [first, second]) {
        const saved = await client.core.moduleInstances.Saver.save();

        expect(saved?.blocks.filter((block) => block.id === 'ghost')).toEqual([
          expect.objectContaining({ data: expect.objectContaining({ text: [{ text: 'Ghost text' }] }) }),
        ]);
      }

      server.destroy();
    });
  });
});
