import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ModificationsObserver } from '../../../../src/components/modules/modificationsObserver';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import {
  BlockChanged,
  FakeCursorAboutToBeToggled,
  FakeCursorHaveBeenSet,
  RedactorDomChanged
} from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokConfig, OutputData } from '../../../../types';
import type { BlockMutationEvent, BlockMutationType } from '../../../../types/events/block';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';

/**
 * Stub implementation of MutationObserver used to capture and trigger callbacks in tests.
 */
class MutationObserverStub {
  public static lastInstance: MutationObserverStub | null = null;

  private readonly callback: MutationCallback;

  public observe = vi.fn();

  public disconnect = vi.fn();

  public takeRecords = vi.fn(() => []);

  /**
   * Creates a stub that records the provided observer callback for later manual triggering.
   * @param callback Mutation observer callback that should run when `trigger` is invoked.
   */
  constructor(callback: MutationCallback) {
    this.callback = callback;
    MutationObserverStub.lastInstance = this;
  }

  /**
   * Invokes the stored callback with the supplied mutation records.
   * @param mutations Mutation records that simulate DOM changes.
   */
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

const observeOptions = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
} as const;

describe('ModificationsObserver', () => {
  let originalMutationObserver: typeof MutationObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    originalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = MutationObserverStub;
    MutationObserverStub.lastInstance = null;
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
    config: BlokConfig;
    redactor: HTMLDivElement;
    apiMethods: Record<string, never>;
    onChange: ReturnType<typeof vi.fn>;
    saverSave: ReturnType<typeof vi.fn>;
    readOnly: { isEnabled: boolean };
  } => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const onChange = vi.fn();
    const config = {
      onChange,
      ...configOverrides,
    } as unknown as BlokConfig;

    const observer = new ModificationsObserver({
      config,
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
      config,
      redactor,
      apiMethods,
      onChange,
      saverSave,
      readOnly,
    };
  };

  it('observes the redactor element when enabled', () => {
    const { observer, redactor } = createObserver();

    observer.enable();

    const instance = MutationObserverStub.lastInstance;

    expect(instance).not.toBeNull();
    expect(instance?.observe).toHaveBeenCalledWith(redactor, observeOptions);
  });

  it('disconnects the observer and prevents onChange while disabled', () => {
    const { observer, eventsDispatcher, onChange, apiMethods } = createObserver();

    observer.disable();

    const instance = MutationObserverStub.lastInstance;

    expect(instance).not.toBeNull();
    expect(instance?.disconnect).toHaveBeenCalledTimes(1);

    const blockEvent = createBlockMutationEvent('block-1');

    eventsDispatcher.emit(BlockChanged, { event: blockEvent });
    vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);

    expect(onChange).not.toHaveBeenCalled();

    // Re-enable to verify the observer resumes normal operation
    observer.enable();
    const blockEvent2 = createBlockMutationEvent('block-2');
    eventsDispatcher.emit(BlockChanged, { event: blockEvent2 });
    vi.advanceTimersByTime(modificationsObserverBatchTimeout);

    expect(onChange).toHaveBeenCalledWith(apiMethods, blockEvent2);
  });

  it('does not deliver onChange until enable() has run (mount-time bookkeeping is silent)', () => {
    // A freshly constructed observer is inert: block mutations fired during the
    // editor's own mount (before core calls enable() post-render) must NOT reach
    // the consumer, otherwise a pristine document emits a spurious change.
    const { eventsDispatcher, onChange } = createObserver();

    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
    vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not serialize or emit onSave until enable() has run', async () => {
    const onSave = vi.fn();
    const { eventsDispatcher, saverSave } = createObserver({ onSave });

    saverSave.mockResolvedValue({ time: 1, version: '1', blocks: [] });

    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

    expect(saverSave).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not deliver onChange while read-only is enabled, even after enable()', () => {
    // Read-only re-enables the observer after toggling (the disable() is only a
    // mutex around the in-place setReadOnly loop). Delivery must still be gated on
    // the live read-only state so a change in read-only mode never reaches onChange.
    const { observer, eventsDispatcher, onChange, readOnly } = createObserver();

    observer.enable();
    readOnly.isEnabled = true;

    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
    vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not serialize or emit onSave while read-only is enabled', async () => {
    const onSave = vi.fn();
    const { observer, eventsDispatcher, saverSave, readOnly } = createObserver({ onSave });

    saverSave.mockResolvedValue({ time: 1, version: '1', blocks: [] });
    observer.enable();
    readOnly.isEnabled = true;

    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

    expect(saverSave).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  // Read-only is honored at DELIVERY, not just at enqueue: a change queued while
  // EDITABLE, with read-only toggled on before the batch fires, must still be
  // suppressed. The two tests above set isEnabled BEFORE emitting, so they only
  // exercise the enqueue-time guard — these cover the mid-batch race the
  // delivery-time guard exists for.
  it('does not deliver onChange when read-only is toggled on AFTER the change is queued', () => {
    const { observer, eventsDispatcher, onChange, readOnly } = createObserver();

    observer.enable();
    // Editable when the mutation is queued — passes the enqueue-time guard.
    readOnly.isEnabled = false;
    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

    // Read-only flips on before the batch window elapses.
    readOnly.isEnabled = true;
    vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not serialize or emit onSave when read-only is toggled on AFTER the change is queued', async () => {
    const onSave = vi.fn();
    const { observer, eventsDispatcher, saverSave, readOnly } = createObserver({ onSave });

    saverSave.mockResolvedValue({ time: 1, version: '1', blocks: [] });
    observer.enable();
    readOnly.isEnabled = false;
    eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });

    readOnly.isEnabled = true;
    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

    expect(saverSave).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('emits onChange with the latest single event after batching time', () => {
    const { observer, eventsDispatcher, onChange, apiMethods } = createObserver();

    observer.enable();

    const firstEvent = createBlockMutationEvent('block-1');
    const latestEvent = createBlockMutationEvent('block-1');

    eventsDispatcher.emit(BlockChanged, { event: firstEvent });
    eventsDispatcher.emit(BlockChanged, { event: latestEvent });

    vi.advanceTimersByTime(modificationsObserverBatchTimeout);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(apiMethods, latestEvent);
  });

  it('emits an array when batching multiple distinct events', () => {
    const { observer, eventsDispatcher, onChange, apiMethods } = createObserver();

    observer.enable();

    const firstEvent = createBlockMutationEvent('block-1');
    const secondEvent = createBlockMutationEvent('block-2');

    eventsDispatcher.emit(BlockChanged, { event: firstEvent });
    eventsDispatcher.emit(BlockChanged, { event: secondEvent });

    vi.advanceTimersByTime(modificationsObserverBatchTimeout);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(apiMethods, [firstEvent, secondEvent]);
  });

  it('emits RedactorDomChanged when mutations are observed', () => {
    const { observer, eventsDispatcher } = createObserver();
    const listener = vi.fn();

    eventsDispatcher.on(RedactorDomChanged, listener);
    observer.enable();

    const instance = MutationObserverStub.lastInstance;
    const mutations: MutationRecord[] = [];

    instance?.trigger(mutations);

    expect(listener).toHaveBeenCalledWith({ mutations });
  });

  it('reacts to fake cursor events by toggling observation', () => {
    const { observer, eventsDispatcher, redactor } = createObserver();

    observer.enable();

    const instance = MutationObserverStub.lastInstance;

    expect(instance).not.toBeNull();
    expect(instance?.observe).toHaveBeenCalledWith(redactor, observeOptions);

    eventsDispatcher.emit(FakeCursorAboutToBeToggled, { state: true });
    expect(instance?.disconnect).toHaveBeenCalledTimes(1);

    eventsDispatcher.emit(FakeCursorHaveBeenSet, { state: true });
    expect(instance?.observe).toHaveBeenCalledTimes(2);
  });

  describe('onSave (serialized output callback)', () => {
    const sampleOutput: OutputData = {
      time: 1,
      version: '1',
      blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'hi' } }],
    };

    it('serializes the editor and emits onSave with the full OutputData after batching', async () => {
      const onSave = vi.fn();
      const { observer, eventsDispatcher, apiMethods, saverSave } = createObserver({ onSave });

      observer.enable();
      saverSave.mockResolvedValue(sampleOutput);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);

      expect(saverSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(sampleOutput, apiMethods);
    });

    it('emits onSave even when no onChange callback is configured', async () => {
      const onSave = vi.fn();
      const { observer, eventsDispatcher, saverSave } = createObserver({
        onChange: undefined,
        onSave,
      });

      observer.enable();
      saverSave.mockResolvedValue(sampleOutput);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(sampleOutput, expect.anything());
    });

    it('serializes only once per batch of multiple events (debounced)', async () => {
      const onSave = vi.fn();
      const { observer, eventsDispatcher, saverSave } = createObserver({ onSave });

      observer.enable();
      saverSave.mockResolvedValue(sampleOutput);

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-2') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);

      expect(saverSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('does not serialize or emit onSave while disabled', async () => {
      const onSave = vi.fn();
      const { observer, eventsDispatcher, saverSave } = createObserver({ onSave });

      saverSave.mockResolvedValue(sampleOutput);
      observer.disable();

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout + 1);

      expect(saverSave).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    });

    it('does not emit onSave after destroy even if serialization was already in flight', async () => {
      const onSave = vi.fn();
      let resolveSave: (data: OutputData) => void = () => {};
      const { observer, eventsDispatcher, saverSave } = createObserver({ onSave });

      observer.enable();
      saverSave.mockReturnValue(
        new Promise<OutputData>((resolve) => {
          resolveSave = resolve;
        })
      );

      eventsDispatcher.emit(BlockChanged, { event: createBlockMutationEvent('block-1') });
      // Fire the batch timer synchronously -> triggers save() (still pending)
      vi.advanceTimersByTime(modificationsObserverBatchTimeout);
      expect(saverSave).toHaveBeenCalledTimes(1);

      observer.destroy();
      resolveSave(sampleOutput);
      await Promise.resolve();
      await Promise.resolve();

      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('destroy()', () => {
    it('disconnects the MutationObserver and disables onChange delivery', () => {
      const { observer, eventsDispatcher, onChange, apiMethods } = createObserver();

      observer.enable();

      const instance = MutationObserverStub.lastInstance;

      expect(instance).not.toBeNull();

      // Baseline: confirm onChange fires normally before destroy
      const beforeEvent = createBlockMutationEvent('block-before');

      eventsDispatcher.emit(BlockChanged, { event: beforeEvent });
      vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);
      expect(onChange).toHaveBeenCalledWith(apiMethods, beforeEvent);

      onChange.mockClear();

      // Now destroy and confirm no further onChange delivery
      observer.destroy();
      expect(instance?.disconnect).toHaveBeenCalledTimes(1);

      const afterEvent = createBlockMutationEvent('block-after');

      eventsDispatcher.emit(BlockChanged, { event: afterEvent });
      vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('cancels the pending batching timeout so onChange is not fired after destroy', () => {
      const { observer, eventsDispatcher, onChange } = createObserver();

      observer.enable();

      // Queue a batched onChange event
      const blockEvent = createBlockMutationEvent('block-1');

      eventsDispatcher.emit(BlockChanged, { event: blockEvent });

      // Destroy before the batch timer fires
      observer.destroy();

      // Advance past the batch timeout
      vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);

      // onChange must NOT have been called — the pending timer was cancelled
      expect(onChange).not.toHaveBeenCalled();
    });

    it('prevents further onChange emissions after destroy', () => {
      const { observer, eventsDispatcher, onChange } = createObserver();

      observer.enable();
      observer.destroy();

      const blockEvent = createBlockMutationEvent('block-2');

      eventsDispatcher.emit(BlockChanged, { event: blockEvent });
      vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});


