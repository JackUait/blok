/**
 * A peer's block added at the root right after a table must render and save
 * at the root on every receiver. Its flat predecessor is the table's last
 * cell block, so anchoring on that predecessor would drop it into a cell.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
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

// The child order is what a peer's `afterId` resolves against.
const blockFormatTable = (tableId = 'table-1'): OutputBlockData[] => [
  {
    id: tableId,
    type: 'table',
    content: ['c00', 'c01', 'c10', 'c11'],
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['c00'] }, { blocks: ['c01'] }],
        [{ blocks: ['c10'] }, { blocks: ['c11'] }],
      ],
    },
  },
  { id: 'c00', type: 'paragraph', data: { text: 'A' }, parent: tableId },
  { id: 'c01', type: 'paragraph', data: { text: 'B' }, parent: tableId },
  { id: 'c10', type: 'paragraph', data: { text: 'C' }, parent: tableId },
  { id: 'c11', type: 'paragraph', data: { text: 'D' }, parent: tableId },
];

const typeInto = (client: LiveClient, blockId: string, text: string): void => {
  const editable = client.core.moduleInstances.BlockManager.getBlockById(blockId)?.pluginsContent;

  if (editable === null || editable === undefined) {
    throw new Error(`${client.name} has no editable for ${blockId}`);
  }
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  client.core.moduleInstances.BlockManager.getBlockById(blockId)?.dispatchChange();
};

const holderOf = (client: LiveClient, id: string): HTMLElement | undefined =>
  client.core.moduleInstances.BlockManager.getBlockById(id)?.holder;

describe('table — a peer root block after the table', { timeout: 60000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  it('renders outside the table, saves at the root, and keeps text typed into it after a reload', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'root-1', type: 'paragraph', data: { text: '' } }, { parentId: null, afterId: 'table-1' });
    const update = peer.encodeStateAsUpdate(before);

    server.applyRemoteUpdate(update);
    a.receive(update);
    await settle();

    const table = holderOf(a, 'table-1');
    const root = holderOf(a, 'root-1');

    expect({
      insideTable: root !== undefined && table?.contains(root) === true,
      parent: a.core.moduleInstances.BlockManager.getBlockById('root-1')?.parentId,
    }).toEqual({ insideTable: false, parent: null });

    typeInto(a, 'root-1', 'my words');
    await settle();
    await pump(server, [a]);

    const saved = server.toJSON().find((block) => block.id === 'root-1');

    expect({ text: (saved?.data as { text?: string } | undefined)?.text, parent: saved?.parent ?? null })
      .toEqual({ text: 'my words', parent: null });

    // A fresh tab opening the document.
    const c = await bootLive(server, 'C');

    await pump(server, [a, c]);

    const reloaded = holderOf(c, 'root-1');

    expect({
      text: reloaded?.textContent,
      insideTable: reloaded !== undefined && holderOf(c, 'table-1')?.contains(reloaded) === true,
    }).toEqual({ text: 'my words', insideTable: false });
    peer.destroy();
    server.destroy();
  });
});
