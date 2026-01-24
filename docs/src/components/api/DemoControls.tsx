import type { FC } from 'react';
import { useState, useCallback } from 'react';
import type { DemoAction } from './api-data';

export interface DemoControlsProps {
  actions: DemoAction[];
  editor: unknown;
  onOutputChange: (output: { message: string; type: 'success' | 'error' } | null) => void;
  onReset?: () => void;
}

/**
 * Renders buttons for demo actions and handles their execution
 * Shows loading state during async operations and displays output
 */
export const DemoControls: FC<DemoControlsProps> = ({
  actions,
  editor,
  onOutputChange,
  onReset,
}) => {
  const [executingIndex, setExecutingIndex] = useState<number | null>(null);

  const handleAction = useCallback(
    async (action: DemoAction, index: number) => {
      setExecutingIndex(index);
      onOutputChange(null);

      try {
        await action.execute(editor);
        onOutputChange({
          message: action.expectedOutput ?? 'Action completed',
          type: 'success',
        });
      } catch (error) {
        onOutputChange({
          message: error instanceof Error ? error.message : 'An error occurred',
          type: 'error',
        });
      } finally {
        setExecutingIndex(null);
      }
    },
    [editor, onOutputChange]
  );

  const handleReset = useCallback(() => {
    onReset?.();
    onOutputChange(null);
  }, [onReset, onOutputChange]);

  return (
    <div className="api-demo-controls">
      <div className="api-demo-actions">
        {actions.map((action, index) => (
          <button
            key={index}
            type="button"
            className="api-demo-action-btn"
            onClick={() => handleAction(action, index)}
            disabled={executingIndex !== null}
          >
            {executingIndex === index ? (
              <span className="api-demo-loading">Loading…</span>
            ) : (
              action.label
            )}
          </button>
        ))}
      </div>
      {onReset && (
        <button
          type="button"
          className="api-demo-reset-btn"
          onClick={handleReset}
          disabled={executingIndex !== null}
        >
          Reset
        </button>
      )}
    </div>
  );
};
