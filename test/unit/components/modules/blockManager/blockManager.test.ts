import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokConfig } from '../../../../../types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

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

    // Flush the microtask queue
    await Promise.resolve();

    // After microtask flush: the deferred boundary stopCapturing should have fired
    expect(stopCapturing).toHaveBeenCalledTimes(2);
  });
});
