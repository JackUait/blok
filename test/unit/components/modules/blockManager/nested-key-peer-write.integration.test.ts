import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
 * The same race one level DOWN. A full save's deep assign deletes every NESTED
 * key its (possibly stale) value omits, so a cell colour or a row property a
 * peer wrote while the async `save()` was in flight was deleted by a save that
 * never saw it — on both peers.
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
    // Through the serializer, not `Y.Map.toJSON()`: a grid's keyed wrapper is
    // an implementation detail and must be read back as plain rows.
    readData: (blockId: string): Record<string, unknown> | undefined =>
      yjsManager.toJSON().find((block) => block.id === blockId)?.data,
    readPeerData: (blockId: string): Record<string, unknown> | undefined =>
      peer.toJSON().find((block) => block.id === blockId)?.data,
  };
};

describe('full-save deep assign and a nested key a peer added while the save was in flight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('keeps a table cell colour the peer set after the save was captured', async () => {
    const harness = createHarness([
      { id: 'T', name: 'table', data: { content: [[{ blocks: ['c0'] }, { blocks: ['c1'] }]] } },
    ]);
    const { yjsManager, peer, mutate, exchange, readData, readPeerData } = harness;

    const peerColoursMidSave = (): void => {
      peer.updateBlockData('T', 'content', [[{ blocks: ['c0'],
        color: 'red' }, { blocks: ['c1'] }]]);
      yjsManager.applyRemoteUpdate(peer.encodeStateAsUpdate(yjsManager.getStateVector()), 'remote');
    };

    // Our save carries our own edit in the OTHER cell and knows nothing of the
    // colour, because it was captured before the colour arrived.
    await mutate('T', { content: [[{ blocks: ['c0'] }, { blocks: ['c1', 'added-by-us'] }]] }, peerColoursMidSave);

    expect(readData('T')?.content).toEqual([[{ blocks: ['c0'],
      color: 'red' }, { blocks: ['c1', 'added-by-us'] }]]);

    exchange();

    expect(readPeerData('T')?.content).toEqual(readData('T')?.content);
  });

  it('keeps a database-row property the peer added after the save was captured', async () => {
    const harness = createHarness([
      { id: 'R', name: 'database-row', data: { properties: { status: 'todo' } } },
    ]);
    const { yjsManager, peer, mutate, exchange, readData, readPeerData } = harness;

    const peerAddsPriorityMidSave = (): void => {
      peer.updateBlockData('R', 'properties', { status: 'todo',
        priority: 'high' });
      yjsManager.applyRemoteUpdate(peer.encodeStateAsUpdate(yjsManager.getStateVector()), 'remote');
    };

    await mutate('R', { properties: { status: 'done' } }, peerAddsPriorityMidSave);

    expect(readData('R')?.properties).toEqual({ status: 'done',
      priority: 'high' });

    exchange();

    expect(readPeerData('R')?.properties).toEqual(readData('R')?.properties);
  });

  /**
   * The failure mode of a careless fix: sparing every unseen nested key would
   * make a real removal impossible. A key the save DID see is still deleted.
   */
  it('still removes a nested key the user deleted, with nobody else editing', async () => {
    const harness = createHarness([
      { id: 'T', name: 'table', data: { content: [[{ blocks: ['c0'],
        color: 'red' }]] } },
    ]);
    const { mutate, exchange, readData, readPeerData } = harness;

    await mutate('T', { content: [[{ blocks: ['c0'] }]] });

    expect(readData('T')?.content).toEqual([[{ blocks: ['c0'] }]]);

    exchange();

    expect(readPeerData('T')?.content).toEqual([[{ blocks: ['c0'] }]]);
  });

  it('still removes a database-row property the user deleted', async () => {
    const harness = createHarness([
      { id: 'R', name: 'database-row', data: { properties: { status: 'todo',
        priority: 'high' } } },
    ]);
    const { mutate, readData } = harness;

    await mutate('R', { properties: { status: 'todo' } });

    expect(readData('R')?.properties).toEqual({ status: 'todo' });
  });
});
