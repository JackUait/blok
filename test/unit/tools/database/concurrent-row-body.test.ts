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
  socket.deliver({ type: 'control', tag: { format: 1, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' } });
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

const body = (id: string, text: string): OutputData => ({
  blocks: [{ id, type: 'paragraph', data: { text } }],
});

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

const openRow = async (client: LiveClient, rowId: string): Promise<NestedEditor> => {
  const databaseHolder = client.core.moduleInstances.BlockManager.getBlockById('db-1')?.holder;
  const card = databaseHolder?.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`);

  if (card === null || card === undefined) throw new Error(`card ${rowId} was not rendered`);
  card.click();
  const editorHolder = databaseHolder?.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');

  if (editorHolder === null || editorHolder === undefined) throw new Error('drawer was not rendered');
  const editorsInHolder = (): NestedEditor[] => nestedEditors.filter(({ config }) => config.holder === editorHolder);
  const before = editorsInHolder().length;

  await waitFor(
    () => editorsInHolder().length > before,
    `nested editor for ${rowId}`,
  );
  const editor = editorsInHolder().at(-1);

  if (editor === undefined) throw new Error('nested editor was not constructed');
  return editor;
};

const editRow = async (client: LiveClient, rowId: string, next: OutputData): Promise<void> => {
  const editor = await openRow(client, rowId);

  editor.saved = next;
  await editor.config.onChange();
  await waitFor(() => {
    const schema = dataOf(client, 'db-1').schema as PropertyDefinition[] | undefined;
    const properties = dataOf(client, rowId).properties as Record<string, unknown> | undefined;

    return schema?.some((property) =>
      property.type === 'richText' && JSON.stringify(properties?.[property.id]) === JSON.stringify(next)) ?? false;
  }, `body for ${rowId} to reach the local document`);
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

  it('reopens both bodies when peers edit different rows before schema sync', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await pump([a, b]);
    const firstBody = body('body-1', 'First body');
    const secondBody = body('body-2', 'Second body');

    await editRow(a, 'row-1', firstBody);
    await editRow(b, 'row-2', secondBody);
    await pump([a, b]);

    const reopened = await bootLive();

    await pump([a, b, reopened]);
    const first = await openRow(reopened, 'row-1');
    const second = await openRow(reopened, 'row-2');

    expect([first.config.data, second.config.data]).toEqual([firstBody, secondBody]);
  });

  it('keeps a later edit on the row’s existing body property', async () => {
    const original = body('body-2', 'Second body');
    const updated = body('body-2', 'Second body edited');
    const database = server.toJSON().find((block) => block.id === 'db-1');
    const schema = (database?.data as { schema?: PropertyDefinition[] } | undefined)?.schema;

    if (schema === undefined) throw new Error('database schema was not seeded');
    server.updateBlockData('db-1', 'schema', [
      ...schema,
      { id: 'prop-body-a', name: 'Details', type: 'richText', position: 'a2' },
      { id: 'prop-body-b', name: 'Details', type: 'richText', position: 'a3' },
    ]);
    server.updateBlockData('row-2', 'properties', {
      'prop-title': 'Second',
      'prop-status': 'opt-todo',
      'prop-body-b': original,
    });

    const client = await bootLive();
    const editor = await openRow(client, 'row-2');

    editor.saved = updated;
    await editor.config.onChange();
    await waitFor(() => {
      const properties = dataOf(client, 'row-2').properties as Record<string, unknown> | undefined;
      const saved = JSON.stringify(updated);

      return JSON.stringify(properties?.['prop-body-a']) === saved
        || JSON.stringify(properties?.['prop-body-b']) === saved;
    }, 'edited body to reach the row');
    const properties = dataOf(client, 'row-2').properties as Record<string, unknown>;

    expect(properties['prop-body-b']).toEqual(updated);
    expect(properties['prop-body-a']).toBeUndefined();
  });
});
