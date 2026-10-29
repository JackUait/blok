import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import type { CollaborationConfig } from '../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
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
      tabs: { class: TabsTool as unknown as BlockToolConstructable },
      tab: { class: TabTool as unknown as BlockToolConstructable },
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
      schema: [{ id: 'prop-title', name: 'Title', type: 'title', position: 'a0', pageLayoutPlacements: [], pageLayoutSections: [] }],
      views: [{ id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  { id: 'row-1', type: 'database-row', parent: 'db-1', data: { position: 'a0', title: 'First', properties: { 'prop-title': 'First' } } },
];

const BUILDER = '[data-blok-interface="database-layout-builder"]';

const click = async (el: Element | null | undefined): Promise<void> => {
  if (el === null || el === undefined) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
};

const byTestId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

/** One peer: open the row page, turn Tabbed on, add a view tab named `name`; the builder stays open. */
const draftViewTab = async (client: LiveClient, name: string): Promise<void> => {
  const holder = client.core.moduleInstances.BlockManager.getBlockById('db-1')?.holder;

  await click(holder?.querySelector('[data-row-id="row-1"] [data-blok-database-table-open]'));
  await click(client.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-customize]'));
  await click(document.querySelectorAll(`${BUILDER} [data-blok-database-layout-structure-card]`)[1]);
  const bar = document.querySelector(`${BUILDER} [data-blok-database-drawer-tabs]`);

  bar?.dispatchEvent(new MouseEvent('pointerenter'));
  await click(bar?.querySelector('[data-blok-database-layout-add-tab]'));
  await click(byTestId('database-layout-link-data-source'));
  await click(byTestId('database-layout-source-db-1'));
  const field = byTestId('database-layout-view-name') as HTMLInputElement | null;

  if (field === null) throw new Error('no View name field');
  field.value = name;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await click(byTestId('database-layout-add-view'));
};

/** One peer, on a layout that is Tabbed already: add a view tab named `name`, Apply, close the page. */
const addViewTabOn = async (client: LiveClient, name: string): Promise<void> => {
  const holder = client.core.moduleInstances.BlockManager.getBlockById('db-1')?.holder;

  await click(holder?.querySelector('[data-row-id="row-1"] [data-blok-database-table-open]'));
  await click(client.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-customize]'));
  const bar = document.querySelector(`${BUILDER} [data-blok-database-drawer-tabs]`);

  bar?.dispatchEvent(new MouseEvent('pointerenter'));
  await click(bar?.querySelector('[data-blok-database-layout-add-tab]'));
  await click(byTestId('database-layout-link-data-source'));
  await click(byTestId('database-layout-source-db-1'));
  const field = byTestId('database-layout-view-name') as HTMLInputElement | null;

  if (field === null) throw new Error('no View name field');
  field.value = name;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await click(byTestId('database-layout-add-view'));
  await click(document.querySelector(`${BUILDER} [data-blok-database-layout-apply]`));
  await click(client.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-close]'));
};

/** One peer: add a view tab named `name`, Apply, close the page. */
const addFirstViewTab = async (client: LiveClient, name: string): Promise<void> => {
  await draftViewTab(client, name);
  await click(document.querySelector(`${BUILDER} [data-blok-database-layout-apply]`));
  await click(client.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-close]'));
};

const tabNames = (client: LiveClient): string[] =>
  [...client.core.moduleInstances.UI.nodes.wrapper.querySelectorAll('[data-blok-database-drawer-tabs] [role="tab"]')].map((tab) => tab.textContent?.trim() ?? '');

const layoutOf = (client: LiveClient): { tabsBlocks: string[]; tabTitles: string[]; tabsId: unknown } => {
  const all = client.core.moduleInstances.YjsManager.toJSON();
  const db = all.find((block) => block.id === 'db-1');
  const tabsBlocks = (db?.content ?? []).filter((id) => all.find((block) => block.id === id)?.type === 'tabs');
  const title = ((db?.data as { schema?: Array<Record<string, unknown>> }).schema ?? []).find((p) => p.type === 'title');
  const named = all.find((block) => block.id === title?.pageLayoutTabsId);
  const tabTitles = (named?.content ?? []).map((id) => String((all.find((block) => block.id === id)?.data as { title?: unknown }).title));

  return { tabsBlocks, tabTitles, tabsId: title?.pageLayoutTabsId };
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

describe('concurrent row page view tabs', { timeout: 60000 }, () => {
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Only turning Tabbed on makes no block, so two peers doing that have nothing to merge.
  it('makes no layout tabs block when two peers only turn Tabbed on', async () => {
    const a = await bootLive();
    const b = await bootLive();

    for (const client of [a, b]) {
      const holder = client.core.moduleInstances.BlockManager.getBlockById('db-1')?.holder;

      await click(holder?.querySelector('[data-row-id="row-1"] [data-blok-database-table-open]'));
      await click(client.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-customize]'));
      await click(document.querySelectorAll(`${BUILDER} [data-blok-database-layout-structure-card]`)[1]);
      await click(document.querySelector(`${BUILDER} [data-blok-database-layout-apply]`));
      await click(client.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-close]'));
    }
    await pump([a, b]);

    expect(layoutOf(a).tabsBlocks).toEqual([]);
    expect(layoutOf(b).tabsBlocks).toEqual([]);
  });

  it('two peers each adding the first view tab end with one layout tabs block holding both tabs', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await addFirstViewTab(a, 'From A');
    await addFirstViewTab(b, 'From B');
    await pump([a, b]);

    for (const client of [a, b]) {
      const layout = layoutOf(client);

      expect(layout.tabsBlocks).toEqual([layout.tabsId]);
      expect([...layout.tabTitles].sort()).toEqual(['', 'From A', 'From B']);
      const blocks = client.core.moduleInstances.BlockManager;
      const winner = blocks.getBlockById(String(layout.tabsId));

      expect(winner?.contentIds.every((id) => winner.holder.contains(blocks.getBlockById(id)?.holder ?? null))).toBe(true);
      // What each peer shows: its row page lists all three tabs, and the tabs holder is mounted.
      await click(blocks.getBlockById('db-1')?.holder.querySelector('[data-row-id="row-1"] [data-blok-database-table-open]'));

      expect([...tabNames(client)].sort()).toEqual(['Content', 'From A', 'From B']);
      expect(winner?.holder.isConnected).toBe(true);
      expect(winner?.holder.closest('[data-blok-database-layout-pool], [data-blok-database-drawer-tab-panel]')).not.toBeNull();
      await click(client.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-close]'));
    }
    expect(layoutOf(a)).toEqual(layoutOf(b));
  });

  /** Every content id names a block that exists, under that parent. */
  const danglingIds = (client: LiveClient): string[] => {
    const all = client.core.moduleInstances.YjsManager.toJSON();

    return all.flatMap((block) => (block.content ?? []).filter((id) => all.find((child) => child.id === id)?.parent !== block.id));
  };

  for (const undoer of ['winner', 'loser'] as const) {
    it(`converges after the ${undoer}'s maker undoes its Apply once two tabs blocks merged`, async () => {
      const a = await bootLive();
      const b = await bootLive();

      await addFirstViewTab(a, 'From A');
      await addFirstViewTab(b, 'From B');
      await pump([a, b]);
      // The winner's own tab comes right after Content; the loser's was copied in after it.
      const aWon = layoutOf(a).tabTitles[1] === 'From A';
      const client = (undoer === 'winner') === aWon ? a : b;

      client.core.moduleInstances.YjsManager.undo();
      await settle();
      await pump([a, b]);

      expect(danglingIds(a)).toEqual([]);
      expect(danglingIds(b)).toEqual([]);
      const layoutBlocks = (peer: LiveClient): unknown => peer.core.moduleInstances.YjsManager.toJSON()
        .filter((block) => block.type !== 'database-row')
        .map((block) => [block.id, block.type, block.parent ?? null, block.content ?? [], (block.data as { title?: unknown }).title ?? '']);

      expect(layoutBlocks(a)).toEqual(layoutBlocks(b));
      for (const peer of [a, b]) {
        const all = peer.core.moduleInstances.YjsManager.toJSON();
        // A view tab is a tab holding a database: what each row page must list after Content.
        const views = all.filter((block) => block.type === 'tab' && all.some((child) => child.parent === block.id && child.type === 'database'))
          .map((block) => String((block.data as { title?: unknown }).title));
        const structure = (((all.find((block) => block.id === 'db-1')?.data as { schema: Array<Record<string, unknown>> }).schema)
          .find((p) => p.type === 'title'))?.pageLayoutStructure;

        await click(peer.core.moduleInstances.BlockManager.getBlockById('db-1')?.holder.querySelector('[data-row-id="row-1"] [data-blok-database-table-open]'));

        // A view tab is never drawn as Content.
        expect(tabNames(peer)).toEqual(structure === 'tabbed' ? ['Content', ...views] : []);
        await click(peer.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-close]'));
      }
    });
  }

  // research/13 §3a: a reorder applied while a peer added a tab keeps that tab.
  it('applies a reorder from "N more…" on both peers, and keeps a tab a peer added meanwhile', async () => {
    const views = ['V1', 'V2', 'V3'];

    server.destroy();
    server = new DocumentStore(new YBlockSerializer());
    server.fromJSON([
      {
        id: 'db-1',
        type: 'database',
        data: {
          ...seedBlocks[0].data,
          schema: [{ id: 'prop-title', name: 'Title', type: 'title', position: 'a0', pageLayoutPlacements: [], pageLayoutSections: [], pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' }],
        },
        content: ['row-1', 'lt'],
      },
      { id: 'row-1', type: 'database-row', data: seedBlocks[1].data, parent: 'db-1' },
      { id: 'lt', type: 'tabs', data: {}, parent: 'db-1', content: ['tc', ...views.map((_, i) => `tv${i}`)] },
      { id: 'tc', type: 'tab', data: { title: '' }, parent: 'lt' },
      ...views.flatMap((name, i) => [
        { id: `tv${i}`, type: 'tab', data: { title: name }, parent: 'lt', content: [`lv${i}`] },
        {
          id: `lv${i}`,
          type: 'database',
          parent: `tv${i}`,
          data: {
            title: '',
            schema: [{ id: 'prop-title', name: 'Title', type: 'title', position: 'a0' }],
            views: [{ id: `lvv${i}`, name, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
            activeViewId: `lvv${i}`,
            source: { databaseId: 'db-1' },
          },
        },
      ]),
    ]);
    // jsdom lays nothing out: a 330px bar holds Content, one 100px tab, Add tab and "N more…".
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: ResizeObserverCallback) {}

      public observe(): void {
        queueMicrotask(() => this.callback([], this));
      }

      public unobserve(): void {}

      public disconnect(): void {}
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.hidden || this.closest('[data-blok-database-drawer-tabs]') === null) return 0;
      if (this.getAttribute('role') === 'tab') return 100;

      return this.hasAttribute('data-blok-database-tab-more') ? 60 : 28;
    });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.matches('[data-blok-database-drawer-tabs]') ? 330 : 0;
    });
    const a = await bootLive();
    const b = await bootLive();

    await addViewTabOn(b, 'From B');
    const holder = a.core.moduleInstances.BlockManager.getBlockById('db-1')?.holder;

    await click(holder?.querySelector('[data-row-id="row-1"] [data-blok-database-table-open]'));
    await click(a.core.moduleInstances.UI.nodes.wrapper.querySelector('[data-blok-database-drawer-customize]'));
    await click(document.querySelector(`${BUILDER} [data-blok-database-tab-more]`));
    const rows = [...document.querySelectorAll<HTMLElement>('[data-blok-database-tab-overflow-item]')];

    rows.forEach((row, index) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 28, 290, 28));
    });
    // V3 (row 3) above V1's middle (row 1).
    rows[3]?.querySelector('[data-blok-database-tab-overflow-handle]')?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientY: 30 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientY: 30 }));
    document.querySelector('[data-blok-database-tab-overflow-dropdown] input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();

    // B's tab arrives while A's draft is open.
    await pump([a, b]);
    await click(document.querySelector(`${BUILDER} [data-blok-database-layout-apply]`));
    await pump([a, b]);

    for (const client of [a, b]) {
      expect(layoutOf(client).tabTitles).toEqual(['', 'V3', 'V1', 'V2', 'From B']);
    }
  });

  // research/11 §1: Discard removes tabs made in the session, even after a peer's tabs block won.
  it('Discard removes a drafted tab after a peer applied the first view tab meanwhile', async () => {
    const a = await bootLive();
    const b = await bootLive();

    // Neither has seen the other: B applies its first tab while A drafts one.
    await addFirstViewTab(b, 'From B');
    await draftViewTab(a, 'Draft A');
    await pump([a, b]);
    await click(document.querySelector(`${BUILDER} [data-blok-database-layout-cancel]`));
    await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));
    await pump([a, b]);

    for (const client of [a, b]) {
      expect(layoutOf(client).tabTitles).toEqual(['', 'From B']);
      expect(client.core.moduleInstances.YjsManager.toJSON().some((block) => (block.data as { title?: unknown }).title === 'Draft A')).toBe(false);
    }
  });
});
