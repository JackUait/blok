/**
 * Peer A's undo step creates a container; peer B adds a child inside it; A
 * undoes. Both documents must agree afterwards, and no content id may name a
 * block that is gone.
 *
 * Rule (undo-history.ts `mayUndoDelete`, undo-peer-content.test.ts): undo never
 * deletes a peer's content, and a container holding a peer's child is spared,
 * or the child would hang off a parent that no longer exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { CalloutTool } from '../../../../../src/tools/callout';
import { Column } from '../../../../../src/tools/column';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { TabsTool } from '../../../../../src/tools/tabs';
import { TabTool } from '../../../../../src/tools/tab';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { OutputBlockData } from '../../../../../types';
import type { BlockToolConstructable } from '../../../../../types/tools';

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
    // A closed WebSocket drops what it is given.
    if (this.readyState !== 1) {
      return;
    }
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

const waitFor = async (predicate: () => boolean, label: string, timeoutMs = 15000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
};

interface LiveClient {
  name: string;
  core: Core;
  /** Update frames sent since the last call. */
  takeSent: () => Uint8Array[];
  receive: (update: Uint8Array) => void;
}

const bootLive = async (server: DocumentStore, name: string): Promise<LiveClient> => {
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
      bookmark: { class: Bookmark },
      callout: { class: CalloutTool as unknown as BlockToolConstructable },
      column: { class: Column as unknown as BlockToolConstructable },
      column_list: { class: ColumnList as unknown as BlockToolConstructable },
      paragraph: { class: Paragraph },
      tabs: { class: TabsTool as unknown as BlockToolConstructable },
      tab: { class: TabTool as unknown as BlockToolConstructable },
      toggle: { class: ToggleItem as unknown as BlockToolConstructable },
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

  await waitFor(() => !core.moduleInstances.ReadOnly.isEnabled, `${name}'s veto to lift`);
  await settle();

  let taken = 0;

  return {
    name,
    core,
    takeSent: () => {
      const frames = socket.sent.slice(taken).map(decode)
        .flatMap((frame) => (frame.type === 'update' ? [frame.update] : []));

      taken = socket.sent.length;

      return frames;
    },
    receive: (update) => socket.deliver({ type: 'update', update }),
  };
};

/**
 * Relays every client's sent frames to the server and to every other client,
 * one frame at a time, until nobody sends anything new.
 */
const pump = async (server: DocumentStore, clients: LiveClient[]): Promise<void> => {
  for (let round = 0; round < 20; round++) {
    const batches = clients.map((client) => ({ client, updates: client.takeSent() }));
    const moved = batches.some(({ updates }) => updates.length > 0);

    batches.forEach(({ client, updates }) => updates.forEach((update) => {
      server.applyRemoteUpdate(update);
      clients.filter((other) => other !== client).forEach((other) => other.receive(update));
    }));
    await settle();

    if (!moved) {
      return;
    }
  }
};

const roomWith = (blocks: OutputBlockData[]): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());

  store.fromJSON(blocks.map((block) => ({
    id: block.id ?? '',
    type: block.type,
    data: block.data,
    ...(block.parent !== undefined ? { parent: block.parent } : {}),
    ...(block.content !== undefined ? { content: block.content } : {}),
  })));

  return store;
};

type Snapshot = Array<[string, string, string | null, string[]]>;

const docOf = (client: LiveClient): Snapshot => client.core.moduleInstances.YjsManager.toJSON()
  .map((block) => [block.id ?? '', block.type, block.parent ?? null, block.content ?? []] as [string, string, string | null, string[]])
  .sort(([x], [y]) => x.localeCompare(y));

/** Every block, every field, sorted by id: what "both peers agree" means. */
const fullDocOf = (client: LiveClient): unknown[] => client.core.moduleInstances.YjsManager.toJSON()
  .sort((x, y) => (x.id ?? '').localeCompare(y.id ?? ''));

/** Content ids naming a block that is missing, or whose parent is someone else. */
const danglingIds = (client: LiveClient): string[] => {
  const all = client.core.moduleInstances.YjsManager.toJSON();

  return all.flatMap((block) => (block.content ?? []).filter((id) => all.find((child) => child.id === id)?.parent !== block.id));
};

interface Fixture {
  label: string;
  /** A's one captured step: make the container. Returns the id B adds a child under. */
  create: (client: LiveClient) => string;
  /** B's child, as a tool name and data. */
  child: { tool: string; data: Record<string, unknown> };
  /** Where B's child ends up when not under the parent it was added to. */
  keptUnder?: string | null;
}

const fixtures: Fixture[] = [
  {
    label: 'toggle',
    create: (client) => {
      client.core.moduleInstances.API.methods.blocks.insertAt('toggle', { text: 'box', isOpen: true }, { id: 'box', position: 'end' });

      return 'box';
    },
    child: { tool: 'paragraph', data: { text: 'from B' } },
  },
  {
    label: 'toggle with a child of A\'s',
    create: (client) => {
      const api = client.core.moduleInstances.API.methods.blocks;

      api.transact?.(() => {
        api.insertAt('toggle', { text: 'box', isOpen: true }, { id: 'box', position: 'end' });
        api.insertAt('paragraph', { text: 'from A' }, { id: 'kid-a', parentId: 'box', position: 'end' });
      });

      return 'box';
    },
    child: { tool: 'paragraph', data: { text: 'from B' } },
  },
  {
    label: 'column list',
    create: (client) => {
      const api = client.core.moduleInstances.API.methods.blocks;

      api.transact?.(() => {
        api.insertAt('column_list', {}, { id: 'box', position: 'end' });
        api.insertAt('column', {}, { id: 'col-1', parentId: 'box', position: 'end' });
        api.insertAt('paragraph', { text: 'left' }, { id: 'left', parentId: 'col-1', position: 'end' });
        api.insertAt('column', {}, { id: 'col-2', parentId: 'box', position: 'end' });
        api.insertAt('paragraph', { text: 'right' }, { id: 'right', parentId: 'col-2', position: 'end' });
      });

      return 'col-2';
    },
    child: { tool: 'paragraph', data: { text: 'from B' } },
    // Undo removes col-1, and a list left with one column dissolves (`unwrapColumnListIfCollapsed`).
    keptUnder: null,
  },
  {
    label: 'callout',
    create: (client) => {
      client.core.moduleInstances.API.methods.blocks.insertAt('callout', { emoji: '', textColor: null, backgroundColor: null }, { id: 'box', position: 'end' });

      return 'box';
    },
    child: { tool: 'paragraph', data: { text: 'from B' } },
  },
  {
    label: 'tabs',
    create: (client) => {
      const api = client.core.moduleInstances.API.methods.blocks;

      api.transact?.(() => {
        api.insertAt('tabs', {}, { id: 'box', position: 'end' });
        api.insertAt('tab', { title: 'One' }, { id: 'tab-a', parentId: 'box', position: 'end' });
      });

      return 'box';
    },
    child: { tool: 'tab', data: { title: 'From B' } },
  },
];

describe('collab undo — a peer\'s child inside a container the undoer created', { timeout: 60000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  it.each(fixtures)('both peers agree after A undoes making a $label B added a child to', async (fixture) => {
    const server = roomWith([{ id: 'p0', type: 'paragraph', data: { text: 'p0' } }]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    const parent = fixture.create(a);

    await settle();
    await pump(server, [a, b]);
    b.core.moduleInstances.API.methods.blocks.insertAt(fixture.child.tool, fixture.child.data, { id: 'kid-b', parentId: parent, position: 'end' });
    await settle();
    await pump(server, [a, b]);
    const before = docOf(a);

    expect(docOf(b)).toEqual(before);

    a.core.moduleInstances.YjsManager.undo();
    await settle();
    await pump(server, [a, b]);

    expect(fullDocOf(a)).toEqual(fullDocOf(b));
    expect(danglingIds(a)).toEqual([]);
    expect(danglingIds(b)).toEqual([]);
    // B's child is B's content: undo spares it and the container that holds it.
    expect(docOf(a).find(([id]) => id === 'kid-b')?.[2]).toBe(fixture.keptUnder === undefined ? parent : fixture.keptUnder);

    a.core.moduleInstances.YjsManager.redo();
    await settle();
    await pump(server, [a, b]);

    expect(fullDocOf(a)).toEqual(fullDocOf(b));
    expect(danglingIds(a)).toEqual([]);
    expect(danglingIds(b)).toEqual([]);
    if (fixture.keptUnder === undefined) {
      expect(docOf(a)).toEqual(before);
    }
    server.destroy();
  });

  it('both peers agree when B also typed into one of the children A made in the same step', async () => {
    const server = roomWith([{ id: 'p0', type: 'paragraph', data: { text: 'p0' } }]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    const api = a.core.moduleInstances.API.methods.blocks;

    api.transact?.(() => {
      api.insertAt('toggle', { text: 'box', isOpen: true }, { id: 'box', position: 'end' });
      api.insertAt('paragraph', { text: 'one' }, { id: 'kid-a1', parentId: 'box', position: 'end' });
      api.insertAt('paragraph', { text: 'two' }, { id: 'kid-a2', parentId: 'box', position: 'end' });
    });
    await settle();
    await pump(server, [a, b]);
    await b.core.moduleInstances.API.methods.blocks.update('kid-a2', { text: 'two, typed by B' });
    b.core.moduleInstances.API.methods.blocks.insertAt('paragraph', { text: 'from B' }, { id: 'kid-b', parentId: 'box', position: 'end' });
    await settle();
    await pump(server, [a, b]);

    a.core.moduleInstances.YjsManager.undo();
    await settle();
    await pump(server, [a, b]);

    expect(fullDocOf(a)).toEqual(fullDocOf(b));
    expect(danglingIds(a)).toEqual([]);
    expect(danglingIds(b)).toEqual([]);
    const kept = docOf(a).map(([id]) => id);

    expect(kept).toContain('kid-a2');
    expect(kept).toContain('kid-b');
    expect(kept).not.toContain('kid-a1');
    server.destroy();
  });

  // A new tabs block makes its tabs in one push, so their ids share one Yjs item.
  it('both peers agree when B renamed one of the tabs a new tabs block made in one push', async () => {
    const server = roomWith([{ id: 'p0', type: 'paragraph', data: { text: 'p0' } }]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    a.core.moduleInstances.API.methods.blocks.insertAt('tabs', {}, { id: 'box', position: 'end' });
    await settle();
    await pump(server, [a, b]);
    const made = docOf(b).find(([id]) => id === 'box')?.[3] ?? [];

    expect(made.length).toBeGreaterThan(1);
    await b.core.moduleInstances.API.methods.blocks.update(made[1], { title: 'Renamed by B' });
    await settle();
    await pump(server, [a, b]);

    a.core.moduleInstances.YjsManager.undo();
    await settle();
    await pump(server, [a, b]);

    expect(fullDocOf(a)).toEqual(fullDocOf(b));
    expect(danglingIds(a)).toEqual([]);
    expect(danglingIds(b)).toEqual([]);
    expect(docOf(a).map(([id]) => id)).toContain(made[1]);

    a.core.moduleInstances.YjsManager.redo();
    await settle();
    await pump(server, [a, b]);

    expect(fullDocOf(a)).toEqual(fullDocOf(b));
    expect(danglingIds(a)).toEqual([]);
    expect(danglingIds(b)).toEqual([]);
    expect(docOf(a).find(([id]) => id === 'box')?.[3]).toEqual(made);
    server.destroy();
  });
});
