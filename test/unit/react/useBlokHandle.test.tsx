import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlokHandle } from '../../../packages/react/src/useBlokHandle';
import type { Blok } from '../../../types';

interface MockInstance {
  focus: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  readOnly: { set: ReturnType<typeof vi.fn>; isEnabled: boolean };
}

const createMockInstance = (): MockInstance => ({
  focus: vi.fn(() => true),
  save: vi.fn(async () => ({ blocks: [] })),
  clear: vi.fn(async () => undefined),
  render: vi.fn(async () => undefined),
  readOnly: { set: vi.fn(async () => true), isEnabled: false },
});

describe('useBlokHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('before the editor is ready (ref never populated)', () => {
    it('reports not ready with a null instance', () => {
      const { result } = renderHook(() => useBlokHandle());

      expect(result.current.isReady).toBe(false);
      expect(result.current.current).toBeNull();
    });

    it('exposes a null-safe API that never throws', async () => {
      const { result } = renderHook(() => useBlokHandle());
      const handle = result.current;

      expect(() => handle.focus()).not.toThrow();
      expect(handle.focus()).toBe(false);
      await expect(handle.save()).resolves.toBeNull();
      await expect(handle.clear()).resolves.toBeUndefined();
      await expect(handle.render({ blocks: [] })).resolves.toBeUndefined();
      await expect(handle.setReadOnly(true)).resolves.toBe(false);
    });
  });

  describe('once the ref is populated with the live instance', () => {
    it('reports ready and exposes the instance', () => {
      const { result } = renderHook(() => useBlokHandle());
      const instance = createMockInstance();

      act(() => {
        result.current.ref(instance as unknown as Blok);
      });

      expect(result.current.isReady).toBe(true);
      expect(result.current.current).toBe(instance as unknown as Blok);
    });

    it('delegates each method to the live instance', async () => {
      const { result } = renderHook(() => useBlokHandle());
      const instance = createMockInstance();

      act(() => {
        result.current.ref(instance as unknown as Blok);
      });

      const handle = result.current;
      const data = { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] };

      expect(handle.focus(true)).toBe(true);
      expect(instance.focus).toHaveBeenCalledWith(true);

      await handle.save();
      expect(instance.save).toHaveBeenCalledTimes(1);

      await handle.clear();
      expect(instance.clear).toHaveBeenCalledTimes(1);

      await handle.render(data);
      expect(instance.render).toHaveBeenCalledWith(data);

      await handle.setReadOnly(true);
      expect(instance.readOnly.set).toHaveBeenCalledWith(true);
    });

    it('toggles read-only against the current state when no argument is given', async () => {
      const { result } = renderHook(() => useBlokHandle());
      const instance = createMockInstance();

      instance.readOnly.isEnabled = false;

      act(() => {
        result.current.ref(instance as unknown as Blok);
      });

      await result.current.setReadOnly();

      // Omitted arg flips the current state (false → true) via the non-deprecated set().
      expect(instance.readOnly.set).toHaveBeenCalledWith(true);
    });

    it('goes back to null-safe no-ops after the ref clears (unmount / recreate)', async () => {
      const { result } = renderHook(() => useBlokHandle());
      const instance = createMockInstance();

      act(() => {
        result.current.ref(instance as unknown as Blok);
      });
      act(() => {
        result.current.ref(null);
      });

      expect(result.current.isReady).toBe(false);
      expect(result.current.current).toBeNull();
      await expect(result.current.save()).resolves.toBeNull();
    });
  });

  it('returns a stable handle and ref across re-renders', () => {
    const { result, rerender } = renderHook(() => useBlokHandle());
    const first = result.current;
    const firstRef = result.current.ref;

    rerender();

    expect(result.current).toBe(first);
    expect(result.current.ref).toBe(firstRef);
  });
});
