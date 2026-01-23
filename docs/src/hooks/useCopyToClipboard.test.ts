import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCopyToClipboard } from './useCopyToClipboard';

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return copyToClipboard function and isCopied state', () => {
    const { result } = renderHook(() => useCopyToClipboard());

    expect(result.current).toHaveProperty('copyToClipboard');
    expect(result.current).toHaveProperty('isCopied');
    expect(typeof result.current.copyToClipboard).toBe('function');
    expect(typeof result.current.isCopied).toBe('boolean');
  });

  it('should initialize with isCopied as false', () => {
    const { result } = renderHook(() => useCopyToClipboard());

    expect(result.current.isCopied).toBe(false);
  });

  it('should set isCopied to true after successful clipboard write', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard('test text');
    });

    expect(mockWriteText).toHaveBeenCalledWith('test text');
    expect(result.current.isCopied).toBe(true);
  });

  it('should reset isCopied to false after 2 seconds', async () => {
    vi.useFakeTimers();

    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard('test text');
    });

    expect(result.current.isCopied).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.isCopied).toBe(false);

    vi.useRealTimers();
  });

  it('should return true when clipboard write succeeds', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    const { result } = renderHook(() => useCopyToClipboard());

    let success = false;
    await act(async () => {
      success = await result.current.copyToClipboard('test text');
    });

    expect(success).toBe(true);
  });

  it('should use fallback method when clipboard API fails', async () => {
    // Mock clipboard API to throw error
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Not allowed')),
      },
    });

    // Mock document.execCommand for fallback
    const mockExecCommand = vi.fn().mockReturnValue(true);
    document.execCommand = mockExecCommand;

    const { result } = renderHook(() => useCopyToClipboard());

    let success = false;
    await act(async () => {
      success = await result.current.copyToClipboard('test text');
    });

    expect(success).toBe(true);
    expect(result.current.isCopied).toBe(true);
  });

  it('should return false when both methods fail', async () => {
    // Mock clipboard API to throw error
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Not allowed')),
      },
    });

    // Mock document.execCommand to return false
    const mockExecCommand = vi.fn().mockReturnValue(false);
    document.execCommand = mockExecCommand;

    const { result } = renderHook(() => useCopyToClipboard());

    let success = false;
    await act(async () => {
      success = await result.current.copyToClipboard('test text');
    });

    expect(success).toBe(false);
    expect(result.current.isCopied).toBe(false);
  });

  it('should clean up textarea element in fallback method', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Not allowed')),
      },
    });

    const mockExecCommand = vi.fn().mockReturnValue(true);
    document.execCommand = mockExecCommand;

    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard('test text');
    });

    // Check that textarea was cleaned up (should not have any textarea in body)
    const textareas = document.body.querySelectorAll('textarea');
    expect(textareas.length).toBe(0);
  });
});
