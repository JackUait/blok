import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import type { CollaborationConfig } from '../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseTool } from '../../../../src/tools/database';
import type { PropertyDefinition } from '../../../../src/tools/database/types';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { OutputBlockData, OutputData } from '../../../../types';
import type { BlockToolConstructable } from '../../../../types/tools';

interface NestedEditorConfig {
  holder: HTMLElement;
  data?: OutputData;
  onChange: () => Promise<void>;
}

interface NestedEditor {
  config: NestedEditorConfig;
  saved: OutputData;
}

const nestedEditors = vi.hoisted((): NestedEditor[] => []);

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();
    readonly i18n = { update: async () => undefined };
    private readonly entry: NestedEditor;

    constructor(config: NestedEditorConfig) {
      this.entry = { config, saved: config.data ?? { blocks: [] } };
      nestedEditors.push(this.entry);
    }

    save(): Promise<OutputData> {
      return Promise.resolve(this.entry.saved);
    }

    destroy(): void {}
  },
}));

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
    if (this.readyState !== 1) return;
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

interface LiveClient {
  core: Core;
  takeSent: () => Uint8Array[];
  receive: (update: Uint8Array) => void;
}

const holders: HTMLElement[] = [];
const booted: Core[] = [];
let server: DocumentStore;

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 15000;

  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
};

const bootLive = async (): Promise<LiveClient> => {
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
      database: { class: DatabaseTool as unknown as BlockToolConstructable },
      'database-row': { class: DatabaseRowTool as unknown as BlockToolConstructable },
    },
    server: 'https://sync.test/api/',
    collaboration,
  });

  await core.isReady;
  booted.push(core);

  const socket = sockets.at(-1);

  if (socket === undefined) throw new Error('no socket was opened');
  socket.open();
  socket.deliver({ type: 'control', tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' } });
  socket.deliver({
    type: 'syncStep2',
    update: server.encodeStateAsUpdate(core.moduleInstances.YjsManager.getStateVector()),
  });
  await waitFor(() => !core.moduleInstances.ReadOnly.isEnabled, 'editor to become writable');
  await settle();

  let taken = 0;

  return {
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

const pump = async (clients: LiveClient[]): Promise<void> => {
  for (let round = 0; round < 20; round++) {
    const batches = clients.map((client) => ({ client, updates: client.takeSent() }));
    const moved = batches.some(({ updates }) => updates.length > 0);

    batches.forEach(({ client, updates }) => updates.forEach((update) => {
      server.applyRemoteUpdate(update);
      clients.filter((other) => other !== client).forEach((other) => other.receive(update));
    }));
    await settle();
    if (!moved) return;
  }
  throw new Error('collaboration updates did not settle');
};

const seedBlocks: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: {
          options: [{ id: 'opt-todo', label: 'Todo', position: 'a0' }],
        } },
      ],
      views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'view-1',
    },
    content: ['row-1', 'row-2'],
  },
  {
    id: 'row-1',
    type: 'database-row',
    parent: 'db-1',
    data: { position: 'a0', title: 'First', properties: { 'prop-title': 'First', 'prop-status': 'opt-todo' } },
  },
  {
    id: 'row-2',
    type: 'database-row',
    parent: 'db-1',
    data: { position: 'a1', title: 'Second', properties: { 'prop-title': 'Second', 'prop-status': 'opt-todo' } },
  },
];

const dataOf = (client: LiveClient, id: string): Record<string, unknown> =>
  client.core.moduleInstances.YjsManager.toJSON().find((block) => block.id === id)?.data ?? {};

const seedSchema = (): PropertyDefinition[] =>
  (seedBlocks[0].data as { schema: PropertyDefinition[] }).schema;

const childrenOf = (client: LiveClient, parentId: string): OutputBlockData[] => {
  const all = client.core.moduleInstances.YjsManager.toJSON();
  const ids = all.find((block) => block.id === parentId)?.content ?? [];

  return ids.flatMap((id) => all.filter((block) => block.id === id && block.parent === parentId));
};

const textOf = (data: unknown): string => {
  const text = (data as { text?: unknown } | undefined)?.text;

  if (typeof text === 'string') {
    return text.replace(/<[^>]*>/g, '');
  }

  return Array.isArray(text) ? text.map((segment: { text?: string }) => segment.text ?? '').join('') : '';
};

const openCard = (client: LiveClient, rowId: string): void => {
  const databaseHolder = client.core.moduleInstances.BlockManager.getBlockById('db-1')?.holder;
  const card = databaseHolder?.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`);

  if (card === null || card === undefined) throw new Error(`card ${rowId} was not rendered`);
  card.click();
};

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

describe('concurrent database row bodies', { timeout: 60000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nestedEditors.length = 0;
    server = new DocumentStore(new YBlockSerializer());
    server.fromJSON(seedBlocks.map((block) => ({
      id: block.id ?? '',
      type: block.type,
      data: block.data,
      ...(block.parent !== undefined ? { parent: block.parent } : {}),
      ...(block.content !== undefined ? { content: block.content } : {}),
    })));
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    server.destroy();
    vi.restoreAllMocks();
  });

  it('keeps both bodies when peers write into different rows', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await pump([a, b]);
    a.core.moduleInstances.API.methods.blocks.insertAt('paragraph', { text: 'First body' }, { parentId: 'row-1', id: 'body-1' });
    b.core.moduleInstances.API.methods.blocks.insertAt('paragraph', { text: 'Second body' }, { parentId: 'row-2', id: 'body-2' });
    await pump([a, b]);

    const reopened = await bootLive();

    await pump([a, b, reopened]);

    expect(childrenOf(reopened, 'row-1').map((block) => textOf(block.data))).toEqual(['First body']);
    expect(childrenOf(reopened, 'row-2').map((block) => textOf(block.data))).toEqual(['Second body']);
  });

  it('merges two peers typing into the same body paragraph', async () => {
    const a = await bootLive();

    a.core.moduleInstances.API.methods.blocks.insertAt('paragraph', { text: 'Hello' }, { parentId: 'row-1', id: 'body-1' });
    const b = await bootLive();

    await pump([a, b]);
    await a.core.moduleInstances.API.methods.blocks.update('body-1', { text: 'Hello from A' });
    await b.core.moduleInstances.API.methods.blocks.update('body-1', { text: 'B says Hello' });
    await pump([a, b]);

    const merged = [a, b].map((client) => textOf(childrenOf(client, 'row-1')[0]?.data));

    expect(merged[0]).toBe(merged[1]);
    expect(merged[0]).toContain('from A');
    expect(merged[0]).toContain('B says');
  });

  it('converts a legacy body once when two peers open the row at the same time', async () => {
    server.updateBlockData('db-1', 'schema', [
      ...seedSchema(),
      { id: 'prop-body', name: 'Details', type: 'richText', position: 'a2' },
    ]);
    server.updateBlockData('row-1', 'properties', {
      'prop-title': 'First',
      'prop-status': 'opt-todo',
      'prop-body': { blocks: [{ id: 'x', type: 'paragraph', data: { text: 'Legacy' } }, { id: 'y', type: 'paragraph', data: { text: 'Body' } }] },
    });
    const a = await bootLive();
    const b = await bootLive();

    await pump([a, b]);
    openCard(a, 'row-1');
    openCard(b, 'row-1');
    await pump([a, b]);

    for (const client of [a, b]) {
      expect(childrenOf(client, 'row-1').map((block) => textOf(block.data))).toEqual(['Legacy', 'Body']);
      expect(dataOf(client, 'row-1').bodyBlocks).toBe(true);
      expect((dataOf(client, 'row-1').properties as Record<string, unknown>)['prop-body']).toBeDefined();
    }
  });

  it('keeps a row a peer adds while another peer converts a legacy body', async () => {
    server.updateBlockData('db-1', 'schema', [
      ...seedSchema(),
      { id: 'prop-body', name: 'Details', type: 'richText', position: 'a2' },
    ]);
    server.updateBlockData('row-1', 'properties', {
      'prop-title': 'First',
      'prop-status': 'opt-todo',
      'prop-body': { blocks: [{ id: 'x', type: 'paragraph', data: { text: 'Legacy' } }] },
    });
    const a = await bootLive();
    const b = await bootLive();

    await pump([a, b]);
    openCard(a, 'row-1');
    b.core.moduleInstances.API.methods.blocks.insertAt('database-row', {
      position: 'a2', title: 'Third', properties: { 'prop-title': 'Third', 'prop-status': 'opt-todo' },
    }, { parentId: 'db-1', id: 'row-3' });
    await pump([a, b]);

    for (const client of [a, b]) {
      expect(childrenOf(client, 'db-1').map((block) => block.id)).toEqual(['row-1', 'row-2', 'row-3']);
      expect(childrenOf(client, 'row-1').map((block) => textOf(block.data))).toEqual(['Legacy']);
    }
  });

  it('converges on one icon and one cover when two peers pick at once, and keeps a concurrent title edit', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await pump([a, b]);
    const rowOf = (client: LiveClient): ReturnType<typeof client.core.moduleInstances.API.methods.blocks.getById> =>
      client.core.moduleInstances.API.methods.blocks.getById('row-1');

    rowOf(a)?.call('updateIcon', { icon: '🚀' });
    rowOf(a)?.call('updateCover', { cover: 'https://example.com/a.png' });
    rowOf(a)?.dispatchChange();
    rowOf(b)?.call('updateIcon', { icon: '🌱' });
    rowOf(b)?.call('updateCover', { cover: 'https://example.com/b.png' });
    rowOf(b)?.call('updateTitle', { title: 'First edited', titlePropertyId: 'prop-title' });
    rowOf(b)?.dispatchChange();
    await settle();
    await pump([a, b]);

    const icons = [a, b].map((client) => dataOf(client, 'row-1').icon);

    expect(icons[0]).toBe(icons[1]);
    expect(['🚀', '🌱']).toContain(icons[0]);
    expect(dataOf(a, 'row-1').title).toBe('First edited');
    expect(dataOf(a, 'row-1').cover).toBe(dataOf(b, 'row-1').cover);
    expect(['https://example.com/a.png', 'https://example.com/b.png']).toContain(dataOf(a, 'row-1').cover);
  });
});
