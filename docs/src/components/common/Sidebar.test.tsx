import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar, type SidebarSection } from './Sidebar';
import { I18nProvider } from '../../contexts/I18nContext';

// Mock scrollTo for JSDOM
Element.prototype.scrollTo = vi.fn();

const MOCK_SECTIONS: SidebarSection[] = [
  {
    title: 'Guide',
    links: [{ id: 'quick-start', label: 'Quick Start' }],
  },
  {
    title: 'Core',
    links: [
      { id: 'core', label: 'Blok Class' },
      { id: 'config', label: 'Configuration' },
    ],
  },
  {
    title: 'API Modules',
    links: [
      { id: 'blocks-api', label: 'Blocks' },
      { id: 'caret-api', label: 'Caret' },
      { id: 'events-api', label: 'Events' },
    ],
  },
];

const I18nWrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

const renderWithI18n = (ui: React.ReactElement) => {
  return render(ui, { wrapper: I18nWrapper });
};

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with api variant', () => {
    it('should render an aside element with correct testid', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const aside = screen.getByTestId('api-sidebar');
      expect(aside).toBeInTheDocument();
      expect(aside.tagName.toLowerCase()).toBe('aside');
    });

    it('should apply active class to the active section', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const coreLink = screen.getByTestId('api-sidebar-link-core');
      expect(coreLink).toHaveClass('active');
    });

    it('should not apply active class to inactive sections', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const configLink = screen.getByTestId('api-sidebar-link-config');
      expect(configLink).not.toHaveClass('active');
    });
  });

  describe('no search bar', () => {
    it('should not render a search input', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      expect(screen.queryByTestId('api-sidebar-search')).not.toBeInTheDocument();
      expect(screen.queryByTestId('api-sidebar-search-input')).not.toBeInTheDocument();
    });
  });

  describe('sections rendering', () => {
    it('should render all sidebar sections', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      expect(screen.getByText('Guide')).toBeInTheDocument();
      expect(screen.getByText('Core')).toBeInTheDocument();
      expect(screen.getByText('API Modules')).toBeInTheDocument();
    });

    it('should render section links', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      expect(screen.getByText('Quick Start')).toBeInTheDocument();
      expect(screen.getByText('Blok Class')).toBeInTheDocument();
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    });

    it('should render nav element', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const nav = screen.getByTestId('api-sidebar-nav');
      expect(nav).toBeInTheDocument();
      expect(nav.tagName.toLowerCase()).toBe('nav');
    });

    it('should have correct href attributes for links', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const quickStartLink = screen.getByTestId('api-sidebar-link-quick-start');
      expect(quickStartLink).toHaveAttribute('href', '#quick-start');

      const coreLink = screen.getByTestId('api-sidebar-link-core');
      expect(coreLink).toHaveAttribute('href', '#core');
    });
  });

  describe('route link mode', () => {
    it('route mode renders router links to module pages', () => {
      render(
        <MemoryRouter>
          <Sidebar
            sections={MOCK_SECTIONS}
            activeSection="caret-api"
            variant="api"
            linkMode="route"
            buildHref={(id) => `/docs/${id}`}
          />
        </MemoryRouter>,
        { wrapper: I18nWrapper },
      );
      const link = screen.getByTestId('api-sidebar-link-caret-api');
      expect(link).toHaveAttribute('href', '/docs/caret-api');
      expect(link).toHaveClass('active');
    });
  });

  describe('collapsible groups', () => {
    it('collapses every group by default except the one holding the active page', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      // 'core' lives in the 'Core' group, so it starts open; the rest collapsed.
      expect(screen.getByRole('button', { name: /Core/i })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: /Guide/i })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('button', { name: /API Modules/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('hides the links of a collapsed group', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const guideToggle = screen.getByRole('button', { name: /Guide/i });
      const regionId = guideToggle.getAttribute('aria-controls');
      const region = regionId ? document.getElementById(regionId) : null;
      expect(region).not.toBeNull();
      expect(region).toHaveAttribute('hidden');
    });

    it('expands a collapsed group when its header is clicked', () => {
      renderWithI18n(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const guideToggle = screen.getByRole('button', { name: /Guide/i });
      expect(guideToggle).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(guideToggle);

      expect(guideToggle).toHaveAttribute('aria-expanded', 'true');
      const regionId = guideToggle.getAttribute('aria-controls');
      const region = regionId ? document.getElementById(regionId) : null;
      expect(region).not.toHaveAttribute('hidden');
    });
  });

  describe('section icons', () => {
    it('renders a section icon when provided', () => {
      const withIcon: SidebarSection[] = [
        {
          title: 'Core',
          icon: <svg data-blok-testid="core-icon" />,
          links: [{ id: 'core', label: 'Blok Class' }],
        },
      ];
      renderWithI18n(<Sidebar sections={withIcon} activeSection="core" variant="api" />);

      const toggle = screen.getByRole('button', { name: /Core/i });
      expect(toggle).toContainElement(screen.getByTestId('core-icon'));
    });
  });

  describe('no auto-scroll on navigation', () => {
    it('does not scroll the sidebar when activeSection changes', () => {
      const { rerender } = renderWithI18n(
        <Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />
      );

      const sidebar = screen.getByTestId('api-sidebar');
      const scrollToSpy = vi.spyOn(sidebar, 'scrollTo');

      // Navigating to a different module must leave the menu's scroll position
      // untouched — the user controls it.
      rerender(<Sidebar sections={MOCK_SECTIONS} activeSection="events-api" variant="api" />);

      expect(scrollToSpy).not.toHaveBeenCalled();
    });
  });
});
