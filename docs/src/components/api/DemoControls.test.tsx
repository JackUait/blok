import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoControls } from './DemoControls';
import type { DemoAction } from './api-data';

describe('DemoControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockEditor = {
    blocks: {
      move: vi.fn(),
      clear: vi.fn(),
    },
  } as unknown;

  const mockActions: DemoAction[] = [
    {
      label: 'Move first to last',
      execute: vi.fn().mockResolvedValue(undefined),
      expectedOutput: 'Moved block from index 0 to index 2',
    },
    {
      label: 'Clear all',
      execute: vi.fn().mockResolvedValue(undefined),
      expectedOutput: 'All blocks cleared',
    },
  ];

  it('should render all action buttons', () => {
    render(
      <DemoControls
        actions={mockActions}
        editor={mockEditor}
        onOutputChange={vi.fn()}
      />
    );

    expect(screen.getByText('Move first to last')).toBeInTheDocument();
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('should call execute function when button is clicked', async () => {
    const onOutputChange = vi.fn();
    render(
      <DemoControls
        actions={mockActions}
        editor={mockEditor}
        onOutputChange={onOutputChange}
      />
    );

    const button = screen.getByText('Move first to last');
    await userEvent.click(button);

    await waitFor(() => {
      expect(mockActions[0].execute).toHaveBeenCalledWith(mockEditor);
    });
  });

  it('should show loading state during async execution', async () => {
    let resolveExecution: (value: void) => void;
    const slowAction: DemoAction = {
      label: 'Slow action',
      execute: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveExecution = resolve;
          })
      ),
    };

    render(
      <DemoControls
        actions={[slowAction]}
        editor={mockEditor}
        onOutputChange={vi.fn()}
      />
    );

    const button = screen.getByText('Slow action');
    await userEvent.click(button);

    // Should show loading state
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    // Resolve the action
    resolveExecution!();

    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  it('should call onOutputChange with success message after execution', async () => {
    const onOutputChange = vi.fn();
    render(
      <DemoControls
        actions={mockActions}
        editor={mockEditor}
        onOutputChange={onOutputChange}
      />
    );

    const button = screen.getByText('Move first to last');
    await userEvent.click(button);

    await waitFor(() => {
      expect(onOutputChange).toHaveBeenCalledWith({
        message: 'Moved block from index 0 to index 2',
        type: 'success',
      });
    });
  });

  it('should call onOutputChange with error message when execution fails', async () => {
    const errorAction: DemoAction = {
      label: 'Failing action',
      execute: vi.fn().mockRejectedValue(new Error('Test error')),
    };

    const onOutputChange = vi.fn();
    render(
      <DemoControls
        actions={[errorAction]}
        editor={mockEditor}
        onOutputChange={onOutputChange}
      />
    );

    const button = screen.getByText('Failing action');
    await userEvent.click(button);

    await waitFor(() => {
      expect(onOutputChange).toHaveBeenCalledWith({
        message: 'Test error',
        type: 'error',
      });
    });
  });

  it('should render reset button when onReset is provided', () => {
    render(
      <DemoControls
        actions={mockActions}
        editor={mockEditor}
        onOutputChange={vi.fn()}
        onReset={vi.fn()}
      />
    );

    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('should clear output when reset button is clicked', async () => {
    const onOutputChange = vi.fn();
    render(
      <DemoControls
        actions={mockActions}
        editor={mockEditor}
        onOutputChange={onOutputChange}
        onReset={vi.fn()}
      />
    );

    const resetButton = screen.getByText('Reset');
    await userEvent.click(resetButton);

    expect(onOutputChange).toHaveBeenCalledWith(null);
  });

  it('should not render reset button when onReset is not provided', () => {
    render(
      <DemoControls
        actions={mockActions}
        editor={mockEditor}
        onOutputChange={vi.fn()}
      />
    );

    expect(screen.queryByText('Reset')).not.toBeInTheDocument();
  });
});
