import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { BlockHierarchy } from '../../../../../src/components/modules/blockManager/hierarchy';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import { BlockAddedMutationType } from '../../../../../types/events/block/BlockAdded';

/**
 * Create a minimal ModuleConfig for constructing BlockManager without calling prepare().
 */
const createModuleConfig = (): ModuleConfig => ({
  config: { defaultBlock: 'paragraph' } as BlokConfig,
  eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
});

/**
 * Create a minimal Blok stub with a mocked YjsManager.
 */
const createBlokStub = () => ({
  YjsManager: {
    stopCapturing: vi.fn(),
  },
});

/**
 * Create a BlockManager without calling prepare().
 * Sets state (Blok) and patches the private `operations` field
 * with a minimal stub so transactForTool can run.
 */
const createBlockManager = (): {
  blockManager: BlockManager;
  stopCapturing: ReturnType<typeof vi.fn>;
} => {
  const blockManager = new BlockManager(createModuleConfig());
  const blokStub = createBlokStub();

  blockManager.state = blokStub as unknown as BlokModules;

  // Patch the private `operations` field with a minimal stub.
  // transactForTool only reads/writes suppressStopCapturing.
  (blockManager as unknown as Record<string, unknown>).operations = {
    suppressStopCapturing: false,
  };

  return {
    blockManager,
    stopCapturing: blokStub.YjsManager.stopCapturing,
  };
};

describe('BlockManager.transactForTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls stopCapturing synchronously at start, then defers the boundary call to a microtask', async () => {
    const { blockManager, stopCapturing } = createBlockManager();

    let fnExecuted = false;

    blockManager.transactForTool(() => { fnExecuted = true; });

    // The callback must have been executed synchronously
    expect(fnExecuted).toBe(true);

    // Synchronously after call: only the initial stopCapturing (start of transaction) should have fired
    expect(stopCapturing).toHaveBeenCalledTimes(1);

    // Flush two levels of the microtask queue.
    // transactForTool uses two nested queueMicrotask calls (see implementation comment),
    // so we need two flushes to reach the inner callback.
    await Promise.resolve();
    await Promise.resolve();

    // After both microtask flushes: the deferred boundary stopCapturing should have fired
    expect(stopCapturing).toHaveBeenCalledTimes(2);
  });
});

describe('BlockManager.setPointerDragActive', () => {
  type BlockManagerPrivate = {
    yjsSync: { isSyncingFromYjs: boolean };
    syncBlockDataToYjs: (block: unknown) => Promise<void>;
    blockDidMutated: (mutationType: string, block: unknown, detail: Record<string, unknown>) => unknown;
  };

  const getPrivate = (bm: BlockManager): BlockManagerPrivate =>
    bm as unknown as BlockManagerPrivate;

  const createBlockStub = () => ({
    id: 'test-block-id',
    name: 'paragraph',
    holder: document.createElement('div'),
    tool: { name: 'paragraph' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('suppresses Yjs sync when activated', () => {
    const { blockManager } = createBlockManager();
    const priv = getPrivate(blockManager);

    priv.yjsSync = { isSyncingFromYjs: false };
    const syncSpy = vi.fn().mockResolvedValue(undefined);

    priv.syncBlockDataToYjs = syncSpy;

    blockManager.setPointerDragActive(true);
    priv.blockDidMutated(BlockChangedMutationType, createBlockStub(), {});

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('resumes Yjs sync when deactivated after being active', () => {
    const { blockManager } = createBlockManager();
    const priv = getPrivate(blockManager);

    priv.yjsSync = { isSyncingFromYjs: false };
    const syncSpy = vi.fn().mockResolvedValue(undefined);

    priv.syncBlockDataToYjs = syncSpy;

    blockManager.setPointerDragActive(true);
    blockManager.setPointerDragActive(false);
    priv.blockDidMutated(BlockChangedMutationType, createBlockStub(), {});

    expect(syncSpy).toHaveBeenCalledOnce();
  });

  it('suppresses syncBlockDataToYjs for BlockChanged when drag is active', () => {
    const { blockManager } = createBlockManager();
    const priv = getPrivate(blockManager);

    // Stub out yjsSync and syncBlockDataToYjs
    priv.yjsSync = { isSyncingFromYjs: false };
    const syncSpy = vi.fn().mockResolvedValue(undefined);

    priv.syncBlockDataToYjs = syncSpy;

    blockManager.setPointerDragActive(true);

    priv.blockDidMutated(BlockChangedMutationType, createBlockStub(), {});

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('calls syncBlockDataToYjs for BlockChanged when drag is NOT active', () => {
    const { blockManager } = createBlockManager();
    const priv = getPrivate(blockManager);

    priv.yjsSync = { isSyncingFromYjs: false };
    const syncSpy = vi.fn().mockResolvedValue(undefined);

    priv.syncBlockDataToYjs = syncSpy;

    blockManager.setPointerDragActive(false);

    priv.blockDidMutated(BlockChangedMutationType, createBlockStub(), {});

    expect(syncSpy).toHaveBeenCalledOnce();
  });

  it('does NOT suppress syncBlockDataToYjs for BlockAdded even when drag is active', () => {
    const { blockManager } = createBlockManager();
    const priv = getPrivate(blockManager);

    priv.yjsSync = { isSyncingFromYjs: false };
    const syncSpy = vi.fn().mockResolvedValue(undefined);

    priv.syncBlockDataToYjs = syncSpy;

    blockManager.setPointerDragActive(true);

    // BlockAdded should not be suppressed
    priv.blockDidMutated(BlockAddedMutationType, createBlockStub(), {});

    // syncBlockDataToYjs is only called for BlockChanged, so it should not be called for BlockAdded either way
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('re-enables syncBlockDataToYjs after drag ends', () => {
    const { blockManager } = createBlockManager();
    const priv = getPrivate(blockManager);

    priv.yjsSync = { isSyncingFromYjs: false };
    const syncSpy = vi.fn().mockResolvedValue(undefined);

    priv.syncBlockDataToYjs = syncSpy;

    blockManager.setPointerDragActive(true);
    priv.blockDidMutated(BlockChangedMutationType, createBlockStub(), {});
    expect(syncSpy).not.toHaveBeenCalled();

    blockManager.setPointerDragActive(false);
    priv.blockDidMutated(BlockChangedMutationType, createBlockStub(), {});
    expect(syncSpy).toHaveBeenCalledOnce();
  });
});

describe('BlockManager.moveCurrentBlockUp/Down (drag guard)', () => {
  const createBlockManagerWithOps = (isDragging: boolean): {
    blockManager: BlockManager;
    moveUpSpy: ReturnType<typeof vi.fn>;
    moveDownSpy: ReturnType<typeof vi.fn>;
  } => {
    const blockManager = new BlockManager(createModuleConfig());
    const moveUpSpy = vi.fn();
    const moveDownSpy = vi.fn();

    (blockManager as unknown as Record<string, unknown>).operations = {
      suppressStopCapturing: false,
      currentBlockIndexValue: 0,
      moveCurrentBlockUp: moveUpSpy,
      moveCurrentBlockDown: moveDownSpy,
    };
    // eslint-disable-next-line internal-unit-test/prefer-public-api -- guard test needs a sentinel blocksStore
    (blockManager as unknown as Record<string, unknown>)._blocks = {};

    blockManager.state = {
      YjsManager: { stopCapturing: vi.fn() },
      DragManager: { isDragging },
    } as unknown as BlokModules;

    return { blockManager, moveUpSpy, moveDownSpy };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT call operations.moveCurrentBlockUp while a drag is active (regression: wrong-block-dropped)', () => {
    const { blockManager, moveUpSpy } = createBlockManagerWithOps(true);

    blockManager.moveCurrentBlockUp();

    expect(moveUpSpy).not.toHaveBeenCalled();
  });

  it('does NOT call operations.moveCurrentBlockDown while a drag is active (regression: wrong-block-dropped)', () => {
    const { blockManager, moveDownSpy } = createBlockManagerWithOps(true);

    blockManager.moveCurrentBlockDown();

    expect(moveDownSpy).not.toHaveBeenCalled();
  });

  it('calls operations.moveCurrentBlockUp when no drag is active', () => {
    const { blockManager, moveUpSpy } = createBlockManagerWithOps(false);

    blockManager.moveCurrentBlockUp();

    expect(moveUpSpy).toHaveBeenCalledOnce();
  });

  it('calls operations.moveCurrentBlockDown when no drag is active', () => {
    const { blockManager, moveDownSpy } = createBlockManagerWithOps(false);

    blockManager.moveCurrentBlockDown();

    expect(moveDownSpy).toHaveBeenCalledOnce();
  });
});

/**
 * Fix 1 (Yjs contentIds companion write).
 *
 * BlockManager.setBlockParent() previously wrote yblock.set('parentId', …) on
 * the reparented child but left the old and new parents' Yjs `contentIds`
 * Y.Arrays completely untouched. That means any remote peer never learned
 * about the move, and undo snapshots silently lost the parent/child link.
 */
describe('BlockManager.setBlockParent Yjs contentIds companion write', () => {
  type Harness = {
    blockManager: BlockManager;
    yBlocks: Map<string, Y.Map<unknown>>;
    ydoc: Y.Doc;
    repository: BlockRepository;
    getContentIds: (id: string) => string[];
  };

  const createChildBlockStub = (options: {
    id: string;
    parentId?: string | null;
    contentIds?: string[];
  }): Block => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');

    return {
      id: options.id,
      holder,
      parentId: options.parentId ?? null,
      contentIds: options.contentIds ?? [],
      call: vi.fn(),
    } as unknown as Block;
  };

  const createHarness = (
    blockConfigs: Array<{ id: string; parentId?: string | null; contentIds?: string[] }>
  ): Harness => {
    const workingArea = document.createElement('div');

    document.body.appendChild(workingArea);

    const blocksStore = new Blocks(workingArea);
    const repository = new BlockRepository();

    for (const config of blockConfigs) {
      blocksStore.push(createChildBlockStub(config));
    }
    repository.initialize(blocksStore as unknown as BlocksStore);

    const ydoc = new Y.Doc();
    const yBlocksArray = ydoc.getArray<Y.Map<unknown>>('blocks');
    const yBlocks = new Map<string, Y.Map<unknown>>();

    // Seed a real Y.Map for every block and integrate it into the shared
    // Y.Array so nested Y.Arrays inside those maps are attached to the doc.
    // Without integration, `.insert(...)` on a Y.Array child throws
    // "Add Yjs type to a document before reading data".
    ydoc.transact(() => {
      for (const config of blockConfigs) {
        const yblock = new Y.Map<unknown>();

        yBlocksArray.push([yblock]);
        yblock.set('id', config.id);
        if (config.parentId !== undefined && config.parentId !== null) {
          yblock.set('parentId', config.parentId);
        }
        yblock.set('contentIds', Y.Array.from(config.contentIds ?? []));
        yBlocks.set(config.id, yblock);
      }
    });

    const yjsManager = {
      getBlockById: (id: string): Y.Map<unknown> | undefined => yBlocks.get(id),
      transact: (fn: () => void): void => {
        ydoc.transact(fn, 'local');
      },
      stopCapturing: vi.fn(),
    };

    const blockManager = new BlockManager(createModuleConfig());

    blockManager.state = { YjsManager: yjsManager } as unknown as BlokModules;

    const priv = blockManager as unknown as Record<string, unknown>;
    const hierarchy = new BlockHierarchy(repository);

    priv.hierarchy = hierarchy;
    priv.repository = repository;
    priv.yjsSync = { isSyncingFromYjs: false };
    // eslint-disable-next-line internal-unit-test/prefer-public-api -- Fix 1 test needs a seeded blocksStore without prepare()
    priv._blocks = blocksStore;
    priv.operations = { suppressStopCapturing: false };

    const getContentIds = (id: string): string[] => {
      const yblock = yBlocks.get(id);

      if (yblock === undefined) {
        return [];
      }
      const arr = yblock.get('contentIds');

      if (arr instanceof Y.Array) {
        return arr.toArray() as string[];
      }

      return [];
    };

    return { blockManager, yBlocks, ydoc, repository, getContentIds };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends the child id to the new parent Yjs contentIds Y.Array', () => {
    const harness = createHarness([
      { id: 'parent-a', parentId: null, contentIds: [] },
      { id: 'parent-b', parentId: null, contentIds: [] },
      { id: 'child', parentId: null, contentIds: [] },
    ]);
    const child = harness.repository.getBlockById('child');

    if (child === undefined) {
      throw new Error('child block missing');
    }

    harness.blockManager.setBlockParent(child, 'parent-b');

    expect(harness.getContentIds('parent-b')).toContain('child');
  });

  it('removes the child id from the old parent Yjs contentIds Y.Array on reparent', () => {
    const harness = createHarness([
      { id: 'parent-a', parentId: null, contentIds: ['child'] },
      { id: 'parent-b', parentId: null, contentIds: [] },
      { id: 'child', parentId: 'parent-a', contentIds: [] },
    ]);
    const child = harness.repository.getBlockById('child');

    if (child === undefined) {
      throw new Error('child block missing');
    }

    harness.blockManager.setBlockParent(child, 'parent-b');

    expect(harness.getContentIds('parent-a')).not.toContain('child');
    expect(harness.getContentIds('parent-b')).toContain('child');
  });

  it('removes the child id from the old parent Yjs contentIds when detaching to root (newParentId null)', () => {
    const harness = createHarness([
      { id: 'parent-a', parentId: null, contentIds: ['child'] },
      { id: 'child', parentId: 'parent-a', contentIds: [] },
    ]);
    const child = harness.repository.getBlockById('child');

    if (child === undefined) {
      throw new Error('child block missing');
    }

    harness.blockManager.setBlockParent(child, null);

    expect(harness.getContentIds('parent-a')).not.toContain('child');
  });

  it('converges two Yjs peers on reparent so the remote peer sees the move', () => {
    const harness = createHarness([
      { id: 'parent-a', parentId: null, contentIds: ['child'] },
      { id: 'parent-b', parentId: null, contentIds: [] },
      { id: 'child', parentId: 'parent-a', contentIds: [] },
    ]);

    // The harness already integrated every yblock into `harness.ydoc`'s
    // shared `blocks` Y.Array — we just need a second doc to sync to.
    const remote = new Y.Doc();
    const remoteBlocks = remote.getArray<Y.Map<unknown>>('blocks');

    const applyUpdate = (origin: Y.Doc, target: Y.Doc): void => {
      Y.applyUpdate(target, Y.encodeStateAsUpdate(origin));
    };

    applyUpdate(harness.ydoc, remote);

    const child = harness.repository.getBlockById('child');

    if (child === undefined) {
      throw new Error('child block missing');
    }

    harness.blockManager.setBlockParent(child, 'parent-b');
    applyUpdate(harness.ydoc, remote);

    const remoteById = new Map<string, Y.Map<unknown>>();

    remoteBlocks.forEach((yblock) => {
      const id = yblock.get('id');

      if (typeof id === 'string') {
        remoteById.set(id, yblock);
      }
    });

    const remoteParentAContent = remoteById.get('parent-a')?.get('contentIds');
    const remoteParentBContent = remoteById.get('parent-b')?.get('contentIds');

    if (!(remoteParentAContent instanceof Y.Array) || !(remoteParentBContent instanceof Y.Array)) {
      throw new Error('Remote contentIds are not Y.Arrays');
    }

    expect(remoteParentAContent.toArray()).not.toContain('child');
    expect(remoteParentBContent.toArray()).toContain('child');
  });
});

/**
 * Fix 2 (insertMany symmetric reconcile) + Fix 3 (insertMany runs assertHierarchy).
 *
 * insertMany previously reconciled children-to-parents (fills parent.contentIds
 * from child.parentId) but not the inverse. insertMany must also run
 * assertHierarchy in test mode so any residual drift throws instead of being
 * smuggled into Yjs.
 */
describe('BlockManager.insertMany hierarchy reconciliation', () => {
  const createInsertBlockStub = (options: {
    id: string;
    parentId?: string | null;
    contentIds?: string[];
  }): Block => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');

    return {
      id: options.id,
      name: 'paragraph',
      holder,
      parentId: options.parentId ?? null,
      contentIds: options.contentIds ?? [],
      preservedData: {},
      preservedTunes: {},
      call: vi.fn(),
      destroy: vi.fn(),
    } as unknown as Block;
  };

  type Harness = {
    blockManager: BlockManager;
    insertMany: (blocks: Block[]) => void;
  };

  const createHarness = (): Harness => {
    const blockManager = new BlockManager(createModuleConfig());

    blockManager.state = {
      YjsManager: {
        fromJSON: vi.fn(),
        stopCapturing: vi.fn(),
      },
    } as unknown as BlokModules;

    const priv = blockManager as unknown as Record<string, unknown>;

    // eslint-disable-next-line internal-unit-test/prefer-public-api -- insertMany test stubs the store to observe reconcile output directly
    priv._blocks = {
      insertMany: vi.fn(),
    };
    priv.yjsSync = {
      withAtomicOperation: (fn: () => void): void => {
        fn();
      },
      isSyncingFromYjs: false,
    };
    priv.hierarchy = {
      updateBlockIndentation: vi.fn(),
    };

    return {
      blockManager,
      insertMany: (blocks: Block[]): void => blockManager.insertMany(blocks),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Fix 2: fills child.parentId from parent.contentIds (inverse reconcile)', () => {
    const harness = createHarness();
    const parent = createInsertBlockStub({ id: 'cal1', contentIds: ['hdr1'] });
    const child = createInsertBlockStub({ id: 'hdr1', parentId: null });

    harness.insertMany([parent, child]);

    expect(child.parentId).toBe('cal1');
  });

  it('Fix 2: sanitises parent.contentIds when child claims a different parent', () => {
    const harness = createHarness();
    const parent = createInsertBlockStub({ id: 'cal1', contentIds: ['hdr1'] });
    const otherParent = createInsertBlockStub({ id: 'cal2', contentIds: [] });
    const child = createInsertBlockStub({ id: 'hdr1', parentId: 'cal2' });

    harness.insertMany([parent, otherParent, child]);

    expect(child.parentId).toBe('cal2');
    expect(parent.contentIds).not.toContain('hdr1');
    expect(otherParent.contentIds).toContain('hdr1');
  });

  it('Fix 2: strips dangling contentIds entries pointing at non-existent blocks', () => {
    const harness = createHarness();
    const parent = createInsertBlockStub({ id: 'cal1', contentIds: ['ghost'] });

    harness.insertMany([parent]);

    expect(parent.contentIds).not.toContain('ghost');
  });

  it('Fix 3: throws in test mode when reconcile cannot restore the invariant', () => {
    const harness = createHarness();
    // Duplicate child ids in parent.contentIds survive both reconcile passes
    // (reconcileParentsToChildren keeps an entry once per sanitised filter
    // call). assertHierarchy must fire on this residual drift.
    const parent = createInsertBlockStub({ id: 'cal1', contentIds: ['hdr1', 'hdr1'] });
    const child = createInsertBlockStub({ id: 'hdr1', parentId: 'cal1' });

    expect(() => harness.insertMany([parent, child])).toThrow(/hierarchy/i);
  });

  it('Fix 3: clears dangling child.parentId pointers so pre-existing permissive orphans still load', () => {
    const harness = createHarness();
    const orphan = createInsertBlockStub({ id: 'orphan', parentId: 'ghost-parent' });

    expect(() => harness.insertMany([orphan])).not.toThrow();
    expect(orphan.parentId).toBeNull();
  });
});
