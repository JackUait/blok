import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * The full-save flush prunes the top-level data keys the tool's save() no
 * longer carries. `save()` is ASYNC, so a peer's key can land in the document
 * between the moment the save was captured and the moment the flush prunes —
 * and the flush would delete a key it never saw, on both peers.
 *
 * Real YjsManager + the real `blockDidMutated` → `syncBlockDataToYjs` →
 * `flushBlockDataWrites` chain; the peer is a second DocumentStore that
 * exchanges real Yjs updates. Only the blocks are stubs.
 */

interface BlockManagerPrivateAccess {
  yjsSync: { isSyncingFromYjs: boolean; isMaterializing: (block: Block) => boolean };
  repository: BlockRepository;
  blockDidMutated: (mutationType: string, block: unknown, detail: Record<string, unknown>) => unknown;
}

interface BlockStub {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
  tool: { name: string };
  save: ReturnType<typeof vi.fn>;
}

interface SeedBlock {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

interface Harness {
  yjsManager: YjsManager;
  peer: DocumentStore;
  /**
   * One DOM mutation of `blockId` whose save() yields exactly `data`.
   * `duringSave` runs while that save is in flight — the gap a peer's update
   * really lands in.
   */
  mutate: (blockId: string, data: Record<string, unknown>, duringSave?: () => void) => Promise<void>;
  /** Send everything each side did while apart, both ways. */
  exchange: () => void;
  readData: (blockId: string) => Record<string, unknown> | undefined;
  readPeerData: (blockId: string) => Record<string, unknown> | undefined;
}

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

const createStubBlock = (seed: SeedBlock): BlockStub => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id: seed.id,
    name: seed.name,
    parentId: null,
    holder,
    contentIds: [],
    inputs: [],
    preservedData: {},
    preservedTunes: {},
    tool: { name: seed.name },
    save: vi.fn(),
    setData: vi.fn(() => Promise.resolve(true)),
    call: vi.fn(),
    destroy: vi.fn(),
  } as unknown as BlockStub;
};

const createHarness = (seed: SeedBlock[]): Harness => {
  const config: BlokConfig = { defaultBlock: 'paragraph', user: { id: 'user-1' } };
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const yjsManager = new YjsManager({ config, eventsDispatcher });
  const blockManager = new BlockManager({ config, eventsDispatcher });

  blockManager.state = { YjsManager: yjsManager } as unknown as BlokModules;

  const priv = blockManager as unknown as BlockManagerPrivateAccess;

  priv.yjsSync = { isSyncingFromYjs: false, isMaterializing: (): boolean => false };

  const workingArea = document.createElement('div');

  document.body.appendChild(workingArea);

  const rawBlocksStore = new Blocks(workingArea);
  const stubs = new Map<string, BlockStub>();

  for (const block of seed) {
    const stub = createStubBlock(block);

    stubs.set(block.id, stub);
    rawBlocksStore.push(stub as unknown as Block);
  }

  const blocksStore = new Proxy(rawBlocksStore, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;

  const repository = new BlockRepository();

  repository.initialize(blocksStore);
  priv.repository = repository;

  for (const block of seed) {
    yjsManager.addBlock({ id: block.id, type: block.name, data: block.data });
  }

  yjsManager.stopCapturing();

  const peer = new DocumentStore(new YBlockSerializer());

  // The peer joins the room: it receives the document over the wire, so every
  // key it holds was authored by the other client.
  peer.applyRemoteUpdate(yjsManager.encodeStateAsUpdate(peer.getStateVector()));

  const exchange = (): void => {
    const fromLocal = yjsManager.encodeStateAsUpdate(peer.getStateVector());
    const fromPeer = peer.encodeStateAsUpdate(yjsManager.getStateVector());

    peer.applyRemoteUpdate(fromLocal);
    yjsManager.applyRemoteUpdate(fromPeer, 'remote');
  };

  return {
    yjsManager,
    peer,
    exchange,
    mutate: async (blockId: string, data: Record<string, unknown>, duringSave?: () => void): Promise<void> => {
      const stub = stubs.get(blockId);

      if (stub === undefined) {
        throw new Error(`test setup: block ${blockId} was never seeded`);
      }

      stub.save.mockImplementation(async () => {
        await Promise.resolve();
        duringSave?.();

        return { data };
      });
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });

      await drainMicrotasks();
    },
    readData: (blockId: string): Record<string, unknown> | undefined => {
      const data = yjsManager.getBlockById(blockId)?.get('data');

      return data instanceof Y.Map ? data.toJSON() : undefined;
    },
    readPeerData: (blockId: string): Record<string, unknown> | undefined =>
      peer.toJSON().find((block) => block.id === blockId)?.data,
  };
};

describe('full-save flush and a key a peer added while the save was in flight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('keeps a key the peer added after the save was captured', async () => {
    const harness = createHarness([
      { id: 'img1', name: 'image', data: { url: 'u' } },
    ]);
    const { yjsManager, peer, mutate, exchange, readData, readPeerData } = harness;

    // The peer captions the image and the update reaches us AFTER our save()
    // was captured and BEFORE the flush prunes.
    const peerCaptionsMidSave = (): void => {
      peer.updateBlockData('img1', 'caption', 'a cat');
      yjsManager.applyRemoteUpdate(peer.encodeStateAsUpdate(yjsManager.getStateVector()), 'remote');
    };

    await mutate('img1', { url: 'u' }, peerCaptionsMidSave);

    expect(readData('img1')).toEqual({ url: 'u', caption: 'a cat' });

    exchange();

    expect(readPeerData('img1')).toEqual({ url: 'u', caption: 'a cat' });
  });

  it('still prunes a legacy key the local save dropped, though it came over the wire', async () => {
    const harness = createHarness([
      { id: 'callout1', name: 'callout', data: { emoji: '\u{1F4A1}', __importedText: 'Meet Blok' } },
    ]);
    const { mutate, exchange, readData, readPeerData } = harness;

    // Every key here reached the peer over the wire; the prune exists exactly
    // for this, so wire provenance must NOT buy a key immunity.
    await mutate('callout1', { emoji: '\u{1F4A1}' });

    expect(readData('callout1')).toEqual({ emoji: '\u{1F4A1}' });

    exchange();

    expect(readPeerData('callout1')).toEqual({ emoji: '\u{1F4A1}' });
  });
});
