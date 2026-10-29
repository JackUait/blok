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

type RelayedFrame = Extract<SyncWireFrame, { type: 'update' | 'awareness' }>;

interface LiveClient {
  core: Core;
  takeSent: () => RelayedFrame[];
  receive: (frame: RelayedFrame) => void;
  /** The room was reset to `server`: the socket closes with 4409 and the client joins `lineage`. */
  relineage: (lineage: string) => Promise<void>;
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

  const current = (): MockSocket => {
    const socket = sockets.at(-1);

    if (socket === undefined) throw new Error('no socket was opened');

    return socket;
  };
  const join = async (lineage: string, writable: boolean): Promise<void> => {
    const socket = current();

    socket.open();
    socket.deliver({ type: 'control', tag: { format: 2, epoch: 0, lineage } });
    socket.deliver({
      type: 'syncStep2',
      update: server.encodeStateAsUpdate(core.moduleInstances.YjsManager.getStateVector()),
    });
    if (writable) await waitFor(() => !core.moduleInstances.ReadOnly.isEnabled, 'editor to become writable');
    await settle();
  };

  await join('0123456789abcdef0123456789abcdef', true);

  let taken = 0;

  return {
    core,
    takeSent: () => {
      const socket = current();
      const frames = socket.sent.slice(taken).map(decode).flatMap((frame) => (frame.type === 'update' || frame.type === 'awareness' ? [frame] : []));

      taken = socket.sent.length;
      return frames;
    },
    receive: (frame) => current().deliver(frame),
    relineage: async (lineage) => {
      const count = sockets.length;
      const old = current();

      old.readyState = 3;
      old.onclose?.({ code: 4409, reason: 'the room was reset' });
      await waitFor(() => sockets.length > count, 'a reconnect');
      taken = 0;
      await join(lineage, false);
    },
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
      schema: [{ id: 'prop-title', name: 'Title', type: 'title', position: 'a0', pageLayoutPlacements: [], pageLayoutSections: [] }],
      views: [{ id: 'view-1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  { id: 'row-1', type: 'database-row', parent: 'db-1', data: { position: 'a0', title: 'First', properties: { 'prop-title': 'First' } } },
];

const BUILDER = '[data-blok-interface="database-layout-builder"]';
/** The builder opened last: two peers may each have one open. */
const lastBuilder = (): Element | undefined => [...document.querySelectorAll(BUILDER)].at(-1);

const click = async (el: Element | null | undefined): Promise<void> => {
  if (el === null || el === undefined) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
};

const byTestId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);
const wrapperOf = (client: LiveClient): HTMLElement => client.core.moduleInstances.UI.nodes.wrapper;

const openRow = (client: LiveClient): Promise<void> =>
  click(client.core.moduleInstances.BlockManager.getBlockById('db-1')?.holder.querySelector('[data-row-id="row-1"] [data-blok-database-table-open]'));

/** Opens the row page and the builder; `tabbed` switches Tabbed on first. Adds a view tab named `name`; the builder stays open. */
const draftViewTab = async (client: LiveClient, name: string, tabbed: boolean): Promise<void> => {
  await openRow(client);
  await click(wrapperOf(client).querySelector('[data-blok-database-drawer-customize]'));
  if (tabbed) await click(lastBuilder()?.querySelectorAll('[data-blok-database-layout-structure-card]')[1]);
  const bar = lastBuilder()?.querySelector('[data-blok-database-drawer-tabs]');

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

const applyAndClose = async (client: LiveClient): Promise<void> => {
  await click(document.querySelector(`${BUILDER} [data-blok-database-layout-apply]`));
  await click(wrapperOf(client).querySelector('[data-blok-database-drawer-close]'));
};

const tabNames = (client: LiveClient): string[] =>
  [...wrapperOf(client).querySelectorAll('[data-blok-database-drawer-tabs] [role="tab"]')].map((tab) => tab.textContent?.trim() ?? '');

const blocksOf = (client: LiveClient): ReturnType<Core['moduleInstances']['YjsManager']['toJSON']> => client.core.moduleInstances.YjsManager.toJSON();
const tabTitled = (client: LiveClient, title: string): (ReturnType<typeof blocksOf>[number]) | undefined =>
  blocksOf(client).find((block) => block.type === 'tab' && (block.data as { title?: unknown }).title === title);

/** Every content id names a block that exists, under that parent. */
const danglingIds = (client: LiveClient): string[] => {
  const all = blocksOf(client);

  return all.flatMap((block) => (block.content ?? []).filter((id) => all.find((child) => child.id === id)?.parent !== block.id));
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

/** The maker's browser is gone: no Discard runs, and the room tells the others it left. */
const loseSession = (client: LiveClient, others: LiveClient[]): void => {
  const departure = client.core.moduleInstances.YjsManager.encodeLocalAwarenessDeparture();

  booted.splice(booted.indexOf(client.core), 1);
  destroyCore(client.core);
  if (departure !== null) others.forEach((other) => other.receive({ type: 'awareness', update: departure }));
};

/**
 * Moves this editor's clock past the presence grace, then relays a presence
 * change of `from`: an unchanged state fires no status.
 */
const pastGrace = async (client: LiveClient, from: LiveClient): Promise<void> => {
  const now = Date.now();

  vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
  from.core.moduleInstances.YjsManager.setAwarenessField('activeAt', now + 31_000);
  client.receive({ type: 'awareness', update: from.core.moduleInstances.YjsManager.encodeAwarenessUpdate() });
  await settle();
};

/** Blocks whose parent is not in the document. */
const orphans = (client: LiveClient): Array<string | undefined> => {
  const all = blocksOf(client);

  return all.filter((block) => block.parent !== undefined && !all.some((other) => other.id === block.parent)).map((block) => block.id);
};

/** The id the title property names as the layout tabs block, and whether that block exists. */
const namedLayout = (client: LiveClient): { id: unknown; exists: boolean } => {
  const all = blocksOf(client);
  const schema = (all.find((block) => block.id === 'db-1')?.data as { schema: Array<Record<string, unknown>> }).schema;
  const id = schema.find((property) => property.type === 'title')?.pageLayoutTabsId;

  return { id, exists: all.some((block) => block.id === id && block.type === 'tabs') };
};

/** The room drops `client`: the others hear it left; its editor stays open, offline. */
const dropOut = (client: LiveClient, others: LiveClient[]): void => {
  const departure = client.core.moduleInstances.YjsManager.encodeLocalAwarenessDeparture();

  if (departure !== null) others.forEach((other) => other.receive({ type: 'awareness', update: departure }));
};

/** `client` reconnects: what each side holds reaches the other and the server, and its presence is back. */
const reconnect = async (client: LiveClient, others: LiveClient[]): Promise<void> => {
  client.takeSent();
  const yjs = client.core.moduleInstances.YjsManager;

  server.applyRemoteUpdate(yjs.encodeStateAsUpdate(server.getStateVector()));
  client.receive({ type: 'update', update: server.encodeStateAsUpdate(yjs.getStateVector()) });
  others.forEach((other) => other.receive({ type: 'update', update: server.encodeStateAsUpdate(other.core.moduleInstances.YjsManager.getStateVector()) }));
  yjs.setAwarenessField('activeAt', Date.now());
  others.forEach((other) => other.receive({ type: 'awareness', update: yjs.encodeAwarenessUpdate() }));
  await settle();
  await pump([client, ...others]);
};

/** A state-vector exchange through the server, both ways: what a live room converges to. */
const syncAll = async (clients: LiveClient[]): Promise<void> => {
  await settle();
  clients.forEach((client) => server.applyRemoteUpdate(client.core.moduleInstances.YjsManager.encodeStateAsUpdate(server.getStateVector())));
  clients.forEach((client) => client.receive({ type: 'update', update: server.encodeStateAsUpdate(client.core.moduleInstances.YjsManager.getStateVector()) }));
  await settle();
  await pump(clients);
};

/** Moves every editor's clock on by `ms`, then has `client` hear a presence frame from `from`. */
const later = async (ms: number, client: LiveClient, from: LiveClient): Promise<void> => {
  const now = Date.now();

  vi.spyOn(Date, 'now').mockReturnValue(now + ms);
  from.core.moduleInstances.YjsManager.setAwarenessField('activeAt', now + ms);
  client.receive({ type: 'awareness', update: from.core.moduleInstances.YjsManager.encodeAwarenessUpdate() });
  await settle();
};

const PAST_WINDOW = 11 * 60_000;

describe('draft view tabs between peers', { timeout: 60000 }, () => {
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

  it('a peer does not see a draft tab until its maker applies it', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await draftViewTab(a, 'Applied', true);
    await applyAndClose(a);
    await pump([a, b]);
    await draftViewTab(a, 'Draft A', false);
    await pump([a, b]);

    expect(tabTitled(b, 'Draft A')).toBeDefined();
    await openRow(b);

    expect(tabNames(b)).toEqual(['Content', 'Applied']);
    await click(wrapperOf(b).querySelector('[data-blok-database-drawer-close]'));
    // Both peers share one document here, and a page holds one peek: b's peek closed a's builder.
    await pump([a, b]);
    await draftViewTab(a, 'Draft A', false);
    await applyAndClose(a);
    await pump([a, b]);

    expect(blocksOf(b).filter((block) => 'draft' in block.data)).toEqual([]);
    await openRow(b);

    expect(tabNames(b)).toEqual(['Content', 'Applied', 'Draft A']);
  });

  it('keeps a draft whose maker is still connected, and deletes it once the maker\'s session is lost', async () => {
    const a = await bootLive();
    const peerOfA = await bootLive();

    await draftViewTab(a, 'Applied', true);
    await applyAndClose(a);
    await draftViewTab(a, 'Draft A', false);
    await pump([a, peerOfA]);

    // The mark names the maker's presence, so a peer can tell when it leaves.
    expect((tabTitled(a, 'Draft A')?.data as { draft?: { by?: unknown[] } }).draft?.by?.length).toBeGreaterThan(0);
    // B joins after A drafted: the room hands it A's presence.
    const b = await bootLive();

    b.receive({ type: 'awareness', update: a.core.moduleInstances.YjsManager.encodeAwarenessUpdate() });
    await settle();
    await pastGrace(b, a);

    expect(tabTitled(b, 'Draft A')).toBeDefined();
    loseSession(a, [b, peerOfA]);
    await settle();

    // A blip looks the same as leaving: nothing goes until the maker has been away the whole window.
    expect(tabTitled(b, 'Draft A')).toBeDefined();
    await later(PAST_WINDOW, b, peerOfA);
    await settle();

    expect(tabTitled(b, 'Draft A')).toBeUndefined();
    expect(danglingIds(b)).toEqual([]);
    expect(tabTitled(b, 'Applied')).toBeDefined();
    expect(b.core.moduleInstances.YjsManager.canUndo()).toBe(false);
    await pump([b, peerOfA]);

    expect(tabTitled(peerOfA, 'Draft A')).toBeUndefined();
  });

  // Teardown discards the open draft, into the document being thrown away.
  it('a room reset while Customize holds a draft tab leaves the maker editing', async () => {
    const a = await bootLive();
    const warn = vi.spyOn(console, 'warn');

    await draftViewTab(a, 'Applied', true);
    await applyAndClose(a);
    await draftViewTab(a, 'Draft A', false);
    await pump([a]);
    const reset = new DocumentStore(new YBlockSerializer());

    reset.fromJSON(server.toJSON());
    server.destroy();
    server = reset;
    await a.relineage('fedcba9876543210fedcba9876543210');
    await settle();

    expect(warn.mock.calls.filter((call) => String(call[0]).includes('could not store an update'))).toEqual([]);
    expect(a.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
    // The room still holds the draft; its builder is gone, so it reads as discarded here too.
    expect(tabTitled(a, 'Draft A')).toBeDefined();
    await openRow(a);

    expect(tabNames(a)).toEqual(['Content', 'Applied']);
    await later(PAST_WINDOW, a, a);
    await settle();

    expect(tabTitled(a, 'Draft A')).toBeUndefined();
    expect(danglingIds(a)).toEqual([]);
  });

  it('an undone first Apply keeps the tab a peer applied into the same block, also after the maker leaves', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await draftViewTab(a, 'From A', true);
    await applyAndClose(a);
    await pump([a, b]);
    await draftViewTab(b, 'From B', false);
    await applyAndClose(b);
    await pump([a, b]);
    a.core.moduleInstances.YjsManager.undo();
    await settle();
    await pump([a, b]);

    for (const peer of [a, b]) {
      expect(danglingIds(peer)).toEqual([]);
      expect(tabTitled(peer, 'From A')).toBeUndefined();
      expect(tabTitled(peer, 'From B')).toBeDefined();
      expect('draft' in (tabTitled(peer, 'From B')?.data as Record<string, unknown>)).toBe(false);
    }
    loseSession(a, [b]);
    await later(PAST_WINDOW, b, b);
    await settle();

    expect(tabTitled(b, 'From B')).toBeDefined();
    expect(danglingIds(b)).toEqual([]);
  });
  // A socket blip withdraws the maker's presence at once: that is not the maker leaving.
  it('keeps a live maker\'s draft through a short drop-out, and its Apply then shows on the peer', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await draftViewTab(a, 'Applied', true);
    await applyAndClose(a);
    await draftViewTab(a, 'Draft A', false);
    await pump([a, b]);
    await later(31_000, b, a);
    dropOut(a, [b]);
    await settle();

    expect(tabTitled(b, 'Draft A')).toBeDefined();
    await reconnect(a, [b]);
    await applyAndClose(a);
    await pump([a, b]);
    await openRow(b);

    expect(tabNames(b)).toEqual(['Content', 'Applied', 'Draft A']);
  });

  // The window is long, but a maker can still be away past it and Apply on its return.
  it('an Apply made offline survives a peer\'s cleanup of its draft block: nothing orphaned, the layout names a real block', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await draftViewTab(a, 'First', true);
    await pump([a, b]);
    await later(1_000, b, a);
    dropOut(a, [b]);
    await later(PAST_WINDOW, b, b);
    await settle();

    expect(tabTitled(b, 'First')).toBeUndefined();
    await applyAndClose(a);
    await reconnect(a, [b]);
    // The maker's repair lands after the sync window: sync again, as the room's state exchange does.
    await syncAll([a, b]);

    for (const peer of [a, b]) {
      expect(orphans(peer)).toEqual([]);
      expect(danglingIds(peer)).toEqual([]);
      expect(namedLayout(peer).exists).toBe(true);
      await openRow(peer);

      expect(tabNames(peer)).toEqual(['Content', 'First']);
      await click(wrapperOf(peer).querySelector('[data-blok-database-drawer-close]'));
    }
  });

  it('redo after a peer cleaned up the undone first Apply\'s block brings the tabs back under a real block', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await draftViewTab(a, 'First', true);
    await applyAndClose(a);
    await pump([a, b]);
    a.core.moduleInstances.YjsManager.undo();
    await settle();
    await pump([a, b]);
    await later(1_000, b, a);
    dropOut(a, [b]);
    await later(PAST_WINDOW, b, b);
    await settle();

    expect(blocksOf(b).filter((block) => block.type === 'tabs')).toEqual([]);
    a.core.moduleInstances.YjsManager.redo();
    await settle();
    await reconnect(a, [b]);
    // The maker's repair lands after the sync window: sync again, as the room's state exchange does.
    await syncAll([a, b]);

    for (const peer of [a, b]) {
      expect(orphans(peer)).toEqual([]);
      expect(danglingIds(peer)).toEqual([]);
      expect(namedLayout(peer).exists).toBe(true);
      await openRow(peer);

      expect(tabNames(peer)).toEqual(['Content', 'First']);
      await click(wrapperOf(peer).querySelector('[data-blok-database-drawer-close]'));
    }
  });

  it('merging two peers\' tabs blocks keeps a draft that sits in the losing block', async () => {
    const a = await bootLive();
    const b = await bootLive();

    // Neither has seen the other: each makes a tabs block.
    await draftViewTab(a, 'From A', true);
    await applyAndClose(a);
    await draftViewTab(b, 'From B', true);
    await applyAndClose(b);
    const sent = new Map([a, b].map((peer) => [peer, peer.takeSent()]));

    sent.forEach((frames) => frames.forEach((frame) => {
      if (frame.type === 'update') server.applyRemoteUpdate(frame.update);
    }));
    // The server already knows which block wins; the loser drafts a tab in its own block before it hears.
    const all = server.toJSON();
    const winner = ((all.find((block) => block.id === 'db-1')?.data as { schema: Array<Record<string, unknown>> }).schema
      .find((property) => property.type === 'title'))?.pageLayoutTabsId;
    const aWon = all.some((block) => block.parent === winner && (block.data as { title?: unknown }).title === 'From A');
    const [loser, other] = aWon ? [b, a] : [a, b];

    await draftViewTab(loser, 'Loser draft', false);
    sent.get(other)?.forEach((frame) => loser.receive(frame));
    sent.get(loser)?.forEach((frame) => other.receive(frame));
    await settle();
    await pump([a, b]);

    for (const peer of [a, b]) {
      expect(tabTitled(peer, 'Loser draft')).toBeDefined();
    }
    await applyAndClose(loser);
    await pump([a, b]);

    for (const peer of [a, b]) {
      expect(orphans(peer)).toEqual([]);
      expect(danglingIds(peer)).toEqual([]);
      await openRow(peer);

      expect([...tabNames(peer)].sort()).toEqual(['Content', 'From A', 'From B', 'Loser draft']);
      await click(wrapperOf(peer).querySelector('[data-blok-database-drawer-close]'));
    }
  });
});
