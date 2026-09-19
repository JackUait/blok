/**
 * Two peers reaching an empty room at the same moment both seed the first
 * paragraph. Whatever either of them types into their own seed before the two
 * seeds meet must survive.
 *
 * Both peers are real `Core` instances with real `YjsManager`s and the real
 * `Collaboration` module; they meet only through encoded Yjs updates handed
 * over the mock transport, which is the provider's own path.
 *
 * Nothing here pins `doc.clientID`, and nothing may depend on it: a Y.Map key
 * collision is resolved by comparing the writers' client ids, which Y.Doc mints
 * randomly with no seam a test can reach (mocking lib0's `uint32` does not
 * reach yjs — it is required as CommonJS). So the assertion is symmetric: both
 * texts, sorted, on both peers. Which peer would lose is exactly the part of
 * the old behaviour nobody could predict.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';

const LINEAGE = '0123456789abcdef0123456789abcdef';

/** Mock transport — the shape `sync-first-load.test.ts` drives. */
class MockSocket {
  public binaryType = 'blob';

  public readyState = 0;

  public protocol = '';

  public onopen: ((event: unknown) => void) | null = null;

  public onmessage: ((event: { data: unknown }) => void) | null = null;

  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  public onerror: ((event: unknown) => void) | null = null;

  public readonly sent: Uint8Array[] = [];

  /**
   * @param url - the sync URL the provider built
   * @param protocols - the subprotocols offered
   */
  public constructor(public readonly url: string, public readonly protocols: string[]) {}

  /**
   * @param data - the frame bytes
   */
  public send(data: ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer));
  }

  public close(): void {
    this.readyState = 3;
  }

  /**
   * @param protocol - the subprotocol the server selected
   */
  public open(protocol = 'blok-sync.v1'): void {
    this.protocol = protocol;
    this.readyState = 1;
    this.onopen?.({});
  }

  /**
   * @param frame - what the server sends
   */
  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }
}

interface Harness {
  core: Core;
  socket: () => MockSocket;
}

const holders: HTMLElement[] = [];
const booted: Core[] = [];

/**
 * Minimal replica of `Blok.destroy()`'s module teardown.
 * @param core - a booted core
 */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as { markDestroyed?: () => void } | null | undefined;

    instance?.markDestroyed?.();
  });

  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as {
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    } | null | undefined;

    instance?.destroy?.();
    instance?.listeners?.removeAll?.();
  });
};

/**
 * Polls until the predicate holds. Real timers: the renderer waits on
 * `requestIdleCallback`, which fake timers fight.
 * @param predicate - what to wait for
 * @param label - named in the timeout message
 * @param timeoutMs - how long to wait
 */
const waitFor = async (
  predicate: () => boolean,
  label = 'condition',
  timeoutMs = 2000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/**
 * @param doc - the collaboration document id both peers share
 */
const boot = async (doc: string): Promise<Harness> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const sockets: MockSocket[] = [];
  const collaboration: CollaborationConfig = {
    doc,
    socketFactory: (url, protocols) => {
      const socket = new MockSocket(url, protocols);

      sockets.push(socket);

      return socket;
    },
  };

  const core = new Core({
    holder,
    minHeight: 50,
    tools: { paragraph: { class: Paragraph }, bookmark: { class: Bookmark } },
    server: 'https://sync.test/api/',
    collaboration,
  });

  await core.isReady;
  booted.push(core);

  return {
    core,
    socket: () => {
      const socket = sockets.at(-1);

      if (socket === undefined) {
        throw new Error('no socket was opened');
      }

      return socket;
    },
  };
};

/** Open + control frame + a first SyncStep2 carrying an EMPTY room. */
const firstSyncEmpty = (harness: Harness): void => {
  const socket = harness.socket();
  const room = new DocumentStore(new YBlockSerializer());

  socket.open();
  socket.deliver({ type: 'control', tag: { format: 1, epoch: 0, lineage: LINEAGE } });
  socket.deliver({
    type: 'syncStep2',
    update: room.encodeStateAsUpdate(harness.core.moduleInstances.YjsManager.getStateVector()),
  });

  room.destroy();
};

/** Every block's text, as the peer's own document holds it. */
const texts = (harness: Harness): string[] =>
  harness.core.moduleInstances.YjsManager.toJSON()
    .map((block) => {
      const text = (block.data as { text?: unknown }).text;

      return typeof text === 'string' ? text : '';
    })
    .sort();

describe('collaboration — concurrent seeding of an empty room (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps what both peers typed into the paragraph each of them seeded', async () => {
    const first = await boot('shared');
    const second = await boot('shared');

    // Both reach the empty room before either seed has been relayed.
    firstSyncEmpty(first);
    firstSyncEmpty(second);

    await waitFor(() => first.core.moduleInstances.BlockManager.blocks.length === 1, 'seed on first peer');
    await waitFor(() => second.core.moduleInstances.BlockManager.blocks.length === 1, 'seed on second peer');

    const firstYjs = first.core.moduleInstances.YjsManager;
    const secondYjs = second.core.moduleInstances.YjsManager;

    // Each peer types into its OWN seed, still before the relay.
    firstYjs.updateBlockData(first.core.moduleInstances.BlockManager.blocks[0].id, 'text', 'first typed this');
    secondYjs.updateBlockData(second.core.moduleInstances.BlockManager.blocks[0].id, 'text', 'second typed this');

    // Play the server: hand each peer what the other wrote, twice, so the mesh
    // settles.
    for (let round = 0; round < 2; round += 1) {
      first.socket().deliver({ type: 'update', update: secondYjs.encodeStateAsUpdate(firstYjs.getStateVector()) });
      second.socket().deliver({ type: 'update', update: firstYjs.encodeStateAsUpdate(secondYjs.getStateVector()) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(texts(first), 'a peer lost everything they typed into the paragraph they seeded')
      .toEqual(['first typed this', 'second typed this']);
    expect(texts(second)).toEqual(texts(first));
  });
});
