import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';
import { BlockYjsSync, type SyncHandlers } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlocksStore, ComposeBlockOptions } from '../../../../../src/components/modules/blockManager/types';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import type { YjsOutputBlockData } from '../../../../../src/components/modules/yjs/serializer';

/**
 * Emptying a shared document makes EVERY receiving peer mint the repair
 * paragraph. Two peers minting it concurrently must not cost anyone the text
 * they typed into theirs.
 *
 * Every peer is a real YjsManager + BlockYjsSync over a real repository, and
 * peers meet only through encoded updates — the provider's own path.
 *
 * `doc.clientID` is PINNED on every peer: the Y.Map loser is decided by the
 * random client id, so an unpinned run proves nothing and flakes ~50%.
 */

interface PeerHarness {
  name: string;
  manager: YjsManager;
  repository: BlockRepository;
  blocksStore: BlocksStore;
  yjsSync: BlockYjsSync;
  workingArea: HTMLElement;
  unsubscribe: () => void;
}

const createStubBlock = (id: string): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id,
    name: 'paragraph',
    holder,
    parentId: null,
    contentIds: [],
    inputs: [],
    preservedData: {},
    preservedTunes: {},
    setData: vi.fn(() => Promise.resolve(true)),
    call: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Block;
};

/** One macrotask covers the reconciler's microtask chains and RAF extension. */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('BlockYjsSync — concurrent empty-document repair (integration)', () => {
  const peers: PeerHarness[] = [];

  const createPeer = (name: string, clientId: number, seed?: Uint8Array): PeerHarness => {
    const manager = new YjsManager({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      } as unknown as YjsManager['eventsDispatcher'],
    });

    const workingArea = document.createElement('div');

    document.body.appendChild(workingArea);

    const rawBlocksStore = new Blocks(workingArea);

    rawBlocksStore.push(createStubBlock('b1'));

    const blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

    const repository = new BlockRepository();

    repository.initialize(blocksStore);

    const factory = {
      composeBlock: (options: ComposeBlockOptions): Block => createStubBlock(options.id ?? 'missing-id'),
      getTool: (): undefined => undefined,
      hasTool: (): boolean => true,
    } as unknown as BlockFactory;

    const handlers: SyncHandlers = {
      getBlockIndex: (block: Block): number => repository.getBlockIndex(block),
      insertDefaultBlock: vi.fn((_skipYjsSync: boolean, id?: string) => {
        const block = createStubBlock(id ?? `generated-${clientId}`);

        blocksStore.insert(0, block);

        return block;
      }),
      setBlockParent: vi.fn(),
      replaceBlock: vi.fn(),
      onBlockRemoved: vi.fn(),
      onBlockAdded: vi.fn(),
    };

    const yjsSync = new BlockYjsSync({ YjsManager: manager }, repository, factory, handlers, blocksStore);

    manager.state = {
      BlockManager: {
        getBlockById: (id: string): Block | undefined => repository.getBlockById(id),
        getBlockByChildNode: (): undefined => undefined,
        currentBlock: undefined,
        reparentFromHistoryReplay: (): void => undefined,
      },
    } as unknown as BlokModules;

    if (seed === undefined) {
      manager.fromJSON([{ id: 'b1', type: 'paragraph', data: { text: '' } }]);
    } else {
      manager.applyRemoteUpdate(seed);
    }

    // Pin the tie-breaker. Items already in the doc were authored before this
    // (they come from one shared binary), so only the concurrent repair writes
    // are affected — which is exactly what the race is about.
    const doc = manager.getBlockById('b1')?.doc;

    if (doc === null || doc === undefined) {
      throw new Error('seeded block has no doc');
    }
    doc.clientID = clientId;

    const unsubscribe = yjsSync.subscribe();
    const harness: PeerHarness = { name, manager, repository, blocksStore, yjsSync, workingArea, unsubscribe };

    peers.push(harness);

    return harness;
  };

  /** One peer's ops to every other peer. */
  const broadcast = (from: PeerHarness): void => {
    peers
      .filter((to) => to !== from)
      .forEach((to) => {
        to.manager.applyRemoteUpdate(from.manager.encodeStateAsUpdate(to.manager.getStateVector()));
      });
  };

  /** Ship every peer's ops to every other peer until the mesh is quiet. */
  const syncMesh = async (): Promise<void> => {
    for (let round = 0; round < 2; round += 1) {
      peers.forEach(broadcast);
      await flush();
    }
  };

  const texts = (peer: PeerHarness): string[] =>
    peer.manager.toJSON().map((block: YjsOutputBlockData) => {
      const text = (block.data as { text?: unknown }).text;

      return typeof text === 'string' ? text : '';
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const peer of peers) {
      peer.unsubscribe();
      peer.manager.destroy();
    }
    peers.length = 0;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps the text both restoring peers typed when a third peer empties the document', async () => {
    const alice = createPeer('alice', 1);
    const snapshot = alice.manager.encodeStateAsUpdate();
    const bob = createPeer('bob', 2, snapshot);
    const carol = createPeer('carol', 3, snapshot);

    // Alice deletes the last block — a LOCAL removal, so she never repairs.
    alice.manager.removeBlock('b1');
    alice.blocksStore.remove(0);
    await flush();

    // Bob and Carol both receive the emptying removal and both repair.
    broadcast(alice);
    await flush();

    const bobRestored = bob.repository.blocks[0];
    const carolRestored = carol.repository.blocks[0];

    expect(bobRestored, 'bob did not repair the emptied document').toBeDefined();
    expect(carolRestored, 'carol did not repair the emptied document').toBeDefined();

    // Both type into their own restored paragraph before the repairs meet.
    bob.manager.updateBlockData(bobRestored.id, 'text', 'bob typed this');
    carol.manager.updateBlockData(carolRestored.id, 'text', 'carol typed this');

    await syncMesh();

    const survived = texts(alice);

    expect(survived, 'a peer lost everything they typed into the restored paragraph')
      .toEqual(expect.arrayContaining(['bob typed this', 'carol typed this']));
    expect(texts(bob)).toEqual(survived);
    expect(texts(carol)).toEqual(survived);
  });
});
