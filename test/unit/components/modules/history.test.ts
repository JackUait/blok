import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { History } from '../../../../src/components/modules/history';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlockMutationEvent } from '../../../../types/events/block';

describe('History', () => {
  let history: History;
  let mockBlok: Partial<BlokModules>;
  let mockConfig: { newGroupDelay?: number; historyDebounceTime?: number };

  beforeEach(() => {
    mockConfig = {};

    // Create a minimal mock of the Blok modules
    mockBlok = {
      BlockManager: {
        blocks: [],
        getBlockById: vi.fn(),
        getBlockByIndex: vi.fn(),
        getBlockIndex: vi.fn(),
        currentBlock: null,
      } as any,
      UI: {
        nodes: {
          redactor: document.createElement('div'),
          wrapper: document.createElement('div'),
        },
      } as any,
      ModificationsObserver: {
        enable: vi.fn(),
        disable: vi.fn(),
      } as any,
      Caret: {
        setToBlock: vi.fn(),
        setToInput: vi.fn(),
        positions: {
          START: 'start',
          END: 'end',
          DEFAULT: 'default',
        },
      } as any,
      Renderer: {
        render: vi.fn(),
      } as any,
      SelectionAPI: {
        methods: {
          clearFakeBackground: vi.fn(),
        },
      } as any,
    };

    // Create History instance with mocked dependencies
    history = new History({
      config: mockConfig,
      eventsDispatcher: {
        on: vi.fn(),
        emit: vi.fn(),
        off: vi.fn(),
      } as any,
    });

    // Set the Blok state (this is how Core sets it up)
    (history as any).Blok = mockBlok;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('newGroupDelay configuration', () => {
    it('should use default newGroupDelay of 500ms when not configured', () => {
      // Access private getter through type assertion
      const delay = (history as any).newGroupDelay;

      expect(delay).toBe(500);
    });

    it('should use custom newGroupDelay when configured', () => {
      mockConfig.newGroupDelay = 1000;
      const customHistory = new History({
        config: mockConfig,
        eventsDispatcher: {
          on: vi.fn(),
          emit: vi.fn(),
          off: vi.fn(),
        } as any,
      });
      (customHistory as any).Blok = mockBlok;

      const delay = (customHistory as any).newGroupDelay;

      expect(delay).toBe(1000);
    });

    it('should accept 0 as a valid newGroupDelay', () => {
      mockConfig.newGroupDelay = 0;
      const customHistory = new History({
        config: mockConfig,
        eventsDispatcher: {
          on: vi.fn(),
          emit: vi.fn(),
          off: vi.fn(),
        } as any,
      });
      (customHistory as any).Blok = mockBlok;

      const delay = (customHistory as any).newGroupDelay;

      expect(delay).toBe(0);
    });
  });

  describe('pause detection (newGroupDelay)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should track lastMutationTime on first mutation', () => {
      const mockEvent = createMockBlockMutationEvent('block-1');
      const startTime = Date.now();

      vi.setSystemTime(startTime);

      // Capture initial state first
      (history as any).initialStateCaptured = true;

      // Trigger mutation
      (history as any).handleBlockMutation(mockEvent);

      expect((history as any).lastMutationTime).toBe(startTime);
    });

    it('should update lastMutationTime on subsequent mutations', () => {
      const mockEvent = createMockBlockMutationEvent('block-1');

      // Set up initial state
      (history as any).initialStateCaptured = true;
      vi.setSystemTime(1000);

      // First mutation
      (history as any).handleBlockMutation(mockEvent);
      expect((history as any).lastMutationTime).toBe(1000);

      // Advance time and trigger another mutation
      vi.setSystemTime(1300);
      (history as any).handleBlockMutation(mockEvent);
      expect((history as any).lastMutationTime).toBe(1300);
    });

    it('should NOT create checkpoint when mutations occur within newGroupDelay', () => {
      const mockEvent = createMockBlockMutationEvent('block-1');
      const recordStateSpy = vi.spyOn(history as any, 'recordState');

      // Set up initial state
      (history as any).initialStateCaptured = true;
      vi.setSystemTime(1000);

      // First mutation
      (history as any).handleBlockMutation(mockEvent);

      // Second mutation within delay (500ms default)
      vi.setSystemTime(1400); // 400ms later
      (history as any).handleBlockMutation(mockEvent);

      // recordState should not be called immediately (only via debounce)
      expect(recordStateSpy).not.toHaveBeenCalled();
    });

    it('should create checkpoint when pause exceeds newGroupDelay', async () => {
      const mockEvent = createMockBlockMutationEvent('block-1');
      const recordStateSpy = vi.spyOn(history as any, 'recordState').mockResolvedValue(undefined);

      // Set up initial state
      (history as any).initialStateCaptured = true;
      vi.setSystemTime(1000);

      // First mutation
      (history as any).handleBlockMutation(mockEvent);

      // Advance time beyond newGroupDelay (500ms default)
      vi.setSystemTime(1600); // 600ms later (> 500ms)

      // Second mutation after pause
      (history as any).handleBlockMutation(mockEvent);

      // Wait for promises to resolve
      await vi.runAllTimersAsync();

      // recordState should be called immediately due to pause detection
      expect(recordStateSpy).toHaveBeenCalled();
    });

    it('should create checkpoint with custom newGroupDelay', async () => {
      mockConfig.newGroupDelay = 1000;
      const customHistory = new History({
        config: mockConfig,
        eventsDispatcher: {
          on: vi.fn(),
          emit: vi.fn(),
          off: vi.fn(),
        } as any,
      });
      (customHistory as any).Blok = mockBlok;

      const mockEvent = createMockBlockMutationEvent('block-1');
      const recordStateSpy = vi.spyOn(customHistory as any, 'recordState').mockResolvedValue(undefined);

      // Set up initial state
      (customHistory as any).initialStateCaptured = true;
      vi.setSystemTime(1000);

      // First mutation
      (customHistory as any).handleBlockMutation(mockEvent);

      // Advance time less than custom delay
      vi.setSystemTime(1800); // 800ms later (< 1000ms)
      (customHistory as any).handleBlockMutation(mockEvent);

      // Should not create checkpoint yet
      expect(recordStateSpy).not.toHaveBeenCalled();

      // Advance time beyond custom delay
      vi.setSystemTime(2100); // 1100ms from start (> 1000ms)
      (customHistory as any).handleBlockMutation(mockEvent);

      await vi.runAllTimersAsync();

      // Now should create checkpoint
      expect(recordStateSpy).toHaveBeenCalled();
    });

    it('should reset lastMutationTime when clearing history', () => {
      const mockEvent = createMockBlockMutationEvent('block-1');

      // Set up and trigger mutation
      (history as any).initialStateCaptured = true;
      (history as any).handleBlockMutation(mockEvent);

      expect((history as any).lastMutationTime).not.toBeNull();

      // Clear history
      history.clear();

      expect((history as any).lastMutationTime).toBeNull();
    });

    it('should work alongside smart grouping (action type changes)', async () => {
      const mockEvent = createMockBlockMutationEvent('block-1');
      const recordStateSpy = vi.spyOn(history as any, 'recordState').mockResolvedValue(undefined);

      // Set up initial state
      (history as any).initialStateCaptured = true;
      vi.setSystemTime(1000);

      // Set action type to insert
      (history as any).currentActionType = 'insert';

      // First mutation (insert)
      (history as any).handleBlockMutation(mockEvent);

      // Quick second mutation (still insert, within pause delay)
      vi.setSystemTime(1200); // 200ms later
      (history as any).handleBlockMutation(mockEvent);

      // No checkpoint yet
      expect(recordStateSpy).not.toHaveBeenCalled();

      // Long pause, then mutation
      vi.setSystemTime(1800); // 600ms from last (> 500ms)
      (history as any).handleBlockMutation(mockEvent);

      await vi.runAllTimersAsync();

      // Should create checkpoint due to pause
      expect(recordStateSpy).toHaveBeenCalled();
    });

    it('should create checkpoint on first mutation after long pause even if action type is same', async () => {
      const mockEvent = createMockBlockMutationEvent('block-1');
      const recordStateSpy = vi.spyOn(history as any, 'recordState').mockResolvedValue(undefined);

      // Set up initial state
      (history as any).initialStateCaptured = true;
      (history as any).currentActionType = 'insert';
      vi.setSystemTime(1000);

      // First mutation
      (history as any).handleBlockMutation(mockEvent);

      // Update context to simulate smart grouping behavior
      (history as any).smartGrouping.updateContext('insert', 'block-1');

      // Clear any pending calls
      recordStateSpy.mockClear();

      // Long pause
      vi.setSystemTime(2000); // 1000ms later (> 500ms)

      // Second mutation with same action type
      (history as any).handleBlockMutation(mockEvent);

      await vi.runAllTimersAsync();

      // Should create checkpoint due to pause, not action type change
      expect(recordStateSpy).toHaveBeenCalled();
    });

    it('should reset lastMutationTime on batch start to prevent stale pause detection', () => {
      const mockEvent = createMockBlockMutationEvent('block-1');

      // Set up initial state
      (history as any).initialStateCaptured = true;
      vi.setSystemTime(1000);

      // First mutation
      (history as any).handleBlockMutation(mockEvent);

      // Verify lastMutationTime was set
      expect((history as any).lastMutationTime).toBe(1000);

      // Start a batch
      history.startBatch();

      // lastMutationTime should be reset to null
      expect((history as any).lastMutationTime).toBeNull();

      history.endBatch();
    });

    it('should not trigger pause detection after batch completes', async () => {
      const mockEvent = createMockBlockMutationEvent('block-1');
      const recordStateSpy = vi.spyOn(history as any, 'recordState').mockResolvedValue(undefined);

      // Set up initial state
      (history as any).initialStateCaptured = true;
      vi.setSystemTime(1000);

      // First mutation (outside batch)
      (history as any).handleBlockMutation(mockEvent);
      expect((history as any).lastMutationTime).toBe(1000);

      // Wait for debounce to complete
      await vi.runAllTimersAsync();
      recordStateSpy.mockClear();

      // Start batch (should reset lastMutationTime)
      vi.setSystemTime(1100);
      history.startBatch();
      expect((history as any).lastMutationTime).toBeNull();

      // Simulate mutations during batch (these set batchHasMutations but don't update lastMutationTime)
      vi.setSystemTime(1200);
      (history as any).handleBlockMutation(mockEvent);
      expect((history as any).batchHasMutations).toBe(true);
      expect((history as any).lastMutationTime).toBeNull(); // Should still be null during batch

      // End batch
      history.endBatch();

      // Verify recordState was called for the batch
      await vi.runAllTimersAsync();
      expect(recordStateSpy).toHaveBeenCalledTimes(1);
      recordStateSpy.mockClear();

      // After batch ends, a long time passes
      vi.setSystemTime(2000); // 800ms later from batch end

      // Next mutation should NOT trigger immediate pause detection checkpoint
      // because lastMutationTime was reset to null during startBatch
      (history as any).handleBlockMutation(mockEvent);

      // Since lastMutationTime was null, shouldCheckpointFromPause will be false
      // So recordState should NOT be called immediately (only via debounce)
      expect(recordStateSpy).not.toHaveBeenCalled();

      // Now lastMutationTime should be set to current time
      expect((history as any).lastMutationTime).toBe(2000);

      // Let the debounce timer complete
      await vi.runAllTimersAsync();

      // Now recordState should be called via debounce
      expect(recordStateSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('transaction()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should call startBatch before executing callback', async () => {
      const startBatchSpy = vi.spyOn(history, 'startBatch');
      const callback = vi.fn(() => 'result');

      await history.transaction(callback);

      expect(startBatchSpy).toHaveBeenCalledBefore(callback);
    });

    it('should call endBatch after executing callback', async () => {
      const endBatchSpy = vi.spyOn(history, 'endBatch');
      const callback = vi.fn(() => 'result');

      await history.transaction(callback);

      expect(callback).toHaveBeenCalledBefore(endBatchSpy);
      expect(endBatchSpy).toHaveBeenCalled();
    });

    it('should return the callback result for sync functions', async () => {
      const result = await history.transaction(() => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });

    it('should return the callback result for async functions', async () => {
      const result = await history.transaction(async () => {
        return 'async-result';
      });

      expect(result).toBe('async-result');
    });

    it('should group operations into a single undo step', async () => {
      const mockEvent = createMockBlockMutationEvent('block-1');
      const recordStateSpy = vi.spyOn(history as any, 'recordState').mockResolvedValue(undefined);

      // Set up initial state
      (history as any).initialStateCaptured = true;

      await history.transaction(() => {
        // Simulate multiple mutations
        (history as any).handleBlockMutation(mockEvent);
        (history as any).handleBlockMutation(mockEvent);
        (history as any).handleBlockMutation(mockEvent);
      });

      // Wait for any pending promises
      await vi.runAllTimersAsync();

      // Should only record state once after the transaction ends
      expect(recordStateSpy).toHaveBeenCalledTimes(1);
    });

    it('should call endBatch even if callback throws an error', async () => {
      const endBatchSpy = vi.spyOn(history, 'endBatch');
      const error = new Error('test error');

      await expect(
        history.transaction(() => {
          throw error;
        })
      ).rejects.toThrow(error);

      expect(endBatchSpy).toHaveBeenCalled();
    });

    it('should call endBatch even if async callback rejects', async () => {
      const endBatchSpy = vi.spyOn(history, 'endBatch');
      const error = new Error('async error');

      await expect(
        history.transaction(async () => {
          throw error;
        })
      ).rejects.toThrow(error);

      expect(endBatchSpy).toHaveBeenCalled();
    });

    it('should preserve batchDepth state after error', async () => {
      const error = new Error('test error');

      // batchDepth should be 0 initially
      expect((history as any).batchDepth).toBe(0);

      await expect(
        history.transaction(() => {
          throw error;
        })
      ).rejects.toThrow(error);

      // batchDepth should still be 0 after error cleanup
      expect((history as any).batchDepth).toBe(0);
    });

    it('should support nested transactions', async () => {
      const mockEvent = createMockBlockMutationEvent('block-1');
      const recordStateSpy = vi.spyOn(history as any, 'recordState').mockResolvedValue(undefined);

      // Set up initial state
      (history as any).initialStateCaptured = true;

      await history.transaction(async () => {
        (history as any).handleBlockMutation(mockEvent);

        await history.transaction(() => {
          (history as any).handleBlockMutation(mockEvent);
        });

        (history as any).handleBlockMutation(mockEvent);
      });

      // Wait for any pending promises
      await vi.runAllTimersAsync();

      // Should only record state once after the outer transaction ends
      expect(recordStateSpy).toHaveBeenCalledTimes(1);
    });

    it('should return undefined when callback returns void', async () => {
      const result = await history.transaction(() => {
        // Function returns void
      });

      expect(result).toBeUndefined();
    });

    it('should handle callbacks that return complex types', async () => {
      const complexResult = { id: 'test', value: 42, nested: { data: 'hello' } };

      const result = await history.transaction(() => {
        return complexResult;
      });

      expect(result).toEqual(complexResult);
    });

    it('should work with async callbacks that await promises', async () => {
      const resultPromise = history.transaction(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));

        return 'delayed-result';
      });

      // Advance timers to resolve the setTimeout
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result).toBe('delayed-result');
    });

    it('should mark batchHasMutations when mutations occur during transaction', async () => {
      const mockEvent = createMockBlockMutationEvent('block-1');

      // Set up initial state
      (history as any).initialStateCaptured = true;

      await history.transaction(() => {
        (history as any).handleBlockMutation(mockEvent);
      });

      // batchHasMutations should be reset after endBatch
      expect((history as any).batchHasMutations).toBe(false);
    });

    it('should not record state if no mutations occurred during transaction', async () => {
      const recordStateSpy = vi.spyOn(history as any, 'recordState').mockResolvedValue(undefined);

      // Set up initial state
      (history as any).initialStateCaptured = true;

      await history.transaction(() => {
        // No mutations
      });

      // Wait for any pending promises
      await vi.runAllTimersAsync();

      // Should not record state if no mutations occurred
      expect(recordStateSpy).not.toHaveBeenCalled();
    });
  });
});

/**
 * Helper function to create a mock BlockMutationEvent
 */
const createMockBlockMutationEvent = (blockId: string): BlockMutationEvent => {
  return {
    type: 'block-changed',
    detail: {
      target: {
        id: blockId,
      } as any,
    },
  } as BlockMutationEvent;
};
