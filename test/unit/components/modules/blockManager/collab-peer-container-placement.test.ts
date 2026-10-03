/**
 * A peer's block that joins or follows a slotted container (toggle, callout,
 * columns) must render where the peer put it on every receiver. Only tables
 * and databases hold a peer's child back; a slot container mounts it.
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
  socket.deliver({ type: 'control', tag: { format: 1, epoch: 0, lineage: LINEAGE } });
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

/** A raw Yjs peer that starts from the server's current state. */
const rawPeer = (server: DocumentStore, clientId?: number): DocumentStore => {
  const peer = new DocumentStore(new YBlockSerializer());
  const doc = peer.blocksMap.doc;

  if (clientId !== undefined && doc !== null) {
    doc.clientID = clientId;
  }
  peer.applyRemoteUpdate(server.encodeStateAsUpdate());

  return peer;
};

const P = (id: string, parent?: string): OutputBlockData => ({
  id, type: 'paragraph', data: { text: id }, ...(parent !== undefined ? { parent } : {}),
});

interface Fixture {
  label: string;
  blocks: OutputBlockData[];
  /** The root-level container a root block follows. */
  rootContainer: string;
  /** The block whose own slot shows `children`. */
  slotOwner: string;
  /** Its children, in order; the last is the flat predecessor of anything after the container. */
  children: string[];
}

const fixtures: Fixture[] = [
  {
    label: 'toggle',
    blocks: [
      { id: 'box', type: 'toggle', data: { text: 'box', isOpen: true }, content: ['k1', 'k2'] },
      P('k1', 'box'),
      P('k2', 'box'),
      P('loose'),
    ],
    rootContainer: 'box',
    slotOwner: 'box',
    children: ['k1', 'k2'],
  },
  {
    label: 'callout',
    blocks: [
      { id: 'box', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['k1', 'k2'] },
      P('k1', 'box'),
      P('k2', 'box'),
      P('loose'),
    ],
    rootContainer: 'box',
    slotOwner: 'box',
    children: ['k1', 'k2'],
  },
  {
    label: 'column',
    blocks: [
      { id: 'cl', type: 'column_list', data: {}, content: ['col1', 'col2'] },
      { id: 'col1', type: 'column', data: {}, parent: 'cl', content: ['left'] },
      P('left', 'col1'),
      { id: 'col2', type: 'column', data: {}, parent: 'cl', content: ['k1', 'k2'] },
      P('k1', 'col2'),
      P('k2', 'col2'),
      P('loose'),
    ],
    rootContainer: 'cl',
    slotOwner: 'col2',
    children: ['k1', 'k2'],
  },
];

const holderOf = (client: LiveClient, id: string): HTMLElement | undefined =>
  client.core.moduleInstances.BlockManager.getBlockById(id)?.holder;

/** Ids of the block holders the container's own slot shows, in DOM order. */
const slotChildren = (client: LiveClient, ownerId: string): string[] => {
  const slot = holderOf(client, ownerId)?.querySelector('[data-blok-toggle-children], [data-blok-nested-blocks]');

  return Array.from(slot?.querySelectorAll(':scope > [data-blok-id]') ?? []).map((holder) => holder.getAttribute('data-blok-id') ?? '');
};

/** Ids of the block holders at the editor root, in DOM order. */
const rootChildren = (client: LiveClient, rootContainer: string): string[] => {
  const root = holderOf(client, rootContainer)?.parentElement;

  return Array.from(root?.querySelectorAll(':scope > [data-blok-id]') ?? []).map((holder) => holder.getAttribute('data-blok-id') ?? '');
};

describe('collab — a peer block next to a slotted container', { timeout: 60000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  it.each(fixtures)('a block a peer moves into a $label shows inside it on the receiver', async (fixture) => {
    const server = roomWith(fixture.blocks);
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.moveBlockTo('loose', { parentId: fixture.slotOwner, afterId: fixture.children.at(-1) ?? null });
    const update = peer.encodeStateAsUpdate(before);

    server.applyRemoteUpdate(update);
    a.receive(update);
    await settle();
    await pump(server, [a]);

    expect(slotChildren(a, fixture.slotOwner)).toEqual([...fixture.children, 'loose']);
    expect(holderOf(a, 'loose')?.isConnected).toBe(true);
    expect(a.core.moduleInstances.BlockManager.getBlockById('loose')?.parentId).toBe(fixture.slotOwner);
    peer.destroy();
    server.destroy();
  });

  it.each(fixtures)('a block a peer adds at the root right after a $label mounts at the root and leaves the container\'s children inside it', async (fixture) => {
    const server = roomWith(fixture.blocks);
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'after', type: 'paragraph', data: { text: 'after' } }, { parentId: null, afterId: fixture.rootContainer });
    const update = peer.encodeStateAsUpdate(before);

    server.applyRemoteUpdate(update);
    a.receive(update);
    await settle();

    const container = holderOf(a, fixture.rootContainer);
    const after = holderOf(a, 'after');

    expect({
      insideContainer: after !== undefined && container?.contains(after) === true,
      parent: a.core.moduleInstances.BlockManager.getBlockById('after')?.parentId,
    }).toEqual({ insideContainer: false, parent: null });
    expect(rootChildren(a, fixture.rootContainer)).toEqual([fixture.rootContainer, 'after', 'loose']);
    expect(slotChildren(a, fixture.slotOwner)).toEqual(fixture.children);

    // A fresh tab opening the document sees the same.
    const c = await bootLive(server, 'C');

    await pump(server, [a, c]);

    expect(rootChildren(c, fixture.rootContainer)).toEqual([fixture.rootContainer, 'after', 'loose']);
    expect(slotChildren(c, fixture.slotOwner)).toEqual(fixture.children);
    peer.destroy();
    server.destroy();
  });
  it.each(fixtures)('a block a peer adds at the root after a $label that ends the document mounts at the root', async (fixture) => {
    // No root block follows the container, so the only flat predecessor is its last child.
    const server = roomWith(fixture.blocks.filter((block) => block.id !== 'loose'));
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'after', type: 'paragraph', data: { text: 'after' } }, { parentId: null, afterId: fixture.rootContainer });
    const update = peer.encodeStateAsUpdate(before);

    server.applyRemoteUpdate(update);
    a.receive(update);
    await settle();

    const after = holderOf(a, 'after');

    expect({
      insideContainer: after !== undefined && holderOf(a, fixture.rootContainer)?.contains(after) === true,
      parent: a.core.moduleInstances.BlockManager.getBlockById('after')?.parentId,
    }).toEqual({ insideContainer: false, parent: null });
    expect(rootChildren(a, fixture.rootContainer)).toEqual([fixture.rootContainer, 'after']);
    expect(slotChildren(a, fixture.slotOwner)).toEqual(fixture.children);
    peer.destroy();
    server.destroy();
  });

  it.each(fixtures)('a block a peer adds at the root and then moves into a $label, in two frames, ends up inside it', async (fixture) => {
    const server = roomWith(fixture.blocks.filter((block) => block.id !== 'loose'));
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'late', type: 'paragraph', data: { text: 'late' } }, { parentId: null, afterId: fixture.rootContainer });
    const first = peer.encodeStateAsUpdate(before);
    const mid = peer.getStateVector();

    peer.moveBlockTo('late', { parentId: fixture.slotOwner, afterId: fixture.children.at(-1) ?? null });
    const second = peer.encodeStateAsUpdate(mid);

    [first, second].forEach((update) => {
      server.applyRemoteUpdate(update);
      a.receive(update);
    });
    await settle();

    expect(slotChildren(a, fixture.slotOwner)).toEqual([...fixture.children, 'late']);
    expect(rootChildren(a, fixture.rootContainer)).toEqual([fixture.rootContainer]);
    peer.destroy();
    server.destroy();
  });
});
