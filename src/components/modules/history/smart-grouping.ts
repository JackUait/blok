/**
 * Smart grouping logic for history checkpoints
 * @module History/SmartGrouping
 */

import type { ActionContext, ActionType, MutationMetadata } from './types';

/**
 * Actions that should create an immediate checkpoint (before the action)
 */
const IMMEDIATE_CHECKPOINT_ACTIONS: ActionType[] = [
  'format',
  'structural',
  'paste',
  'cut',
];

/**
 * Threshold for action type changes before creating a checkpoint.
 * Quick corrections (< threshold) stay grouped with previous actions.
 */
const ACTION_CHANGE_THRESHOLD = 3;

/**
 * Determines when to create history checkpoints based on action patterns
 *
 * Creates checkpoints when:
 * - Action type changes (e.g., typing → deleting)
 * - Block changes
 * - Immediate actions (format, structural, paste, cut)
 */
export class SmartGrouping {
  /**
   * Current action context
   */
  private currentContext: ActionContext | undefined;

  /**
   * Count of actions since last action type change.
   * Used to implement threshold-based checkpointing.
   */
  private pendingActionCount = 0;

  /**
   * Determines if a checkpoint should be created before recording this mutation
   * @param metadata - mutation metadata with action type info
   * @param blockId - ID of the block being mutated
   * @returns true if a checkpoint should be created
   */
  public shouldCreateCheckpoint(
    metadata: MutationMetadata,
    blockId: string
  ): boolean {
    const actionType = metadata.actionType ?? 'insert';

    // No current context means this is the first action - don't checkpoint
    if (!this.currentContext) {
      return false;
    }

    // Block changed - create checkpoint immediately
    if (this.currentContext.blockId !== blockId) {
      this.pendingActionCount = 0;

      return true;
    }

    const actionMatchesContext = this.currentContext.type === actionType;

    // If we're tracking a transition and action matches context, continue counting
    // (Context was updated to the new action type by caller)
    if (actionMatchesContext && this.pendingActionCount > 0) {
      this.pendingActionCount++;

      if (this.pendingActionCount >= ACTION_CHANGE_THRESHOLD) {
        return true;
      }

      return false;
    }

    // Same action as context with no pending transition - stable state
    if (actionMatchesContext) {
      return false;
    }

    // Action differs from context
    if (this.pendingActionCount > 0) {
      // Was tracking different action, now switching again - reset
      this.pendingActionCount = 0;

      return false;
    }

    // Start tracking new action type
    this.pendingActionCount = 1;

    return false;
  }

  /**
   * Checks if this action type should trigger an immediate checkpoint
   * @param actionType - the action type to check
   * @returns true if this action should create an immediate checkpoint
   */
  public isImmediateCheckpoint(actionType: ActionType): boolean {
    return IMMEDIATE_CHECKPOINT_ACTIONS.includes(actionType);
  }

  /**
   * Updates the current action context
   * @param actionType - the new action type
   * @param blockId - the block being edited
   */
  public updateContext(actionType: ActionType, blockId: string): void {
    this.currentContext = {
      type: actionType,
      blockId,
      timestamp: Date.now(),
    };
  }

  /**
   * Gets the current action context
   * @returns the current context or undefined
   */
  public getCurrentContext(): ActionContext | undefined {
    return this.currentContext;
  }

  /**
   * Clears the current action context
   */
  public clearContext(): void {
    this.currentContext = undefined;
  }

  /**
   * Resets the pending action count.
   * Call this after a checkpoint is created.
   */
  public resetPendingActionCount(): void {
    this.pendingActionCount = 0;
  }
}
