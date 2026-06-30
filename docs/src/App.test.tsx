import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './contexts/I18nContext';
import { FrameworkProvider } from './contexts/FrameworkContext';

vi.mock('framer-motion', () => {
  // Strip motion-only props so they don't leak onto the DOM element.
  const MOTION_PROPS = new Set([
    'variants',
    'initial',
    'animate',
    'exit',
    'whileHover',
    'whileTap',
    'whileInView',
    'transition',
    'viewport',
    'drag',
    'dragControls',
    'dragListener',
    'dragConstraints',
    'dragElastic',
    'onDragEnd',
  ]);

  // Render any motion.<tag> (div, button, …) as a plain passthrough element.
  const motion = new Proxy(
    {},
    {
      get:
        (_target, tag: string) =>
        ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => {
          const domProps = Object.fromEntries(
            Object.entries(props).filter(([key]) => !MOTION_PROPS.has(key))
          );
          return React.createElement(tag, domProps, children);
        },
    }
  );

  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion,
    useReducedMotion: () => false,
    useDragControls: () => ({ start: () => {} }),
    useInView: () => true,
    useMotionValue: (value: number) => value,
    // A settable stand-in for the spring values used by the tilt cards.
    useSpring: () => ({ set: () => {}, get: () => 0 }),
    useVelocity: () => 0,
    useTransform: () => 0,
    // Settle straight to the target value; no async stepping needed in tests.
    animate: (
      _from: number,
      to: number,
      opts?: { onUpdate?: (value: number) => void }
    ) => {
      opts?.onUpdate?.(to);
      return { stop: () => {} };
    },
  };
});

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

    sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // Restore original history
    Object.defineProperty(window, 'history', {
      value: originalHistory,
      writable: true,
      configurable: true,
    });
    // Tests below mutate window.scrollY; reset it so it can't leak between tests.
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  it('should render HomePage for root path', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
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
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    // ApiPage has a sidebar with data-blok-testid
    const apiSidebar = screen.getByTestId('api-sidebar');
    expect(apiSidebar).toBeInTheDocument();
  });

  it('renders a single API module page at /docs/caret-api', () => {
    render(
      <MemoryRouter initialEntries={['/docs/caret-api']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    // Only the Caret module is rendered — Selection API must not be present
    expect(screen.getByText('Caret API')).toBeInTheDocument();
    expect(screen.queryByText('Selection API')).toBeNull();
  });

  it('should render without crashing', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    // App should render children - verify by checking HomePage content is present
    const heading = screen.getByRole('heading', { name: /block-based editors/i });
    expect(heading).toBeInTheDocument();
  });

  it('should set scrollRestoration to manual so it can restore scroll position itself on reload', () => {
    // Create a mock history with scrollRestoration property
    const mockHistory = {
      ...originalHistory,
      scrollRestoration: 'auto' as 'auto' | 'manual',
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
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    // The app takes manual control because native restoration is unreliable
    // when content renders progressively (animations, lazy sections).
    expect(mockHistory.scrollRestoration).toBe('manual');
  });

  it('should restore the saved scroll position for the current path on reload', () => {
    // Simulate a previous visit to "/" that was scrolled to y=500
    sessionStorage.setItem('blok-docs:scroll:/', '500');

    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 500, left: 0, behavior: 'instant' });
  });

  it('should restore the position saved for the specific path, not another path', () => {
    sessionStorage.setItem('blok-docs:scroll:/', '100');
    sessionStorage.setItem('blok-docs:scroll:/docs', '700');

    render(
      <MemoryRouter initialEntries={['/docs']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 700, left: 0, behavior: 'instant' });
    expect(window.scrollTo).not.toHaveBeenCalledWith({ top: 100, left: 0, behavior: 'instant' });
  });

  it('should not restore when there is no saved position (stay at top)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('should save the current scroll position when the page is hidden (pagehide)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    Object.defineProperty(window, 'scrollY', {
      value: 880,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('pagehide'));

    expect(sessionStorage.getItem('blok-docs:scroll:/')).toBe('880');
  });

  it('should save the current scroll position for the current path while scrolling', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    Object.defineProperty(window, 'scrollY', {
      value: 320,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('scroll'));

    expect(sessionStorage.getItem('blok-docs:scroll:/')).toBe('320');
  });

  it('should not overwrite the saved position with a clamped scroll while it is restoring', () => {
    // A previous visit was deep on the page.
    sessionStorage.setItem('blok-docs:scroll:/', '2000');

    render(
      <MemoryRouter initialEntries={['/']}>
        <I18nProvider>
          <FrameworkProvider>
            <App />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>
    );

    // While the page is still short, the browser clamps our restore scrollTo and
    // fires a scroll event reporting a much smaller offset. That must NOT clobber
    // the target we're trying to restore to.
    Object.defineProperty(window, 'scrollY', {
      value: 40,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('scroll'));

    expect(sessionStorage.getItem('blok-docs:scroll:/')).toBe('2000');
  });
});
