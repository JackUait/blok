import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Nav } from './Nav';
import { I18nProvider } from '../../contexts/I18nContext';
import type { NavLink } from '@/types/navigation';

const mockLinks: NavLink[] = [
  { href: '/docs', label: 'Docs' },
  { href: '/demo', label: 'Demo' },
  { href: '/migration', label: 'Migration' },
  { href: 'https://example.com/external', label: 'External', external: true },
];

const mockLinksWithI18nKeys: NavLink[] = [
  { href: '/docs', label: 'Docs', i18nKey: 'nav.docs' },
  { href: '/demo', label: 'Demo', i18nKey: 'nav.demo' },
  { href: '/migration', label: 'Migration', i18nKey: 'nav.migration' },
];

const TestWrapper: React.FC<{
  children: React.ReactNode;
  initialPath?: string;
  locale?: 'en' | 'ru';
}> = ({ children, initialPath = '/', locale = 'en' }) => (
  <MemoryRouter initialEntries={[initialPath]}>
    <I18nProvider locale={locale}>{children}</I18nProvider>
  </MemoryRouter>
);

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

describe('Nav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (window as GtagWindow).gtag = vi.fn();
  });

  afterEach(() => {
    delete (window as GtagWindow).gtag;
    vi.restoreAllMocks();
  });

  it('should render a nav element', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });

  it('should render all provided links', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('Migration')).toBeInTheDocument();
    expect(screen.getByText('External')).toBeInTheDocument();
  });

  it('should render the Logo component', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    // Logo renders as an img element with alt="Blok"
    const logo = screen.getByRole('img', { name: 'Blok' });
    expect(logo).toBeInTheDocument();
  });

  it('should mark the active link based on current path', () => {
    render(
      <TestWrapper initialPath="/demo">
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const demoLink = screen.getByText('Demo');
    expect(demoLink).toBeInTheDocument();
  });

  it('should render external links with anchor tags', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    // External links live in the account menu dropdown — open it first
    fireEvent.click(screen.getByLabelText('Toggle menu'));

    const externalLink = screen.getByRole('link', { name: 'External' });
    expect(externalLink).toHaveAttribute('href', 'https://example.com/external');
    expect(externalLink).toHaveAttribute('target', '_blank');
    expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should render a mobile menu toggle button', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const toggleButton = screen.getByLabelText('Toggle menu');
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('type', 'button');
  });

  it('should have data-nav attribute', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('data-nav');
  });

  it('should have data-nav-toggle attribute on toggle button', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    const toggleButton = screen.getByLabelText('Toggle menu');
    expect(toggleButton).toHaveAttribute('data-nav-toggle');
  });

  it('should render home link with Logo', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    // The home link has Logo image and "Blok" text
    const homeLink = screen.getByRole('link', { name: /Blok/i });
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('should use link.label as fallback when i18nKey is not provided', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );

    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });

  it('should render translated labels when locale is Russian and i18nKey is provided', () => {
render(
      <TestWrapper locale="ru">
        <Nav links={mockLinksWithI18nKeys} />
      </TestWrapper>
    );

    expect(screen.getByText('Документация')).toBeInTheDocument();
    expect(screen.getByText('Демо')).toBeInTheDocument();
    expect(screen.getByText('Миграция')).toBeInTheDocument();
  });

  it('should render English labels when locale is English and i18nKey is provided', () => {
render(
      <TestWrapper locale="en">
        <Nav links={mockLinksWithI18nKeys} />
      </TestWrapper>
    );

    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('Migration')).toBeInTheDocument();
  });

  it('should render search button with translated aria-label', () => {
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );
    expect(screen.getByLabelText('Search (⌘K)')).toBeInTheDocument();
  });

  it('should render translated toggle menu label when locale is Russian', () => {
render(
      <TestWrapper locale="ru">
        <Nav links={mockLinks} />
      </TestWrapper>
    );
    expect(screen.getByLabelText('Открыть меню навигации')).toBeInTheDocument();
  });

  it('should render translated search aria-label when locale is Russian', () => {
render(
      <TestWrapper locale="ru">
        <Nav links={mockLinks} />
      </TestWrapper>
    );
    expect(screen.getByLabelText('Поиск (⌘K)')).toBeInTheDocument();
  });

  describe('analytics', () => {
    const gtagCalls = (): unknown[][] => {
      const gtag = (window as GtagWindow).gtag;
      if (!vi.isMockFunction(gtag)) {
        throw new Error('window.gtag is not stubbed');
      }
      return gtag.mock.calls;
    };

    it('tracks a nav_link_click when an internal menu link is clicked', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );

      fireEvent.click(screen.getByLabelText('Toggle menu'));
      fireEvent.click(screen.getByRole('link', { name: 'Docs' }));

      expect(gtagCalls()).toContainEqual([
        'event',
        'nav_link_click',
        { label: 'Docs', to: '/docs' },
      ]);
    });

    it('reports the destination of each internal link it tracks', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );

      fireEvent.click(screen.getByLabelText('Toggle menu'));
      fireEvent.click(screen.getByRole('link', { name: 'Migration' }));

      expect(gtagCalls()).toContainEqual([
        'event',
        'nav_link_click',
        { label: 'Migration', to: '/migration' },
      ]);
    });

    it('does not track external links (covered by the global outbound tracker)', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );

      fireEvent.click(screen.getByLabelText('Toggle menu'));
      fireEvent.click(screen.getByRole('link', { name: 'External' }));

      const navEvents = gtagCalls().filter((call) => call[1] === 'nav_link_click');
      expect(navEvents).toHaveLength(0);
    });

    it('uses the stable link label, not the translated one, as the analytics label', () => {
  render(
        <TestWrapper locale="ru">
          <Nav links={mockLinksWithI18nKeys} />
        </TestWrapper>
      );

      fireEvent.click(screen.getByLabelText('Открыть меню навигации'));
      fireEvent.click(screen.getByRole('link', { name: 'Документация' }));

      expect(gtagCalls()).toContainEqual([
        'event',
        'nav_link_click',
        { label: 'Docs', to: '/docs' },
      ]);
    });
  });

  describe('skip to content link', () => {
    it('renders a skip link pointing at the main content landmark', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );

      const skipLink = screen.getByRole('link', { name: 'Skip to content' });
      expect(skipLink).toHaveAttribute('href', '#main-content');
    });

    it('is visually hidden until focused', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );

      const skipLink = screen.getByRole('link', { name: 'Skip to content' });
      expect(skipLink).toHaveClass('sr-only');
      expect(skipLink.className).toMatch(/focus:not-sr-only/);
    });

    it('is the first focusable element in the nav', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );

      const skipLink = screen.getByRole('link', { name: 'Skip to content' });
      const nav = screen.getByRole('navigation');
      expect(
        skipLink.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  describe('staticPosition', () => {
    it('is fixed to the viewport by default', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );

      const nav = screen.getByRole('navigation');
      expect(nav.className).toMatch(/\bfixed\b/);
      expect(nav.className).not.toMatch(/\bstatic\b/);
    });

    it('renders in normal document flow when staticPosition is set', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} staticPosition />
        </TestWrapper>
      );

      const nav = screen.getByRole('navigation');
      expect(nav.className).toMatch(/\bstatic\b/);
      expect(nav.className).not.toMatch(/\bfixed\b/);
    });

    it('never tucks away on scroll when staticPosition is set', () => {
      Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

      render(
        <TestWrapper>
          <Nav links={mockLinks} staticPosition />
        </TestWrapper>
      );

      const nav = screen.getByRole('navigation');
      act(() => {
        Object.defineProperty(window, 'scrollY', { value: 600, writable: true, configurable: true });
        fireEvent.scroll(window);
      });

      expect(nav.style.transform).toBe('');
    });
  });

  describe('scroll-linked hide/reveal', () => {
    const setScrollY = (value: number) => {
      Object.defineProperty(window, 'scrollY', {
        value,
        writable: true,
        configurable: true,
      });
    };

    // The header transform is driven continuously by the scroll gesture:
    // translateY(0px) = fully visible, translateY(-120px) = fully tucked away.
    const offsetOf = (nav: HTMLElement): number => {
      const match = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(nav.style.transform);
      return match ? Math.abs(parseFloat(match[1])) : 0;
    };

    beforeEach(() => {
      setScrollY(0);
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    });

    it('is fully visible at the top of the page', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );
      const nav = screen.getByRole('navigation');
      act(() => {
        setScrollY(40);
        fireEvent.scroll(window);
      });
      expect(offsetOf(nav)).toBe(0);
    });

    it('tucks away progressively — partially hidden for a partial scroll', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );
      const nav = screen.getByRole('navigation');
      // Anchor just past the hide threshold (80px), then scroll down 30px more.
      act(() => {
        setScrollY(80);
        fireEvent.scroll(window);
      });
      act(() => {
        setScrollY(110);
        fireEvent.scroll(window);
      });
      // Tucks ~2x the scrolled distance (a short scroll hides it): ~60px tucked,
      // still partial — proving continuous tracking, not a snap.
      expect(offsetOf(nav)).toBeGreaterThan(0);
      expect(offsetOf(nav)).toBeLessThan(120);
      expect(offsetOf(nav)).toBeCloseTo(60, 0);
    });

    it('is fully hidden once scrolled far enough down', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );
      const nav = screen.getByRole('navigation');
      act(() => {
        setScrollY(80);
        fireEvent.scroll(window);
      });
      act(() => {
        setScrollY(600);
        fireEvent.scroll(window);
      });
      expect(offsetOf(nav)).toBe(120);
    });

    it('reveals progressively when scrolling back up', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );
      const nav = screen.getByRole('navigation');
      act(() => {
        setScrollY(80);
        fireEvent.scroll(window);
      });
      act(() => {
        setScrollY(600);
        fireEvent.scroll(window);
      });
      expect(offsetOf(nav)).toBe(120);
      // Scroll up 20px — header peeks back ~2x (40px), still partly tucked.
      act(() => {
        setScrollY(580);
        fireEvent.scroll(window);
      });
      expect(offsetOf(nav)).toBeCloseTo(80, 0);
      expect(offsetOf(nav)).toBeGreaterThan(0);
    });

    it('snaps back to fully visible when returning to the top', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );
      const nav = screen.getByRole('navigation');
      act(() => {
        setScrollY(80);
        fireEvent.scroll(window);
      });
      act(() => {
        setScrollY(600);
        fireEvent.scroll(window);
      });
      expect(offsetOf(nav)).toBe(120);
      act(() => {
        setScrollY(40);
        fireEvent.scroll(window);
      });
      expect(offsetOf(nav)).toBe(0);
    });
  });
});
