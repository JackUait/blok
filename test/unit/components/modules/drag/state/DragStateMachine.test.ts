/**
 * Tests for DragStateMachine
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  DragStateMachine,
  type DragState,
  isIdle,
  isTracking,
  isDragging,
  isDropped,
  isCancelled,
  isDragActive,
  isActuallyDragging,
} from '../../../../../../src/components/modules/drag/state/DragStateMachine';
import type { Block } from '../../../../../../src/components/block';

describe('DragStateMachine', () => {
  let stateMachine: DragStateMachine;
  let mockBlock1: Partial<Block>;
  let mockBlock2: Partial<Block>;
  let mockBlock3: Partial<Block>;

  beforeEach(() => {
    vi.clearAllMocks();
    stateMachine = new DragStateMachine();

    // Create mock blocks
    mockBlock1 = { id: 'block-1' } as Block;
    mockBlock2 = { id: 'block-2' } as Block;
    mockBlock3 = { id: 'block-3' } as Block;
  });

  describe('initial state', () => {
    it('should start in idle state', () => {
      expect(stateMachine.getState()).toEqual({ type: 'idle' });
    });

    it('should return null for getSourceBlocks when idle', () => {
      expect(stateMachine.getSourceBlocks()).toBeNull();
    });

    it('should return null for getSourceBlock when idle', () => {
      expect(stateMachine.getSourceBlock()).toBeNull();
    });

    it('should return false for isMultiBlockDrag when idle', () => {
      expect(stateMachine.isMultiBlockDrag()).toBe(false);
    });

    it('should return false for isSourceBlock when idle', () => {
      expect(stateMachine.isSourceBlock(mockBlock1 as Block)).toBe(false);
    });
  });

  describe('startTracking', () => {
    it('should transition to tracking state', () => {
      const state = stateMachine.startTracking(
        mockBlock1 as Block,
        [mockBlock1 as Block],
        100,
        200
      );

      expect(state.type).toBe('tracking');
      expect(state.sourceBlock).toBe(mockBlock1);
      expect(state.sourceBlocks).toEqual([mockBlock1]);
      expect(state.startX).toBe(100);
      expect(state.startY).toBe(200);
      expect(state.isMultiBlockDrag).toBe(false);
    });

    it('should detect multi-block drag', () => {
      stateMachine.startTracking(
        mockBlock1 as Block,
        [mockBlock1 as Block, mockBlock2 as Block, mockBlock3 as Block],
        0,
        0
      );

      expect(stateMachine.isMultiBlockDrag()).toBe(true);
    });

    it('should throw when starting tracking from non-idle state', () => {
      stateMachine.startTracking(
        mockBlock1 as Block,
        [mockBlock1 as Block],
        0,
        0
      );

      expect(() => {
        stateMachine.startTracking(
          mockBlock2 as Block,
          [mockBlock2 as Block],
          0,
          0
        );
      }).toThrow('Cannot start tracking from state "tracking", must be idle');
    });

    it('should make source blocks available', () => {
      const blocks = [mockBlock1 as Block, mockBlock2 as Block];
      stateMachine.startTracking(mockBlock1 as Block, blocks, 0, 0);

      expect(stateMachine.getSourceBlocks()).toEqual(blocks);
    });
  });

  describe('startDrag', () => {
    it('should transition from tracking to dragging', () => {
      stateMachine.startTracking(
        mockBlock1 as Block,
        [mockBlock1 as Block],
        100,
        200
      );

      const state = stateMachine.startDrag();

      expect(state.type).toBe('dragging');
      expect(state.sourceBlock).toBe(mockBlock1);
      expect(state.targetBlock).toBeNull();
      expect(state.targetEdge).toBeNull();
    });

    it('should preserve multi-block drag status', () => {
      stateMachine.startTracking(
        mockBlock1 as Block,
        [mockBlock1 as Block, mockBlock2 as Block],
        0,
        0
      );

      const state = stateMachine.startDrag();

      expect(state.isMultiBlockDrag).toBe(true);
    });

    it('should throw when starting drag from idle state', () => {
      expect(() => stateMachine.startDrag()).toThrow(
        'Cannot start drag from state "idle", must be tracking'
      );
    });

    it('should throw when starting drag from dragging state', () => {
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);
      stateMachine.startDrag();

      expect(() => stateMachine.startDrag()).toThrow(
        'Cannot start drag from state "dragging", must be tracking'
      );
    });
  });

  describe('updateTarget', () => {
    beforeEach(() => {
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);
      stateMachine.startDrag();
    });

    it('should update target block and edge', () => {
      stateMachine.updateTarget(mockBlock2 as Block, 'top');

      const state = stateMachine.getState();
      if (state.type === 'dragging') {
        expect(state.targetBlock).toBe(mockBlock2);
        expect(state.targetEdge).toBe('top');
      }
    });

    it('should allow clearing target', () => {
      stateMachine.updateTarget(mockBlock2 as Block, 'bottom');
      stateMachine.updateTarget(null, null);

      const state = stateMachine.getState();
      if (state.type === 'dragging') {
        expect(state.targetBlock).toBeNull();
        expect(state.targetEdge).toBeNull();
      }
    });

    it('should throw when updating target from non-dragging state', () => {
      stateMachine.reset();

      expect(() => {
        stateMachine.updateTarget(mockBlock2 as Block, 'top');
      }).toThrow('Cannot update target from state "idle", must be dragging');
    });
  });

  describe('drop', () => {
    beforeEach(() => {
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);
      stateMachine.startDrag();
      stateMachine.updateTarget(mockBlock2 as Block, 'bottom');
    });

    it('should transition to dropped state', () => {
      const state = stateMachine.drop();

      expect(state.type).toBe('dropped');
      expect(state.sourceBlock).toBe(mockBlock1);
      expect(state.targetBlock).toBe(mockBlock2);
      expect(state.targetEdge).toBe('bottom');
    });

    it('should throw when dropping without target', () => {
      stateMachine.reset();
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);
      stateMachine.startDrag();
      // Don't set target

      expect(() => stateMachine.drop()).toThrow('Cannot drop: no valid target');
    });

    it('should throw when dropping from tracking state', () => {
      stateMachine.reset();
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);

      expect(() => stateMachine.drop()).toThrow(
        'Cannot drop from state "tracking", must be dragging'
      );
    });
  });

  describe('cancel', () => {
    it('should cancel from tracking state', () => {
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);

      const state = stateMachine.cancel();

      expect(state.type).toBe('cancelled');
      expect(state.sourceBlock).toBe(mockBlock1);
      expect(state.sourceBlocks).toEqual([mockBlock1]);
    });

    it('should cancel from dragging state', () => {
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);
      stateMachine.startDrag();

      const state = stateMachine.cancel();

      expect(state.type).toBe('cancelled');
      expect(state.sourceBlock).toBe(mockBlock1);
    });

    it('should throw when cancelling from idle state', () => {
      expect(() => stateMachine.cancel()).toThrow(
        'Cannot cancel from state "idle", must be tracking or dragging'
      );
    });
  });

  describe('reset', () => {
    it('should reset from any state to idle', () => {
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);
      stateMachine.startDrag();

      stateMachine.reset();

      expect(stateMachine.getState()).toEqual({ type: 'idle' });
    });

    it('should allow starting new drag after reset', () => {
      stateMachine.startTracking(mockBlock1 as Block, [mockBlock1 as Block], 0, 0);
      stateMachine.reset();

      expect(() => {
        stateMachine.startTracking(mockBlock2 as Block, [mockBlock2 as Block], 0, 0);
      }).not.toThrow();
    });
  });

  describe('isSourceBlock', () => {
    it('should return true for blocks in source list', () => {
      stateMachine.startTracking(
        mockBlock1 as Block,
        [mockBlock1 as Block, mockBlock2 as Block],
        0,
        0
      );

      expect(stateMachine.isSourceBlock(mockBlock1 as Block)).toBe(true);
      expect(stateMachine.isSourceBlock(mockBlock2 as Block)).toBe(true);
    });

    it('should return false for blocks not in source list', () => {
      stateMachine.startTracking(
        mockBlock1 as Block,
        [mockBlock1 as Block],
        0,
        0
      );

      expect(stateMachine.isSourceBlock(mockBlock2 as Block)).toBe(false);
    });
  });

  describe('type guards', () => {
    it('isIdle should correctly identify idle state', () => {
      const state: DragState = { type: 'idle' };
      expect(isIdle(state)).toBe(true);
      expect(isTracking(state)).toBe(false);
      expect(isDragging(state)).toBe(false);
      expect(isDropped(state)).toBe(false);
      expect(isCancelled(state)).toBe(false);
    });

    it('isTracking should correctly identify tracking state', () => {
      const state: DragState = {
        type: 'tracking',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        startX: 0,
        startY: 0,
      };
      expect(isTracking(state)).toBe(true);
      expect(isIdle(state)).toBe(false);
      expect(isDragging(state)).toBe(false);
    });

    it('isDragging should correctly identify dragging state', () => {
      const state: DragState = {
        type: 'dragging',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        targetBlock: null,
        targetEdge: null,
        startX: 0,
        startY: 0,
      };
      expect(isDragging(state)).toBe(true);
      expect(isTracking(state)).toBe(false);
      expect(isIdle(state)).toBe(false);
    });

    it('isDropped should correctly identify dropped state', () => {
      const state: DragState = {
        type: 'dropped',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        targetBlock: mockBlock2 as Block,
        targetEdge: 'bottom',
      };
      expect(isDropped(state)).toBe(true);
      expect(isDragging(state)).toBe(false);
    });

    it('isCancelled should correctly identify cancelled state', () => {
      const state: DragState = {
        type: 'cancelled',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
      };
      expect(isCancelled(state)).toBe(true);
      expect(isDragging(state)).toBe(false);
    });
  });

  describe('isDragActive', () => {
    it('should return true for tracking state', () => {
      const state: DragState = {
        type: 'tracking',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        startX: 0,
        startY: 0,
      };
      expect(isDragActive(state)).toBe(true);
    });

    it('should return true for dragging state', () => {
      const state: DragState = {
        type: 'dragging',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        targetBlock: null,
        targetEdge: null,
        startX: 0,
        startY: 0,
      };
      expect(isDragActive(state)).toBe(true);
    });

    it('should return false for idle, dropped, and cancelled states', () => {
      expect(isDragActive({ type: 'idle' })).toBe(false);
      expect(isDragActive({
        type: 'dropped',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        targetBlock: mockBlock2 as Block,
        targetEdge: 'bottom',
      })).toBe(false);
      expect(isDragActive({
        type: 'cancelled',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
      })).toBe(false);
    });
  });

  describe('isActuallyDragging', () => {
    it('should return true for dragging and dropped states', () => {
      const draggingState: DragState = {
        type: 'dragging',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        targetBlock: null,
        targetEdge: null,
        startX: 0,
        startY: 0,
      };
      const droppedState: DragState = {
        type: 'dropped',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        targetBlock: mockBlock2 as Block,
        targetEdge: 'bottom',
      };
      expect(isActuallyDragging(draggingState)).toBe(true);
      expect(isActuallyDragging(droppedState)).toBe(true);
    });

    it('should return false for idle, tracking, and cancelled states', () => {
      expect(isActuallyDragging({ type: 'idle' })).toBe(false);
      expect(isActuallyDragging({
        type: 'tracking',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
        isMultiBlockDrag: false,
        startX: 0,
        startY: 0,
      })).toBe(false);
      expect(isActuallyDragging({
        type: 'cancelled',
        sourceBlock: mockBlock1 as Block,
        sourceBlocks: [mockBlock1 as Block],
      })).toBe(false);
    });
  });
});
