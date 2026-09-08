import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { InlineLifecycleManager } from '../../../../../../src/components/modules/toolbar/inline/lifecycle-manager';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

interface Fixture {
  manager: InlineLifecycleManager;
  initialize: Mock<() => void>;
}

const build = (blok: unknown): Fixture => {
  const initialize = vi.fn<() => void>();

  return {
    manager: new InlineLifecycleManager(() => blok as BlokModules, initialize),
    initialize,
  };
};

const readyBlok = (): { UI: { nodes: { wrapper?: HTMLElement } } } => ({
  UI: { nodes: { wrapper: document.createElement('div') } },
});

describe('inline toolbar lifecycle mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Fake timers do not drive the idle queue, and whether jsdom even has one
    // varies. Running the idle callback inline leaves exactly one setTimeout to
    // drain, whichever branch the scheduler took.
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback): number => {
      callback({ didTimeout: false, timeRemaining: () => 0 });

      return 1;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes once the wrapper is there, and stops reporting itself scheduled', () => {
    const { manager, initialize } = build(readyBlok());

    manager.schedule();

    expect(manager.isScheduled).toBe(true);

    vi.runOnlyPendingTimers();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(manager.isInitialized).toBe(true);
    expect(manager.isScheduled).toBe(false);
  });

  it('does not queue a second attempt while one is pending', () => {
    const { manager, initialize } = build(readyBlok());

    manager.schedule();
    manager.schedule();
    vi.runOnlyPendingTimers();

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  // Something else can finish initialization between scheduling and the
  // deferred callback firing.
  it('drops a deferred attempt that has been overtaken', () => {
    const { manager, initialize } = build(readyBlok());

    manager.schedule();
    manager.markInitialized();
    vi.runOnlyPendingTimers();

    expect(initialize).not.toHaveBeenCalled();
  });

  // runOnlyPendingTimers, never runAllTimers: each retry queues the next one,
  // so draining the queue would never end.
  it('retries rather than initializing while the wrapper is missing', () => {
    const blok = { UI: { nodes: {} as { wrapper?: HTMLElement } } };
    const { manager, initialize } = build(blok);

    manager.schedule();
    vi.runOnlyPendingTimers();

    expect(initialize).not.toHaveBeenCalled();

    blok.UI.nodes.wrapper = document.createElement('div');
    vi.runOnlyPendingTimers();

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('survives a Blok with no UI module, and a UI module with no nodes', () => {
    const withoutUi = build({});

    withoutUi.manager.schedule();

    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
    expect(withoutUi.initialize).not.toHaveBeenCalled();

    const withoutNodes = build({ UI: {} });

    withoutNodes.manager.schedule();

    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
    expect(withoutNodes.initialize).not.toHaveBeenCalled();
  });

  // The stub has to be gone before any assertion runs — an expect with no
  // window takes the whole file down.
  it('initializes straight away when there is no window to defer with', () => {
    const { manager, initialize } = build(readyBlok());
    let failure: unknown;

    vi.stubGlobal('window', undefined);
    try {
      manager.schedule();
    } catch (error) {
      failure = error;
    } finally {
      vi.unstubAllGlobals();
    }

    expect(failure).toBeUndefined();
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});
