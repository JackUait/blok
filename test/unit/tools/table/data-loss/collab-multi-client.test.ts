/**
 * Table data loss across collaborating editors. Every editor is a real Core on
 * a real Yjs doc; the "server" is a DocumentStore that every update is written
 * into and relayed from, one frame at a time, the way the sync server relays.
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

const textOf = (server: DocumentStore, id: string): string | undefined => {
  const block = server.toJSON().find((candidate) => candidate.id === id);

  return (block?.data as { text?: string } | undefined)?.text;
};

/** Every authored text the table shows, by cell, read from the server doc. */
const visibleTexts = (server: DocumentStore, tableId: string): string[][] =>
  cellRefs(server, tableId).map((row) => row.map((ids) => ids.map((id) => textOf(server, id) ?? '<missing>').join('|')));

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

const typeInto = (client: LiveClient, blockId: string, text: string): void => {
  const editable = client.core.moduleInstances.BlockManager.getBlockById(blockId)?.pluginsContent;

  if (editable === null || editable === undefined) {
    throw new Error(`${client.name} has no editable for ${blockId}`);
  }
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  client.core.moduleInstances.BlockManager.getBlockById(blockId)?.dispatchChange();
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

const clientIdOf = (client: LiveClient): number =>
  (client.core.moduleInstances.YjsManager as unknown as { documentStore: DocumentStore }).documentStore.blocksMap.doc?.clientID ?? 0;

interface TableToolHandle {
  deleteRowWithCleanup: (index: number) => void;
  deleteColumnWithCleanup: (index: number) => void;
}

const tableTool = (client: LiveClient, tableId = 'table-1'): TableToolHandle =>
  (client.core.moduleInstances.BlockManager.getBlockById(tableId) as unknown as { toolInstance: TableToolHandle }).toolInstance;

/** What each cell shows in the client's DOM: its block holders' texts joined by "|". */
const holderCounts = (client: LiveClient, tableId = 'table-1'): number[][] => {
  const holder = client.core.moduleInstances.BlockManager.getBlockById(tableId)?.holder;
  const rows = Array.from(holder?.querySelectorAll('[data-blok-table-row]') ?? []);

  return rows.map((row) => Array.from(row.querySelectorAll(':scope > [data-blok-table-cell]')).map((cell) =>
    cell.querySelectorAll('[data-blok-nested-blocks] > [data-blok-id]').length));
};

const shownCells = (client: LiveClient, tableId = 'table-1'): string[][] => {
  const holder = client.core.moduleInstances.BlockManager.getBlockById(tableId)?.holder;
  const rows = Array.from(holder?.querySelectorAll('[data-blok-table-row]') ?? []);

  return rows.map((row) => Array.from(row.querySelectorAll(':scope > [data-blok-table-cell]')).map((cell) =>
    Array.from(cell.querySelectorAll('[data-blok-nested-blocks] > [data-blok-id]')).map((block) => block.textContent ?? '').join('|')));
};

describe('table — collaborative data loss', { timeout: 60000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  it.each([
    ['in one update', false],
    ['in two steps (add at root, then reparent)', true],
  ])('a peer child with no cell reference, arriving %s, is not written into cell (0,0)', async (_label, twoStep) => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    if (twoStep) {
      peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: '' } }, { parentId: null, afterId: 'table-1' });
      const first = peer.encodeStateAsUpdate(before);
      const mid = peer.getStateVector();

      peer.moveBlockTo('stray-1', { parentId: 'table-1', afterId: 'c11' });
      const second = peer.encodeStateAsUpdate(mid);

      [first, second].forEach((update) => {
        server.applyRemoteUpdate(update);
        a.receive(update);
      });
    } else {
      peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: '' } }, { parentId: 'table-1', afterId: 'c11' });
      const update = peer.encodeStateAsUpdate(before);

      server.applyRemoteUpdate(update);
      a.receive(update);
    }
    await settle();

    // Any later save of the table by A.
    tableBlock(a).dispatchChange();
    await settle();
    await pump(server, [a]);

    expect(cellRefs(server, 'table-1')).toEqual([[['c00'], ['c01']], [['c10'], ['c11']]]);

    peer.destroy();
    server.destroy();
  });
  it('two editors converting the same legacy table before either relays keep one resolvable set of cells', async () => {
    const server = roomWith([
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] } },
    ]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);

    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect(visibleTexts(server, 'table-1')).toEqual([['A', 'B'], ['C', 'D']]);
    server.destroy();
  });

  it('a row a peer adds reaches me and the server with resolvable cells', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    pressAddRow(b);
    await settle();
    await pump(server, [a, b]);

    expect(cellRefs(server, 'table-1')).toHaveLength(3);
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect(visibleTexts(server, 'table-1').slice(0, 2)).toEqual([['A', 'B'], ['C', 'D']]);
    server.destroy();
  });

  it('two peers adding a row at the same time keep both rows resolvable', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    pressAddRow(a);
    pressAddRow(b);
    await settle();
    await pump(server, [a, b]);

    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect(visibleTexts(server, 'table-1').slice(0, 2)).toEqual([['A', 'B'], ['C', 'D']]);
    server.destroy();
  });

  it('a peer adding a column while I add a row keeps every cell resolvable', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    pressAddRow(a);
    pressAddColumn(b);
    await settle();
    await pump(server, [a, b]);

    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect(visibleTexts(server, 'table-1').slice(0, 2).map((row) => row.slice(0, 2))).toEqual([['A', 'B'], ['C', 'D']]);
    server.destroy();
  });

  it('text I type in a cell survives a peer editing another cell at the same time', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    typeInto(a, 'c00', 'typed by A');
    typeInto(b, 'c11', 'typed by B');
    await settle();
    await pump(server, [a, b]);

    expect(visibleTexts(server, 'table-1')).toEqual([['typed by A', 'B'], ['C', 'typed by B']]);
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    server.destroy();
  });

  it.each([
    ['the editor whose conversion loses the race', 'loser'],
    ['the editor whose conversion wins the race', 'winner'],
  ])('text typed into a freshly converted legacy cell before relay survives a concurrent conversion, typed by %s', async (_label, role) => {
    const server = roomWith([
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] } },
    ]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');
    // Concurrent sets of one Y.Map key resolve to the higher client id.
    const [low, high] = [a, b].sort((x, y) => clientIdOf(x) - clientIdOf(y));
    const writer = role === 'loser' ? low : high;
    const ownTextA = writer.core.moduleInstances.BlockManager.blocks
      .filter((block) => block.parentId === 'table-1')
      .find((block) => block.pluginsContent.textContent === 'A')?.id;

    if (ownTextA === undefined) {
      throw new Error('no cell block holding A');
    }
    typeInto(writer, ownTextA, 'edited');
    await settle();
    await pump(server, [a, b]);

    expect(visibleTexts(server, 'table-1')[0][0]).toBe('edited');
    server.destroy();
  });

  it.each([
    ['in one round', false],
    ['one frame per turn, the winner\'s frames first', true],
  ])('text both editors type into the same freshly converted legacy cell before relay all survives, relayed %s', async (_label, perFrame) => {
    const server = roomWith([
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] } },
    ]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');
    const [low, high] = [a, b].sort((x, y) => clientIdOf(x) - clientIdOf(y));
    const ownTextA = (client: LiveClient): string => client.core.moduleInstances.BlockManager.blocks
      .filter((block) => block.parentId === 'table-1')
      .find((block) => block.pluginsContent.textContent === 'A')?.id ?? '';

    typeInto(low, ownTextA(low), 'by loser');
    typeInto(high, ownTextA(high), 'by winner');
    await settle();

    if (perFrame) {
      const deliveries = [
        ...high.takeSent().map((update) => ({ update, target: low })),
        ...low.takeSent().map((update) => ({ update, target: high })),
      ];

      for (const { update, target } of deliveries) {
        server.applyRemoteUpdate(update);
        target.receive(update);
        await settle();
      }
    }
    await pump(server, [a, b]);

    const sorted = (cell: string): string[] => cell.split('|').sort();

    expect(sorted(visibleTexts(server, 'table-1')[0][0])).toEqual(['by loser', 'by winner']);
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect({ A: shownCells(a), B: shownCells(b) }).toEqual({ A: visibleTexts(server, 'table-1'), B: visibleTexts(server, 'table-1') });
    server.destroy();
  });

  it('text the losing editor types into a freshly converted legacy cell just as the winning conversion arrives survives', async () => {
    const server = roomWith([
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] } },
    ]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');
    const [low, high] = [a, b].sort((x, y) => clientIdOf(x) - clientIdOf(y));
    const ownTextA = low.core.moduleInstances.BlockManager.blocks
      .filter((block) => block.parentId === 'table-1')
      .find((block) => block.pluginsContent.textContent === 'A')?.id ?? '';
    const fromHigh = high.takeSent();

    typeInto(low, ownTextA, 'by loser');
    fromHigh.forEach((update) => {
      server.applyRemoteUpdate(update);
      low.receive(update);
    });
    await settle();
    await pump(server, [a, b]);

    expect(visibleTexts(server, 'table-1')[0][0]).toBe('by loser');
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect({ A: shownCells(a), B: shownCells(b) }).toEqual({ A: visibleTexts(server, 'table-1'), B: visibleTexts(server, 'table-1') });
    server.destroy();
  });

  it('undoing text typed into a converted legacy cell, after a concurrent conversion won, takes the cell back to its legacy text', async () => {
    const server = roomWith([
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] } },
    ]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');
    const [loser] = [a, b].sort((x, y) => clientIdOf(x) - clientIdOf(y));
    const ownTextA = loser.core.moduleInstances.BlockManager.blocks
      .filter((block) => block.parentId === 'table-1')
      .find((block) => block.pluginsContent.textContent === 'A')?.id;

    if (ownTextA === undefined) {
      throw new Error('no cell block holding A');
    }
    typeInto(loser, ownTextA, 'edited');
    await settle();
    await pump(server, [a, b]);

    expect(visibleTexts(server, 'table-1')[0][0]).toBe('edited');

    loser.core.moduleInstances.YjsManager.stopCapturing();
    loser.core.moduleInstances.YjsManager.undo();
    await settle();
    await pump(server, [a, b]);

    expect({ server: visibleTexts(server, 'table-1'), A: shownCells(a), B: shownCells(b) }).toEqual({
      server: [['A', 'B'], ['C', 'D']],
      A: [['A', 'B'], ['C', 'D']],
      B: [['A', 'B'], ['C', 'D']],
    });
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    server.destroy();
  });

  it('a peer child with no cell reference is not written into cell (0,0) after a remote table write rebuilds my grid', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: 'stray' } }, { parentId: 'table-1', afterId: 'c11' });
    const addUpdate = peer.encodeStateAsUpdate(before);
    const mid = peer.getStateVector();

    // Any table data write from the peer: here, turning the heading row on.
    peer.updateBlockData('table-1', 'withHeadings', true);
    const dataUpdate = peer.encodeStateAsUpdate(mid);

    [addUpdate, dataUpdate].forEach((update) => {
      server.applyRemoteUpdate(update);
      a.receive(update);
    });
    await settle();

    // Any later save of the table by A.
    tableBlock(a).dispatchChange();
    await settle();
    await pump(server, [a]);

    expect(cellRefs(server, 'table-1')).toEqual([[['c00'], ['c01']], [['c10'], ['c11']]]);

    peer.destroy();
    server.destroy();
  });

  it('after two editors convert the same legacy table concurrently, a later table save writes no extra blocks into cell (0,0)', async () => {
    const server = roomWith([
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] } },
    ]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);

    tableBlock(a).dispatchChange();
    tableBlock(b).dispatchChange();
    await settle();
    await pump(server, [a, b]);

    expect(cellRefs(server, 'table-1').map((row) => row.map((ids) => ids.length))).toEqual([[1, 1], [1, 1]]);
    expect(visibleTexts(server, 'table-1')).toEqual([['A', 'B'], ['C', 'D']]);
    server.destroy();
  });

  it('after two editors convert the same legacy table concurrently, each shows exactly one block per cell', async () => {
    const server = roomWith([
      { id: 'table-1', type: 'table', data: { withHeadings: false, content: [['A', 'B'], ['C', 'D']] } },
    ]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);

    expect({ A: shownCells(a), B: shownCells(b) }).toEqual({ A: [['A', 'B'], ['C', 'D']], B: [['A', 'B'], ['C', 'D']] });
    server.destroy();
  });

  it('a peer child with no cell reference does not show up in my cell (0,0)', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: 'stray' } }, { parentId: 'table-1', afterId: 'c11' });
    const update = peer.encodeStateAsUpdate(before);

    server.applyRemoteUpdate(update);
    a.receive(update);
    await settle();

    expect(shownCells(a)).toEqual([['A', 'B'], ['C', 'D']]);
    peer.destroy();
    server.destroy();
  });

  it('a peer block no cell references gives me nowhere to type it in', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: '' } }, { parentId: 'table-1', afterId: 'c11' });
    const update = peer.encodeStateAsUpdate(before);

    server.applyRemoteUpdate(update);
    a.receive(update);
    await settle();

    // Typing into a block no cell names would be lost on the next load.
    const holder = a.core.moduleInstances.BlockManager.getBlockById('stray-1')?.holder;

    expect(holder?.isConnected ?? false).toBe(false);
    expect(shownCells(a)[0][0]).toBe('A');
    peer.destroy();
    server.destroy();
  });

  it('a peer child shown in my cell (0,0) is not written into cell (0,0) after a read-only round trip', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: 'stray' } }, { parentId: 'table-1', afterId: 'c11' });
    const update = peer.encodeStateAsUpdate(before);

    server.applyRemoteUpdate(update);
    a.receive(update);
    await settle();

    await a.core.moduleInstances.ReadOnly.set(true);
    await settle();
    await a.core.moduleInstances.ReadOnly.set(false);
    await settle();
    tableBlock(a).dispatchChange();
    await settle();
    await pump(server, [a]);

    expect(cellRefs(server, 'table-1')).toEqual([[['c00'], ['c01']], [['c10'], ['c11']]]);
    peer.destroy();
    server.destroy();
  });

  it('a tab that opens between the frames of a peer\'s add-row keeps every cell of the new row resolvable', { timeout: 180000 }, async () => {
    const base = roomWith(blockFormatTable());
    const b = await bootLive(base, 'B');

    await pump(base, [b]);
    const baseline = base.encodeStateAsUpdate();

    pressAddRow(b);
    await settle();
    const frames = b.takeSent();

    const failures: string[] = [];

    for (let cut = 1; cut < frames.length; cut++) {
      const server = new DocumentStore(new YBlockSerializer());

      server.applyRemoteUpdate(baseline);
      frames.slice(0, cut).forEach((update) => server.applyRemoteUpdate(update));
      const c = await bootLive(server, `C@${cut}`);

      frames.slice(cut).forEach((update) => {
        server.applyRemoteUpdate(update);
        c.receive(update);
      });
      await settle();
      await pump(server, [c]);

      const report = integrity(server);

      if (cellRefs(server, 'table-1').length !== 3 || report.missingRefs.length > 0) {
        failures.push(`cut ${cut}: rows=${cellRefs(server, 'table-1').length} missing=${report.missingRefs.join(',')} unreferenced=${report.unreferencedChildren.join(',')}`);
      }
      server.destroy();
    }

    expect(failures).toEqual([]);
    base.destroy();
  });

  it('text I type in row 2 survives a peer deleting row 1 at the same time', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    typeInto(a, 'c11', 'typed by A');
    tableTool(b).deleteRowWithCleanup(0);
    await settle();
    await pump(server, [a, b]);

    expect(visibleTexts(server, 'table-1')).toEqual([['C', 'typed by A']]);
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect({ A: shownCells(a), B: shownCells(b) }).toEqual({ A: [['C', 'typed by A']], B: [['C', 'typed by A']] });
    server.destroy();
  });

  it('text I type in column 2 survives a peer deleting column 1 at the same time', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    typeInto(a, 'c11', 'typed by A');
    tableTool(b).deleteColumnWithCleanup(0);
    await settle();
    await pump(server, [a, b]);

    expect(visibleTexts(server, 'table-1')).toEqual([['B'], ['typed by A']]);
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect({ A: shownCells(a), B: shownCells(b) }).toEqual({ A: [['B'], ['typed by A']], B: [['B'], ['typed by A']] });
    server.destroy();
  });

  it('two peers deleting different rows at the same time keep the remaining row', async () => {
    const server = roomWith([
      ...blockFormatTable(),
    ]);
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    pressAddRow(a);
    await settle();
    await pump(server, [a, b]);
    tableTool(a).deleteRowWithCleanup(0);
    tableTool(b).deleteRowWithCleanup(2);
    await settle();
    await pump(server, [a, b]);

    expect(visibleTexts(server, 'table-1')).toEqual([['C', 'D']]);
    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect({ A: shownCells(a), B: shownCells(b) }).toEqual({ A: [['C', 'D']], B: [['C', 'D']] });
    server.destroy();
  });

  it('a peer adding a column while I add a row converge on a full 3x3 grid', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    pressAddRow(a);
    pressAddColumn(b);
    await settle();
    await pump(server, [a, b]);

    const shape = (grid: string[][]): number[] => grid.map((row) => row.length);

    expect({ server: cellRefs(server, 'table-1').map((row) => row.length), A: shape(shownCells(a)), B: shape(shownCells(b)) })
      .toEqual({ server: [3, 3, 3], A: [3, 3, 3], B: [3, 3, 3] });
    expect({
      refsPerCell: cellRefs(server, 'table-1').map((row) => row.map((ids) => ids.length)),
      integrity: integrity(server),
      A: holderCounts(a),
      B: holderCounts(b),
    }).toEqual({
      refsPerCell: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
      integrity: { missingRefs: [], unreferencedChildren: [] },
      A: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
      B: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
    });
    server.destroy();
  });

  it('a tab that boots while a peer\'s child exists but its cell reference has not arrived yet keeps the peer\'s block order in that cell', async () => {
    const server = roomWith(blockFormatTable());
    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'late-1', type: 'paragraph', data: { text: 'peer text' } }, { parentId: 'table-1', afterId: 'c11' });
    const childUpdate = peer.encodeStateAsUpdate(before);
    const mid = peer.getStateVector();

    peer.updateBlockData('table-1', 'content', [
      [{ blocks: ['c00', 'late-1'] }, { blocks: ['c01'] }],
      [{ blocks: ['c10'] }, { blocks: ['c11'] }],
    ]);
    const refUpdate = peer.encodeStateAsUpdate(mid);

    server.applyRemoteUpdate(childUpdate);
    const c = await bootLive(server, 'C');

    await pump(server, [c]);
    server.applyRemoteUpdate(refUpdate);
    c.receive(refUpdate);
    await settle();
    await pump(server, [c]);

    expect({ server: visibleTexts(server, 'table-1')[0][0], shown: shownCells(c)[0][0] })
      .toEqual({ server: 'A|peer text', shown: 'A|peer text' });
    peer.destroy();
    server.destroy();
  });

  it('closing my editor sends nothing that deletes the table\'s cells', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);
    destroyCore(a.core);
    booted.splice(booted.indexOf(a.core), 1);
    a.takeSent().forEach((update) => server.applyRemoteUpdate(update));

    expect(visibleTexts(server, 'table-1')).toEqual([['A', 'B'], ['C', 'D']]);
    server.destroy();
  });

  it('a peer deleting the row I am typing in leaves both editors on one consistent table', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    typeInto(a, 'c10', 'typed by A');
    tableTool(b).deleteRowWithCleanup(1);
    await settle();
    await pump(server, [a, b]);

    expect(integrity(server)).toEqual({ missingRefs: [], unreferencedChildren: [] });
    expect(shownCells(a)).toEqual(shownCells(b));
    expect(shownCells(a)).toEqual(visibleTexts(server, 'table-1'));
    server.destroy();
  });

  it('a peer child shown in my cell (0,0) is not saved into (0,0) when the peer removes the block that cell referenced', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');

    await pump(server, [a]);

    const peer = rawPeer(server, 7);
    const before = peer.getStateVector();

    peer.addBlockAt({ id: 'stray-1', type: 'paragraph', data: { text: 'stray' } }, { parentId: 'table-1', afterId: 'c11' });
    const addUpdate = peer.encodeStateAsUpdate(before);
    const mid = peer.getStateVector();

    peer.removeBlock('c00');
    const removeUpdate = peer.encodeStateAsUpdate(mid);

    [addUpdate, removeUpdate].forEach((update) => {
      server.applyRemoteUpdate(update);
      a.receive(update);
    });
    await settle();
    tableBlock(a).dispatchChange();
    await settle();
    await pump(server, [a]);

    expect(cellRefs(server, 'table-1')[0][0]).not.toContain('stray-1');
    peer.destroy();
    server.destroy();
  });

  it('a blockless corner cell left by a concurrent add-row and add-column gets one block after a reload', async () => {
    const server = roomWith(blockFormatTable());
    const a = await bootLive(server, 'A');
    const b = await bootLive(server, 'B');

    await pump(server, [a, b]);
    pressAddRow(a);
    pressAddColumn(b);
    await settle();
    await pump(server, [a, b]);

    const c = await bootLive(server, 'C');
    const d = await bootLive(server, 'D');

    await pump(server, [a, b, c, d]);

    expect({ refs: cellRefs(server, 'table-1')[2][2].length, C: holderCounts(c)[2][2], D: holderCounts(d)[2][2] })
      .toEqual({ refs: 1, C: 1, D: 1 });
    server.destroy();
  });
});
