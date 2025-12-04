/**
 * Event name for history state changes
 */
export const HistoryStateChanged = 'history:state-changed';

/**
 * Payload for history state change event
 */
export interface HistoryStateChangedPayload {
  /**
   * Whether undo action is available
   */
  canUndo: boolean;

  /**
   * Whether redo action is available
   */
  canRedo: boolean;
}
