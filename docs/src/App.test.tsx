import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './contexts/I18nContext';

describe('App', () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  let originalHistory: History;

  beforeEach(() => {
    // Mock scrollIntoView for testing
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock as unknown as typeof Element.prototype.scrollIntoView;
    // Mock window.scrollTo
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

    // Store original history for scrollRestoration testing
    originalHistory = window.history;
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restore original history
    Object.defineProperty(window, 'history', {
      value: originalHistory,
      writable: true,
      configurable: true,
    });
  });

  it('should render HomePage for root path', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </MemoryRouter>
    );

    // HomePage renders Hero component with specific text content
    const heading = screen.getByRole('heading', { name: /block-based editors/i });
    expect(heading).toBeInTheDocument();
  });

  it('should render ApiPage for /docs path', () => {
    render(
      <MemoryRouter initialEntries={['/docs']}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </MemoryRouter>
    );

    // ApiPage has a sidebar with data-blok-testid
    const apiSidebar = screen.getByTestId('api-sidebar');
    expect(apiSidebar).toBeInTheDocument();
  });

  it('should render without crashing', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </MemoryRouter>
    );

    // App should render children - verify by checking HomePage content is present
    const heading = screen.getByRole('heading', { name: /block-based editors/i });
    expect(heading).toBeInTheDocument();
  });

  it('should set scrollRestoration to auto to preserve scroll position on reload', () => {
    // Create a mock history with scrollRestoration property
    const mockHistory = {
      ...originalHistory,
      scrollRestoration: 'manual' as 'auto' | 'manual',
    };

    // Override global history
    Object.defineProperty(window, 'history', {
      value: mockHistory,
      writable: true,
      configurable: true,
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </MemoryRouter>
    );

    // After app renders, scrollRestoration should be set to 'auto'
    expect(mockHistory.scrollRestoration).toBe('auto');
  });
});
