import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
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
