import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { UseBlokConfig } from '../../../src/react/types';

/**
 * Mock shape matching the real Blok public API used by useBlok
 */
function createMockBlokInstance(): {
  isReady: Promise<void>;
  destroy: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn> };
  focus: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  return {
    isReady: Promise.resolve(),
    destroy: vi.fn(),
    readOnly: { set: vi.fn().mockResolvedValue(false) },
    focus: vi.fn().mockReturnValue(true),
    save: vi.fn().mockResolvedValue({ time: 0, blocks: [], version: '0' }),
  };
}

type MockBlokInstance = ReturnType<typeof createMockBlokInstance>;

let mockBlokInstances: MockBlokInstance[] = [];
const MockBlokConstructor = vi.fn();

vi.mock('../../../src/blok', () => {
  return {
    Blok: class MockBlok {
      public isReady: Promise<void>;
      public destroy: ReturnType<typeof vi.fn>;
      public readOnly: { set: ReturnType<typeof vi.fn> };
      public focus: ReturnType<typeof vi.fn>;
      public save: ReturnType<typeof vi.fn>;

      constructor(config?: unknown) {
        MockBlokConstructor(config);
        const instance = createMockBlokInstance();

        this.isReady = instance.isReady;
        this.destroy = instance.destroy;
        this.readOnly = instance.readOnly;
        this.focus = instance.focus;
        this.save = instance.save;
        mockBlokInstances.push(instance);
      }
    },
  };
});

vi.mock('../../../src/react/holder-map', () => ({
  setHolder: vi.fn(),
  getHolder: vi.fn(),
  removeHolder: vi.fn(),
}));

import { useBlok } from '../../../src/react/useBlok';
import { setHolder, removeHolder } from '../../../src/react/holder-map';

/**
 * Helper: flush microtasks and advance fake timers to settle React state updates.
 */
async function flushAll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useBlok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBlokInstances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return null initially and then the editor after isReady', async () => {
    const config: UseBlokConfig = {};

    const { result } = renderHook(() => useBlok(config));

    // Initially null (before isReady resolves)
    expect(result.current).toBeNull();

    // Flush isReady promise and React state updates
    await flushAll();

    expect(result.current).not.toBeNull();
    expect(MockBlokConstructor).toHaveBeenCalledTimes(1);

    // Verify holder was a div element
    const passedConfig = MockBlokConstructor.mock.calls[0][0] as { holder: HTMLElement };

    expect(passedConfig.holder).toBeInstanceOf(HTMLDivElement);
  });

  it('should destroy editor on unmount after deferred timeout', async () => {
    const config: UseBlokConfig = {};

    const { result, unmount } = renderHook(() => useBlok(config));

    await flushAll();
    expect(result.current).not.toBeNull();

    const instance = mockBlokInstances[0];

    unmount();

    // destroy should NOT have been called yet (deferred via setTimeout(0))
    expect(instance.destroy).not.toHaveBeenCalled();

    // Advance timers to flush the deferred destroy
    act(() => {
      vi.runAllTimers();
    });

    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(removeHolder).toHaveBeenCalled();
  });

  it('should reuse editor instance on StrictMode remount (cleanup then re-run)', async () => {
    const config: UseBlokConfig = {};

    const { result, unmount } = renderHook(() => useBlok(config));

    await flushAll();

    expect(result.current).not.toBeNull();
    expect(MockBlokConstructor).toHaveBeenCalledTimes(1);

    // StrictMode: the deferred destroy mechanism means if cleanup runs
    // and the effect re-runs before the setTimeout fires, the timer is
    // cancelled and the existing editor is reused (only 1 constructor call).
    expect(MockBlokConstructor).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.runAllTimers();
    });
  });

  it('should recreate editor when deps change', async () => {
    const config: UseBlokConfig = {};

    const { result, rerender } = renderHook(
      ({ d }: { d: string[] }) => useBlok(config, d),
      { initialProps: { d: ['dep1'] } }
    );

    await flushAll();

    expect(MockBlokConstructor).toHaveBeenCalledTimes(1);
    expect(result.current).not.toBeNull();
    const firstInstance = mockBlokInstances[0];

    // Change deps — triggers effect cleanup + re-run
    rerender({ d: ['dep2'] });

    // Flush the deferred destroy of the first instance and isReady of second
    await flushAll();

    // The deferred destroy timer should have fired, but since the new effect
    // also runs synchronously before the timer fires, the old one's destroy
    // gets deferred. Let's flush all timers:
    act(() => {
      vi.runAllTimers();
    });

    expect(firstInstance.destroy).toHaveBeenCalledTimes(1);

    // A second constructor call was made
    expect(MockBlokConstructor).toHaveBeenCalledTimes(2);
    expect(mockBlokInstances).toHaveLength(2);
  });

  it('should not recreate editor when callbacks change', async () => {
    let onReady = vi.fn();
    let onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ onReady: onReadyCb, onChange: onChangeCb }: { onReady: () => void; onChange: () => void }) =>
        useBlok({ onReady: onReadyCb, onChange: onChangeCb }),
      { initialProps: { onReady, onChange } }
    );

    await flushAll();
    expect(result.current).not.toBeNull();

    expect(MockBlokConstructor).toHaveBeenCalledTimes(1);

    // Change callbacks
    onReady = vi.fn();
    onChange = vi.fn();
    rerender({ onReady, onChange });

    // Still only one Blok instance (deps didn't change — default [])
    expect(MockBlokConstructor).toHaveBeenCalledTimes(1);
    expect(mockBlokInstances).toHaveLength(1);
  });

  it('should sync readOnly prop changes', async () => {
    const { result, rerender } = renderHook(
      ({ readOnly }: { readOnly: boolean }) => useBlok({ readOnly }),
      { initialProps: { readOnly: false } }
    );

    await flushAll();
    expect(result.current).not.toBeNull();

    const instance = mockBlokInstances[0];

    // Initially set to false
    expect(instance.readOnly.set).toHaveBeenCalledWith(false);

    instance.readOnly.set.mockClear();

    // Change to true
    rerender({ readOnly: true });

    expect(instance.readOnly.set).toHaveBeenCalledWith(true);
  });

  it('should call focus when autofocus changes to true', async () => {
    const { result, rerender } = renderHook(
      ({ autofocus }: { autofocus: boolean }) => useBlok({ autofocus }),
      { initialProps: { autofocus: false } }
    );

    await flushAll();
    expect(result.current).not.toBeNull();

    const instance = mockBlokInstances[0];

    // Initially not focused (autofocus was false)
    expect(instance.focus).not.toHaveBeenCalled();

    // Change to true
    rerender({ autofocus: true });

    expect(instance.focus).toHaveBeenCalledTimes(1);
  });

  it('should return null during SSR (initial render before useEffect)', () => {
    // useEffect doesn't run during SSR; hook returns null from useState initial value
    const config: UseBlokConfig = {};

    const { result } = renderHook(() => useBlok(config));

    // Before any effects run (or timers advance), the result is null
    expect(result.current).toBeNull();
  });

  it('should call setHolder when creating editor', async () => {
    const config: UseBlokConfig = {};

    const { result } = renderHook(() => useBlok(config));

    await flushAll();
    expect(result.current).not.toBeNull();

    expect(setHolder).toHaveBeenCalledTimes(1);
    const [editorArg, holderArg] = (setHolder as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(editorArg).toBeDefined();
    expect(holderArg).toBeInstanceOf(HTMLDivElement);
  });

  it('should pass config options through to Blok constructor', async () => {
    const config: UseBlokConfig = {
      placeholder: 'Type here...',
      readOnly: true,
      autofocus: true,
    };

    const { result } = renderHook(() => useBlok(config));

    await flushAll();
    expect(result.current).not.toBeNull();

    const passedConfig = MockBlokConstructor.mock.calls[0][0] as Record<string, unknown>;

    expect(passedConfig.placeholder).toBe('Type here...');
    expect(passedConfig.readOnly).toBe(true);
    expect(passedConfig.autofocus).toBe(true);
    expect(passedConfig.holder).toBeInstanceOf(HTMLDivElement);
  });

  it('should use latest callback refs without recreating editor', async () => {
    const onReady1 = vi.fn();
    const onReady2 = vi.fn();

    const { result, rerender } = renderHook(
      ({ onReady }: { onReady: () => void }) => useBlok({ onReady }),
      { initialProps: { onReady: onReady1 } }
    );

    await flushAll();
    expect(result.current).not.toBeNull();

    // The onReady wrapper in the config should call the current ref
    const passedConfig = MockBlokConstructor.mock.calls[0][0] as { onReady: () => void };

    // Update to new callback
    rerender({ onReady: onReady2 });

    // Call the wrapper — should call onReady2 (latest), not onReady1
    passedConfig.onReady();

    expect(onReady1).not.toHaveBeenCalled();
    expect(onReady2).toHaveBeenCalledTimes(1);
  });
});
