import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { FrameworkProvider, useFramework } from './FrameworkContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={['/docs']}>
    <FrameworkProvider>{children}</FrameworkProvider>
  </MemoryRouter>
);

/** Surfaces the active framework and the live URL search string for assertions. */
const Harness = () => {
  const { framework, setFramework } = useFramework();
  const location = useLocation();
  return (
    <div>
      <span data-blok-testid="framework">{framework}</span>
      <span data-blok-testid="search">{location.search}</span>
      <button onClick={() => setFramework('vue')}>pick vue</button>
      <button onClick={() => setFramework('vanilla')}>pick vanilla</button>
    </div>
  );
};

const renderHarness = (entry = '/docs') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <FrameworkProvider>
        <Harness />
      </FrameworkProvider>
    </MemoryRouter>,
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

  describe('URL persistence', () => {
    it('reads the initial framework from the ?framework query param', () => {
      renderHarness('/docs?framework=vue');
      expect(screen.getByTestId('framework')).toHaveTextContent('vue');
    });

    it('lets the URL param win over localStorage', () => {
      localStorage.setItem('blok-docs-framework', 'react');
      renderHarness('/docs?framework=angular');
      expect(screen.getByTestId('framework')).toHaveTextContent('angular');
    });

    it('falls back to localStorage when the URL has no param', () => {
      localStorage.setItem('blok-docs-framework', 'react');
      renderHarness('/docs');
      expect(screen.getByTestId('framework')).toHaveTextContent('react');
    });

    it('ignores an unknown URL param and falls back to the default', () => {
      renderHarness('/docs?framework=svelte');
      expect(screen.getByTestId('framework')).toHaveTextContent('vanilla');
    });

    it('writes a chosen framework into the URL query param', async () => {
      const user = userEvent.setup();
      renderHarness('/docs');

      await user.click(screen.getByRole('button', { name: 'pick vue' }));

      expect(screen.getByTestId('search')).toHaveTextContent('framework=vue');
      expect(screen.getByTestId('framework')).toHaveTextContent('vue');
    });

    it('drops the param when the default framework is chosen', async () => {
      const user = userEvent.setup();
      renderHarness('/docs?framework=react');

      await user.click(screen.getByRole('button', { name: 'pick vanilla' }));

      expect(screen.getByTestId('search')).not.toHaveTextContent('framework');
      expect(screen.getByTestId('framework')).toHaveTextContent('vanilla');
    });

    it('reflects a restored non-default selection in the URL on mount', async () => {
      localStorage.setItem('blok-docs-framework', 'react');
      renderHarness('/docs');

      // The effect syncs the remembered choice into the address bar.
      await screen.findByText('?framework=react');
      expect(screen.getByTestId('framework')).toHaveTextContent('react');
    });
  });
});
