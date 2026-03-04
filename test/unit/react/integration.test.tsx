import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, within, fireEvent } from '@testing-library/react';
import React, { useState, createRef } from 'react';
import { useBlok } from '../../../src/react/useBlok';
import { BlokContent } from '../../../src/react/BlokContent';
import type { UseBlokConfig } from '../../../src/react/types';

interface MockBlokInstance {
  isReady: Promise<void>;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

let mockBlokInstances: MockBlokInstance[] = [];

vi.mock('../../../src/blok', () => {
  return {
    Blok: class MockBlok {
      public isReady: Promise<void>;
      public destroy: ReturnType<typeof vi.fn>;
      public readOnly: { set: ReturnType<typeof vi.fn> };
      public focus: ReturnType<typeof vi.fn>;
      public save: ReturnType<typeof vi.fn>;
      public clear: ReturnType<typeof vi.fn>;

      constructor(config: { holder: HTMLElement }) {
        // Simulate Blok building DOM inside the holder
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-blok-editor', 'true');
        wrapper.textContent = 'Editor loaded';
        config.holder.appendChild(wrapper);

        this.isReady = Promise.resolve();
        this.destroy = vi.fn();
        this.readOnly = { set: vi.fn().mockResolvedValue(true) };
        this.focus = vi.fn().mockReturnValue(true);
        this.save = vi.fn().mockResolvedValue({ blocks: [] });
        this.clear = vi.fn();

        mockBlokInstances.push(this);
      }
    },
  };
});

function TestEditor({ config }: { config: UseBlokConfig }) {
  const editor = useBlok(config);

  return (
    <div>
      <div data-testid="status">{editor ? 'ready' : 'loading'}</div>
      <button data-testid="save" onClick={() => editor?.save()}>Save</button>
      <BlokContent editor={editor} data-testid="editor-container" />
    </div>
  );
}

function TestEditorWithDeps({ config, d }: { config: UseBlokConfig; d: string[] }) {
  const editor = useBlok(config, d);

  return (
    <div>
      <div data-testid="status">{editor ? 'ready' : 'loading'}</div>
      <BlokContent editor={editor} data-testid="editor-container" />
    </div>
  );
}

describe('React adapter integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBlokInstances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Helper: flush microtasks and advance fake timers to settle React state updates.
   */
  async function flushAll(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('should render editor content inside BlokContent', async () => {
    render(<TestEditor config={{ tools: {} }} />);

    // Initially loading
    expect(screen.getByTestId('status').textContent).toBe('loading');

    // After init
    await flushAll();
    expect(screen.getByTestId('status').textContent).toBe('ready');

    // Editor DOM should be visible inside the container
    const container = screen.getByTestId('editor-container');
    expect(within(container).getByText('Editor loaded')).toBeInTheDocument();
  });

  it('should allow calling editor.save() via the returned instance', async () => {
    render(<TestEditor config={{ tools: {} }} />);

    await flushAll();
    expect(screen.getByTestId('status').textContent).toBe('ready');

    // Click save
    fireEvent.click(screen.getByTestId('save'));

    // The last created instance is the one exposed to the component
    const activeInstance = mockBlokInstances[mockBlokInstances.length - 1];
    expect(activeInstance.save).toHaveBeenCalledOnce();
  });

  it('should destroy editor on unmount', async () => {
    const { unmount } = render(<TestEditor config={{ tools: {} }} />);

    await flushAll();
    expect(screen.getByTestId('status').textContent).toBe('ready');

    // The last created instance is the active editor
    const activeInstance = mockBlokInstances[mockBlokInstances.length - 1];
    expect(activeInstance.destroy).not.toHaveBeenCalled();

    unmount();

    // Deferred destroy — need to advance timers past setTimeout(0)
    act(() => {
      vi.runAllTimers();
    });

    expect(activeInstance.destroy).toHaveBeenCalledOnce();
  });

  it('should swap holder DOM in BlokContent when deps change', async () => {
    function Wrapper() {
      const [deps, setDeps] = useState(['dep1']);

      return (
        <div>
          <button data-testid="change-deps" onClick={() => setDeps(['dep2'])}>Change</button>
          <TestEditorWithDeps config={{ tools: {} }} d={deps} />
        </div>
      );
    }

    render(<Wrapper />);

    // Initially loading, then ready after first editor initialises
    await flushAll();
    expect(screen.getByTestId('status').textContent).toBe('ready');

    // First editor instance created — its holder should be in the container
    expect(mockBlokInstances).toHaveLength(1);
    const container = screen.getByTestId('editor-container');
    expect(within(container).getByText('Editor loaded')).toBeInTheDocument();

    // Capture the first holder's wrapper element so we can check it is detached later
    // eslint-disable-next-line testing-library/no-node-access
    const firstWrapper = container.querySelector('[data-blok-editor="true"]');
    expect(firstWrapper).not.toBeNull();

    // Change deps — triggers editor recreation
    fireEvent.click(screen.getByTestId('change-deps'));
    await flushAll();

    // A second editor instance should have been created
    expect(mockBlokInstances).toHaveLength(2);

    // Status should be ready again (new editor is ready)
    expect(screen.getByTestId('status').textContent).toBe('ready');

    // The container should contain the new editor's DOM
    expect(within(container).getByText('Editor loaded')).toBeInTheDocument();

    // The old holder's wrapper should no longer be in the document
    expect(document.contains(firstWrapper)).toBe(false);

    // The new holder's wrapper should be the one now inside the container
    // eslint-disable-next-line testing-library/no-node-access
    const newWrapper = container.querySelector('[data-blok-editor="true"]');
    expect(newWrapper).not.toBeNull();
    expect(newWrapper).not.toBe(firstWrapper);
  });

  it('should cycle through loading → ready → loading → ready when deps change', async () => {
    const statusHistory: string[] = [];

    function TrackingEditorWithDeps({ config, d }: { config: UseBlokConfig; d: string[] }) {
      const editor = useBlok(config, d);
      const status = editor ? 'ready' : 'loading';

      // Record every distinct status change
      const lastRecorded = statusHistory[statusHistory.length - 1];
      if (lastRecorded !== status) {
        statusHistory.push(status);
      }

      return (
        <div>
          <div data-testid="status">{status}</div>
          <BlokContent editor={editor} data-testid="editor-container" />
        </div>
      );
    }

    function Wrapper() {
      const [deps, setDeps] = useState(['dep1']);

      return (
        <div>
          <button data-testid="change-deps" onClick={() => setDeps(['dep2'])}>Change</button>
          <TrackingEditorWithDeps config={{ tools: {} }} d={deps} />
        </div>
      );
    }

    render(<Wrapper />);

    // Initial loading → ready
    await flushAll();
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(mockBlokInstances).toHaveLength(1);

    // Trigger deps change — should go loading → ready again
    fireEvent.click(screen.getByTestId('change-deps'));
    await flushAll();

    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(mockBlokInstances).toHaveLength(2);

    // Full cycle recorded: loading, ready, loading, ready
    expect(statusHistory).toEqual(['loading', 'ready', 'loading', 'ready']);
  });

  it('should forward ref to the container div in BlokContent', async () => {
    const containerRef = createRef<HTMLDivElement>();

    function RefTestEditor() {
      const editor = useBlok({ tools: {} });

      return <BlokContent editor={editor} ref={containerRef} data-testid="editor-container" />;
    }

    render(<RefTestEditor />);

    await flushAll();

    // The forwarded ref should point to the rendered container div
    expect(containerRef.current).not.toBeNull();
    expect(containerRef.current).toBe(screen.getByTestId('editor-container'));
    expect(containerRef.current).toBeInstanceOf(HTMLDivElement);
  });
});
