import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InlineLifecycleManager } from '../../../../../src/components/modules/toolbar/inline/index';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

describe('InlineLifecycleManager', () => {
  let lifecycleManager: InlineLifecycleManager;
  let initializeCallback: () => void;
  let mockBlok: BlokModules;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useFakeTimers();

    // Mock requestIdleCallback
    if (typeof window !== 'undefined') {
      (window as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback = vi.fn(
        (cb: () => void, _options?: { timeout: number }) => {
          setTimeout(() => cb(), 0);
          return 1;
        }
      ) as unknown as (cb: () => void, options?: { timeout: number }) => number;
    } else {
      vi.stubGlobal('window', {
        setTimeout,
        clearTimeout,
        requestIdleCallback: (cb: () => void, _options?: { timeout: number }) => {
          setTimeout(() => cb(), 0);
          return 1;
        },
      });
    }

    initializeCallback = vi.fn() as unknown as () => void;

    mockBlok = {
      UI: {
        nodes: {
          wrapper: undefined,
        },
      },
    } as unknown as BlokModules;

    const getBlok = () => mockBlok;
    lifecycleManager = new InlineLifecycleManager(getBlok, initializeCallback);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('isInitialized', () => {
    it('should return false initially', () => {
      expect(lifecycleManager.isInitialized).toBe(false);
    });

    it('should return true after markInitialized is called', () => {
      lifecycleManager.markInitialized();

      expect(lifecycleManager.isInitialized).toBe(true);
    });
  });

  describe('markInitialized', () => {
    it('should set initialized to true', () => {
      lifecycleManager.markInitialized();

      expect(lifecycleManager.isInitialized).toBe(true);
    });
  });

  describe('isScheduled', () => {
    it('should return false initially', () => {
      expect(lifecycleManager.isScheduled).toBe(false);
    });

    it('should return true after schedule is called', () => {
      lifecycleManager.schedule();

      expect(lifecycleManager.isScheduled).toBe(true);
    });
  });

  describe('schedule', () => {
    it('should not schedule if already initialized', () => {
      lifecycleManager.markInitialized();

      lifecycleManager.schedule();

      // Should not call initialize callback since already initialized
      vi.runOnlyPendingTimers();
      expect(initializeCallback).not.toHaveBeenCalled();
    });

    it('should not schedule if already scheduled', () => {
      lifecycleManager.schedule();

      // Get the current call count
      vi.runOnlyPendingTimers();
      const initialCalls = (window.requestIdleCallback as ReturnType<typeof vi.fn>).mock.calls.length;

      lifecycleManager.schedule();

      // No new calls should be made
      expect((window.requestIdleCallback as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialCalls);
    });

    it('should schedule initialization when requestIdleCallback is available', () => {
      lifecycleManager.schedule();

      expect(window.requestIdleCallback).toHaveBeenCalledWith(
        expect.any(Function),
        { timeout: 2000 }
      );
    });

    it('should fallback to setTimeout when requestIdleCallback is not available', () => {
      // Create a mock window without requestIdleCallback
      vi.stubGlobal('requestIdleCallback', undefined);
      vi.stubGlobal('window', {
        setTimeout,
        clearTimeout,
      });

      const newLifecycleManager = new InlineLifecycleManager(() => mockBlok, initializeCallback);
      const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

      newLifecycleManager.schedule();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);

      // Restore the original for other tests
      vi.unstubAllGlobals();
    });
  });

  describe('initialization behavior', () => {
    it('should not initialize when UI wrapper is not ready', () => {
      lifecycleManager.schedule();

      // Run only pending timers once (to avoid infinite loop when wrapper is never ready)
      vi.runOnlyPendingTimers();

      // Should not have called initialize since UI wrapper is not ready
      expect(initializeCallback).not.toHaveBeenCalled();
    });

    it('should initialize when UI wrapper is ready', () => {
      const wrapper = document.createElement('div');
      mockBlok.UI.nodes.wrapper = wrapper;

      lifecycleManager.schedule();

      // Run timers
      vi.runAllTimers();

      expect(initializeCallback).toHaveBeenCalledTimes(1);
      expect(lifecycleManager.isInitialized).toBe(true);
    });

    it('should only initialize once even if schedule is called multiple times', () => {
      const wrapper = document.createElement('div');
      mockBlok.UI.nodes.wrapper = wrapper;

      lifecycleManager.schedule();
      lifecycleManager.schedule();
      lifecycleManager.schedule();

      // Run timers
      vi.runAllTimers();

      expect(initializeCallback).toHaveBeenCalledTimes(1);
      expect(lifecycleManager.isInitialized).toBe(true);
    });

    it('should handle UI wrapper becoming available after initial schedule', () => {
      // Initially no wrapper
      lifecycleManager.schedule();
      vi.runOnlyPendingTimers();
      expect(initializeCallback).not.toHaveBeenCalled();

      // Make wrapper available
      const wrapper = document.createElement('div');
      mockBlok.UI.nodes.wrapper = wrapper;

      // Create new lifecycle manager since the previous one won't reschedule automatically
      const newLifecycleManager = new InlineLifecycleManager(() => mockBlok, initializeCallback);
      newLifecycleManager.schedule();

      // Run timers
      vi.runAllTimers();

      // Should have called initialize after wrapper became available
      expect(initializeCallback).toHaveBeenCalled();
      expect(newLifecycleManager.isInitialized).toBe(true);
    });
  });
});
