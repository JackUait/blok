import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import ModificationsObserver from '../../../../src/components/modules/modificationsObserver';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import {
  BlockChanged,
  FakeCursorAboutToBeToggled,
  FakeCursorHaveBeenSet,
  RedactorDomChanged
} from '../../../../src/components/events';
import EventsDispatcher from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokConfig } from '../../../../types';
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
    this.callback(mutations, this as unknown as MutationObserver);
  }
}

const createBlockMutationEvent = (
  id: string,
  type: BlockMutationType = 'block-changed'
): BlockMutationEvent => new CustomEvent(type, {
  detail: {
    target: { id } as unknown,
  },
}) as BlockMutationEvent;

const observeOptions = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
} as const;

describe('ModificationsObserver', () => {
  let originalMutationObserver: typeof MutationObserver | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = MutationObserverStub as unknown as typeof MutationObserver;
    MutationObserverStub.lastInstance = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalMutationObserver) {
      globalThis.MutationObserver = originalMutationObserver;

      return;
    }
    delete (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
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

    observer.state = {
      UI: {
        nodes: {
          redactor,
        },
      },
      API: {
        methods: apiMethods,
      },
    } as unknown as BlokModules;

    return {
      observer,
      eventsDispatcher,
      config,
      redactor,
      apiMethods,
      onChange,
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
    const { observer, eventsDispatcher, onChange } = createObserver();

    observer.disable();

    const instance = MutationObserverStub.lastInstance;

    expect(instance).not.toBeNull();
    expect(instance?.disconnect).toHaveBeenCalledTimes(1);

    const blockEvent = createBlockMutationEvent('block-1');

    eventsDispatcher.emit(BlockChanged, { event: blockEvent });
    vi.advanceTimersByTime(modificationsObserverBatchTimeout + 1);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits onChange with the latest single event after batching time', () => {
    const { eventsDispatcher, onChange, apiMethods } = createObserver();

    const firstEvent = createBlockMutationEvent('block-1');
    const latestEvent = createBlockMutationEvent('block-1');

    eventsDispatcher.emit(BlockChanged, { event: firstEvent });
    eventsDispatcher.emit(BlockChanged, { event: latestEvent });

    vi.advanceTimersByTime(modificationsObserverBatchTimeout);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(apiMethods, latestEvent);
  });

  it('emits an array when batching multiple distinct events', () => {
    const { eventsDispatcher, onChange, apiMethods } = createObserver();

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
});


