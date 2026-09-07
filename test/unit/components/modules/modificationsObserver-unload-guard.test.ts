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
 * What the tab's unload prompt is actually driven by.
 *
 * The prompt is armed by the persistence queue, which only holds a payload once
 * a serialization has been delivered to it. The 400ms batch window and the
 * serialization itself sit before that, and an edit is just as unsaved there.
 */

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

/**
 * Dispatches the event the browser sends when the tab is closing and reports
 * whether a guard held it back.
 */
const fireBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
};

/**
 * A promise plus the handle to settle it, so a test can hold a serialization
 * open for as long as it likes.
 */
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return {
    promise,
    resolve,
  };
};

describe('ModificationsObserver — what the unload guard reads', () => {
  const released: Array<BlokConfig['persistence']> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    released.splice(0).forEach((owner) => {
      releasePersistenceQueue(owner);
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createObserver = (config: BlokConfig): {
    observer: ModificationsObserver;
    eventsDispatcher: EventsDispatcher<BlokEventMap>;
    saverSave: ReturnType<typeof vi.fn>;
  } => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const observer = new ModificationsObserver({
      config,
      eventsDispatcher,
    });
    const saverSave = vi.fn().mockResolvedValue(DOC);

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

    return {
      observer,
      eventsDispatcher,
      saverSave,
    };
  };

  describe('the batch window and the serialization the queue cannot see', () => {
    it('arms the unload prompt for an edit that has not reached the queue yet', () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const config = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      released.push(config.persistence);

      const { observer, eventsDispatcher } = createObserver(config);

      observer.enable();

      expect(fireBeforeUnload()).toBe(false);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b1') });

      // Still inside the batch window: nothing has been serialized, so the
      // queue holds nothing at all.
      expect(save).not.toHaveBeenCalled();
      expect(fireBeforeUnload()).toBe(true);
    });

    it('stands the prompt down once the queue has written the document', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const config = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      released.push(config.persistence);

      const { observer, eventsDispatcher } = createObserver(config);

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b1') });

      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(save).toHaveBeenCalledTimes(1);
      expect(fireBeforeUnload()).toBe(false);
    });

    it('drops the prompt when the pending edit is discarded by a document replacement', () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const config = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      released.push(config.persistence);

      const { observer, eventsDispatcher } = createObserver(config);

      observer.enable();
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b1') });

      expect(fireBeforeUnload()).toBe(true);

      observer.discardPendingChanges();

      expect(fireBeforeUnload()).toBe(false);
    });
  });

  describe('overlapping serializations', () => {
    it('stays dirty while a second serialization is still outstanding', async () => {
      const first = deferred<OutputData>();
      const second = deferred<OutputData>();
      const onSave = vi.fn();
      const { observer, eventsDispatcher, saverSave } = createObserver({ onSave });

      saverSave
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      observer.enable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b2') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(saverSave).toHaveBeenCalledTimes(2);

      // The first window's serialization lands. The second one has not, so the
      // host is still missing an edit.
      first.resolve(DOC);
      await vi.advanceTimersByTimeAsync(0);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(observer.hasUnsavedChanges).toBe(true);

      second.resolve(DOC);
      await vi.advanceTimersByTimeAsync(0);

      expect(observer.hasUnsavedChanges).toBe(false);
    });

    it('keeps the unload prompt up until the last serialization settles', async () => {
      const first = deferred<OutputData>();
      const second = deferred<OutputData>();
      const save = vi.fn().mockResolvedValue(undefined);
      const config = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      released.push(config.persistence);

      const { observer, eventsDispatcher, saverSave } = createObserver(config);

      saverSave
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      observer.enable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('b2') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      first.resolve(DOC);
      await vi.advanceTimersByTimeAsync(0);

      expect(fireBeforeUnload()).toBe(true);
    });
  });
});
