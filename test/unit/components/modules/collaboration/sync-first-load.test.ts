/**
 * Sync-first load (Phase 3, task C1).
 *
 * The whole point of these tests is the branch that must not leak: with
 * `collaboration` configured, core seeds NOTHING — not the document, not the
 * default empty block — and the editor stays read-only until the server's first
 * SyncStep2 materialises the blocks through the ordinary remote path. With
 * `collaboration` absent, not one byte of that machinery may be allocated.
 */
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import * as encoding from 'lib0/encoding';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { Modules } from '../../../../../src/components/modules';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { ANONYMOUS_LABEL_KEYS } from '../../../../../src/components/modules/collaboration/anonymous-identity';
import * as operationStore from '../../../../../src/components/modules/collaboration/operation-store';
import { MAX_PEERS } from '../../../../../src/components/modules/collaboration/presence';
import * as collabProvider from '../../../../../src/components/modules/collaboration/provider';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { CollabDocSeam, SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig, OutputBlockData } from '../../../../../types';
import type { BlockToolConstructable } from '../../../../../types/tools';
import type { CollaborationStatusChangedPayload } from '../../../../../types/events/editor-events';

const LINEAGE = '0123456789abcdef0123456789abcdef';

/** What a server backed by a durable operation store selects. */
const V2 = 'blok-sync.v2';

/** The identity partition every offline boot here runs under. */
const SCOPE = 'member-1';

/**
 * The store the module opens for a document under one identity — the probes
 * below read exactly what the module wrote, so this has to track it.
 * @param doc - the document id the harness booted with
 * @param scope - the identity partition the harness booted under
 */
const storeOptions = (doc = 'doc-1', scope: string = SCOPE): operationStore.OperationStoreOptions => ({
  url: `wss://sync.test/api/sync/${doc}`,
  doc,
  offlineScope: scope,
});

/**
 * The real factory, captured before any test can spy the namespace: the probes
 * in this file must keep reading the store even while the module under test is
 * being handed a faulty one.
 */
const { createOperationStore } = operationStore;

/** What `createOperationStore` prefixes its database name with. */
const CACHE_DB_PREFIX = 'blok-ops-';

/**
 * An ordinary third-party tool: read-only CAPABLE, but with no `setReadOnly`.
 *
 * `setReadOnly` is a Blok extension almost nothing outside this repo implements,
 * and one such tool in the registry is what turns every read-only transition
 * into the real save/clear/render dance instead of the in-place per-block
 * toggle. Both fixture tools this harness used to register (paragraph, bookmark)
 * implement it, so the suite only ever saw the in-place path — which is how a
 * document-corrupting bug on the dance survived three review rounds.
 *
 * The two levers are different and both matter: `isReadOnlySupported` must stay
 * true (a collaboration editor always boots read-only, and a tool without it
 * fails the contract loudly — see the `collaboration` JSDoc), while the absent
 * `setReadOnly` is what makes the transition real.
 */
class PlainTool {
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get toolbox(): { icon: string; title: string } {
    return {
      icon: '',
      title: 'Plain',
    };
  }

  private readonly text: string;

  /**
   * @param options - tool constructor options
   * @param options.data - saved block data
   */
  public constructor({ data }: { data?: { text?: string } }) {
    this.text = data?.text ?? '';
  }

  /**
   * Renders the block's only element.
   */
  public render(): HTMLElement {
    const element = document.createElement('div');

    element.textContent = this.text;

    return element;
  }

  /**
   * @param element - the rendered element
   */
  public save(element: HTMLElement): { text: string } {
    return { text: element.textContent ?? '' };
  }
}

/** A control frame the client accepts: our format, a stable lineage. */
const controlFrame = (): SyncWireFrame => ({
  type: 'control',
  tag: { format: 1, epoch: 0, lineage: LINEAGE },
});

/** Mock transport — the same shape provider.test.ts drives. */
class MockSocket {
  public binaryType = 'blob';

  public readyState = 0;

  public protocol = '';

  public onopen: ((event: unknown) => void) | null = null;

  public onmessage: ((event: { data: unknown }) => void) | null = null;

  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  public onerror: ((event: unknown) => void) | null = null;

  public readonly sent: Uint8Array[] = [];

  public closedWith: { code?: number; reason?: string } | null = null;

  public constructor(public readonly url: string, public readonly protocols: string[]) {}

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer));
  }

  public close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  /** Mirrors a real WebSocket: `.protocol` is set before `onopen` fires. */
  public open(protocol = 'blok-sync.v1'): void {
    this.protocol = protocol;
    this.readyState = 1;
    this.onopen?.({});
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }

  public serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

/** A peer document to answer the client's SyncStep1 from. */
const peerWith = (blocks: OutputBlockData[]): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer());

  store.fromJSON(blocks.map((block, index) => ({
    id: block.id ?? `peer-block-${index}`,
    type: block.type,
    data: block.data,
  })));

  return store;
};

interface Harness {
  core: Core;
  sockets: MockSocket[];
  socket: () => MockSocket;
}

const holders: HTMLElement[] = [];
const booted: Core[] = [];

/**
 * Minimal replica of Blok.destroy()'s module teardown, so a Core booted
 * directly does not leak sockets, timers or listeners between tests.
 * @param core - booted core instance
 */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as { markDestroyed?: () => void } | null | undefined;

    if (instance && typeof instance.markDestroyed === 'function') {
      instance.markDestroyed();
    }
  });

  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as {
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    } | null | undefined;

    if (instance && typeof instance.destroy === 'function') {
      instance.destroy();
    }

    if (instance?.listeners && typeof instance.listeners.removeAll === 'function') {
      instance.listeners.removeAll();
    }
  });
};

/**
 * Polls until the predicate holds. Real timers throughout: `Renderer.render`
 * waits on `requestIdleCallback`, which fake timers fight.
 * @param predicate - condition to wait for
 * @param label - what the caller was waiting for, for the failure message
 * @param timeoutMs - how long to wait before giving up
 */
const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  label = 'condition',
  timeoutMs = 2000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/**
 * Waits until the session has actually written its document to the cache.
 *
 * A real reload is a new page, so the old session's writes are long settled;
 * in-process the two overlap, and reading the store is the only honest signal
 * that there is something to reload INTO.
 * @param doc - the document id the harness booted with
 */
const waitForCachedDocument = async (doc = 'doc-1', scope: string = SCOPE): Promise<void> => {
  await waitFor(async () => {
    const probe = createOperationStore(storeOptions(doc, scope));
    const contents = await probe.open();

    await probe.close();

    return contents !== null && contents.updates.length > 0;
  }, 'the session to persist its document');
};

/**
 * Rows in one object store of a database, read RAW.
 *
 * The store's database name folds three escaped segments together and cannot
 * be parsed back into the options that built it, so a probe that only has a
 * name has to open it directly.
 * @param name - the database name
 * @param objectStore - which of the store's four object stores to count
 */
const rawRowCount = async (name: string, objectStore: string): Promise<number> =>
  new Promise((resolve) => {
    const request = indexedDB.open(name);

    request.onerror = () => resolve(0);
    request.onsuccess = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(objectStore)) {
        db.close();
        resolve(0);

        return;
      }

      const count = db.transaction(objectStore, 'readonly').objectStore(objectStore).count();

      count.onsuccess = () => {
        db.close();
        resolve(count.result);
      };
      count.onerror = () => {
        db.close();
        resolve(0);
      };
    };
  });

/**
 * What the local copy holds: its cache rows, and the oldest row the outbox
 * would hand a drain.
 *
 * `oldestPending`, never `stats().pendingOperations` — that counter includes
 * rows `oldestPending` refuses to hand out.
 * @param doc - the document id the harness booted with
 * @param scope - the identity partition the harness booted under
 */
const readStore = async (
  doc = 'doc-1',
  scope: string = SCOPE
): Promise<{ updates: Uint8Array[]; pending: operationStore.PendingOperation | null }> => {
  const probe = createOperationStore(storeOptions(doc, scope));
  const contents = await probe.open();
  const pending = await probe.oldestPending();

  await probe.close();

  return {
    updates: contents?.updates ?? [],
    pending,
  };
};

/**
 * Outbox row counts a probe sees. `stats` counts EVERY row, unlike
 * `oldestPending`, which is only the drain's cursor; `quarantined` excludes the
 * recovery snapshot the quarantine writes beside the rows.
 * @param doc - the document id the harness booted with
 * @param scope - the identity partition the harness booted under
 */
const storeCounts = async (
  doc = 'doc-1',
  scope: string = SCOPE
): Promise<{ pending: number; quarantined: number }> => {
  const probe = createOperationStore(storeOptions(doc, scope));

  await probe.open();

  const stats = await probe.stats();

  await probe.close();

  return { pending: stats.pendingOperations, quarantined: stats.quarantinedOperations };
};

/**
 * The block texts a set of updates replays into.
 * @param updates - update bytes, applied in order
 */
const textsOf = (updates: Uint8Array[]): (string | undefined)[] => {
  const replay = new DocumentStore(new YBlockSerializer());

  for (const update of updates) {
    replay.applyRemoteUpdate(update);
  }

  const texts = replay.toJSON().map((block) => (block.data as { text?: string }).text);

  replay.destroy();

  return texts;
};

/**
 * The document the local copy replays into — what a reload would show.
 * @param doc - the document id the harness booted with
 * @param scope - the identity partition the harness booted under
 */
const cachedTexts = async (doc = 'doc-1', scope: string = SCOPE): Promise<(string | undefined)[]> =>
  textsOf((await readStore(doc, scope)).updates);

/**
 * Waits until SOME session has written a document, whatever partition it chose.
 *
 * The scoped gate above reads through `storeOptions`, so a regression that merges
 * two scopes makes the gate time out and the partition test reports a probe
 * timeout instead of the leak it exists to name. This one asks the factory.
 *
 * PRECONDITION: at most one cache database exists when it is called. It
 * returns on the first one holding updates, so gating a caller that has
 * already booted two partitions can settle on the wrong one.
 */
const waitForAnyCachedDocument = async (): Promise<void> => {
  await waitFor(async () => {
    for (const entry of await indexedDB.databases()) {
      const name = entry.name;

      if (name === undefined || !name.startsWith(CACHE_DB_PREFIX)) {
        continue;
      }

      if (await rawRowCount(name, 'updates') > 0) {
        return true;
      }
    }

    return false;
  }, 'any session to persist its document');
};

interface BootOptions {
  doc?: string;
  server?: string;
  data?: BlokConfig['data'];
  readOnly?: boolean;
  ticket?: string;
  collaboration?: boolean;
  offline?: boolean;
  offlineScope?: string;
  user?: { name: string; color?: string };
  editor?: { id: string; name?: string };
}

const boot = async (options: BootOptions = {}): Promise<Harness> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const sockets: MockSocket[] = [];
  const collaboration: CollaborationConfig = {
    doc: options.doc ?? 'doc-1',
    user: options.user,
    offline: options.offline,
    offlineScope: options.offlineScope ?? (options.offline === true ? SCOPE : undefined),
    socketFactory: (url, protocols) => {
      const socket = new MockSocket(url, protocols);

      sockets.push(socket);

      return socket;
    },
  };

  const core = new Core({
    holder,
    minHeight: 50,
    // The `server` shorthand fills in a bookmark endpoint, so the tool it names
    // has to carry a class or Tools refuses the config-only entry.
    // `plain` has no `setReadOnly`, so every read-only transition here is the
    // real save/clear/render dance — what a host with any third-party tool gets.
    tools: {
      paragraph: { class: Paragraph },
      bookmark: { class: Bookmark },
      plain: { class: PlainTool as unknown as BlockToolConstructable },
    },
    data: options.data,
    readOnly: options.readOnly,
    ...(options.editor === undefined ? {} : { user: options.editor }),
    ...(options.collaboration === false
      ? {}
      : { server: options.server ?? 'https://sync.test/api/', collaboration }),
    ...(options.ticket === undefined ? {} : { ticket: options.ticket }),
  });

  await core.isReady;
  booted.push(core);

  return {
    core,
    sockets,
    socket: () => {
      const socket = sockets.at(-1);

      if (socket === undefined) {
        throw new Error('no socket was opened');
      }

      return socket;
    },
  };
};

/**
 * Open + control frame + a first SyncStep2 carrying the peer's blocks.
 * @param harness - the booted editor
 * @param blocks - what the room holds
 * @param protocol - the subprotocol the server selects
 */
const firstSync = (harness: Harness, blocks: OutputBlockData[], protocol = 'blok-sync.v1'): MockSocket => {
  const socket = harness.socket();
  const peer = peerWith(blocks);

  socket.open(protocol);
  socket.deliver(controlFrame());
  socket.deliver({
    type: 'syncStep2',
    update: peer.encodeStateAsUpdate(harness.core.moduleInstances.YjsManager.getStateVector()),
  });

  peer.destroy();

  return socket;
};

const collabAttr = (core: Core): string | null =>
  core.moduleInstances.UI.nodes.wrapper.getAttribute('data-blok-collab');

/**
 * What the server would hold: `base` plus every update frame the client wrote.
 * @param socket - the client's transport
 * @param base - the document as it stood before the writes under test
 */
const firstBlockTextOnTheWire = (socket: MockSocket, base: Uint8Array): string | undefined => {
  const replay = new DocumentStore(new YBlockSerializer());

  replay.applyRemoteUpdate(base);

  for (const bytes of socket.sent) {
    const frame = decode(bytes);

    if (frame.type === 'update') {
      replay.applyRemoteUpdate(frame.update);
    }
  }

  const text = (replay.toJSON()[0]?.data as { text?: string } | undefined)?.text;

  replay.destroy();

  return text;
};

const blockTexts = (core: Core): string[] =>
  core.moduleInstances.BlockManager.blocks.map((block) => block.holder.textContent ?? '');

describe('collaboration — sync-first load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('absent collaboration costs nothing', () => {
    it('opens no socket and never turns awareness on', async () => {
      const socketConstructor = vi.fn();
      const enableAwareness = vi.spyOn(YjsManager.prototype, 'enableAwareness');

      vi.stubGlobal('WebSocket', socketConstructor);

      const { core } = await boot({ collaboration: false });

      expect(core.moduleInstances.Collaboration.isEnabled).toBe(false);
      expect(socketConstructor).not.toHaveBeenCalled();
      expect(enableAwareness).not.toHaveBeenCalled();
      expect(collabAttr(core)).toBeNull();
    });

    it('still seeds the default block, so single-player load is untouched', async () => {
      const { core } = await boot({ collaboration: false });

      expect(core.moduleInstances.BlockManager.blocks.length).toBe(1);
      expect(core.moduleInstances.YjsManager.toJSON().length).toBe(1);
    });
  });

  describe('the read-only contract collaboration always reaches', () => {
    it('rejects at boot when a registered tool cannot render read-only', async () => {
      const holder = document.createElement('div');

      document.body.appendChild(holder);
      holders.push(holder);

      // No `isReadOnlySupported`. In a single-player editor this tool is fine
      // until somebody asks for read-only; under collaboration the session
      // boots read-only, so the contract is failed on the way up. The
      // `collaboration` JSDoc states this — a host adding the key to an editor
      // with such a tool otherwise gets a rejected ready promise and no clue.
      class NoReadOnlyTool extends PlainTool {
        public static get isReadOnlySupported(): boolean {
          return false;
        }
      }

      const core = new Core({
        holder,
        tools: {
          paragraph: { class: Paragraph },
          bookmark: { class: Bookmark },
          strict: { class: NoReadOnlyTool as unknown as BlockToolConstructable },
        },
        server: 'https://sync.test/api/',
        collaboration: { doc: 'doc-1', socketFactory: () => new MockSocket('', []) } as CollaborationConfig,
      });

      await expect(core.isReady).rejects.toThrow(/strict/);
    });
  });

  describe('while unsynced', () => {
    it('seeds neither the document nor a default block, even with config.data', async () => {
      const { core } = await boot({ data: { blocks: [{ type: 'paragraph', data: { text: 'last known' } }] } });

      expect(core.moduleInstances.BlockManager.blocks.length).toBe(0);
      expect(core.moduleInstances.YjsManager.toJSON()).toEqual([]);
      expect(collabAttr(core)).toBe('connecting');
    });

    it('leaves config.data free of the injected default block', async () => {
      const { core } = await boot();

      expect(core.configuration.data?.blocks).toEqual([]);
    });

    it('is read-only', async () => {
      const { core } = await boot();

      expect(core.moduleInstances.ReadOnly.isEnabled).toBe(true);
    });

    it('derives the sync URL from server + doc', async () => {
      const harness = await boot({ doc: 'my doc/1'.replace('/', '-') });

      expect(harness.socket().url).toBe('wss://sync.test/api/sync/my%20doc-1');
      expect(harness.socket().protocols).toEqual([V2, 'blok-sync.v1']);
    });
  });

  describe('first sync', () => {
    it('materialises the remote blocks and lifts read-only', async () => {
      const harness = await boot();

      firstSync(harness, [
        { type: 'paragraph', data: { text: 'from the server' } },
        { type: 'paragraph', data: { text: 'and another' } },
      ]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 2, 'remote blocks');

      expect(blockTexts(harness.core)).toEqual(['from the server', 'and another']);
      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
      expect(collabAttr(harness.core)).toBe('connected');
    });

    it('keeps the editor read-only when the host asked for read-only', async () => {
      const harness = await boot({ readOnly: true });

      firstSync(harness, [{ type: 'paragraph', data: { text: 'read me' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
    });

    it('stays editable after a post-sync disconnect (the asymmetry)', async () => {
      const harness = await boot();
      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      socket.serverClose(1001, 'server restarting');

      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
      expect(collabAttr(harness.core)).toBe('offline');
      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(1);
    });

    it('drops to read-only when the provider gives up for good', async () => {
      const harness = await boot();
      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      // 4403 is terminal: no reconnect will ever ship the pending diff.
      socket.serverClose(4403, 'forbidden');

      await waitFor(() => harness.core.moduleInstances.ReadOnly.isEnabled, 'read-only after terminal');

      expect(collabAttr(harness.core)).toBe('error');
    });
  });

  describe('degrade to last known', () => {
    it('renders config.data read-only without touching the document, then swaps on the first sync', async () => {
      const harness = await boot({ data: { blocks: [{ type: 'paragraph', data: { text: 'last known' } }] } });

      harness.socket().open();
      // Close before any control frame: nothing was ever synced.
      harness.socket().serverClose(1001, 'gone');

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'degraded render');

      expect(blockTexts(harness.core)).toEqual(['last known']);
      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
      expect(harness.core.moduleInstances.YjsManager.toJSON()).toEqual([]);
      expect(collabAttr(harness.core)).toBe('offline');

      // 1001 on the first attempt reconnects in ~250ms.
      await waitFor(() => harness.sockets.length === 2, 'reconnect', 6000);

      firstSync(harness, [{ type: 'paragraph', data: { text: 'server truth' } }]);

      await waitFor(() => blockTexts(harness.core).join() === 'server truth', 'swap to server truth');

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(1);
      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
      // Two renders and a reconnect on real timers: the default 5s per-test
      // budget is not enough on a loaded machine.
    }, 20_000);

    it('stays empty and read-only when the host passed no data', async () => {
      const harness = await boot();

      harness.socket().open();
      harness.socket().serverClose(4503, 'unavailable');

      await waitFor(() => collabAttr(harness.core) === 'offline', 'offline');

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(0);
      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
    });

    /**
     * `ModificationsObserver.disable()/enable()` is a boolean, not a counter.
     * The degrade render is the module's only suspension that spans an await —
     * a tool with a genuinely async `render` holds it open for as long as it
     * likes — and a first sync landing inside that window drops the degraded
     * view, which suspends the observer again. The inner `enable()` would then
     * re-arm the observer on top of a DOM the outer window is still rewriting,
     * reporting the swap as the user's own edit.
     */
    it('keeps the observer suspended when a first sync lands mid-degrade-render', async () => {
      const harness = await boot({ data: { blocks: [{ type: 'paragraph', data: { text: 'last known' } }] } });
      const { ModificationsObserver, Renderer } = harness.core.moduleInstances;

      const disableSpy = vi.spyOn(ModificationsObserver, 'disable');
      const enableSpy = vi.spyOn(ModificationsObserver, 'enable');

      let releaseRender = (): void => {};
      const parked = new Promise<void>((resolve) => {
        releaseRender = resolve;
      });

      vi.spyOn(Renderer, 'render').mockImplementationOnce(async () => {
        await parked;
      });

      harness.socket().open();
      harness.socket().serverClose(1001, 'gone');

      await waitFor(() => disableSpy.mock.calls.length > 0, 'degrade render suspended the observer');
      await waitFor(() => harness.sockets.length === 2, 'reconnect', 6000);

      firstSync(harness, [{ type: 'paragraph', data: { text: 'server truth' } }]);

      await waitFor(() => disableSpy.mock.calls.length > 1, 'the swap suspended the observer again');

      // The degrade render is STILL parked, so nothing may have re-armed it.
      expect(enableSpy).not.toHaveBeenCalled();

      releaseRender();

      await waitFor(() => enableSpy.mock.calls.length > 0, 'observer re-armed once the render finished');
      await waitFor(() => blockTexts(harness.core).join() === 'server truth', 'server truth on screen');

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(1);
    }, 20_000);
  });

  describe('offline cache', () => {
    /**
     * The carve-out in "never editable unsynced": a cached document IS a synced
     * one — the cache only became adoptable behind a validated control frame —
     * so it comes up editable before this boot has spoken to anybody.
     */
    it('boots editable from a cached document, before any socket opens', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const first = await boot({ offline: true });

      firstSync(first, [{ type: 'paragraph', data: { text: 'synced once' } }]);
      await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitFor(() => !first.core.moduleInstances.ReadOnly.isEnabled, 'editable');
      await waitForCachedDocument();

      destroyCore(booted.splice(booted.indexOf(first.core), 1)[0]);

      const reloaded = await boot({ offline: true });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');

      expect(blockTexts(reloaded.core)).toEqual(['synced once']);
      expect(reloaded.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
      // The claim in full: this editor is usable having exchanged nothing.
      expect(reloaded.sockets[0].sent).toEqual([]);
    }, 20_000);

    it('stays read-only when the cache remembers a write-denied member', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const payload = btoa(JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 3600,
        write: false,
      }));

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async (): Promise<unknown> => ({ ticket: `header.${payload}.signature` }),
      })));

      const first = await boot({ offline: true, ticket: '/tickets' });

      await waitFor(() => first.sockets.length === 1, 'socket after the ticket mint');
      firstSync(first, [{ type: 'paragraph', data: { text: 'read me' } }]);
      await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      destroyCore(booted.splice(booted.indexOf(first.core), 1)[0]);

      const reloaded = await boot({ offline: true, ticket: '/tickets' });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');

      expect(reloaded.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
    }, 20_000);

    /**
     * `writeDenied` is only ever re-derived from a ticket mint. A session with
     * no ticket endpoint has no mint, so a cached verdict would hold — and be
     * re-persisted on every `connected` — for the rest of that browser's life.
     */
    it('ignores a cached write-denied verdict when there is no ticket source', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const snapshot = peerWith([{ id: 'b1', type: 'paragraph', data: { text: 'cached' } }]);
      const seed = createOperationStore(storeOptions());

      await seed.open();
      await seed.recordSession({ format: 1, epoch: 0, lineage: LINEAGE }, true, 'v1', snapshot.encodeStateAsUpdate());
      await seed.close();
      snapshot.destroy();

      const harness = await boot({ offline: true });

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');
      await waitFor(() => !harness.core.moduleInstances.ReadOnly.isEnabled, 'editable');
    }, 20_000);

    /**
     * The replay applies rows through the same document the cache is
     * subscribed to. Without the origin check every boot writes the whole
     * document straight back, so the store grows by a copy per reload.
     */
    it('does not write the cache back to itself on every boot', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const first = await boot({ offline: true });

      firstSync(first, [{ type: 'paragraph', data: { text: 'synced once' } }]);
      await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();
      destroyCore(booted.splice(booted.indexOf(first.core), 1)[0]);

      const rowsAfter = async (): Promise<number> => {
        const probe = createOperationStore(storeOptions());
        const contents = await probe.open();

        await probe.close();

        return contents?.updates.length ?? 0;
      };

      const afterFirstBoot = await rowsAfter();

      for (let reload = 0; reload < 3; reload += 1) {
        const reloaded = await boot({ offline: true });

        await waitFor(
          () => reloaded.core.moduleInstances.BlockManager.blocks.length === 1,
          'cached blocks'
        );
        destroyCore(booted.splice(booted.indexOf(reloaded.core), 1)[0]);
      }

      expect(await rowsAfter()).toBe(afterFirstBoot);
    }, 30_000);

    /**
     * `pagehide` covers a dying tab. An editor destroyed while the page lives
     * on — an app unmounting it, a route change — must not lose the last
     * thing typed, which is still sitting in the coalescing write buffer.
     */
    it('flushes the pending write buffer when the editor is destroyed', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }]);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      const yjs = harness.core.moduleInstances.YjsManager;

      // Two writes: the first lands on the leading edge, the second coalesces
      // into the trailing window and is still pending at teardown. The flush
      // body is the real one — a data write, exactly as typing produces.
      const flush = (entries: ReadonlyMap<string, unknown>): boolean => {
        let wrote = false;

        for (const [key, value] of entries) {
          wrote = yjs.updateBlockData('b1', key, value) || wrote;
        }

        return wrote;
      };

      yjs.enqueueBlockDataWrite('b1', { text: 'leading' }, flush);
      yjs.enqueueBlockDataWrite('b1', { text: 'trailing' }, flush);

      destroyCore(booted.splice(booted.indexOf(harness.core), 1)[0]);

      // Polled, not read once: the flush is synchronous but the row it makes
      // reaches disk on the store's own transaction, which `close()` drains.
      await waitFor(async () => (await cachedTexts())[0] === 'trailing', 'the flushed write to reach the copy');

      expect(await cachedTexts()).toEqual(['trailing']);
    }, 30_000);

    /**
     * The oversized update is in the cache too. Every later boot replays it,
     * the server's SyncStep1 draws it back into the resync answer, and the
     * announced cap refuses it again: a permanent lockout for this browser.
     * The terminal has to take the cache with it, so the next load syncs from
     * the room exactly as the no-cache path does.
     */
    it('clears the cache on an oversized-update terminal, so the next boot syncs from the room', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      socket.deliver({ type: 'limits', maxMessageBytes: 200 });
      harness.core.moduleInstances.YjsManager.addBlock({
        id: 'huge',
        type: 'paragraph',
        data: { text: 'x'.repeat(8192) },
      });

      await waitFor(() => collabAttr(harness.core) === 'error', 'the terminal');

      expect(seen.at(-1)?.error).toBe('oversized-update');
      expect(seen.at(-1)?.reason).toContain('offline copy was discarded');

      await waitFor(async () => {
        const probe = createOperationStore(storeOptions());
        const contents = await probe.open();

        await probe.close();

        return contents === null;
      }, 'the cache to be cleared');

      destroyCore(booted.splice(booted.indexOf(harness.core), 1)[0]);

      const reloaded = await boot({ offline: true });

      expect(reloaded.core.moduleInstances.BlockManager.blocks.length).toBe(0);
      expect(reloaded.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
    }, 20_000);

    /**
     * The cache checks a row's TYPE, not its content. One row yjs cannot
     * decode made the replay throw, `load()` reject, and every reload fail
     * the same way until the user cleared site data.
     */
    it('boots unadopted and syncs from the room when a cached row cannot be replayed', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const seed = createOperationStore(storeOptions());

      await seed.open();
      await seed.recordSession(
        { format: 1, epoch: 0, lineage: LINEAGE },
        false,
        'v1',
        new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff])
      );
      await seed.close();

      const harness = await boot({ offline: true });

      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(true);

      await waitFor(async () => {
        const probe = createOperationStore(storeOptions());
        const contents = await probe.open();

        await probe.close();

        return contents === null;
      }, 'the cache to be cleared');

      firstSync(harness, [{ type: 'paragraph', data: { text: 'from the room' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'the room');
      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');

      expect(blockTexts(harness.core)).toEqual(['from the room']);
    }, 20_000);

    it('allocates nothing when the host did not ask for it', async () => {
      const factory = new IDBFactory();
      const openSpy = vi.spyOn(factory, 'open');

      vi.stubGlobal('indexedDB', factory);

      const harness = await boot();

      firstSync(harness, [{ type: 'paragraph', data: { text: 'no cache here' } }]);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      expect(openSpy).not.toHaveBeenCalled();
    });

    // A scope is a partition for a copy, not a reason to keep one: without
    // `offline` the host never consented to writing the document to disk.
    it('opens no database for an offlineScope without offline', async () => {
      const factory = new IDBFactory();
      const openSpy = vi.spyOn(factory, 'open');

      vi.stubGlobal('indexedDB', factory);

      const harness = await boot({ offline: false,
        offlineScope: 'alice' });

      firstSync(harness, [{ type: 'paragraph', data: { text: 'not cached' } }]);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      expect(openSpy).not.toHaveBeenCalled();
    });

    /**
     * The local copy belongs to the BROWSER, so on a shared profile the next
     * person to open the page was handed the previous person's document —
     * drawn on screen before any connection was made. `offlineScope` is the
     * partition that stops it.
     */
    describe('the identity partition', () => {
      it('never hands one scope the document another scope cached', async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());

        const alice = await boot({ offline: true,
          offlineScope: 'alice' });

        firstSync(alice, [{ type: 'paragraph', data: { text: 'alice private' } }]);
        await waitFor(() => alice.core.moduleInstances.BlockManager.blocks.length === 1, 'alice synced');
        await waitForAnyCachedDocument();
        destroyCore(booted.splice(booted.indexOf(alice.core), 1)[0]);

        const bob = await boot({ offline: true,
          offlineScope: 'bob' });

        expect(
          blockTexts(bob.core),
          'a bob-scoped boot adopted the alice-scoped cached document'
        ).toEqual([]);
        expect(bob.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
      }, 20_000);

      it('leaves the other partition untouched', async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());

        const alice = await boot({ offline: true,
          offlineScope: 'alice' });

        firstSync(alice, [{ type: 'paragraph', data: { text: 'alice private' } }]);
        await waitFor(() => alice.core.moduleInstances.BlockManager.blocks.length === 1, 'alice synced');
        await waitForAnyCachedDocument();
        destroyCore(booted.splice(booted.indexOf(alice.core), 1)[0]);

        const bob = await boot({ offline: true,
          offlineScope: 'bob' });

        firstSync(bob, [{ type: 'paragraph', data: { text: 'bob private' } }]);
        await waitFor(() => bob.core.moduleInstances.BlockManager.blocks.length === 1, 'bob synced');
        // Timeout tolerated: a regression that merges the two scopes leaves
        // nothing under bob's key, and the gate would then report a probe
        // failure instead of the assertion below naming the leak.
        await waitForCachedDocument('doc-1', 'bob').catch(() => undefined);
        destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);

        const probe = createOperationStore(storeOptions('doc-1', 'alice'));
        const contents = await probe.open();

        await probe.close();

        const replay = new DocumentStore(new YBlockSerializer());

        for (const update of contents?.updates ?? []) {
          replay.applyRemoteUpdate(update);
        }

        const texts = replay.toJSON().map((block) => (block.data as { text?: string }).text);

        replay.destroy();

        expect(
          texts,
          'a bob-scoped session wrote into the alice-scoped partition'
        ).toEqual(['alice private']);
      }, 30_000);

      it('finds its own copy intact on a later visit', async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());

        const alice = await boot({ offline: true,
          offlineScope: 'alice' });

        firstSync(alice, [{ type: 'paragraph', data: { text: 'alice private' } }]);
        await waitFor(() => alice.core.moduleInstances.BlockManager.blocks.length === 1, 'alice synced');
        await waitForCachedDocument('doc-1', 'alice');
        destroyCore(booted.splice(booted.indexOf(alice.core), 1)[0]);

        const bob = await boot({ offline: true,
          offlineScope: 'bob' });

        await waitFor(() => bob.sockets.length === 1, 'bob opened a socket');
        destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);

        const back = await boot({ offline: true,
          offlineScope: 'alice' });

        await waitFor(
          () => back.core.moduleInstances.BlockManager.blocks.length === 1,
          'the alice-scoped copy on the second visit'
        );

        expect(blockTexts(back.core)).toEqual(['alice private']);
      }, 30_000);

      /**
       * The key joins the server url and the scope with `|`, and BOTH can carry
       * one: `|` is not percent-encoded in a URL path, and the scope is an
       * arbitrary host string. These two configurations are different
       * partitions that spell a single database name unescaped.
       */
      it('keeps two partitions apart when a separator sits inside the key', async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());

        // Both spell `<origin>/foo/sync/e|e|/sync/g|g|s` when the three
        // segments are joined raw. The doc rides the key twice — once
        // percent-encoded inside the url, once verbatim — so a colliding pair
        // has to move the `|` through the server path and the scope.
        const first = await boot({ server: '/foo',
          doc: 'e',
          offline: true,
          offlineScope: '/sync/g|g|s' });

        firstSync(first, [{ type: 'paragraph', data: { text: 'first partition' } }]);
        await waitFor(
          () => first.core.moduleInstances.BlockManager.blocks.length === 1,
          'the first partition synced'
        );
        await waitForAnyCachedDocument();
        destroyCore(booted.splice(booted.indexOf(first.core), 1)[0]);

        const second = await boot({ server: '/foo/sync/e|e|',
          doc: 'g',
          offline: true,
          offlineScope: 's' });

        expect(
          blockTexts(second.core),
          'a `|` inside the server path aliased two identity partitions onto one database'
        ).toEqual([]);
      }, 20_000);
    });
  });

  /**
   * Capture is a MODULE-lifetime job. The provider's own doc hook lives on one
   * connection and drops a local edit outright when the socket is absent or not
   * ready, which is precisely when an offline edit is made.
   */
  describe('capturing local updates', () => {
    /**
     * The narrow window this whole feature exists for: an adopted copy is
     * editable before the tab has spoken to anybody, and what is typed in that
     * window has to be waiting in the outbox when a connection finally happens.
     */
    it('captures a local update before any socket exists (cache-adopted boot)', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const first = await boot({ offline: true });

      firstSync(first, [{ id: 'b1', type: 'paragraph', data: { text: 'synced once' } }], V2);
      await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();
      destroyCore(booted.splice(booted.indexOf(first.core), 1)[0]);

      const reloaded = await boot({ offline: true });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');

      const before = await readStore();

      reloaded.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed with no socket');

      // Tolerated: with nothing captured there is nothing to wait for, and the
      // assertion below has to be the one that speaks.
      await waitFor(async () => (await readStore()).pending !== null, 'the edit to reach the outbox', 1500)
        .catch(() => undefined);

      const after = await readStore();

      expect(after.pending, 'an edit made on a cache-adopted boot never reached the outbox').not.toBeNull();
      expect(after.pending?.lineage).toBe(LINEAGE);
      // ONE row, not two: `appendLocal` writes the cache row and the outbox
      // row in the same transaction, so a second cache write for the same
      // edit means both taps journaled it.
      expect(after.updates.length).toBe(before.updates.length + 1);
      expect(textsOf([...before.updates, ...(after.pending === null ? [] : [after.pending.bytes])]))
        .toEqual(['typed with no socket']);
      // The claim in full: nothing was exchanged with anybody to get here.
      expect(reloaded.sockets[0].sent).toEqual([]);
    }, 30_000);

    it('captures while reconnecting and offline', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      const before = await readStore();

      socket.serverClose(1006);
      await waitFor(() => collabAttr(harness.core) === 'offline', 'offline');

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed while reconnecting');

      await waitFor(async () => (await readStore()).pending !== null, 'the edit to reach the outbox', 1500)
        .catch(() => undefined);

      const after = await readStore();

      expect(after.pending, 'an edit made while the socket was down never reached the outbox').not.toBeNull();
      expect(textsOf([...before.updates, ...(after.pending === null ? [] : [after.pending.bytes])]))
        .toEqual(['typed while reconnecting']);
    }, 30_000);

    /**
     * The reason capture is TWO taps. The unfiltered tap is the only one that
     * sees a peer's update, and it feeds the cache; the filtered tap is the
     * only one that sees ours, and it feeds the outbox. One tap over
     * `onAnyDocUpdate` would journal every peer's work as ours and send it
     * back to the room.
     */
    it('does not enqueue a provider-origin broadcast', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      const yjs = harness.core.moduleInstances.YjsManager;
      const peer = new DocumentStore(new YBlockSerializer());

      peer.applyRemoteUpdate(yjs.encodeStateAsUpdate());
      peer.addBlock({ id: 'b2', type: 'paragraph', data: { text: 'from a peer' } });
      socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate(yjs.getStateVector()) });
      peer.destroy();

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 2, "the peer's block");
      // Tolerated: a broadcast that is misrouted never reaches the copy, and
      // the assertions below are the ones that have to say so.
      await waitFor(async () => (await cachedTexts()).length === 2, "the peer's block in the copy", 1500)
        .catch(() => undefined);

      const after = await readStore();

      expect(after.pending, "a server broadcast was journaled into this browser's outbox").toBeNull();
      expect(textsOf(after.updates)).toEqual(['synced', 'from a peer']);
    }, 30_000);

    /**
     * The store could not be opened, so nothing this tab writes is durable —
     * and the design's local-durability boundary says an edit that cannot be
     * stored must not be sent. Blok keeps what is on screen, blocks editing,
     * and asks for a recovery export. The empty room here makes the point
     * sharp: the first-sync seed is a write the module itself would make, and
     * it is gated on the applied read-only state.
     */
    it('storage failure blocks editing and sends nothing', async () => {
      const factory = new IDBFactory();

      vi.spyOn(factory, 'open').mockImplementation(() => {
        throw new Error('storage is unavailable');
      });
      vi.stubGlobal('indexedDB', factory);

      const harness = await boot({ offline: true });
      const socket = firstSync(harness, []);

      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');

      expect(
        harness.core.moduleInstances.ReadOnly.isEnabled,
        'editing resumed on a session whose local copy could not be opened'
      ).toBe(true);
      expect(socket.sent.map((bytes) => decode(bytes).type)).toEqual(['syncStep1']);
      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(0);
    }, 20_000);

    /**
     * A write forced into the document before any lineage exists. The store
     * REFUSES such a row rather than parking it — there is nothing to stamp it
     * with — and a refusal is what latches the durability block, so the taps
     * have to hold it back rather than let it end the session.
     */
    it('drops a write made before the session names a lineage, and keeps editing possible', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });

      harness.core.moduleInstances.YjsManager.addBlock({
        id: 'early',
        type: 'paragraph',
        data: { text: 'written before the first sync' },
      });

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'from the room' } }]);
      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');

      // Waits for the arbitration a completed sync owes. Waiting for read-only
      // to be ENABLED would return on the first poll — that is where a
      // collaboration editor starts — and race the refusal this pins against.
      await waitFor(() => !harness.core.moduleInstances.ReadOnly.isEnabled, 'editing to be possible', 2000)
        .catch(() => undefined);

      expect(
        harness.core.moduleInstances.ReadOnly.isEnabled,
        'a write with no lineage to stamp it ended the session'
      ).toBe(false);
    }, 20_000);

    /**
     * A host that seeds content the moment it hears `connected`. The status
     * event reaches that listener from inside the transition, so the session
     * has to be recorded with the store BEFORE the event goes out — otherwise
     * the write it provokes is a local edit with no lineage to stamp it, which
     * the store refuses and the refusal ends the session.
     */
    it('records the session before the status event a host may write from', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        if (payload.status === 'connected') {
          harness.core.moduleInstances.YjsManager.addBlock({
            id: 'seeded-by-host',
            type: 'paragraph',
            data: { text: 'written from the status event' },
          });
        }
      });

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'from the room' } }]);
      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');

      // Waits for the arbitration a completed sync owes; read-only is where a
      // collaboration editor starts, so the wait has to be for it to LIFT.
      await waitFor(() => !harness.core.moduleInstances.ReadOnly.isEnabled, 'editing to be possible', 2000)
        .catch(() => undefined);

      expect(
        harness.core.moduleInstances.ReadOnly.isEnabled,
        'a write from the connected event outran the session record and ended the session'
      ).toBe(false);
    }, 20_000);

    /**
     * The other way durability goes: the copy opened, and then a write to it
     * failed. Another tab (or the browser) dropping the database is the
     * reachable form of it. The update is on screen and not in the copy, so
     * every later struct from this client depends on one that is missing —
     * editing stops until a recovery export.
     */
    it('blocks editing when a write does not reach the copy', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(false);

      for (const entry of await indexedDB.databases()) {
        if (entry.name !== undefined) {
          await new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(entry.name as string);

            request.onsuccess = resolve;
            request.onerror = resolve;
            request.onblocked = resolve;
          });
        }
      }

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed onto a copy that is gone');

      await waitFor(
        () => harness.core.moduleInstances.ReadOnly.isEnabled,
        'editing to be blocked',
        2000
      ).catch(() => undefined);

      expect(
        harness.core.moduleInstances.ReadOnly.isEnabled,
        'editing continued although the edit never reached the copy'
      ).toBe(true);

      // And the host has to be TOLD. Editing stopping with nothing published
      // is a session that looks healthy from the outside while the copy has a
      // hole in it.
      await waitFor(
        () => seen.at(-1)?.save?.state === 'blocked',
        'the blocked save state',
        3000
      ).catch(() => undefined);

      expect(
        seen.at(-1)?.save,
        'the copy lost a write and the host was never told why editing stopped'
      ).toMatchObject({ state: 'blocked', reason: 'local-storage-failed' });
    }, 20_000);

    /**
     * A write that fails once and then works again — a quota refusal, not a
     * database that has gone. The recovery clear empties the copy, so the next
     * session record owes it a fresh snapshot: a `meta` written over an empty
     * copy is exactly what makes the boot after it adopt an EMPTY document as
     * editable.
     *
     * The reconnect here keeps the same lineage, so this pins the snapshot
     * half of that rule, not the new-lineage half.
     */
    it('a transient write failure leaves the next session record carrying a snapshot', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const harness = await boot({ offline: true });
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      // One refusal, then the database is healthy again — `commitTogether`
      // catches the synchronous throw, aborts that transaction alone, and
      // leaves the connection open.
      const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => {
        throw new Error('a transient quota failure');
      });

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed onto a full disk');

      await waitFor(() => harness.core.moduleInstances.ReadOnly.isEnabled, 'editing to be blocked', 3000);
      add.mockRestore();

      socket.serverClose(1001, 'gone');
      await waitFor(() => harness.sockets.length === 2, 'reconnect', 6000);
      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => collabAttr(harness.core) === 'connected', 'reconnected');

      // Tolerated: with the snapshot never re-owed there is nothing to wait for.
      await waitFor(async () => (await readStore()).updates.length > 0, 'a fresh snapshot', 3000)
        .catch(() => undefined);

      expect(
        (await readStore()).updates.length,
        'the re-recorded session left an adoptable copy with no snapshot behind it'
      ).toBeGreaterThan(0);
    }, 30_000);

    /**
     * A session with no local copy still opens a store — in memory, so the
     * queue contract holds — but a snapshot handed to it is discarded at
     * `db === null`. Encoding the whole document for that costs a full
     * serialisation on the first-sync critical path and buys nothing.
     */
    it('encodes no snapshot for a session that keeps no local copy', async () => {
      const encode = vi.spyOn(YjsManager.prototype, 'encodeStateAsUpdate');

      const harness = await boot();

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'from the room' } }]);
      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');

      expect(
        encode.mock.calls.length,
        'a session with nowhere to put a snapshot serialised the whole document anyway'
      ).toBe(0);
    }, 20_000);

    /**
     * The teardown window, where carry-forward contracts 2 and 4 pull opposite
     * ways: a write that fails during the final flush wants the copy dropped,
     * and a closed store may be asked for nothing. Contract 4 wins, and the
     * arbitration that would follow must not run either — every module is
     * marked destroyed before any `destroy()` body runs, so a late rejection
     * would reach a torn-down ReadOnly.
     */
    it('asks nothing of a torn-down editor when the final flush fails to store', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const harness = await boot({ offline: true });

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      const yjs = harness.core.moduleInstances.YjsManager;
      const flush = (entries: ReadonlyMap<string, unknown>): boolean => {
        let wrote = false;

        for (const [key, value] of entries) {
          wrote = yjs.updateBlockData('b1', key, value) || wrote;
        }

        return wrote;
      };

      yjs.enqueueBlockDataWrite('b1', { text: 'leading' }, flush);
      // The leading write has to be SAFELY stored before the copy goes, or the
      // block latches before teardown and the trailing failure is never the
      // first one.
      await waitFor(async () => textsOf((await readStore()).updates).includes('leading'), 'the leading write');

      yjs.enqueueBlockDataWrite('b1', { text: 'trailing' }, flush);

      for (const entry of await indexedDB.databases()) {
        if (entry.name !== undefined) {
          await new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(entry.name as string);

            request.onsuccess = resolve;
            request.onerror = resolve;
            request.onblocked = resolve;
          });
        }
      }

      const arbitration = vi.spyOn(harness.core.moduleInstances.ReadOnly, 'reapplyCollaborationArbitration');

      destroyCore(booted.splice(booted.indexOf(harness.core), 1)[0]);

      const duringTeardown = arbitration.mock.calls.length;

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(
        arbitration.mock.calls.length,
        'a store rejection after teardown re-ran arbitration on a destroyed editor'
      ).toBe(duringTeardown);
    }, 30_000);

    /**
     * The coalescing write buffer may still hold the last thing typed when the
     * editor comes down. `destroy` flushes it FIRST and detaches capture
     * after, or that write is made into a document nothing is listening to.
     */
    it('destroy detaches capture only after the final buffered Yjs flush', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      const before = await readStore();
      const yjs = harness.core.moduleInstances.YjsManager;
      const flush = (entries: ReadonlyMap<string, unknown>): boolean => {
        let wrote = false;

        for (const [key, value] of entries) {
          wrote = yjs.updateBlockData('b1', key, value) || wrote;
        }

        return wrote;
      };

      // Two writes: the first lands on the leading edge, the second coalesces
      // into the trailing window and is still pending at teardown.
      yjs.enqueueBlockDataWrite('b1', { text: 'leading' }, flush);
      yjs.enqueueBlockDataWrite('b1', { text: 'trailing' }, flush);

      destroyCore(booted.splice(booted.indexOf(harness.core), 1)[0]);

      await waitFor(
        async () => textsOf([...before.updates, ...(await readStore()).updates]).includes('trailing'),
        'the flushed write to reach the copy',
        1500
      ).catch(() => undefined);

      const after = await readStore();

      expect(
        textsOf(after.updates),
        'the buffered write was flushed after capture had already detached, so it reached nothing'
      ).toEqual(['trailing']);
      // Through the outbox, which is where a v2 session's own edits go.
      expect(after.pending).not.toBeNull();
    }, 30_000);

    /**
     * The same buffer, on the other structural chokepoint: a relineage
     * quarantines every row of the abandoned lineage, and the last thing typed
     * has to be a row by then or the recovery record does not carry it.
     *
     * Pins the OUTCOME, not the seam wiring that is one of its two causes:
     * `UndoHistory`'s 100ms word-boundary timer drains the same buffer
     * (undo-history.ts, `stopCapturing`), and it beats the quarantine's turn on
     * the store's serial queue here, so removing `flushPendingWrites` from the
     * seam does not fail this test. Measured, not assumed.
     */
    it('a buffered write in flight during relineage is quarantined with the rest', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      const yjs = harness.core.moduleInstances.YjsManager;
      const flush = (entries: ReadonlyMap<string, unknown>): boolean => {
        let wrote = false;

        for (const [key, value] of entries) {
          wrote = yjs.updateBlockData('b1', key, value) || wrote;
        }

        return wrote;
      };

      expect((await storeCounts()).pending, 'the fixture began with rows already waiting').toBe(0);

      // Back to back, with NOTHING awaited between them: the first rides the
      // leading edge and is a row at once, the second coalesces into the
      // trailing window and is still only in the buffer. Any await here would
      // outlast the 400ms window and make the second a leading edge too, which
      // is a fixture that cannot fail.
      yjs.enqueueBlockDataWrite('b1', { text: 'leading' }, flush);
      yjs.enqueueBlockDataWrite('b1', { text: 'trailing' }, flush);

      harness.socket().deliver({
        type: 'control',
        tag: { format: 1, epoch: 0, lineage: 'fedcba9876543210fedcba9876543210' },
      });

      await waitFor(async () => (await storeCounts()).quarantined > 0, 'the quarantine', 5000);

      expect(
        (await storeCounts()).quarantined,
        'the last buffered edit was still in the write buffer when the quarantine walked the outbox, so it never became a row and the recovery record does not carry it'
      ).toBe(2);
    }, 40_000);
  });

  /**
   * Protocol section 2. A client that negotiates v1 MUST NOT claim durable
   * acknowledgement: rows a v2 session journalled are KEPT — a v1 server can
   * neither acknowledge nor reject them — and editing stops until a connection
   * that can drain them arrives.
   */
  describe('mixed-version fallback', () => {
    /** What the client wrote, minus the presence chatter every session makes. */
    const wireTypes = (socket: MockSocket): string[] =>
      socket.sent.map((bytes) => decode(bytes).type).filter((type) => type !== 'awareness');

    const operationOn = (socket: MockSocket): Extract<SyncWireFrame, { type: 'operation' }> | undefined =>
      socket.sent
        .map((bytes) => decode(bytes))
        .find((frame): frame is Extract<SyncWireFrame, { type: 'operation' }> => frame.type === 'operation');

    /**
     * Leaves an outbox row behind that nothing has acknowledged, and hands back
     * the row a reload will find waiting.
     */
    const retainedRow = async (): Promise<operationStore.PendingOperation> => {
      const first = await boot({ offline: true });

      firstSync(first, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      first.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed under v2');
      await waitFor(async () => (await readStore()).pending !== null, 'the edit to reach the outbox');

      const { pending } = await readStore();

      destroyCore(booted.splice(booted.indexOf(first.core), 1)[0]);

      if (pending === null) {
        throw new Error('the v2 session journalled nothing to retain');
      }

      return pending;
    };

    it('v1 selected with no v2 rows keeps current behavior', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitFor(() => !harness.core.moduleInstances.ReadOnly.isEnabled, 'editable');

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed under v1');
      await waitFor(async () => (await cachedTexts()).includes('typed under v1'), 'the edit in the copy');

      expect(
        harness.core.moduleInstances.ReadOnly.isEnabled,
        'a v1 session with nothing waiting for a receipt stopped accepting edits'
      ).toBe(false);
      expect(wireTypes(socket), 'a v1 session stopped broadcasting its local writes')
        .toEqual(['syncStep1', 'update']);
      expect(
        (await readStore()).pending,
        'a v1 session journalled an operation row nothing can ever acknowledge'
      ).toBeNull();
    }, 30_000);

    it('v1 selected with pending v2 rows sends none and blocks editing', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const row = await retainedRow();
      const reloaded = await boot({ offline: true });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');

      const socket = firstSync(reloaded, []);

      await waitFor(() => collabAttr(reloaded.core) === 'connected', 'connected');

      // The real server ALWAYS asks (CollabRoom answers a SyncStep1 with its
      // diff and its own SyncStep1), and a v1 session answers that with a raw
      // SyncStep2 by design. Without this frame the fixture proves only that
      // the mock never asked.
      const asking = peerWith([]);

      socket.deliver({ type: 'syncStep1', stateVector: asking.getStateVector() });
      asking.destroy();

      // Tolerated: with the hold never applied there is nothing to wait for,
      // and the assertion below is the one that has to speak.
      await waitFor(() => reloaded.core.moduleInstances.ReadOnly.isEnabled, 'editing to be blocked', 1500)
        .catch(() => undefined);

      expect(
        reloaded.core.moduleInstances.ReadOnly.isEnabled,
        'a v1 server was selected while durable rows waited, so the session went on taking edits it can never deliver a receipt for'
      ).toBe(true);
      // "Sends none" is about OPERATIONS: no type-102 frame carries a durable
      // row to a server that can neither acknowledge nor reject it. The resync
      // answer is a separate, ruled-correct behaviour — the rows' CONTENT does
      // reach a v1 server inside that SyncStep2, because it is in the document
      // and v1 sync is the only way it gets there at all.
      expect(
        operationOn(socket),
        'a v1 server was sent an operation frame on behalf of a row it can neither acknowledge nor reject'
      ).toBeUndefined();
      expect(wireTypes(socket), 'a v1 session stopped answering the server resync it has always answered')
        .toEqual(['syncStep1', 'syncStep2']);
      expect(
        (await readStore()).pending?.operationId,
        'the retained row did not survive the v1 session that could not take it'
      ).toBe(row.operationId);
    }, 40_000);

    /**
     * A read that cannot answer "are rows waiting?" must not be read as "no".
     * The database is deleted underneath the session, so `oldestPending`'s own
     * `idb.transact` throws — the same fault that makes `stats()` throw, which
     * `recordSaveState` already handles by leaving the verdict to the latch.
     */
    it('an outbox read that fails stops taking edits rather than assuming none wait', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      await retainedRow();

      // ONLY `oldestPending` fails. Deleting the database would do it too, but
      // that also makes `stats()` throw, which latches `durabilityLost` and
      // blocks editing on its own — the fixture would pass without the catch.
      vi.spyOn(operationStore, 'createOperationStore').mockImplementation((options) => {
        const store = createOperationStore(options);

        return {
          ...store,
          oldestPending: () => Promise.reject(new Error('probe: the outbox could not be read')),
        };
      });

      const reloaded = await boot({ offline: true });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');

      firstSync(reloaded, []);
      await waitFor(() => collabAttr(reloaded.core) === 'connected', 'connected');

      // The failing read also SKIPS the arbitration of its own transition, so
      // "still read-only" right here proves nothing — the session simply never
      // left the state it booted in. The next transition arbitrates normally
      // and is what reads the latch back.
      reloaded.socket().serverClose(1006);
      await waitFor(() => collabAttr(reloaded.core) === 'offline', 'the disconnect', 5000);
      // Tolerated: a hold that fails open never blocks, so there is nothing to
      // wait for and the assertion below is the one that has to speak.
      await waitFor(() => reloaded.core.moduleInstances.ReadOnly.isEnabled, 'editing to be blocked', 3000)
        .catch(() => undefined);

      expect(
        reloaded.core.moduleInstances.ReadOnly.isEnabled,
        'an outbox read that could not answer was read as "no rows waiting", so the session went on taking edits it can never deliver'
      ).toBe(true);
    }, 40_000);

    /**
     * `recordCacheMeta` already refuses to encode a snapshot a memory-mode
     * store would only discard; the quarantine snapshot owes the same rule. It
     * is a whole-document serialisation on a session that keeps no copy at all.
     */
    it('a session with no local copy encodes no recovery snapshot to quarantine', async () => {
      const harness = await boot();

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      const encode = vi.spyOn(harness.core.moduleInstances.YjsManager, 'encodeStateAsUpdate');

      harness.socket().deliver({
        type: 'control',
        tag: { format: 1, epoch: 0, lineage: 'fedcba9876543210fedcba9876543210' },
      });
      await waitFor(() => harness.sockets.length === 2, 'the reconnect', 8000);

      expect(
        encode.mock.calls.filter((call) => call[0] === undefined),
        'a session that keeps no local copy serialised the whole document for a recovery snapshot the store throws away'
      ).toEqual([]);
    }, 30_000);

    /**
     * The other half of the downgrade: everything this session journalled was
     * already acknowledged, so v1 takes nothing away from it.
     */
    it('a v1 downgrade with nothing waiting keeps editing possible', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const first = await boot({ offline: true });

      firstSync(first, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      expect((await readStore()).pending, 'the fixture left a row behind').toBeNull();

      destroyCore(booted.splice(booted.indexOf(first.core), 1)[0]);

      const reloaded = await boot({ offline: true });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');

      // A cache-adopted session is ALREADY editable when the frame lands, so
      // waiting for "editable" returns on the first poll and would assert
      // before the outbox read has answered. Arbitration is the first thing the
      // transition does after that read, so one more call is the barrier — and
      // if it has already landed the wait simply expires, which is still after.
      const arbitration = vi.spyOn(reloaded.core.moduleInstances.ReadOnly, 'reapplyCollaborationArbitration');

      firstSync(reloaded, []);
      await waitFor(() => collabAttr(reloaded.core) === 'connected', 'connected');

      const published = arbitration.mock.calls.length;

      await waitFor(
        () => arbitration.mock.calls.length > published,
        'the arbitration that follows the outbox read',
        3000
      ).catch(() => undefined);

      expect(
        reloaded.core.moduleInstances.ReadOnly.isEnabled,
        'a v1 server was blamed for rows that do not exist, and the session stopped taking edits'
      ).toBe(false);
    }, 40_000);

    /**
     * The hold is re-read on EVERY later v1 connection, not only on the
     * downgrade that set it: a relineage empties the outbox behind the
     * session's back, and a client that only ever asked once would stay
     * unable to edit for the rest of the tab's life.
     */
    it('a later v1 connection lifts the hold once the rows are gone', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      await retainedRow();

      const reloaded = await boot({ offline: true });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');
      firstSync(reloaded, []);
      await waitFor(() => reloaded.core.moduleInstances.ReadOnly.isEnabled, 'the hold to go on', 3000);

      // A lineage the client has never seen: the rows stamped with the old one
      // are quarantined, so by the next connection nothing is waiting.
      reloaded.socket().deliver({
        type: 'control',
        tag: { format: 1, epoch: 0, lineage: 'fedcba9876543210fedcba9876543210' },
      });
      await waitFor(() => reloaded.sockets.length === 2, 'the reconnect', 8000);
      await waitFor(async () => (await readStore()).pending === null, 'the quarantine', 5000);

      firstSync(reloaded, []);
      await waitFor(() => collabAttr(reloaded.core) === 'connected', 'the second v1 connection', 5000);
      await waitFor(() => !reloaded.core.moduleInstances.ReadOnly.isEnabled, 'the hold to lift', 5000)
        .catch(() => undefined);

      expect(
        reloaded.core.moduleInstances.ReadOnly.isEnabled,
        'the outbox was emptied and a fresh connection came up, and the session never asked again — it stays unable to edit for good'
      ).toBe(false);
    }, 60_000);

    it('v2 reconnect later sends and acknowledges the retained row', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const row = await retainedRow();
      const reloaded = await boot({ offline: true });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');
      firstSync(reloaded, []);
      await waitFor(() => collabAttr(reloaded.core) === 'connected', 'the v1 connection');

      reloaded.socket().serverClose(1006);
      await waitFor(() => reloaded.sockets.length === 2, 'the reconnect', 8000);

      const second = firstSync(reloaded, [], V2);

      // Tolerated: a row that never leaves has nothing to wait for.
      await waitFor(() => operationOn(second) !== undefined, 'the retained row on the wire', 3000)
        .catch(() => undefined);

      expect(
        operationOn(second),
        'a connection that could finally take the retained row came up and the row still never left'
      ).toBeDefined();
      expect(operationOn(second)?.operationId).toBe(row.operationId);

      second.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE,
        operationId: row.operationId,
        serverSequence: '1',
      });
      await waitFor(async () => (await readStore()).pending === null, 'the row to be retired', 3000)
        .catch(() => undefined);

      expect((await readStore()).pending, 'an acknowledged row stayed in the outbox').toBeNull();
      expect(
        reloaded.core.moduleInstances.ReadOnly.isEnabled,
        'editing stayed blocked on a session that can deliver again'
      ).toBe(false);
    }, 60_000);

    /**
     * The await this task introduces. A v2 session that comes back to a v1
     * server reads the outbox before arbitration may lift read-only, and a
     * teardown landing inside that read must not re-arbitrate a ReadOnly that
     * is already gone — the same rule the final-flush case above pins.
     */
    it('asks nothing of a torn-down editor while the outbox read is in flight', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      await retainedRow();

      const reloaded = await boot({ offline: true });

      await waitFor(() => reloaded.core.moduleInstances.BlockManager.blocks.length === 1, 'cached blocks');

      const arbitration = vi.spyOn(reloaded.core.moduleInstances.ReadOnly, 'reapplyCollaborationArbitration');

      // Synchronous with the frame: the transition runs to the outbox read and
      // parks there, which is the window this test exists for.
      firstSync(reloaded, []);
      destroyCore(booted.splice(booted.indexOf(reloaded.core), 1)[0]);

      const duringTeardown = arbitration.mock.calls.length;

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(
        arbitration.mock.calls.length,
        'an outbox read that resolved after teardown re-arbitrated a destroyed editor'
      ).toBe(duringTeardown);
    }, 40_000);

    /**
     * The same-tab wake. The store's `onCommitted` hint is cross-tab only, so
     * without it a fresh edit sits in the outbox until something else — a
     * reconnect, another tab — happens to shake the drain loose.
     */
    it('a fresh local edit reaches the wire without waiting for a reconnect', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const harness = await boot({ offline: true });
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed on a live session');
      await waitFor(() => operationOn(socket) !== undefined, 'the edit on the wire', 3000)
        .catch(() => undefined);

      const pending = (await readStore()).pending;

      expect(
        operationOn(socket),
        'an edit made on a live v2 session sat in the outbox until something else woke the drain'
      ).toBeDefined();
      expect(operationOn(socket)?.operationId).toBe(pending?.operationId);
    }, 30_000);
  });

  describe('the binary seam', () => {
    it('delivers a remote update through onAnyDocUpdate but not onDocUpdate', async () => {
      // seam() is private and nothing calls its onAnyDocUpdate yet (the offline
      // cache reaches YjsManager directly), so only the object handed to the
      // provider proves the seam still carries the method. Spy calls through.
      const createProviderSpy = vi.spyOn(collabProvider, 'createCollabProvider');

      const harness = await boot();
      const [firstCall] = createProviderSpy.mock.calls;

      if (firstCall === undefined) {
        throw new Error('Collaboration never built a provider');
      }

      const seam: CollabDocSeam = firstCall[0].yjs;
      const anyUpdates: unknown[] = [];
      const localUpdates: unknown[] = [];

      seam.onAnyDocUpdate((update) => anyUpdates.push(update));
      seam.onDocUpdate((update) => localUpdates.push(update));

      firstSync(harness, [{ type: 'paragraph', data: { text: 'from the server' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      expect(anyUpdates.length).toBeGreaterThan(0);
      expect(localUpdates).toEqual([]);
    });
  });

  describe('empty document after the first sync', () => {
    it('seeds exactly one default block, with an id both peers agree on', async () => {
      const first = await boot({ doc: 'shared' });
      const second = await boot({ doc: 'shared' });

      firstSync(first, []);
      firstSync(second, []);

      await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'seed on first peer');
      await waitFor(() => second.core.moduleInstances.BlockManager.blocks.length === 1, 'seed on second peer');

      const firstId = first.core.moduleInstances.BlockManager.blocks[0].id;
      const secondId = second.core.moduleInstances.BlockManager.blocks[0].id;

      expect(firstId).toBe(secondId);
      expect(first.core.moduleInstances.YjsManager.toJSON().map((block) => block.id)).toEqual([firstId]);
    });

    it('stays at ONE paragraph after the two peers exchange what they wrote', async () => {
      const first = await boot({ doc: 'shared' });
      const second = await boot({ doc: 'shared' });

      firstSync(first, []);
      firstSync(second, []);

      await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'seed on first peer');
      await waitFor(() => second.core.moduleInstances.BlockManager.blocks.length === 1, 'seed on second peer');

      const firstYjs = first.core.moduleInstances.YjsManager;
      const secondYjs = second.core.moduleInstances.YjsManager;

      // The mock transport does not relay, so play the server: hand each peer
      // the other's state. Anything either of them authored on its own — a
      // block core seeded behind the module's back — lands here as a second
      // paragraph, and N peers would make N.
      first.socket().deliver({ type: 'update', update: secondYjs.encodeStateAsUpdate(firstYjs.getStateVector()) });
      second.socket().deliver({ type: 'update', update: firstYjs.encodeStateAsUpdate(secondYjs.getStateVector()) });

      await waitFor(() => collabAttr(first.core) === 'connected', 'first peer still connected');

      expect(firstYjs.toJSON()).toHaveLength(1);
      expect(secondYjs.toJSON()).toHaveLength(1);
      expect(firstYjs.toJSON()[0].id).toBe(secondYjs.toJSON()[0].id);
      expect(first.core.moduleInstances.BlockManager.blocks.length).toBe(1);
      expect(second.core.moduleInstances.BlockManager.blocks.length).toBe(1);
    });

    it('keeps a room whose only block is the empty seed on screen for the peer that joins it', async () => {
      const harness = await boot({ doc: 'shared' });

      // What a second peer receives from a room somebody else just seeded: one
      // paragraph with no text. `validate()` rejects it, so the read-only
      // transition's save comes back empty — and rebuilding the view from THAT
      // would leave the joiner staring at a blank editor over a document that
      // has content.
      firstSync(harness, [{ id: 'seeded-block', type: 'paragraph', data: { text: '' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'the remote block');

      const mounted = harness.core.moduleInstances.BlockManager.blocks[0];

      // The transition rebuilds the view, so the block is composed again: wait
      // for THAT, not for the read-only flag, which flips before the rebuild.
      await waitFor(
        () => harness.core.moduleInstances.BlockManager.blocks[0] !== mounted,
        'the read-only transition to rebuild the view'
      );

      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
      expect(harness.core.moduleInstances.BlockManager.blocks.map((block) => block.id)).toEqual(['seeded-block']);
      expect(harness.core.moduleInstances.YjsManager.toJSON().map((block) => block.id)).toEqual(['seeded-block']);
    });

    it('seeds nothing for a read-only host, whatever the ticket grants', async () => {
      const harness = await boot({ doc: 'shared', readOnly: true });

      firstSync(harness, []);

      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');
      // The status handler seeds synchronously after arbitration; give the whole
      // chain a turn so "nothing was written" is a real observation.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(harness.core.moduleInstances.YjsManager.toJSON()).toEqual([]);
      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(0);
      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
    });

    it('seeds once per session, not once per reconnect', async () => {
      const harness = await boot();
      const socket = firstSync(harness, []);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'seed');

      socket.serverClose(1001, 'gone');

      await waitFor(() => harness.sockets.length === 2, 'reconnect', 6000);

      firstSync(harness, []);

      await waitFor(() => collabAttr(harness.core) === 'connected', 'reconnected');

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(1);
    });
  });

  describe('an editable editor always has somewhere to type', () => {
    it('seeds when a later ticket grants the write access the first one denied', async () => {
      // Short-lived on purpose: the ticket source caches a pass until 30s
      // before it expires, so a grant only ever changes on a re-mint.
      const ticketFor = (write: boolean): string =>
        `header.${btoa(JSON.stringify({
          exp: Math.floor(Date.now() / 1000) + 10,
          write,
        }))}.signature`;

      const grant = { write: false };

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async (): Promise<unknown> => ({ ticket: ticketFor(grant.write) }),
      })));

      const harness = await boot({ doc: 'shared', ticket: '/tickets' });

      await waitFor(() => harness.sockets.length === 1, 'socket after the ticket mint');

      firstSync(harness, []);

      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // A member the server will not accept writes from authors nothing.
      expect(harness.core.moduleInstances.YjsManager.toJSON()).toEqual([]);

      grant.write = true;
      harness.socket().serverClose(1001, 'gone');

      // The reconnect mints a fresh ticket, and THAT is where the grant flips.
      await waitFor(() => harness.sockets.length === 2, 'a reconnect', 6000);
      await waitFor(
        () => harness.core.moduleInstances.BlockManager.blocks.length === 1,
        'the seed the new grant unlocks'
      );

      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
      expect(harness.core.moduleInstances.YjsManager.toJSON()).toHaveLength(1);
      // A sync, a reconnect and a re-mint on real timers.
    }, 20_000);

    it('appends the first block when a click below an empty editor is the only way in', async () => {
      const harness = await boot({ doc: 'shared', readOnly: true });

      firstSync(harness, []);

      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');
      // Let the sync's own seed decision land first: lifting read-only while it
      // is still in flight would make the seed run and hide the state under test.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // A pure viewer seeds nothing, so lifting read-only leaves an editable
      // editor with no block — and the bottom zone is what a user reaches for.
      await harness.core.moduleInstances.API.methods.readOnly.set(false);

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(0);

      harness.core.moduleInstances.UI.nodes.bottomZone.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'the appended block');

      expect(harness.core.moduleInstances.YjsManager.toJSON()).toHaveLength(1);
    });
  });

  describe('lineage reset', () => {
    it('drops the old room, reconnects, and materialises the new one', async () => {
      const harness = await boot();
      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'the old room' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'old room block');

      socket.serverClose(4409, 'the room was reset');

      // No longer synchronous with the close: every session now holds an
      // outbox, so the reset waits for the old lineage to be quarantined before
      // it throws the document away. Both still go, and the SyncStep1 below is
      // what proves nothing of the old room reached the new one.
      await waitFor(
        () => harness.core.moduleInstances.YjsManager.toJSON().length === 0,
        'the old room to be dropped'
      );

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(0);

      await waitFor(() => harness.core.moduleInstances.ReadOnly.isEnabled, 'read-only while unsynced again');
      await waitFor(() => harness.sockets.length === 2, 'a reconnect', 6000);

      const second = harness.socket();

      second.open();

      // The one frame that may precede the control frame now describes a
      // document with no history: nothing of the old room can reach the new one.
      expect(second.sent).toHaveLength(1);

      second.deliver(controlFrame());

      const peer = peerWith([{ type: 'paragraph', data: { text: 'the new room' } }]);

      second.deliver({
        type: 'syncStep2',
        update: peer.encodeStateAsUpdate(harness.core.moduleInstances.YjsManager.getStateVector()),
      });
      peer.destroy();

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'new room block');

      expect(blockTexts(harness.core)).toEqual(['the new room']);
      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
      expect(collabAttr(harness.core)).toBe('connected');
    });

    it('keeps publishing participants afterwards, on the awareness the reset rebuilt', async () => {
      const harness = await boot();
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'the old room' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'old room block');

      socket.serverClose(4409, 'the room was reset');

      await waitFor(() => harness.sockets.length === 2, 'a reconnect', 6000);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());

      // Awareness subscriptions bind to the INSTANCE, and the reset built a new
      // one: a module still hooked to the old object would publish nothing here.
      const peer = new DocumentStore(new YBlockSerializer());

      peer.enableAwareness();
      peer.setAwarenessField('user', { name: 'Ada' });
      second.deliver({ type: 'awareness', update: peer.encodeAwarenessUpdate() });
      peer.destroy();

      expect(seen.at(-1)?.participants.map((entry) => entry.user.name)).toContain('Ada');
    });
  });

  describe('readOnly arbitration', () => {
    it('refuses set(false) while unsynced and says why', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { core } = await boot();
      const readOnly = core.moduleInstances.API.methods.readOnly;

      const result = await readOnly.set(false);

      expect(result).toBe(true);
      expect(core.moduleInstances.ReadOnly.isEnabled).toBe(true);
      expect(warn).toHaveBeenCalled();
    });

    it('lets set(true) win over a later sync', async () => {
      const harness = await boot();

      await harness.core.moduleInstances.API.methods.readOnly.set(true);

      firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
    });

    it('keeps a write:false ticket read-only after the sync', async () => {
      const payload = btoa(JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 3600,
        write: false,
      }));

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async (): Promise<unknown> => ({ ticket: `header.${payload}.signature` }),
      })));

      const harness = await boot({ ticket: '/tickets' });

      await waitFor(() => harness.sockets.length === 1, 'socket after the ticket mint');

      firstSync(harness, [{ type: 'paragraph', data: { text: 'read only for me' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
      expect(harness.socket().protocols).toEqual([V2, 'blok-sync.v1', `header.${payload}.signature`]);
    });
  });

  describe('status events', () => {
    it('emits collaboration:status on connect and on disconnect', async () => {
      const harness = await boot();
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      socket.serverClose(1001, 'gone');

      // Consecutive repeats are collapsed: the save state is published on the
      // same event and changes without the connection changing, so a
      // transition is a status that differs from the one before it.
      const transitions = seen
        .map((payload) => payload.status)
        .filter((status, index, all) => status !== all[index - 1]);

      expect(transitions).toEqual(['connected', 'offline']);
      // No REMOTE participant yet; the local reader may already be its own row.
      expect(seen[0].participants.filter((participant) => !participant.self)).toEqual([]);
    });

    it('reports a terminal stop as error, with why it stopped', async () => {
      const harness = await boot();
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      // 4403 is the provider's last word. Calling that "offline" told the host
      // the opposite of the truth — offline means edits stay pending until a
      // reconnect, and nothing here will ever reconnect.
      socket.serverClose(4403, 'forbidden');

      await waitFor(() => seen.at(-1)?.status === 'error', 'the terminal status');

      expect(seen.at(-1)?.error).toBe('forbidden');
      expect(seen.at(-1)?.code).toBe(4403);
      expect(seen.at(-1)?.reason).toBe('forbidden');
    });

    it('says when the next reconnect attempt is while offline', async () => {
      const harness = await boot();
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      socket.serverClose(1001, 'server restarting');

      const offline = seen.at(-1);

      expect(offline?.status).toBe('offline');
      expect(offline?.retryInMs).toBeGreaterThan(0);
      expect(offline?.error).toBeUndefined();
    });

    it('drops a stale detail when the next transition carries none', async () => {
      const harness = await boot();
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      socket.serverClose(1001, 'server restarting');

      // A generous budget: the transition that lifted read-only is still
      // rebuilding the view, and the reconnect timer only gets the thread back
      // once that settles — the reported `retryInMs` is 250, the wall clock ~2s.
      await waitFor(() => harness.sockets.length === 2, 'a reconnect', 6000);

      firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => seen.at(-1)?.status === 'connected', 'reconnected');

      // A retry countdown riding along on `connected` would have the host
      // telling the user a live session is about to retry.
      expect(seen.at(-1)?.retryInMs).toBeUndefined();
      expect(seen.at(-1)?.code).toBeUndefined();
      expect(seen.at(-1)?.reason).toBeUndefined();
      // Two syncs and a reconnect on real timers.
    }, 20_000);

    it('names the local editor from the identity it publishes to the room', async () => {
      const harness = await boot({ user: { name: 'Ada' }, editor: { id: 'account-7' } });

      firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      // The room never echoes this editor's own state back, so without the
      // direct hand-off a host could name every peer except themselves.
      expect(harness.core.moduleInstances.UserDirectory.known('account-7')?.name).toBe('Ada');
    });

    it('learns a peer name so the last-edited footer can use it', async () => {
      const harness = await boot();
      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      const peer = new DocumentStore(new YBlockSerializer());

      peer.enableAwareness();
      peer.setAwarenessField('user', { name: 'Ada', color: '#0b6e99', id: 'account-7' });
      socket.deliver({ type: 'awareness', update: peer.encodeAwarenessUpdate() });
      peer.destroy();

      expect(harness.core.moduleInstances.UserDirectory.known('account-7')?.name).toBe('Ada');
    });

    it('publishes a peer who configured no name — the default configuration', async () => {
      const harness = await boot();
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      // `collaboration.user` is optional, so this is what a host who never set
      // one looks like to everybody else. Dropping them left a room where
      // everyone is connected and nobody appears.
      const peer = new DocumentStore(new YBlockSerializer());

      peer.enableAwareness();
      peer.setAwarenessField('user', { color: '#0b6e99' });
      socket.deliver({ type: 'awareness', update: peer.encodeAwarenessUpdate() });
      peer.destroy();

      // The local reader may also be in the list now, as its own row.
      const remote = seen.at(-1)?.participants.find((participant) => !participant.self);

      expect(remote).toBeDefined();
      expect(remote?.user.name).toBe('');
      expect(remote?.user.color).toBe('#0b6e99');
      expect(remote?.user.glyph).not.toBeNull();
      // The glyph is non-deterministic, so the label cannot be pinned to one
      // phrase — but it must be ONE of the translated anonymous phrases,
      // proving the translator wired at index.ts actually ran.
      const knownLabels = Object.values(ANONYMOUS_LABEL_KEYS).map((key) =>
        harness.core.moduleInstances.I18n.t(key));

      expect(knownLabels).toContain(remote?.user.label);
    });

    it('reports the local user as self, now that participants include the reader', async () => {
      const harness = await boot({ user: { name: 'Me' } });
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      // The local state is REAL, published by presence like any peer's. Unlike
      // the renderer, which must never draw the reader's own caret, this list
      // is the one place that IS supposed to draw them, marked `self`.
      const states = Array.from(harness.core.moduleInstances.YjsManager.getAwarenessStates().values());

      expect(states).toHaveLength(1);
      expect(states[0].user).toMatchObject({ name: 'Me' });

      // Pinned only now, after the local reader's own (real-clock) activeAt
      // was already published — so this stamp is the only one measured
      // against the frozen clock, proving the reported lastActiveAt travels
      // through the RECEIVER's own Date.now() at index.ts, not a fixed value.
      const NOW = 1_700_000_000_000;

      vi.spyOn(Date, 'now').mockReturnValue(NOW);

      const peer = new DocumentStore(new YBlockSerializer());

      peer.enableAwareness();
      peer.setAwarenessField('user', { name: 'Ada' });
      peer.setAwarenessField('activeAt', NOW - 5_000);
      socket.deliver({ type: 'awareness', update: peer.encodeAwarenessUpdate() });
      peer.destroy();

      const participants = seen.at(-1)?.participants ?? [];
      const self = participants.find((participant) => participant.self);
      const remote = participants.find((participant) => !participant.self);

      expect(participants).toHaveLength(2);
      expect(self?.user.name).toBe('Me');
      expect(remote?.lastActiveAt).toBe(NOW - 5_000);
    });

    // A hostile frame can carry thousands of fabricated client states, and
    // every awareness change re-walks the map. The host's peer list is built
    // through the same cap the presence renderer applies.
    it('caps the published participant list at MAX_PEERS however many states a frame carries', async () => {
      const harness = await boot();
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      // Hand-encoded: y-protocols only encodes states an Awareness holds.
      const fabricated = 500;
      const encoder = encoding.createEncoder();

      encoding.writeVarUint(encoder, fabricated);

      for (const index of Array.from({ length: fabricated }, (_, position) => position)) {
        encoding.writeVarUint(encoder, 1_000_000 + index);
        encoding.writeVarUint(encoder, 1);
        encoding.writeVarString(encoder, JSON.stringify({ user: { name: `peer ${index}` } }));
      }

      socket.deliver({ type: 'awareness', update: encoding.toUint8Array(encoder) });

      expect(harness.core.moduleInstances.YjsManager.getAwarenessStates().size).toBeGreaterThan(MAX_PEERS);

      // Same cap, self excluded: `selectDrawableStates` bounds the FABRICATED
      // peers, and the reader's own row rides in beside them afterwards.
      const remote = seen.at(-1)?.participants.filter((participant) => !participant.self) ?? [];

      expect(remote.length).toBeLessThanOrEqual(MAX_PEERS);
    });
  });

  // `emitStatus` runs inside the awareness change callback, inside the frame
  // handler: a host listener that throws must not end the session, and one that
  // throws on the `connected` transition must not stop arbitration behind it.
  describe('save state', () => {
    /** The first operation frame a v2 session put on the wire. */
    const operationOn = (socket: MockSocket): Extract<SyncWireFrame, { type: 'operation' }> | undefined =>
      socket.sent
        .map((bytes) => decode(bytes))
        .find((frame): frame is Extract<SyncWireFrame, { type: 'operation' }> => frame.type === 'operation');

    /** Every save state published so far, in order. */
    const states = (seen: CollaborationStatusChangedPayload[]): (string | undefined)[] =>
      seen.map((payload) => payload.save?.state);

    /**
     * Waits until nothing new is published for a beat.
     *
     * The first sync's read-only cascade runs over several macrotasks and its
     * TRAILING store read lands whenever it lands. Without this barrier that
     * read is what publishes the next state, and a wake under test is never
     * the thing that spoke — which is exactly how the quarantine wake passed
     * while deleted.
     * @param seen - the payloads collected so far
     */
    const settle = async (seen: CollaborationStatusChangedPayload[]): Promise<void> => {
      await waitFor(async () => {
        const count = seen.length;

        await new Promise((resolve) => setTimeout(resolve, 250));

        return seen.length === count;
      }, 'the session to go quiet', 10_000);
    };

    /**
     * Boots and collects status payloads from that moment on. The array is live.
     * @param options - what to boot with
     */
    const watched = async (
      options: BootOptions = {}
    ): Promise<{ harness: Harness; seen: CollaborationStatusChangedPayload[] }> => {
      const harness = await boot(options);
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      return { harness, seen };
    };

    it('connected may report pending', async () => {
      const { harness, seen } = await watched();

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitFor(() => states(seen).includes('saved'), 'the synced save state', 3000);

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed and unacknowledged');

      await waitFor(
        () => seen.some((payload) => payload.save?.state === 'pending' && payload.save.pendingOperations > 0),
        'a pending save state',
        3000
      ).catch(() => undefined);

      const pending = seen.filter((payload) => payload.save?.state === 'pending').at(-1);

      expect(
        pending,
        'a live session published nothing about an edit the server has not taken'
      ).toBeDefined();
      expect(
        pending?.status,
        'unsaved work was only reported once the connection itself changed'
      ).toBe('connected');
      expect(pending?.save?.pendingOperations).toBe(1);
      expect(pending?.save?.pendingBytes).toBeGreaterThan(0);
    }, 20_000);

    it('saved requires zero rows and no append transaction', async () => {
      const { harness, seen } = await watched();

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitFor(() => states(seen).includes('saved'), 'the synced save state', 3000);

      expect(seen.filter((payload) => payload.save?.state === 'saved').at(-1)?.save).toEqual({
        state: 'saved',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 0,
      });

      const before = seen.length;

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'mid-append');

      await waitFor(
        () => seen.slice(before).some((payload) => payload.save?.state === 'pending'),
        'the save state to leave saved',
        3000
      ).catch(() => undefined);

      // The store counts an append from the CALL, not from the commit, so this
      // first report is the window where no row exists yet — and the document
      // is not saved in it either.
      expect(
        seen.slice(before).find((payload) => payload.save?.state === 'pending')?.save,
        'the editor called itself saved while the row for the last edit was still being written'
      ).toEqual({
        state: 'pending',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 0,
      });
    }, 20_000);

    it('v1 reports legacy unavailable and never saved', async () => {
      const { harness, seen } = await watched();

      // Let the boot go quiet first. The post-ready replay publishes whatever
      // is current WITHOUT coalescing, so a replay landing after the sync
      // would deliver the legacy verdict on its own and this test would pass
      // with the coalescer's `reason` term deleted.
      await settle(seen);

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }]);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitFor(
        () => seen.some((payload) => payload.save?.reason === 'legacy-protocol'),
        'the legacy verdict',
        3000
      ).catch(() => undefined);

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed under v1');
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(
        states(seen),
        'a v1 session called an edit saved, though v1 acknowledges nothing (protocol section 2)'
      ).not.toContain('saved');
      expect(seen.at(-1)?.save).toEqual({
        state: 'unavailable',
        reason: 'legacy-protocol',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 0,
      });

      // RE-EMIT, not reorder. `emitStatus` has to stay synchronous — the
      // connect/disconnect test asserts right after `serverClose` — so the
      // store read that names the protocol lands on a FOLLOW-UP event.
      // Computing the save state before the emit would collapse these two.
      const connected = seen.filter((payload) => payload.status === 'connected');

      expect(connected.length).toBeGreaterThan(1);
      expect(connected[0].save?.reason).toBeUndefined();
      expect(connected.at(-1)?.save?.reason).toBe('legacy-protocol');
    }, 20_000);

    it('storage failure reports blocked with reason local-storage-failed and leaves the terminal reason union unchanged', async () => {
      const factory = new IDBFactory();

      vi.spyOn(factory, 'open').mockImplementation(() => {
        throw new Error('storage is unavailable');
      });
      vi.stubGlobal('indexedDB', factory);

      const { harness, seen } = await watched({ offline: true });

      firstSync(harness, []);
      await waitFor(() => collabAttr(harness.core) === 'connected', 'connected');
      await waitFor(() => states(seen).includes('blocked'), 'the blocked save state', 3000)
        .catch(() => undefined);

      expect(
        seen.at(-1)?.save,
        'a session whose local copy could not be opened went on reporting its work saved'
      ).toEqual({
        state: 'blocked',
        reason: 'local-storage-failed',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 0,
      });
      // The terminal union means "the editor will not reconnect". A broken
      // local store does not stop the socket, so it must never reach `error`.
      expect(
        seen.map((payload) => payload.error),
        'a persistence failure widened the terminal reason union'
      ).toEqual(seen.map(() => undefined));
      expect(states(seen)).not.toContain('saved');
    }, 20_000);

    it('reset reports quarantined count after reconnect', async () => {
      const { harness, seen } = await watched();
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed before the reset');
      await waitFor(
        () => seen.some((payload) => payload.save?.state === 'pending' && payload.save.pendingOperations > 0),
        'the outbox row',
        3000
      );

      // A lineage this client has never seen: the rows stamped with the old one
      // move to quarantine and the session reconnects into the new room.
      socket.deliver({
        type: 'control',
        tag: { format: 1, epoch: 0, lineage: 'fedcba9876543210fedcba9876543210' },
      });

      await waitFor(() => harness.sockets.length === 2, 'the reconnect', 8000);
      firstSync(harness, [], V2);
      await waitFor(() => seen.at(-1)?.status === 'connected', 'the second connection', 5000);
      await waitFor(() => states(seen).includes('quarantined'), 'the quarantined verdict', 3000)
        .catch(() => undefined);

      expect(
        seen.at(-1)?.save,
        'a reset moved this editor’s work out of the queue and the session reported nothing lost'
      ).toEqual({
        state: 'quarantined',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 1,
      });

      // Both counts non-zero, which is the only place the ORDER of the two
      // branches shows: new work drains itself, quarantined work never does
      // and needs the reader to export it, so the loss is what the headline
      // has to name.
      harness.core.moduleInstances.YjsManager.addBlock({
        id: 'after-the-reset',
        type: 'paragraph',
        data: { text: 'typed into the new room' },
      });

      await waitFor(
        () => (seen.at(-1)?.save?.pendingOperations ?? 0) > 0,
        'a row in the new lineage',
        3000
      ).catch(() => undefined);

      expect(
        seen.at(-1)?.save?.state,
        'work that can still be sent hid work that never will be'
      ).toBe('quarantined');
      expect(seen.at(-1)?.save?.pendingOperations).toBeGreaterThan(0);
      expect(seen.at(-1)?.save?.quarantinedOperations).toBe(1);
    }, 40_000);

    /**
     * The third reason the payload declares. A FINAL rejection retires the
     * whole tail — later updates may depend on the refused one — so the rows
     * are gone for good and only an export brings them back.
     */
    it('a final rejection reports quarantined with reason operation-rejected', async () => {
      const { harness, seen } = await watched();
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed and refused');
      await waitFor(() => operationOn(socket) !== undefined, 'the operation on the wire', 3000);
      await settle(seen);

      socket.deliver({
        type: 'rejection',
        lineage: LINEAGE,
        operationId: operationOn(socket)?.operationId ?? '',
        code: 'invalid-update',
      });

      await waitFor(() => states(seen).includes('quarantined'), 'the quarantined verdict', 3000)
        .catch(() => undefined);

      expect(
        seen.at(-1)?.save,
        'the server refused an edit for good and the session reported nothing lost'
      ).toEqual({
        state: 'quarantined',
        reason: 'operation-rejected',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 1,
      });
    }, 20_000);

    /**
     * The FOURTH reason `quarantineTail` runs with, and the one a classifier
     * built from the other three gets wrong. `oldestPending` does not filter by
     * lineage — another tab shares this outbox — so a row of a lineage this
     * session no longer serves reaches the drain and is quarantined as
     * `stale-lineage`. Nothing was refused and nothing failed.
     */
    it('a stale-lineage quarantine is not reported as a rejection', async () => {
      vi.stubGlobal('indexedDB', new IDBFactory());

      const { harness, seen } = await watched({ offline: true });

      firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);
      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');
      await waitForCachedDocument();
      await settle(seen);

      // The other tab. It journals a row under a lineage this session does not
      // serve, and it is the OLDEST row, so it is the one the next drain reads.
      const otherTab = createOperationStore(storeOptions());

      await otherTab.open();
      await otherTab.recordSession(
        { format: 1, epoch: 0, lineage: 'fedcba9876543210fedcba9876543210' },
        false,
        'v2'
      );
      await otherTab.appendLocal(new Uint8Array([1, 2, 3]));
      await otherTab.close();

      // Wakes this tab's drain.
      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed beside the stray row');

      await waitFor(() => states(seen).includes('quarantined'), 'the stale-lineage quarantine', 5000)
        .catch(() => undefined);

      const quarantined = seen.filter((payload) => payload.save?.state === 'quarantined').at(-1);

      expect(
        quarantined?.save?.reason,
        'a row dropped for belonging to an old lineage was published as a server rejection'
      ).toBeUndefined();
      expect(quarantined?.save?.quarantinedOperations).toBe(1);
    }, 30_000);

    it('server sequence remains a decimal string', async () => {
      const { harness, seen } = await watched();
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed under v2');
      await waitFor(() => operationOn(socket) !== undefined, 'the operation on the wire', 3000);

      // 2^64 - 1, the protocol's ceiling: a `number` rounds it to
      // 18446744073709552000 and the last four digits are gone for good.
      socket.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE,
        operationId: operationOn(socket)?.operationId ?? '',
        serverSequence: '18446744073709551615',
      });

      await waitFor(
        () => seen.some((payload) => payload.save?.serverSequence !== undefined),
        'the acknowledged sequence',
        3000
      ).catch(() => undefined);

      expect(
        seen.at(-1)?.save?.serverSequence,
        'the acknowledged sequence came back rounded, so it travelled as a number'
      ).toBe('18446744073709551615');
      expect(seen.at(-1)?.save?.state).toBe('saved');
      expect(seen.at(-1)?.save?.pendingOperations).toBe(0);

      await settle(seen);

      // Another tab shares this outbox, so an acknowledgement may name a row
      // this one does not hold: the delete is a no-op and every count stays
      // put. The sequence is then the ONLY thing that moved, and it still has
      // to reach the host. 2^53 + 1, so it is also a value `number` rounds —
      // and the protocol does not require a sequence to increase.
      socket.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE,
        operationId: 'ab'.repeat(16),
        serverSequence: '9007199254740993',
      });

      await waitFor(
        () => seen.at(-1)?.save?.serverSequence === '9007199254740993',
        'the sequence from the other tab',
        3000
      ).catch(() => undefined);

      expect(
        seen.at(-1)?.save?.serverSequence,
        'a sequence that advanced with no other change was never published'
      ).toBe('9007199254740993');
    }, 30_000);

    /**
     * The other half of the law above: a state that did NOT move is not an
     * event. Every path that touches the store re-reads it and would publish,
     * so a redelivered receipt — the server answers a re-sent operation with
     * its ORIGINAL acknowledgement (protocol section 7.2) — hands the host a
     * payload identical to the one it already holds unless the comparator
     * coalesces it.
     *
     * `refreshSave` is private; the lever is the outbox seam's `acknowledge`,
     * which is what the provider calls for any id on our lineage.
     */
    it('a redelivered acknowledgement whose save state is identical publishes nothing', async () => {
      const { harness, seen } = await watched();

      // FIRST, before anything is measured. The post-ready replay publishes
      // with `force`, which bypasses the comparator by design, so the event it
      // is entitled to make would read as a coalescing failure if it landed
      // inside a window below.
      //
      // What sequences it out is the WAIT, not which payload arrives: `seen`
      // starts empty, so `waitFor` always sleeps at least one 10ms timer — and
      // the replay's timer was queued during `load`, strictly earlier, so it
      // has fired by the time this returns. The payload that ends the wait may
      // be the connecting transition's own store read rather than the replay.
      await waitFor(() => seen.length > 0, 'the session to publish', 3000);

      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      harness.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed once');
      await waitFor(() => operationOn(socket) !== undefined, 'the operation on the wire', 3000);

      const receipt: Extract<SyncWireFrame, { type: 'acknowledgement' }> = {
        type: 'acknowledgement',
        lineage: LINEAGE,
        operationId: operationOn(socket)?.operationId ?? '',
        serverSequence: '7',
      };

      socket.deliver(receipt);
      await waitFor(() => states(seen).includes('saved'), 'the acknowledged save state', 3000)
        .catch(() => undefined);
      await settle(seen);

      expect(
        seen.at(-1)?.save,
        'the session never settled on the acknowledged state, so there is nothing to repeat'
      ).toEqual({
        state: 'saved',
        serverSequence: '7',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 0,
      });

      const quiet = seen.length;

      // A CONTROL window first, the same length as the measured one and with
      // nothing delivered into it. Without it a session that publishes on its
      // own — a late store read, a presence change — would fail the window
      // below and read as a comparator that stopped coalescing.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(
        seen.length - quiet,
        'the settled session published on its own, so the window below measures noise, not the comparator'
      ).toBe(0);

      // The SAME receipt: the row it names is already gone, so the delete is a
      // no-op, and the sequence it carries is the one already published.
      socket.deliver(receipt);

      // A republish would ride the acknowledge transaction's completion, so
      // this waits well past it instead of asserting on the same tick.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(
        seen.length - quiet,
        'the host was told again about a save state it was already in'
      ).toBe(0);
    }, 30_000);

    it('a host subscribing right after isReady receives the current save state', async () => {
      const harness = await boot();

      // The connecting transition's own store read rides a MICROTASK chain
      // (its emit arrives through processTicksAndRejections), so draining the
      // queue puts it strictly before this subscription. What is left can only
      // come from something scheduled on a macrotask — the replay. Without the
      // drain this test passes on that first read and pins nothing: removing
      // the replay outright left it green.
      for (let turn = 0; turn < 200; turn += 1) {
        await Promise.resolve();
      }

      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      await waitFor(() => seen.length > 0, 'the post-ready replay', 3000).catch(() => undefined);

      expect(
        seen[0],
        'a host that subscribed the moment the editor was ready never heard from the session'
      ).toBeDefined();
      // Nothing has been negotiated yet, so there is no durable save to report
      // and nobody to blame for it.
      expect(seen[0]?.save).toEqual({
        state: 'unavailable',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 0,
      });
      expect(seen[0]?.status).toBe('connecting');
    }, 20_000);

    it('memory mode arms the beforeunload guard while pending; offline mode does not', async () => {
      const added = vi.spyOn(window, 'addEventListener');
      const removed = vi.spyOn(window, 'removeEventListener');
      const guards = (): number => added.mock.calls.filter(([type]) => type === 'beforeunload').length;
      const dropped = (): number => removed.mock.calls.filter(([type]) => type === 'beforeunload').length;

      const memory = await boot();
      const memorySocket = firstSync(memory, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => memory.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      memory.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed in memory mode');
      await waitFor(() => operationOn(memorySocket) !== undefined, 'the operation on the wire', 3000);
      await waitFor(() => guards() > 0, 'the unload guard', 3000).catch(() => undefined);

      expect(
        guards(),
        'a memory-mode session let a reload throw away an edit nobody has taken'
      ).toBeGreaterThan(0);

      destroyCore(booted.splice(booted.indexOf(memory.core), 1)[0]);

      expect(
        dropped(),
        'a destroyed editor left its confirm-on-leave dialog armed for the rest of the page'
      ).toBeGreaterThan(0);

      added.mockClear();

      vi.stubGlobal('indexedDB', new IDBFactory());

      const offline = await boot({ offline: true });
      const offlineSocket = firstSync(offline, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }], V2);

      await waitFor(() => offline.core.moduleInstances.BlockManager.blocks.length === 1, 'the offline first sync');

      offline.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed offline');
      await waitFor(() => operationOn(offlineSocket) !== undefined, 'the offline operation on the wire', 5000);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(
        guards(),
        'an offline session, whose rows survive the reload, still asked the user to confirm leaving'
      ).toBe(0);
    }, 40_000);
  });

  describe('a throwing collaboration:status listener', () => {
    it('does not end the session when it throws on an awareness frame', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const harness = await boot();
      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', () => {
        throw new Error('host listener blew up');
      });

      const peer = new DocumentStore(new YBlockSerializer());

      peer.enableAwareness();
      peer.setAwarenessField('user', { name: 'Ada' });
      socket.deliver({ type: 'awareness', update: peer.encodeAwarenessUpdate() });
      peer.destroy();

      expect(collabAttr(harness.core)).toBe('connected');
      expect(socket.closedWith).toBeNull();

      // Positive proof the session is live: a later doc frame still materialises.
      const late = peerWith([{ id: 'late', type: 'paragraph', data: { text: 'late' } }]);

      socket.deliver({ type: 'update', update: late.encodeStateAsUpdate() });
      late.destroy();

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 2, 'a later remote block');
    });

    it('still lifts read-only after the first sync when it throws on the connected transition', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const harness = await boot();

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', () => {
        throw new Error('host listener blew up');
      });

      firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');
      await waitFor(() => !harness.core.moduleInstances.ReadOnly.isEnabled, 'editable after the first sync');

      expect(collabAttr(harness.core)).toBe('connected');
    });
  });

  // The coalescing write buffer holds the last ~400ms of typing. Whatever ends
  // the session — a host unmounting the editor, the tab closing — that buffer
  // has to reach the WIRE, not just the local document, and the offline cache
  // is opt-in so its flush cannot be the only one.
  describe('the write buffer reaches the wire', () => {
    /** Two writes: the first lands on the leading edge, the second stays pending. */
    const enqueueLeadingAndTrailing = (harness: Harness): Uint8Array => {
      const yjs = harness.core.moduleInstances.YjsManager;
      const base = yjs.encodeStateAsUpdate();
      const flush = (entries: ReadonlyMap<string, unknown>): boolean => {
        let wrote = false;

        for (const [key, value] of entries) {
          wrote = yjs.updateBlockData('b1', key, value) || wrote;
        }

        return wrote;
      };

      yjs.enqueueBlockDataWrite('b1', { text: 'leading' }, flush);
      yjs.enqueueBlockDataWrite('b1', { text: 'trailing' }, flush);

      return base;
    };

    it('ships the pending write when the editor is destroyed, without the offline cache', async () => {
      const harness = await boot();
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      const base = enqueueLeadingAndTrailing(harness);

      destroyCore(booted.splice(booted.indexOf(harness.core), 1)[0]);

      expect(firstBlockTextOnTheWire(socket, base)).toBe('trailing');
    });

    it('ships the pending write on pagehide, without the offline cache', async () => {
      const harness = await boot();
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      const base = enqueueLeadingAndTrailing(harness);

      window.dispatchEvent(new Event('pagehide'));

      expect(firstBlockTextOnTheWire(socket, base)).toBe('trailing');
    });

    /**
     * A reloading tab comes back under a new awareness client id. Unless the
     * old one is withdrawn on the way out, every peer keeps drawing it until
     * their own 30s sweep — one person, two avatars.
     */
    it('withdraws this client from the room on pagehide', async () => {
      const harness = await boot();
      const socket = firstSync(harness, [{ id: 'b1', type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'first sync');

      const yjs = harness.core.moduleInstances.YjsManager;
      const localClientId = Array.from(yjs.getAwarenessStates().keys())[0];
      const peer = new DocumentStore(new YBlockSerializer());

      peer.enableAwareness();
      peer.applyAwarenessUpdate(yjs.encodeAwarenessUpdate(), { source: 'peer' });
      expect(peer.getAwarenessStates().has(localClientId)).toBe(true);

      const before = socket.sent.length;

      window.dispatchEvent(new Event('pagehide'));

      for (const bytes of socket.sent.slice(before)) {
        const frame = decode(bytes);

        if (frame.type === 'awareness') {
          peer.applyAwarenessUpdate(frame.update, { source: 'peer' });
        }
      }

      expect(peer.getAwarenessStates().has(localClientId)).toBe(false);

      peer.destroy();
    });
  });

  describe('teardown', () => {
    it('is registered before YjsManager so the socket closes before the document dies', () => {
      const names = Object.keys(Modules);

      expect(names.indexOf('Collaboration')).toBeGreaterThan(-1);
      expect(names.indexOf('Collaboration')).toBeLessThan(names.indexOf('YjsManager'));
    });

    it('closes the socket on destroy', async () => {
      const harness = await boot();
      const socket = harness.socket();

      destroyCore(harness.core);
      booted.splice(booted.indexOf(harness.core), 1);

      expect(socket.closedWith).not.toBeNull();
    });
  });
});
