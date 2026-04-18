import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Nav } from './Nav';
import { I18nProvider } from '../../contexts/I18nContext';
import type { NavLink } from '@/types/navigation';

const mockLinks: NavLink[] = [
  { href: '/docs', label: 'Docs' },
  { href: '/demo', label: 'Demo' },
  { href: '/migration', label: 'Migration' },
  { href: 'https://github.com/JackUait/blok', label: 'GitHub', external: true },
];

const mockLinksWithI18nKeys: NavLink[] = [
  { href: '/docs', label: 'Docs', i18nKey: 'nav.docs' },
  { href: '/demo', label: 'Demo', i18nKey: 'nav.demo' },
  { href: '/migration', label: 'Migration', i18nKey: 'nav.migration' },
  { href: 'https://github.com/JackUait/blok', label: 'GitHub', i18nKey: 'nav.github', external: true },
];

const TestWrapper: React.FC<{ children: React.ReactNode; initialPath?: string }> = ({
  children,
  initialPath = '/',
}) => (
  <MemoryRouter initialEntries={[initialPath]}>
    <I18nProvider>{children}</I18nProvider>
  </MemoryRouter>
);

describe('Nav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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
    expect(screen.getByText('GitHub')).toBeInTheDocument();
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

    const githubLink = screen.getByRole('link', { name: 'GitHub' });
    expect(githubLink).toHaveAttribute('href', 'https://github.com/JackUait/blok');
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
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
    localStorage.setItem('blok-docs-locale', 'ru');

    render(
      <TestWrapper>
        <Nav links={mockLinksWithI18nKeys} />
      </TestWrapper>
    );

    expect(screen.getByText('Документация')).toBeInTheDocument();
    expect(screen.getByText('Демо')).toBeInTheDocument();
    expect(screen.getByText('Миграция')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('should render English labels when locale is English and i18nKey is provided', () => {
    localStorage.setItem('blok-docs-locale', 'en');

    render(
      <TestWrapper>
        <Nav links={mockLinksWithI18nKeys} />
      </TestWrapper>
    );

    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('Migration')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
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
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );
    expect(screen.getByLabelText('Открыть меню навигации')).toBeInTheDocument();
  });

  it('should render translated search aria-label when locale is Russian', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <TestWrapper>
        <Nav links={mockLinks} />
      </TestWrapper>
    );
    expect(screen.getByLabelText('Поиск (⌘K)')).toBeInTheDocument();
  });

  describe('hide on scroll', () => {
    const setScrollY = (value: number) => {
      Object.defineProperty(window, 'scrollY', {
        value,
        writable: true,
        configurable: true,
      });
    };

    beforeEach(() => {
      setScrollY(0);
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    });

    it('is visible at the top of the page', () => {
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
      expect(nav.className).not.toContain('hidden');
    });

    it('hides when scrolling down past the threshold', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );
      const nav = screen.getByRole('navigation');
      act(() => {
        setScrollY(50);
        fireEvent.scroll(window);
      });
      act(() => {
        setScrollY(200);
        fireEvent.scroll(window);
      });
      expect(nav.className).toContain('hidden');
    });

    it('shows again when scrolling up', () => {
      render(
        <TestWrapper>
          <Nav links={mockLinks} />
        </TestWrapper>
      );
      const nav = screen.getByRole('navigation');
      act(() => {
        setScrollY(300);
        fireEvent.scroll(window);
      });
      expect(nav.className).toContain('hidden');
      act(() => {
        setScrollY(200);
        fireEvent.scroll(window);
      });
      expect(nav.className).not.toContain('hidden');
    });
  });
});
