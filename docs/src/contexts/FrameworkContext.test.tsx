import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FrameworkProvider, useFramework } from './FrameworkContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <FrameworkProvider>{children}</FrameworkProvider>
);

describe('FrameworkContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useFramework())).toThrow(
      'useFramework must be used within a FrameworkProvider',
    );
  });

  it('defaults to vanilla', () => {
    const { result } = renderHook(() => useFramework(), { wrapper });
    expect(result.current.framework).toBe('vanilla');
  });

  it('switches the active framework', () => {
    const { result } = renderHook(() => useFramework(), { wrapper });

    act(() => {
      result.current.setFramework('react');
    });

    expect(result.current.framework).toBe('react');
  });

  it('persists the selection to localStorage', () => {
    const { result } = renderHook(() => useFramework(), { wrapper });

    act(() => {
      result.current.setFramework('vue');
    });

    expect(localStorage.getItem('blok-docs-framework')).toBe('vue');
  });

  it('restores a persisted selection on mount', () => {
    localStorage.setItem('blok-docs-framework', 'angular');
    const { result } = renderHook(() => useFramework(), { wrapper });
    expect(result.current.framework).toBe('angular');
  });

  it('ignores an unknown persisted value and falls back to vanilla', () => {
    localStorage.setItem('blok-docs-framework', 'svelte');
    const { result } = renderHook(() => useFramework(), { wrapper });
    expect(result.current.framework).toBe('vanilla');
  });
});
