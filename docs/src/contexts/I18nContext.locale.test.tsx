import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider, StoredLocaleRedirect, useI18n, useLocalePath } from './I18nContext';

const STORAGE_KEY = 'blok-docs-locale';

const CurrentPath = () => <span data-blok-testid="path">{useLocation().pathname}</span>;

const renderRedirect = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <StoredLocaleRedirect />
      <CurrentPath />
    </MemoryRouter>,
  );

describe('locale as route state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('takes the locale the route resolved to', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <I18nProvider locale="ru">{children}</I18nProvider>
    );
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe('ru');
    expect(result.current.t('nav.docs')).toBe('Документация');
  });

  it('ignores a stored preference, so a crawler and a returning reader see the same page', () => {
    localStorage.setItem(STORAGE_KEY, 'ru');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <I18nProvider locale="en">{children}</I18nProvider>
    );
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe('en');
  });

  it('records a choice as a hint without overriding the route', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <I18nProvider locale="en">{children}</I18nProvider>
    );
    const { result } = renderHook(() => useI18n(), { wrapper });

    act(() => {
      result.current.setLocale('ru');
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('ru');
    expect(result.current.locale).toBe('en');
  });
});

describe('useLocalePath', () => {
  const renderAt = (path: string) => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    );
    return renderHook(() => useLocalePath(), { wrapper });
  };

  it('maps the current page onto its twin in the other locale', () => {
    expect(renderAt('/docs/table').result.current('ru')).toBe('/ru/docs/table');
    expect(renderAt('/ru/docs/table').result.current('en')).toBe('/docs/table');
  });

  it('keeps the site root free of a trailing slash', () => {
    expect(renderAt('/').result.current('ru')).toBe('/ru');
    expect(renderAt('/ru').result.current('en')).toBe('/');
  });
});

describe('StoredLocaleRedirect', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('sends a reader who previously chose Russian from the site root to /ru', () => {
    localStorage.setItem(STORAGE_KEY, 'ru');
    renderRedirect('/');
    expect(screen.getByTestId('path')).toHaveTextContent('/ru');
  });

  it('leaves the site root alone with no stored choice, which is every crawler', () => {
    renderRedirect('/');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
    expect(screen.getByTestId('path').textContent).toBe('/');
  });

  it('never moves a visitor off a URL they asked for', () => {
    localStorage.setItem(STORAGE_KEY, 'ru');
    renderRedirect('/docs/table');
    expect(screen.getByTestId('path')).toHaveTextContent('/docs/table');
  });

  it('cannot loop: the Russian root is already the destination', () => {
    localStorage.setItem(STORAGE_KEY, 'ru');
    renderRedirect('/ru');
    expect(screen.getByTestId('path').textContent).toBe('/ru');
  });

  it('ignores a stored value that is not a locale', () => {
    localStorage.setItem(STORAGE_KEY, 'klingon');
    renderRedirect('/');
    expect(screen.getByTestId('path').textContent).toBe('/');
  });
});

describe('document language', () => {
  it('follows the route locale for client-side navigation', () => {
    render(
      <MemoryRouter initialEntries={['/ru']}>
        <Routes>
          <Route
            path="/ru"
            element={
              <I18nProvider locale="ru">
                <span>ru</span>
              </I18nProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.documentElement.lang).toBe('ru');
  });
});
