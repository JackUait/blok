import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ModificationsObserver } from '../../../../src/components/modules/modificationsObserver';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import { BlockChanged } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokConfig, OutputData } from '../../../../types';
import type { BlockMutationEvent, BlockMutationType } from '../../../../types/events/block';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';

/**
 * Stub MutationObserver — the module constructs one eagerly.
 */
class MutationObserverStub {
  public observe = vi.fn();

  public disconnect = vi.fn();

  public takeRecords = vi.fn(() => []);

  /**
   * Stores the observer callback so the test never has to touch a real DOM observer.
   * @param _callback - mutation callback, unused by these tests
   */
  constructor(_callback: MutationCallback) {
    void _callback;
  }
}

const createBlockMutationEvent = (
  id: string,
  type: BlockMutationType = 'block-changed'
): BlockMutationEvent => new CustomEvent(type, {
  detail: {
    target: { id },
  },
}) as BlockMutationEvent;

const sampleOutput: OutputData = {
  time: 1,
  version: '1',
  blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }],
};

describe('ModificationsObserver — autosave lifecycle', () => {
  let originalMutationObserver: typeof MutationObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    originalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = MutationObserverStub;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.MutationObserver = originalMutationObserver;
  });

  const createObserver = (
    configOverrides?: Partial<BlokConfig>
  ): {
    observer: ModificationsObserver;
    eventsDispatcher: EventsDispatcher<BlokEventMap>;
    onChange: ReturnType<typeof vi.fn>;
    onSave: ReturnType<typeof vi.fn>;
    saverSave: ReturnType<typeof vi.fn>;
    readOnly: { isEnabled: boolean };
  } => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const onChange = vi.fn();
    const onSave = vi.fn();
    const config = {
      onChange,
      onSave,
      ...configOverrides,
    } as unknown as BlokConfig;

    const observer = new ModificationsObserver({
      config,
      eventsDispatcher,
    });

    const saverSave = vi.fn().mockResolvedValue(sampleOutput);
    const readOnly = { isEnabled: false };

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
      ReadOnly: readOnly,
    } as unknown as BlokModules;

    return {
      observer,
      eventsDispatcher,
      onChange,
      onSave,
      saverSave,
      readOnly,
    };
  };

  describe('Finding 3 — a batch window that outlives disable()', () => {
    it('does not serialize after disable(), even when the window was already open', async () => {
      const { observer, eventsDispatcher, saverSave, onSave } = createObserver();

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      // A host-driven render lands inside the open window.
      await vi.advanceTimersByTimeAsync(Math.round(modificationsObserverBatchTimeout / 8));
      observer.disable();

      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(saverSave).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('cancels the armed timer on disable() so nothing is left to fire', () => {
      const { observer, eventsDispatcher } = createObserver();

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      expect(vi.getTimerCount()).toBe(1);

      observer.disable();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('Finding 9 — teardown drops an un-flushed batch', () => {
    it('flushes the pending batch on destroy()', async () => {
      const { observer, eventsDispatcher, saverSave } = createObserver();

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      // Navigating away well inside the batch window.
      await vi.advanceTimersByTimeAsync(Math.round(modificationsObserverBatchTimeout / 4));
      observer.destroy();

      expect(saverSave).toHaveBeenCalledTimes(1);
    });

    it('reports the document as dirty while a batch is still un-delivered', async () => {
      const { observer, eventsDispatcher } = createObserver();

      observer.enable();

      expect(observer.hasUnsavedChanges).toBe(false);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      expect(observer.hasUnsavedChanges).toBe(true);

      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(observer.hasUnsavedChanges).toBe(false);
    });
  });

  describe('Finding 10 — read-only toggled inside the window', () => {
    it('keeps the edit pending instead of discarding it when read-only lands mid-window', async () => {
      const { observer, eventsDispatcher, readOnly } = createObserver();

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      // The host freezes the document before the window closes.
      readOnly.isEnabled = true;
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      // The user's edit is real and unsaved — the dirty bit must survive.
      expect(observer.hasUnsavedChanges).toBe(true);
    });

    it('does not deliver onSave for a flip that lands after the serialization started', async () => {
      const { observer, eventsDispatcher, readOnly, onSave, saverSave } = createObserver();
      let resolveSave: (data: OutputData) => void = () => {};

      saverSave.mockReturnValue(new Promise<OutputData>((resolve) => {
        resolveSave = resolve;
      }));

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(saverSave).toHaveBeenCalledTimes(1);

      // Host freezes the document while the serialization is in flight.
      readOnly.isEnabled = true;
      resolveSave(sampleOutput);
      await Promise.resolve();
      await Promise.resolve();

      expect(onSave).not.toHaveBeenCalled();
      expect(observer.hasUnsavedChanges).toBe(true);
    });
  });

  describe('Finding 11 — a failed serialization drops the batch', () => {
    it('keeps the document dirty when the serialization rejects', async () => {
      const { observer, eventsDispatcher, saverSave } = createObserver();

      saverSave.mockRejectedValue(new Error('save exploded'));

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(saverSave).toHaveBeenCalledTimes(1);
      expect(observer.hasUnsavedChanges).toBe(true);
    });

    it('keeps the document dirty when the serialization yields no data', async () => {
      const { observer, eventsDispatcher, saverSave, onSave } = createObserver();

      saverSave.mockResolvedValue(undefined);

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(onSave).not.toHaveBeenCalled();
      expect(observer.hasUnsavedChanges).toBe(true);
    });

    it('retries the dropped batch on the next change window', async () => {
      const { observer, eventsDispatcher, saverSave, onSave } = createObserver();

      saverSave.mockRejectedValueOnce(new Error('save exploded'));

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      saverSave.mockResolvedValue(sampleOutput);
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-2') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(observer.hasUnsavedChanges).toBe(false);
    });
  });
});
