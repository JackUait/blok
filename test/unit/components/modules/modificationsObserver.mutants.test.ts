import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ModificationsObserver } from '../../../../src/components/modules/modificationsObserver';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import { BlockChanged } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import { expandPersistenceConfig, releasePersistenceQueue } from '../../../../src/components/utils/persistence';

import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig, OutputData } from '../../../../types';
import type { BlockMutationEvent, BlockMutationType } from '../../../../types/events/block';

/**
 * Mutation-killing tests for `ModificationsObserver`.
 *
 * Every case pins a decision the module makes about WHICH changes reach the
 * host, WHEN they reach it, and what the tab's unload guard is told in
 * between. The assertions name the defect, not the implementation.
 */

class MutationObserverStub {
  public static lastInstance: MutationObserverStub | null = null;

  private readonly callback: MutationCallback;

  public observe = vi.fn();

  public disconnect = vi.fn();

  public takeRecords = vi.fn(() => []);

  constructor(callback: MutationCallback) {
    this.callback = callback;
    MutationObserverStub.lastInstance = this;
  }

  public trigger(mutations: MutationRecord[]): void {
    this.callback(mutations, this);
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

const DOC: OutputData = {
  time: 1,
  version: '1.0.0',
  blocks: [ { id: 'b1', type: 'paragraph', data: { text: 'typed' } } ],
};

/** Dispatches the browser's tab-closing event and reports whether the guard held it back. */
const fireBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
};

/** A promise plus the handle to settle it, so a test can hold a serialization open. */
const deferred = <T>(): { promise: Promise<T>; reject: (error: unknown) => void; resolve: (value: T) => void } => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, reject, resolve };
};

interface Harness {
  observer: ModificationsObserver;
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
  config: BlokConfig;
  redactor: HTMLDivElement;
  apiMethods: Record<string, never>;
  onChange: ReturnType<typeof vi.fn>;
  saverSave: ReturnType<typeof vi.fn>;
  readOnly: { isEnabled: boolean };
}

describe('ModificationsObserver — mutants', () => {
  let originalMutationObserver: typeof MutationObserver;
  const released: Array<BlokConfig['persistence']> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    originalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = MutationObserverStub;
    MutationObserverStub.lastInstance = null;
  });

  afterEach(() => {
    released.splice(0).forEach((owner) => {
      releasePersistenceQueue(owner);
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.MutationObserver = originalMutationObserver;
  });

  const createObserver = (configOverrides?: Partial<BlokConfig>, config?: BlokConfig): Harness => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const onChange = vi.fn();
    const resolvedConfig = config ?? ({
      onChange,
      ...configOverrides,
    });

    const observer = new ModificationsObserver({
      config: resolvedConfig,
      eventsDispatcher,
    });

    const redactor = document.createElement('div');
    const apiMethods = {} as Record<string, never>;
    const saverSave = vi.fn().mockResolvedValue(undefined);
    const readOnly = { isEnabled: false };

    observer.state = {
      UI: {
        nodes: {
          redactor,
        },
      },
      API: {
        methods: apiMethods,
      },
      Saver: {
        save: saverSave,
      },
      ReadOnly: readOnly,
    } as unknown as BlokModules;

    return {
      observer,
      eventsDispatcher,
      config: resolvedConfig,
      redactor,
      apiMethods,
      onChange,
      saverSave,
      readOnly,
    };
  };

  /**
   * The unload guard is the queue's, and it is armed only while something is
   * unsaved — the observer's `syncUnloadGuard` is what re-evaluates it.
   */
  const withPersistence = (
    onSave: BlokConfig['onSave'],
    persistenceSave: ReturnType<typeof vi.fn>
  ): BlokConfig => {
    const expanded = expandPersistenceConfig({
      persistence: {
        load: async () => null,
        save: persistenceSave,
      } as unknown as Parameters<typeof expandPersistenceConfig>[0]['persistence'],
    });

    released.push(expanded.persistence);

    return {
      onChange: vi.fn(),
      onSave,
      persistence: expanded.persistence,
    };
  };

  describe('discardPendingChanges', () => {
    it('does not deliver a change that was discarded before its window closed', async () => {
      const { observer, eventsDispatcher, onChange, apiMethods } = createObserver();

      observer.enable();

      const discarded = createBlockMutationEvent('block-1');
      const fresh = createBlockMutationEvent('block-2');

      eventsDispatcher.emit(BlockChanged, { event: discarded });
      observer.discardPendingChanges();
      eventsDispatcher.emit(BlockChanged, { event: fresh });

      await vi.advanceTimersByTimeAsync(0);

      // The discarded edit was made against a document the caller replaced: only
      // the edit made after the discard may reach onChange, and unwrapped.
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(apiMethods, fresh);
    });

    it('leaves no timer armed for the discarded window', () => {
      const { observer, eventsDispatcher } = createObserver();

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      expect(vi.getTimerCount()).toBe(1);

      observer.discardPendingChanges();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not let the discarded window close a later one early', async () => {
      const onSave = vi.fn();
      const { observer, eventsDispatcher, saverSave } = createObserver({ onSave });

      saverSave.mockResolvedValue(DOC);
      observer.enable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(0);

      // Half a window in, so the discarded window's deadline is distinguishable
      // from the one the next change opens.
      await vi.advanceTimersByTimeAsync(Math.round(modificationsObserverBatchTimeout / 2));

      observer.discardPendingChanges();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-2') });
      await vi.advanceTimersByTimeAsync(0);

      // The discarded window's original deadline passes with the new one open.
      await vi.advanceTimersByTimeAsync(Math.round(modificationsObserverBatchTimeout / 2) + 1);

      // A timer that outlived its document serializes a window that has not
      // closed, and the edit it carries is the replacement document's.
      expect(saverSave).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(Math.round(modificationsObserverBatchTimeout / 2));

      expect(saverSave).toHaveBeenCalledTimes(1);
    });

    it('cancels the open window so the next change leads a fresh one', async () => {
      const { observer, eventsDispatcher, onChange, apiMethods } = createObserver();

      observer.enable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(0);
      expect(onChange).toHaveBeenCalledTimes(1);

      observer.discardPendingChanges();
      onChange.mockClear();

      const fresh = createBlockMutationEvent('block-2');

      eventsDispatcher.emit(BlockChanged, { event: fresh });
      await vi.advanceTimersByTimeAsync(0);

      // A surviving timer would swallow the leading edge and make the edit wait
      // out a window that belongs to a discarded document.
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(apiMethods, fresh);
    });
  });

  describe('destroy', () => {
    it('leaves no batching timer behind', () => {
      const { observer, eventsDispatcher } = createObserver();

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      expect(vi.getTimerCount()).toBe(1);

      observer.destroy();

      // A surviving timer keeps the JS engine (and the page) alive after teardown.
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stays inert for a change dispatched after destroy', () => {
      const { observer, eventsDispatcher } = createObserver();

      observer.enable();
      observer.destroy();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      // Destroy is terminal: a later change must not re-arm the observer or
      // mark the document dirty again.
      expect(vi.getTimerCount()).toBe(0);
      expect(observer.hasUnsavedChanges).toBe(false);
    });
  });

  describe('the onSave half of a window', () => {
    it('does not serialize when the host configured no onSave handler', async () => {
      const { observer, eventsDispatcher, saverSave } = createObserver({ onSave: undefined });

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      // Nothing serializes a whole document for a host that never asked for it.
      expect(saverSave).not.toHaveBeenCalled();
    });

    it('clears the dirty bit when there is no onSave handler to receive the batch', async () => {
      const { observer, eventsDispatcher } = createObserver({ onSave: undefined });

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      // The batch was handed to onChange, so it is no longer unsaved work.
      expect(observer.hasUnsavedChanges).toBe(false);
    });

    it('does not call onSave when the host dropped the handler mid-serialization', async () => {
      const onSave = vi.fn();
      const { observer, eventsDispatcher, config, saverSave } = createObserver({ onSave });

      saverSave.mockResolvedValue(DOC);
      observer.enable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      // Timer only: the serialization has started but has not settled.
      vi.advanceTimersByTime(modificationsObserverBatchTimeout);
      expect(saverSave).toHaveBeenCalledTimes(1);

      (config as { onSave?: unknown }).onSave = undefined;

      await vi.advanceTimersByTimeAsync(0);

      // A guard taken at ENQUEUE time would call a handler the host already
      // removed, and the throw would put the document back to dirty.
      expect(observer.hasUnsavedChanges).toBe(false);
    });

    it('keeps the document dirty while another serialization is still outstanding', async () => {
      const first = deferred<OutputData>();
      const second = deferred<OutputData>();
      const onSave = vi.fn();
      const { observer, eventsDispatcher, saverSave } = createObserver({ onSave });

      saverSave
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      observer.enable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-2') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(saverSave).toHaveBeenCalledTimes(2);

      first.reject(new Error('endpoint down'));
      await vi.advanceTimersByTimeAsync(0);

      // Drop the rejected batch's own dirty bit, leaving only the in-flight one
      // that the host still has not received.
      observer.discardPendingChanges();

      expect(observer.hasUnsavedChanges).toBe(true);

      second.resolve(DOC);
      await vi.advanceTimersByTimeAsync(0);

      expect(observer.hasUnsavedChanges).toBe(false);
    });
  });

  describe('read-only suppression', () => {
    it('never delivers a change that was queued while read-only suppressed it', async () => {
      const { observer, eventsDispatcher, onChange, readOnly } = createObserver();

      observer.enable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      readOnly.isEnabled = true;

      // The leading edge sees read-only on and drops the batch.
      await vi.advanceTimersByTimeAsync(0);

      readOnly.isEnabled = false;

      // The window closes with read-only off.
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      // The suppressed batch is gone for good: a notification withheld from a
      // read-only document must not surface later as a spurious change.
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('what the unload guard is told', () => {
    it('stands the prompt down when a window closes with no onSave handler', async () => {
      const persistenceSave = vi.fn().mockResolvedValue(undefined);
      const config = withPersistence(undefined, persistenceSave);
      const { observer, eventsDispatcher } = createObserver(undefined, config);

      observer.enable();

      expect(fireBeforeUnload()).toBe(false);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      // Inside the window: the edit is unsaved even though nothing was serialized.
      expect(fireBeforeUnload()).toBe(true);

      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      // The batch is delivered to onChange and nothing is owed to a save queue,
      // so the prompt has to go.
      expect(fireBeforeUnload()).toBe(false);
    });

    it('stands the prompt down once the host received the serialized document', async () => {
      const persistenceSave = vi.fn().mockResolvedValue(undefined);
      const onSave = vi.fn<NonNullable<BlokConfig['onSave']>>();
      const config = withPersistence(onSave, persistenceSave);
      const { observer, eventsDispatcher, saverSave } = createObserver(undefined, config);

      saverSave.mockResolvedValue(DOC);
      observer.enable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

      expect(fireBeforeUnload()).toBe(true);

      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(fireBeforeUnload()).toBe(false);
    });
  });
});
