import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../contexts/I18nContext';
import { CategoryBar, type HomeView } from './CategoryBar';

const renderBar = (
  activeView: HomeView = 'getStarted',
  onSelect = vi.fn(),
  locale: 'en' | 'ru' = 'en',
) => {
  render(
    <MemoryRouter>
      <I18nProvider locale={locale}>
        <CategoryBar activeView={activeView} onSelect={onSelect} />
      </I18nProvider>
    </MemoryRouter>
  );
  return onSelect;
};

describe('CategoryBar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders a navigation landmark labelled for browsing the docs', () => {
    renderBar();
    expect(
      screen.getByRole('navigation', { name: /browse the documentation/i })
    ).toBeInTheDocument();
  });

  it('renders every category as a real anchor pointing at its own route', () => {
    renderBar();

    // Google discovers links only through <a href>. Each pill therefore has to
    // carry the address of the route that serves the same content, even though
    // a plain click swaps the panel in place instead of navigating.
    const expected: [RegExp, string][] = [
      [/get started/i, '/'],
      [/^docs$/i, '/docs'],
      [/^playground$/i, '/demo'],
      [/^migration$/i, '/migration'],
      [/^changelog$/i, '/changelog'],
    ];

    expected.forEach(([name, href]) => {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    });
  });

  it('does not render the tools, recipes, or integrations categories', () => {
    renderBar();
    expect(screen.queryByRole('link', { name: /^tools$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^recipes$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^integrations$/i })).not.toBeInTheDocument();
  });

  it('calls onSelect with the view when a pill is clicked', () => {
    const onSelect = renderBar('getStarted');
    fireEvent.click(screen.getByRole('link', { name: /^playground$/i }));
    expect(onSelect).toHaveBeenCalledWith('playground');
  });

  it('leaves a modified click to the browser so the route can open in a new tab', () => {
    const onSelect = renderBar('getStarted');
    fireEvent.click(screen.getByRole('link', { name: /^playground$/i }), { metaKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks the active view as the current page and others as not', () => {
    renderBar('playground');
    expect(screen.getByRole('link', { name: /^playground$/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: /^migration$/i })).not.toHaveAttribute('aria-current');
  });

  it('marks "Get started" as the current page when it is the active view', () => {
    renderBar('getStarted');
    expect(screen.getByRole('link', { name: /get started/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('does not scroll the active pill into view on initial mount', () => {
    // scrollIntoView bubbles to the window's scroll position, so firing it on
    // mount would yank the page to the category bar and fight scroll restoration
    // on reload. It must only react to actual selection changes.
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');

    renderBar('getStarted');

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls the active pill into view when the selection changes', () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');

    const { rerender } = render(
      <MemoryRouter>
        <I18nProvider>
          <CategoryBar activeView="getStarted" onSelect={vi.fn()} />
        </I18nProvider>
      </MemoryRouter>
    );

    scrollIntoView.mockClear();

    rerender(
      <MemoryRouter>
        <I18nProvider>
          <CategoryBar activeView="changelog" onSelect={vi.fn()} />
        </I18nProvider>
      </MemoryRouter>
    );

    // The newly-active pill is brought into the visible scroll window so the
    // current view is never hidden off-screen on a narrow viewport.
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('renders translated labels in Russian', () => {
    renderBar('getStarted', vi.fn(), 'ru');
    expect(screen.getByRole('link', { name: /начало работы/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^документация$/i })).toBeInTheDocument();
  });
});
