/**
 * Types for smart history grouping
 * @module History/Types
 */

/**
 * Action types that can be detected from mutations
 */
export type ActionType =
  | 'insert'       // Typing characters
  | 'delete-back'  // Backspace deletion
  | 'delete-fwd'   // Forward delete
  | 'format'       // Inline formatting (bold, italic, etc.)
  | 'structural'   // Block-level changes (split, merge)
  | 'paste'        // Paste operation
  | 'cut';         // Cut operation

/**
 * Metadata about a mutation for smart grouping decisions
 */
export interface MutationMetadata {
  /**
   * Type of action that caused this mutation
   */
  actionType?: ActionType;

  /**
   * Text that was inserted (captured by MutationDetector)
   */
  insertedText?: string;

  /**
   * Text that was deleted (captured by MutationDetector)
   */
  deletedText?: string;
}

/**
 * Context about the current action sequence
 */
export interface ActionContext {
  /**
   * The type of action being performed
   */
  type: ActionType;

  /**
   * ID of the block being edited
   */
  blockId: string;

  /**
   * Timestamp when this context started
   */
  timestamp: number;
}
