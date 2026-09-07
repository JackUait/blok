import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BlocksAPI } from '../../../src/components/modules/api/blocks';
import { ModificationsObserver } from '../../../src/components/modules/modificationsObserver';
import { modificationsObserverBatchTimeout } from '../../../src/components/constants';
import { BlockChanged } from '../../../src/components/events';
import { EventsDispatcher } from '../../../src/components/utils/events';

import type { BlokEventMap } from '../../../src/components/events';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { BlokConfig, OutputData } from '../../../types';
import type { BlockMutationEvent, BlockMutationType } from '../../../types/events/block';

/**
 * `blocks.render()` displays a NEW document over the existing one, so an edit
 * still sitting in the observer's batch window was made against a document that
 * no longer exists. Delivering it would hand the host its own pushed document
 * straight back to its save endpoint.
 *
 * Driven through the REAL ModificationsObserver: blocks-render-echo.test.ts
 * stubs `enable`/`disable` as bare mocks, so nothing there can observe what the
 * observer does with its pending state across a render.
 */

const createBlockMutationEvent = (
  id: string,
  type: BlockMutationType = 'block-changed'
): BlockMutationEvent => new CustomEvent(type, {
  detail: {
    target: { id },
  },
}) as BlockMutationEvent;

const doc = (text: string): OutputData => ({
  time: 111,
  version: '1.0.0',
  blocks: [ { id: 'b1', type: 'paragraph', data: { text } } ],
});

/** The document the editor currently holds, as the Saver reports it. */
const CURRENT = doc('typed by the user');

/** The document the host pushes in, structurally different from CURRENT. */
const INCOMING = doc('pushed by the host');

const createHarness = (): {
  blocksApi: BlocksAPI;
  observer: ModificationsObserver;
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
  onSave: ReturnType<typeof vi.fn>;
  rendererRender: ReturnType<typeof vi.fn>;
} => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const onSave = vi.fn();
  const config = { onSave } as unknown as BlokConfig;

  const observer = new ModificationsObserver({
    config,
    eventsDispatcher,
  });

  const saverSave = vi.fn().mockResolvedValue(CURRENT);
  const rendererRender = vi.fn().mockResolvedValue(undefined);

  observer.state = {
    UI: {
      nodes: {
        redactor: document.createElement('div'),
      },
    },
    API: {
      methods: {},
    },
    Saver: {
      save: saverSave,
    },
    ReadOnly: {
      isEnabled: false,
    },
  } as unknown as BlokModules;

  const blocksApi = new BlocksAPI({
    config,
    eventsDispatcher,
  });

  blocksApi.state = {
    BlockManager: {
      clear: vi.fn().mockResolvedValue(undefined),
      getBlockById: vi.fn(),
    },
    ModificationsObserver: observer,
    Renderer: {
      render: rendererRender,
      markRenderStart: vi.fn(),
      markRenderEnd: vi.fn(),
      pendingHashScroll: null,
    },
    Saver: {
      save: saverSave,
    },
    BlockSelection: {
      selectBlock: vi.fn(),
    },
  } as unknown as BlokModules;

  return {
    blocksApi,
    observer,
    eventsDispatcher,
    onSave,
    rendererRender,
  };
};

describe('Blocks API render() — a pending edit against the replaced document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not echo the host\'s own pushed document back through onSave', async () => {
    const { blocksApi, observer, eventsDispatcher, onSave, rendererRender } = createHarness();

    observer.enable();
    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b1') });

    await blocksApi.methods.render(INCOMING);

    expect(rendererRender).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

    expect(onSave).not.toHaveBeenCalled();
    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it('keeps observing after the render, so the next real edit still saves', async () => {
    const { blocksApi, observer, eventsDispatcher, onSave } = createHarness();

    observer.enable();
    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b1') });

    await blocksApi.methods.render(INCOMING);
    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b2') });
    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps the pending edit when the render is an echo and replaces nothing', async () => {
    const { blocksApi, observer, eventsDispatcher, onSave, rendererRender } = createHarness();

    observer.enable();
    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b1') });

    // Same blocks, different envelope: render() no-ops, so the document the
    // pending edit was made against is still the one on screen.
    await blocksApi.methods.render({
      time: 999,
      version: '9.9.9',
      blocks: [ { id: 'b1', type: 'paragraph', data: { text: 'typed by the user' } } ],
    });

    expect(rendererRender).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
