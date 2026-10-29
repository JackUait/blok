import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import type { CollaborationConfig } from '../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseTool } from '../../../../src/tools/database';
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

vi.mock('../../../../src/components/utils/editor-constructor', () => ({
  loadEditorConstructor: async () => class MockBlok {
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

type RelayedFrame = Extract<SyncWireFrame, { type: 'update' | 'awareness' }>;

interface LiveClient {
  core: Core;
  takeSent: () => RelayedFrame[];
  receive: (frame: RelayedFrame) => void;
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
      const frames = socket.sent.slice(taken).map(decode).flatMap((frame) => (frame.type === 'update' || frame.type === 'awareness' ? [frame] : []));

      taken = socket.sent.length;
      return frames;
    },
    receive: (frame) => socket.deliver(frame),
  };
};

/** Document updates go through the server; presence goes peer to peer, as the room relays it. */
const pump = async (clients: LiveClient[]): Promise<void> => {
  for (let round = 0; round < 20; round++) {
    const batches = clients.map((client) => ({ client, frames: client.takeSent() }));
    const moved = batches.some(({ frames }) => frames.some((frame) => frame.type === 'update'));

    batches.forEach(({ client, frames }) => frames.forEach((frame) => {
      if (frame.type === 'update') server.applyRemoteUpdate(frame.update);
      clients.filter((other) => other !== client).forEach((other) => other.receive(frame));
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
      title: 'Projects',
      schema: [{ id: 'prop-title', name: 'Title', type: 'title', position: 'a0' }],
      views: [
        { id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
        { id: 'view-2', name: 'Board', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: [] },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  { id: 'row-1', type: 'database-row', parent: 'db-1', data: { position: 'a0', title: 'First', properties: { 'prop-title': 'First' } } },
];

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


const databaseRoot = (client: LiveClient): HTMLElement => {
  const root = client.core.moduleInstances.UI.nodes.wrapper.querySelector<HTMLElement>('[data-blok-element][data-blok-id="db-1"]');

  if (root === null) throw new Error('no database');

  return root;
};

const ownTabs = (client: LiveClient): HTMLElement[] => {
  const root = databaseRoot(client);

  return [...root.querySelectorAll<HTMLElement>('[role="tab"]')].filter((tab) => tab.closest('[data-blok-element]') === root);
};

const sourceIds = (client: LiveClient): string[] => client.core.moduleInstances.YjsManager.toJSON()
  .filter((block) => block.type === 'database' && block.parent === 'db-1').map((block) => block.id)
  .filter((id): id is string => id !== undefined);

describe('New data source between peers', { timeout: 60000 }, () => {
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

  it('a peer gets the new source hidden, with no chrome, and the new tab in its own bar', async () => {
    const a = await bootLive();
    const b = await bootLive();
    const add = [...databaseRoot(a).querySelectorAll<HTMLElement>('[data-blok-database-add-view]')].find((el) => el.closest('[data-blok-element]') === databaseRoot(a));

    add?.click();
    await settle();
    expect(document.querySelectorAll('[data-blok-database-view-option]').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-blok-database-view-new-source]')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-blok-database-view-new-source]')?.click();
    await settle();
    expect(add).toBeDefined();
    expect(sourceIds(a)).toHaveLength(1);
    await pump([a, b]);

    const [sourceId] = sourceIds(b);
    const holder = databaseRoot(b).querySelector<HTMLElement>(`[data-blok-id="${sourceId}"]`);

    expect(sourceId).toBeDefined();
    expect(ownTabs(b)).toHaveLength(3);
    expect(holder?.closest('[hidden]')).not.toBeNull();
    expect(holder?.querySelector('[data-blok-database-tab-bar], [data-blok-database-title]')).toBeNull();
    // Only the peer that clicked gets the "New data source" panel.
    expect(document.querySelectorAll('[data-blok-testid="database-new-source-panel"]')).toHaveLength(1);
  });

  it('a view moved back to the database\'s own data shows its rows on a peer too', async () => {
    const a = await bootLive();
    const b = await bootLive();
    const own = (client: LiveClient, selector: string): HTMLElement | undefined =>
      [...databaseRoot(client).querySelectorAll<HTMLElement>(selector)].find((el) => el.closest('[data-blok-element]') === databaseRoot(client));

    own(a, '[data-blok-database-add-view]')?.click();
    await settle();
    document.querySelector<HTMLElement>('[data-blok-database-view-new-source]')?.click();
    await settle();
    await pump([a, b]);
    const views = (client: LiveClient): Array<{ id: string; dataSourceId?: string }> =>
      (client.core.moduleInstances.YjsManager.toJSON().find((block) => block.id === 'db-1')?.data as { views: Array<{ id: string; dataSourceId?: string }> }).views;
    const bound = views(b).find((view) => view.dataSourceId !== undefined);

    expect(bound).toBeDefined();
    own(a, '[data-blok-testid="database-toolbar-settings"]')?.click();
    await settle();
    document.querySelector<HTMLElement>('[data-blok-testid="database-settings-source"]')?.click();
    await settle();
    document.querySelector<HTMLElement>('[data-blok-testid="database-source-option-db-1"]')?.click();
    await settle();
    await pump([a, b]);

    expect(views(b).find((view) => view.id === bound?.id)?.dataSourceId).toBeUndefined();
    own(b, `[role="tab"][data-view-id="${bound?.id ?? ''}"]`)?.click();
    await settle();
    expect(own(b, '[data-blok-database-board-container]')?.textContent).toContain('First');
  });
});
