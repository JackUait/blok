import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
    expect(container.querySelector('[data-blok-editor]')).not.toBeNull();
  });

  it('should allow calling editor.save() via the returned instance', async () => {
    render(<TestEditor config={{ tools: {} }} />);

    await flushAll();
    expect(screen.getByTestId('status').textContent).toBe('ready');

    // Click save
    screen.getByTestId('save').click();

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
});
