/**
 * A peer's table child reaches me in pieces: its add, its parent write, and
 * last the table data that names its cell. Nothing I do in between may put
 * it in a cell, and nothing I insert after the table may land beside it while
 * it waits off-screen.
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

type Cell = { blocks?: unknown } | string | null;

const tableContent = (server: DocumentStore, tableId: string): Cell[][] => {
  const table = server.toJSON().find((block) => block.id === tableId);

  return ((table?.data as { content?: Cell[][] } | undefined)?.content ?? []);
};

const cellRefs = (server: DocumentStore, tableId: string): string[][][] =>
  tableContent(server, tableId).map((row) => row.map((cell) => {
    const blocks = (cell as { blocks?: unknown } | null)?.blocks;

    return Array.isArray(blocks) ? blocks.filter((id): id is string => typeof id === 'string') : [];
  }));

const childrenOf = (server: DocumentStore, parentId: string): string[] =>
  server.toJSON().filter((block) => block.parent === parentId).map((block) => block.id ?? '');

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

const tableBlock = (client: LiveClient, tableId = 'table-1'): { dispatchChange: () => void } => {
  const block = client.core.moduleInstances.BlockManager.getBlockById(tableId);

  if (block === undefined) {
    throw new Error(`${client.name} has no ${tableId}`);
  }

  return block;
};

const pressAddRow = (client: LiveClient, tableId = 'table-1'): void => {
  const holder = client.core.moduleInstances.BlockManager.getBlockById(tableId)?.holder;
  const button = holder?.querySelector<HTMLElement>('[data-blok-table-add-row]');

  if (button === null || button === undefined) {
    throw new Error(`${client.name} has no add-row button`);
  }
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};

const pressAddColumn = (client: LiveClient, tableId = 'table-1'): void => {
  const holder = client.core.moduleInstances.BlockManager.getBlockById(tableId)?.holder;
  const button = holder?.querySelector<HTMLElement>('[data-blok-table-add-col]');

  if (button === null || button === undefined) {
    throw new Error(`${client.name} has no add-column button`);
  }
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};

/** The table's data and its children, as the server doc holds them. */
const integrity = (server: DocumentStore, tableId = 'table-1'): {
  missingRefs: string[];
  unreferencedChildren: string[];
} => {
  const children = childrenOf(server, tableId);
  const refs = cellRefs(server, tableId).flat(2);
  const ids = new Set(server.toJSON().map((block) => block.id));

  return {
    missingRefs: refs.filter((id) => !ids.has(id)),
    unreferencedChildren: children.filter((id) => !refs.includes(id)),
  };
};

/** How many block holders each cell shows in the client's DOM. */
const holderCounts = (client: LiveClient, tableId = 'table-1'): number[][] => {
  const holder = client.core.moduleInstances.BlockManager.getBlockById(tableId)?.holder;
  const rows = Array.from(holder?.querySelectorAll('[data-blok-table-row]') ?? []);

  return rows.map((row) => Array.from(row.querySelectorAll(':scope > [data-blok-table-cell]')).map((cell) =>
    cell.querySelectorAll('[data-blok-nested-blocks] > [data-blok-id]').length));
};


/** Sends `change` as its own frame to the server and to `client`. */
const deliver = (peer: DocumentStore, server: DocumentStore, client: LiveClient, change: () => void): void => {
  const before = peer.getStateVector();

  change();
  const update = peer.encodeStateAsUpdate(before);

  server.applyRemoteUpdate(update);
  client.receive(update);
};

/** Where a block's holder is in the client's DOM. */
const placeOf = (client: LiveClient, id: string): { connected: boolean; insideTable: boolean; atRoot: boolean } => {
  const holder = client.core.moduleInstances.BlockManager.getBlockById(id)?.holder;
  const table = client.core.moduleInstances.BlockManager.getBlockById('table-1')?.holder;

  return {
    connected: holder?.isConnected === true,
    insideTable: holder !== undefined && table?.contains(holder) === true,
    atRoot: holder?.isConnected === true && holder.parentElement?.closest('[data-blok-id]') === null,
  };
};

const parentInServer = (server: DocumentStore, id: string): string | null | undefined => {
  const block = server.toJSON().find((candidate) => candidate.id === id);

  return block === undefined ? undefined : block.parent ?? null;
};

describe('table — a peer cell block that arrives before its cell', { timeout: 120000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  // COB-4: the add comes with no parent, then the parent write, then the
  // table data. A save of my table in between must not claim it for a cell.
  it.each(['row', 'column'] as const)('a peer add-%s, one frame per turn with my table saving between them, gives each new cell its own block', async (what) => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    if (what === 'row') {
      pressAddRow(b);
    } else {
      pressAddColumn(b);
    }
    await settle();

    for (const update of b.takeSent()) {
      server.applyRemoteUpdate(update);
      a.receive(update);
      await settle();
      tableBlock(a).dispatchChange();
      await settle();
    }
    await pump(server, [a, b]);

    const named = cellRefs(server, 'table-1').flat(2);
    const grid = what === 'row' ? [[1, 1], [1, 1], [1, 1]] : [[1, 1, 1], [1, 1, 1]];

    expect(cellRefs(server, 'table-1').flat().map((cell) => cell.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect({ named: named.length, distinct: new Set(named).size }).toEqual({ named: 6, distinct: 6 });
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect({ a: holderCounts(a), b: holderCounts(b) }).toEqual({ a: grid, b: grid });
    server.destroy();
  });

  it('a raw peer cell block added with no parent after the last cell, then parented, then named, is never saved into a cell before it is named', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);

    deliver(peer, server, a, () => {
      peer.addBlockAt({ id: 'new-1', type: 'paragraph', data: { text: '' } }, { parentId: null, afterId: 'c11' });
    });
    await settle();
    tableBlock(a).dispatchChange();
    await settle();
    deliver(peer, server, a, () => {
      peer.moveBlockTo('new-1', { parentId: 'table-1', afterId: 'c11' });
    });
    await settle();
    tableBlock(a).dispatchChange();
    await settle();
    await pump(server, [a]);

    expect(cellRefs(server, 'table-1')).toEqual([[['c00'], ['c01']], [['c10'], ['c11']]]);

    deliver(peer, server, a, () => {
      peer.updateBlockData('table-1', 'content', [
        [{ blocks: ['c00'] }, { blocks: ['c01'] }],
        [{ blocks: ['c10'] }, { blocks: ['c11'] }],
        [{ blocks: ['new-1'] }, { blocks: [] }],
      ]);
    });
    await settle();
    await pump(server, [a]);

    const refs = cellRefs(server, 'table-1');

    expect(refs.slice(0, 2)).toEqual([[['c00'], ['c01']], [['c10'], ['c11']]]);
    expect(refs[2][0]).toEqual(['new-1']);
    expect(holderCounts(a).slice(0, 2)).toEqual([[1, 1], [1, 1]]);
    expect(placeOf(a, 'new-1')).toEqual({ connected: true, insideTable: true, atRoot: false });
    peer.destroy();
    server.destroy();
  });
});

describe('table — inserting after a table while a peer child waits for its cell', { timeout: 120000 }, () => {
  const arrivals = ['in one frame', 'at the root, then moved'] as const;

  type Arrival = typeof arrivals[number];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  /**
   * A peer's table child that reached A under the table (in one frame, or at
   * the root and then moved), with no cell naming it: A keeps it off-screen, as the last
   * block of the table's run, so it is the flat predecessor of whatever
   * goes right after the table.
   */
  const withWaitingStray = async (arrival: Arrival): Promise<{ server: DocumentStore; a: LiveClient; peer: DocumentStore }> => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);

    if (arrival === 'in one frame') {
      deliver(peer, server, a, () => {
        peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: '' } }, { parentId: 'table-1', afterId: 'c11' });
      });
    } else {
      deliver(peer, server, a, () => {
        peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: '' } }, { parentId: null, afterId: 'table-1' });
      });
      await settle();
      deliver(peer, server, a, () => peer.moveBlockTo('stray-1', { parentId: 'table-1', afterId: 'c11' }));
    }
    await settle();

    const ids = a.core.moduleInstances.BlockManager.blocks.map((block) => block.id);

    expect({ last: ids.at(-1), connected: placeOf(a, 'stray-1').connected }).toEqual({ last: 'stray-1', connected: false });

    return { server, a, peer };
  };

  it.each(arrivals)('a block I insert after the table shows at the root and saves there (stray arrived %s)', async (arrival) => {
    const { server, a, peer } = await withWaitingStray(arrival);
    const blocks = a.core.moduleInstances.API.methods.blocks;
    const mine = blocks.insert('paragraph', { text: 'mine' }, {}, blocks.getBlocksCount(), true);

    await settle();

    expect(placeOf(a, mine.id)).toEqual({ connected: true, insideTable: false, atRoot: true });
    expect(a.core.moduleInstances.BlockManager.getBlockById(mine.id)?.parentId).toBeNull();

    await pump(server, [a]);

    expect(parentInServer(server, mine.id)).toBeNull();
    expect(cellRefs(server, 'table-1')).toEqual([[['c00'], ['c01']], [['c10'], ['c11']]]);
    peer.destroy();
    server.destroy();
  });

  it.each(arrivals)('a click below the table gives me a block at the root to type in (stray arrived %s)', async (arrival) => {
    const { server, a, peer } = await withWaitingStray(arrival);
    const bottomZone = a.core.moduleInstances.UI.nodes.wrapper.querySelector<HTMLElement>('[data-blok-bottom-zone]');

    bottomZone?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();

    const caretBlock = a.core.moduleInstances.BlockManager.currentBlock;

    expect(caretBlock === undefined ? undefined : placeOf(a, caretBlock.id)).toEqual({ connected: true, insideTable: false, atRoot: true });
    expect(caretBlock?.id).not.toBe('stray-1');
    peer.destroy();
    server.destroy();
  });

  it.each(arrivals)('a peer root block added after the table shows at the root (stray arrived %s)', async (arrival) => {
    const { server, a, peer } = await withWaitingStray(arrival);

    deliver(peer, server, a, () => {
      peer.addBlockAt({ id: 'root-2', type: 'paragraph', data: { text: 'theirs' } }, { parentId: null, afterId: 'table-1' });
    });
    await settle();

    expect(placeOf(a, 'root-2')).toEqual({ connected: true, insideTable: false, atRoot: true });
    expect(a.core.moduleInstances.BlockManager.getBlockById('root-2')?.parentId).toBeNull();
    peer.destroy();
    server.destroy();
  });
});

describe('table — a peer child that arrives already under the table with no cell naming it', { timeout: 120000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  const cellTexts = (client: LiveClient): string[][] => {
    const holder = client.core.moduleInstances.BlockManager.getBlockById('table-1')?.holder;
    const rows = Array.from(holder?.querySelectorAll('[data-blok-table-row]') ?? []);

    return rows.map((row) => Array.from(row.querySelectorAll(':scope > [data-blok-table-cell]')).map((cell) =>
      Array.from(cell.querySelectorAll('[data-blok-nested-blocks] > [data-blok-id]')).map((block) => block.textContent ?? '').join('|')));
  };

  it('stays off-screen until the table data names its cell, then shows in that cell', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);

    // One frame: the add, its parent and its place after c11 together.
    deliver(peer, server, a, () => {
      peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: 'theirs' } }, { parentId: 'table-1', afterId: 'c11' });
    });
    await settle();

    expect(childrenOf(server, 'table-1')).toEqual(['c00', 'c01', 'c10', 'c11', 'stray-1']);
    expect(placeOf(a, 'stray-1')).toEqual({ connected: false, insideTable: false, atRoot: false });
    expect(cellTexts(a)).toEqual([['A', 'B'], ['C', 'D']]);

    tableBlock(a).dispatchChange();
    await settle();
    await pump(server, [a]);

    expect(cellRefs(server, 'table-1')).toEqual([[['c00'], ['c01']], [['c10'], ['c11']]]);
    expect(parentInServer(server, 'stray-1')).toBe('table-1');

    deliver(peer, server, a, () => {
      peer.updateBlockData('table-1', 'content', [
        [{ blocks: ['c00'] }, { blocks: ['c01'] }],
        [{ blocks: ['c10'] }, { blocks: ['c11', 'stray-1'] }],
      ]);
    });
    await settle();

    expect(placeOf(a, 'stray-1')).toEqual({ connected: true, insideTable: true, atRoot: false });
    expect(cellTexts(a)).toEqual([['A', 'B'], ['C', 'D|theirs']]);
    peer.destroy();
    server.destroy();
  });

  // A peer's add-row: the add lands after the last cell block, then moves to
  // the end of the table. Add-column: it moves into the middle of the table.
  it.each([
    ['the end of the table', 'c11'],
    ['the middle of the table', 'c01'],
  ] as const)('added at the root, then moved to %s, stays off-screen until the table data names its cell', async (_where, tableAfterId) => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);

    deliver(peer, server, a, () => {
      peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: 'theirs' } }, { parentId: null, afterId: 'c11' });
    });
    await settle();

    // Mounted next to c11 it would sit in cell (1,1), and the parent write
    // only detaches a holder that joins the table from outside.
    expect(placeOf(a, 'stray-1')).toEqual({ connected: true, insideTable: false, atRoot: true });

    deliver(peer, server, a, () => peer.moveBlockTo('stray-1', { parentId: 'table-1', afterId: tableAfterId }));
    await settle();

    expect(placeOf(a, 'stray-1')).toEqual({ connected: false, insideTable: false, atRoot: false });
    expect(cellTexts(a)).toEqual([['A', 'B'], ['C', 'D']]);

    deliver(peer, server, a, () => {
      peer.updateBlockData('table-1', 'content', [
        [{ blocks: ['c00'] }, { blocks: ['c01'] }],
        [{ blocks: ['c10'] }, { blocks: ['c11', 'stray-1'] }],
      ]);
    });
    await settle();

    expect(placeOf(a, 'stray-1')).toEqual({ connected: true, insideTable: true, atRoot: false });
    expect(cellTexts(a)).toEqual([['A', 'B'], ['C', 'D|theirs']]);
    peer.destroy();
    server.destroy();
  });
});
