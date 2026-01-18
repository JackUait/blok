/**
 * State machine for drag operations
 * Manages drag state transitions in a type-safe way
 */

import type { Block } from '../../../block';

/**
 * Drag operation states
 */
export type DragStateType =
  | 'idle'
  | 'tracking'
  | 'dragging'
  | 'dropped'
  | 'cancelled';

/**
 * Drop edge position
 */
export type DropEdge = 'top' | 'bottom';

/**
 * Drag state data for each state
 */
export interface IdleState {
  type: 'idle';
}

export interface TrackingState {
  type: 'tracking';
  sourceBlock: Block;
  sourceBlocks: Block[];
  isMultiBlockDrag: boolean;
  startX: number;
  startY: number;
}

export interface DraggingState {
  type: 'dragging';
  sourceBlock: Block;
  sourceBlocks: Block[];
  isMultiBlockDrag: boolean;
  targetBlock: Block | null;
  targetEdge: DropEdge | null;
  startX: number;
  startY: number;
}

export interface DroppedState {
  type: 'dropped';
  sourceBlock: Block;
  sourceBlocks: Block[];
  isMultiBlockDrag: boolean;
  targetBlock: Block;
  targetEdge: DropEdge;
}

export interface CancelledState {
  type: 'cancelled';
  sourceBlock: Block;
  sourceBlocks: Block[];
}

/**
 * Union type of all possible drag states
 */
export type DragState =
  | IdleState
  | TrackingState
  | DraggingState
  | DroppedState
  | CancelledState;

/**
 * State transition type guards
 */
export const isIdle = (state: DragState): state is IdleState => state.type === 'idle';

export const isTracking = (state: DragState): state is TrackingState => state.type === 'tracking';

export const isDragging = (state: DragState): state is DraggingState => state.type === 'dragging';

export const isDropped = (state: DragState): state is DroppedState => state.type === 'dropped';

export const isCancelled = (state: DragState): state is CancelledState => state.type === 'cancelled';

/**
 * Check if any drag operation is active (tracking, dragging, or cancelled/dropped before cleanup)
 */
export const isDragActive = (state: DragState): boolean =>
  state.type === 'tracking' || state.type === 'dragging';

/**
 * Check if drag has passed threshold and is actually moving blocks
 */
export const isActuallyDragging = (state: DragState): boolean =>
  state.type === 'dragging' || state.type === 'dropped';

/**
 * Drag State Machine
 * Manages drag state with type-safe transitions
 */
export class DragStateMachine {
  private state: DragState = { type: 'idle' };

  /**
   * Get current state
   */
  getState(): DragState {
    return this.state;
  }

  /**
   * Start tracking mouse movement for potential drag
   */
  startTracking(
    sourceBlock: Block,
    sourceBlocks: Block[],
    startX: number,
    startY: number
  ): TrackingState {
    if (this.state.type !== 'idle') {
      throw new Error(`Cannot start tracking from state "${this.state.type}", must be idle`);
    }

    const isMultiBlockDrag = sourceBlocks.length > 1;

    this.state = {
      type: 'tracking',
      sourceBlock,
      sourceBlocks,
      isMultiBlockDrag,
      startX,
      startY,
    };

    return this.state;
  }

  /**
   * Transition from tracking to actual dragging
   */
  startDrag(): DraggingState {
    if (this.state.type !== 'tracking') {
      throw new Error(`Cannot start drag from state "${this.state.type}", must be tracking`);
    }

    this.state = {
      type: 'dragging',
      sourceBlock: this.state.sourceBlock,
      sourceBlocks: this.state.sourceBlocks,
      isMultiBlockDrag: this.state.isMultiBlockDrag,
      targetBlock: null,
      targetEdge: null,
      startX: this.state.startX,
      startY: this.state.startY,
    };

    return this.state;
  }

  /**
   * Update drop target during drag
   */
  updateTarget(targetBlock: Block | null, targetEdge: DropEdge | null): void {
    if (this.state.type !== 'dragging') {
      throw new Error(`Cannot update target from state "${this.state.type}", must be dragging`);
    }

    this.state = {
      ...this.state,
      targetBlock,
      targetEdge,
    };
  }

  /**
   * Complete the drag with a drop
   */
  drop(): DroppedState {
    if (this.state.type !== 'dragging') {
      throw new Error(`Cannot drop from state "${this.state.type}", must be dragging`);
    }

    if (!this.state.targetBlock || !this.state.targetEdge) {
      throw new Error('Cannot drop: no valid target');
    }

    this.state = {
      type: 'dropped',
      sourceBlock: this.state.sourceBlock,
      sourceBlocks: this.state.sourceBlocks,
      isMultiBlockDrag: this.state.isMultiBlockDrag,
      targetBlock: this.state.targetBlock,
      targetEdge: this.state.targetEdge,
    };

    return this.state;
  }

  /**
   * Cancel the drag operation
   */
  cancel(): CancelledState {
    if (this.state.type !== 'tracking' && this.state.type !== 'dragging') {
      throw new Error(`Cannot cancel from state "${this.state.type}", must be tracking or dragging`);
    }

    this.state = {
      type: 'cancelled',
      sourceBlock: this.state.sourceBlock,
      sourceBlocks: this.state.sourceBlocks,
    };

    return this.state;
  }

  /**
   * Reset to idle state
   */
  reset(): IdleState {
    this.state = { type: 'idle' };
    return this.state;
  }

  /**
   * Get the source blocks (only valid when not idle)
   */
  getSourceBlocks(): Block[] | null {
    switch (this.state.type) {
      case 'tracking':
      case 'dragging':
      case 'dropped':
      case 'cancelled':
        return this.state.sourceBlocks;
      default:
        return null;
    }
  }

  /**
   * Get the primary source block (only valid when not idle)
   */
  getSourceBlock(): Block | null {
    switch (this.state.type) {
      case 'tracking':
      case 'dragging':
      case 'dropped':
      case 'cancelled':
        return this.state.sourceBlock;
      default:
        return null;
    }
  }

  /**
   * Check if this is a multi-block drag (only valid when not idle)
   */
  isMultiBlockDrag(): boolean {
    switch (this.state.type) {
      case 'tracking':
      case 'dragging':
      case 'dropped':
        return this.state.isMultiBlockDrag;
      case 'cancelled':
      case 'idle':
        return false;
    }
  }

  /**
   * Check if a given block is part of the source blocks
   */
  isSourceBlock(block: Block): boolean {
    const sourceBlocks = this.getSourceBlocks();
    return sourceBlocks ? sourceBlocks.includes(block) : false;
  }
}
