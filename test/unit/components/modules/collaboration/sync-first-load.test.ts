/**
 * Sync-first load (Phase 3, task C1).
 *
 * The whole point of these tests is the branch that must not leak: with
 * `collaboration` configured, core seeds NOTHING — not the document, not the
 * default empty block — and the editor stays read-only until the server's first
 * SyncStep2 materialises the blocks through the ordinary remote path. With
 * `collaboration` absent, not one byte of that machinery may be allocated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { Modules } from '../../../../../src/components/modules';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig, OutputBlockData } from '../../../../../types';
import type { CollaborationStatusChangedPayload } from '../../../../../types/events/editor-events';

const LINEAGE = '0123456789abcdef0123456789abcdef';

/** A control frame the client accepts: our format, a stable lineage. */
const controlFrame = (): SyncWireFrame => ({
  type: 'control',
  tag: { format: 1, epoch: 0, lineage: LINEAGE },
});

/** Mock transport — the same shape provider.test.ts drives. */
class MockSocket {
  public binaryType = 'blob';

  public readyState = 0;

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

  public open(): void {
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
 */
const waitFor = async (predicate: () => boolean, label = 'condition'): Promise<void> => {
  const deadline = Date.now() + 2000;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

interface BootOptions {
  doc?: string;
  data?: BlokConfig['data'];
  readOnly?: boolean;
  ticket?: string;
  collaboration?: boolean;
  user?: { name: string; color?: string };
}

const boot = async (options: BootOptions = {}): Promise<Harness> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const sockets: MockSocket[] = [];
  const collaboration: CollaborationConfig = {
    doc: options.doc ?? 'doc-1',
    user: options.user,
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
    tools: { paragraph: { class: Paragraph }, bookmark: { class: Bookmark } },
    data: options.data,
    readOnly: options.readOnly,
    ...(options.collaboration === false ? {} : { server: 'https://sync.test/api/', collaboration }),
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

/** Open + control frame + a first SyncStep2 carrying the peer's blocks. */
const firstSync = (harness: Harness, blocks: OutputBlockData[]): MockSocket => {
  const socket = harness.socket();
  const peer = peerWith(blocks);

  socket.open();
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
      expect(harness.socket().protocols).toEqual(['blok-sync.v1']);
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
      await waitFor(() => harness.sockets.length === 2, 'reconnect');

      firstSync(harness, [{ type: 'paragraph', data: { text: 'server truth' } }]);

      await waitFor(() => blockTexts(harness.core).join() === 'server truth', 'swap to server truth');

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(1);
      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(false);
    });

    it('stays empty and read-only when the host passed no data', async () => {
      const harness = await boot();

      harness.socket().open();
      harness.socket().serverClose(4503, 'unavailable');

      await waitFor(() => collabAttr(harness.core) === 'offline', 'offline');

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(0);
      expect(harness.core.moduleInstances.ReadOnly.isEnabled).toBe(true);
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

    it('seeds once per session, not once per reconnect', async () => {
      const harness = await boot();
      const socket = firstSync(harness, []);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'seed');

      socket.serverClose(1001, 'gone');

      await waitFor(() => harness.sockets.length === 2, 'reconnect');

      firstSync(harness, []);

      await waitFor(() => collabAttr(harness.core) === 'connected', 'reconnected');

      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(1);
    });
  });

  describe('lineage reset', () => {
    it('drops the old room, reconnects, and materialises the new one', async () => {
      const harness = await boot();
      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'the old room' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'old room block');

      socket.serverClose(4409, 'the room was reset');

      // Document and DOM both gone, synchronously with the close.
      expect(harness.core.moduleInstances.YjsManager.toJSON()).toEqual([]);
      expect(harness.core.moduleInstances.BlockManager.blocks.length).toBe(0);

      await waitFor(() => harness.core.moduleInstances.ReadOnly.isEnabled, 'read-only while unsynced again');
      await waitFor(() => harness.sockets.length === 2, 'a reconnect');

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

    it('keeps publishing peers afterwards, on the awareness the reset rebuilt', async () => {
      const harness = await boot();
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      const socket = firstSync(harness, [{ type: 'paragraph', data: { text: 'the old room' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'old room block');

      socket.serverClose(4409, 'the room was reset');

      await waitFor(() => harness.sockets.length === 2, 'a reconnect');

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

      expect(seen.at(-1)?.peers.map((entry) => entry.user.name)).toContain('Ada');
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
      expect(harness.socket().protocols).toEqual(['blok-sync.v1', `header.${payload}.signature`]);
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

      expect(seen.map((payload) => payload.status)).toEqual(['connected', 'offline']);
      expect(seen[0].peers).toEqual([]);
    });

    it('leaves the local user out of peers, now that presence publishes an identity', async () => {
      const harness = await boot({ user: { name: 'Me' } });
      const seen: CollaborationStatusChangedPayload[] = [];

      harness.core.moduleInstances.API.methods.events.on('collaboration:status', (payload) => {
        seen.push(payload);
      });

      firstSync(harness, [{ type: 'paragraph', data: { text: 'synced' } }]);

      await waitFor(() => harness.core.moduleInstances.BlockManager.blocks.length === 1, 'remote block');

      // The local state is REAL and would satisfy `toPeer` — before presence
      // existed it was excluded only because it carried no name. The exclusion
      // has to be by client id now, or the host sees itself in its own roster.
      const states = Array.from(harness.core.moduleInstances.YjsManager.getAwarenessStates().values());

      expect(states).toHaveLength(1);
      expect(states[0].user).toMatchObject({ name: 'Me' });
      expect(seen.at(-1)?.peers).toEqual([]);
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
