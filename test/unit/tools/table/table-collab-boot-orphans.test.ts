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

/**
 * Boots an editor against a server holding `server`, waits for the veto to
 * lift and writes the client's updates back into `server`.
 * @param server - the room's document, written into by this boot
 * @returns whether the boot left an undo step behind
 */
const bootAgainst = async (server: DocumentStore): Promise<{ canUndo: boolean }> => {
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
  socket.deliver({ type: 'control', tag: { format: 1, epoch: 0, lineage: LINEAGE } });
  socket.deliver({
    type: 'syncStep2',
    update: server.encodeStateAsUpdate(core.moduleInstances.YjsManager.getStateVector()),
  });

  await waitFor(() => !core.moduleInstances.ReadOnly.isEnabled, 'the veto to lift');
  await settle();

  const canUndo = core.moduleInstances.YjsManager.canUndo();

  for (const bytes of socket.sent) {
    const frame = decode(bytes);

    if (frame.type === 'update') {
      server.applyRemoteUpdate(frame.update);
    }
  }

  destroyCore(core);
  booted.splice(booted.indexOf(core), 1);

  return { canUndo };
};

const roomWith = (blocks: OutputBlockData[]): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());

  store.fromJSON(blocks.map((block) => ({ id: block.id ?? '', type: block.type, data: block.data })));

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
});
