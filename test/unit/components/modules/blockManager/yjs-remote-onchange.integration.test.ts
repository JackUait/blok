import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { BlokConfig } from '../../../../../types';
import type { BlockMutationEvent } from '../../../../../types/events/block';
import { BlockAddedMutationType } from '../../../../../types/events/block/BlockAdded';
import { BlockRemovedMutationType } from '../../../../../types/events/block/BlockRemoved';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { BlockYjsSync, type SyncHandlers } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlocksStore, ComposeBlockOptions } from '../../../../../src/components/modules/blockManager/types';
import { ModificationsObserver } from '../../../../../src/components/modules/modificationsObserver';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import { BlockChanged } from '../../../../../src/components/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Decision 13 pin: a REMOTE reconcile (a peer's Yjs change materialized through
 * the real binary seam) must fire the host's `onChange`. v-model consumers rely
 * on it to stay current with edits made by other collaborators.
 *
 * The whole chain runs through real code: a peer DocumentStore ships an encoded
 * update → the local YjsManager applies it → the real BlockYjsSync reconciles →
 * its `onBlockAdded`/`onBlockRemoved` handlers call the real
 * `BlockManager.blockDidMutated` (wired exactly as prepare() does, see
 * blockManager.ts:468-473, yjs-sync.ts:781/1021) → `blockDidMutated` emits
 * `BlockChanged` on the SHARED dispatcher UNGATED → the real ModificationsObserver
 * delivers `onChange`.
 *
 * The one seam is the shared EventsDispatcher: BlockManager and
 * ModificationsObserver must be on the SAME bus or the test goes vacuously green.
 */

interface DocSeedBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

const KNOWN_TOOLS = new Set(['paragraph']);

const paragraph = (id: string): DocSeedBlock => ({
  id,
  type: 'paragraph',
  data: { text: id },
});

const createStubBlock = (id: string, name = 'paragraph'): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id,
    name,
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

/** Private surface the harness drives on the real BlockManager. */
interface BlockManagerPrivate {
  blockDidMutated: (type: string, block: Block, detail: Record<string, unknown>) => Block;
  yjsSync: unknown;
}

/**
 * One macrotask drains the reconciler's microtask chains AND the observer's
 * leading-edge onChange microtask (which fires before the next paint).
 */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('BlockYjsSync — remote reconcile fires host onChange (integration)', () => {
  let dispatcher: EventsDispatcher<BlokEventMap>;
  let manager: YjsManager;
  let peer: DocumentStore;
  let repository: BlockRepository;
  let blocksStore: BlocksStore;
  let workingArea: HTMLElement;
  let blockManager: BlockManager;
  let observer: ModificationsObserver;
  let yjsSync: BlockYjsSync;
  let unsubscribe: (() => void) | null = null;
  let onChange: ReturnType<typeof vi.fn>;

  const createHarness = (seed: DocSeedBlock[]): void => {
    dispatcher = new EventsDispatcher<BlokEventMap>();

    manager = new YjsManager({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      } as unknown as YjsManager['eventsDispatcher'],
    });

    workingArea = document.createElement('div');
    document.body.appendChild(workingArea);

    const rawBlocksStore = new Blocks(workingArea);

    for (const block of seed) {
      rawBlocksStore.push(createStubBlock(block.id, block.type));
    }

    blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    const factory = {
      composeBlock: vi.fn((options: ComposeBlockOptions): Block => createStubBlock(options.id ?? 'missing-id', options.tool)),
      getTool: (): undefined => undefined,
      hasTool: (name: string): boolean => KNOWN_TOOLS.has(name),
    } as unknown as BlockFactory;

    // Real BlockManager: the source of the UNGATED BlockChanged emit. It shares
    // the dispatcher with the observer; state.API only needs to exist because
    // blockDidMutated wraps the block in a lazy BlockAPI.
    blockManager = new BlockManager({
      config: { defaultBlock: 'paragraph' },
      eventsDispatcher: dispatcher,
    });
    blockManager.state = {
      API: { methods: {} },
    } as unknown as BlokModules;

    const priv = blockManager as unknown as BlockManagerPrivate;

    // Handlers wired exactly as BlockManager.prepare() wires them into BlockYjsSync.
    const handlers: SyncHandlers = {
      addToDom: (block, index) => {
        blocksStore.insert(index, block);
      },
      removeFromDom: (index) => {
        blocksStore.remove(index);
      },
      moveInDom: (toIndex, fromIndex) => {
        blocksStore.move(toIndex, fromIndex);
      },
      getBlockIndex: (block: Block): number => repository.getBlockIndex(block),
      insertDefaultBlock: vi.fn((_skipYjsSync: boolean, id?: string) => {
        const block = createStubBlock(id ?? 'default');

        blocksStore.insert(0, block);

        return block;
      }),
      updateIndentation: vi.fn(),
      setBlockParent: vi.fn(),
      replaceBlock: vi.fn(),
      onBlockRemoved: (block, index) => {
        priv.blockDidMutated(BlockRemovedMutationType, block, { index });
      },
      onBlockAdded: (block, index) => {
        priv.blockDidMutated(BlockAddedMutationType, block, { index });
      },
    };

    yjsSync = new BlockYjsSync({ YjsManager: manager }, repository, factory, handlers, blocksStore);
    unsubscribe = yjsSync.subscribe();
    priv.yjsSync = yjsSync;

    manager.state = {
      BlockManager: {
        getBlockById: (id: string): Block | undefined => repository.getBlockById(id),
        getBlockByChildNode: (): undefined => undefined,
        currentBlock: undefined,
        reparentFromHistoryReplay: (): void => undefined,
      },
    } as unknown as BlokModules;

    manager.fromJSON(seed);

    peer = new DocumentStore(new YBlockSerializer());

    // Real ModificationsObserver on the SAME bus, wired like the editor's boot.
    onChange = vi.fn();
    const redactor = document.createElement('div');

    observer = new ModificationsObserver({
      config: { onChange } as unknown as BlokConfig,
      eventsDispatcher: dispatcher,
    });
    observer.state = {
      UI: { nodes: { redactor } },
      API: { methods: {} },
      Saver: { save: vi.fn().mockResolvedValue(undefined) },
      ReadOnly: { isEnabled: false },
    } as unknown as BlokModules;
    observer.enable();
  };

  const syncPeerUp = (): void => {
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));
  };

  const applyPeerToLocal = (): void => {
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    observer.destroy();
    peer.destroy();
    manager.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('fires onChange with the changed block when a remote add reconciles', async () => {
    createHarness([paragraph('b1'), paragraph('b2')]);
    syncPeerUp();

    // Nothing has reached the host yet — a clean baseline before the remote op.
    onChange.mockClear();

    peer.addBlock(paragraph('r1'), 1);
    applyPeerToLocal();
    await flush();

    expect(onChange).toHaveBeenCalledTimes(1);

    const [, delivered] = onChange.mock.calls[0] as [unknown, BlockMutationEvent | BlockMutationEvent[]];
    const event = Array.isArray(delivered) ? delivered[0] : delivered;

    expect(event.type).toBe(BlockAddedMutationType);
    expect(event.detail.target.id).toBe('r1');
  });

  it('fires onChange when a remote remove reconciles', async () => {
    createHarness([paragraph('b1'), paragraph('b2'), paragraph('b3')]);
    syncPeerUp();

    onChange.mockClear();

    peer.removeBlock('b2');
    applyPeerToLocal();
    await flush();

    expect(onChange).toHaveBeenCalledTimes(1);

    const [, delivered] = onChange.mock.calls[0] as [unknown, BlockMutationEvent | BlockMutationEvent[]];
    const event = Array.isArray(delivered) ? delivered[0] : delivered;

    expect(event.type).toBe(BlockRemovedMutationType);
    expect(event.detail.target.id).toBe('b2');
  });

  /**
   * States decision 13's property directly and survives a harness refactor: the
   * BlockChanged EMIT is ungated. Only the write-back (syncBlockDataToYjs) is
   * gated on isSyncingFromYjs, so the emit still fires while a remote reconcile
   * holds that flag true.
   */
  it('emits BlockChanged even while isSyncingFromYjs is true (emit is ungated)', () => {
    createHarness([paragraph('b1')]);

    const priv = blockManager as unknown as BlockManagerPrivate;

    priv.yjsSync = { isSyncingFromYjs: true, isReconciling: (): boolean => true };

    const heard: BlockMutationEvent[] = [];

    dispatcher.on(BlockChanged, (payload) => {
      heard.push(payload.event);
    });

    const block = createStubBlock('b1');

    priv.blockDidMutated(BlockChangedMutationType, block, {});

    expect(heard).toHaveLength(1);
    expect(heard[0].detail.target.id).toBe('b1');
  });
});
