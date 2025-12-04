import { useState, useEffect, useCallback, useMemo } from 'react';
import { useEditor, useEditorEvent } from '../EditorContext';
import { HistoryStateChanged } from '../../events';

/**
 * Return type for useHistory hook
 */
export interface UseHistoryReturn {
  /**
   * Performs undo operation
   * @returns Promise resolving to true if undo was performed
   */
  undo: () => Promise<boolean>;

  /**
   * Performs redo operation
   * @returns Promise resolving to true if redo was performed
   */
  redo: () => Promise<boolean>;

  /**
   * Whether undo is currently available
   */
  canUndo: boolean;

  /**
   * Whether redo is currently available
   */
  canRedo: boolean;

  /**
   * Clears the history stacks
   */
  clear: () => void;
}

/**
 * React hook for accessing undo/redo functionality
 *
 * Provides reactive state that updates when history changes,
 * enabling UI components to show proper button states.
 *
 * @example
 * ```tsx
 * function UndoRedoButtons() {
 *   const { undo, redo, canUndo, canRedo } = useHistory();
 *
 *   return (
 *     <>
 *       <button onClick={undo} disabled={!canUndo}>Undo</button>
 *       <button onClick={redo} disabled={!canRedo}>Redo</button>
 *     </>
 *   );
 * }
 * ```
 */
export const useHistory = (): UseHistoryReturn => {
  const { modules } = useEditor();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Subscribe to history state changes
  useEditorEvent(HistoryStateChanged, (payload) => {
    setCanUndo(payload.canUndo);
    setCanRedo(payload.canRedo);
  });

  // Initialize state from current history state
  useEffect(() => {
    if (modules.History) {
      setCanUndo(modules.History.canUndo());
      setCanRedo(modules.History.canRedo());
    }
  }, [modules.History]);

  // Memoize action callbacks
  const undo = useCallback(async (): Promise<boolean> => {
    if (modules.History) {
      return modules.History.undo();
    }

    return false;
  }, [modules.History]);

  const redo = useCallback(async (): Promise<boolean> => {
    if (modules.History) {
      return modules.History.redo();
    }

    return false;
  }, [modules.History]);

  const clear = useCallback((): void => {
    if (modules.History) {
      modules.History.clear();
    }
  }, [modules.History]);

  return useMemo(() => ({
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
  }), [undo, redo, canUndo, canRedo, clear]);
};
