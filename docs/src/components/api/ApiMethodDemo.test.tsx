import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiMethodDemo } from './ApiMethodDemo';
import type { DemoConfig } from './api-data';

// Mock the MiniBlokEditor component
vi.mock('./MiniBlokEditor', () => ({
  MiniBlokEditor: ({ onEditorReady }: { onEditorReady?: (editor: unknown) => void }) => {
    // Simulate editor initialization
    setTimeout(() => {
      if (onEditorReady) {
        onEditorReady({
          blocks: {
            getBlocksCount: () => 3,
          },
        });
      }
    }, 0);
    return <div data-testid="mini-blok-editor">Mock Editor</div>;
  },
}));

describe('ApiMethodDemo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const demoConfig: DemoConfig = {
    actions: [
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
    ],
  };

  it('should render when demo config is provided', () => {
    render(<ApiMethodDemo demo={demoConfig} />);

    expect(screen.getByTestId('mini-blok-editor')).toBeInTheDocument();
  });

  it('should render demo controls with actions', () => {
    render(<ApiMethodDemo demo={demoConfig} />);

    expect(screen.getByText('Move first to last')).toBeInTheDocument();
    expect(screen.getByText('Clear all')).toBeInTheDocument();
  });

  it('should render reset button', () => {
    render(<ApiMethodDemo demo={demoConfig} />);

    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('should not render when demo config is not provided', () => {
    const { container } = render(<ApiMethodDemo />);
    expect(container.firstChild).toBe(null);
  });
});
