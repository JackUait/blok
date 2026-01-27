import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar, type SidebarSection } from './Sidebar';

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

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with api variant', () => {
    it('should render an aside element with correct testid', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const aside = screen.getByTestId('api-sidebar');
      expect(aside).toBeInTheDocument();
      expect(aside.tagName.toLowerCase()).toBe('aside');
    });

    it('should render the search input with api prefix', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      expect(searchInput).toBeInTheDocument();
      expect(searchInput).toHaveAttribute('placeholder', 'Filter...');
    });

    it('should apply active class to the active section', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const coreLink = screen.getByTestId('api-sidebar-link-core');
      expect(coreLink).toHaveClass('active');
    });

    it('should not apply active class to inactive sections', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const configLink = screen.getByTestId('api-sidebar-link-config');
      expect(configLink).not.toHaveClass('active');
    });
  });

  describe('with recipes variant', () => {
    it('should render an aside element with correct testid', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="recipes" />);

      const aside = screen.getByTestId('recipes-sidebar');
      expect(aside).toBeInTheDocument();
      expect(aside.tagName.toLowerCase()).toBe('aside');
    });

    it('should render the search input with recipes prefix', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="recipes" />);

      const searchInput = screen.getByTestId('recipes-sidebar-search-input');
      expect(searchInput).toBeInTheDocument();
      expect(searchInput).toHaveAttribute('placeholder', 'Filter...');
    });

    it('should apply active class to the active section', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="recipes" />);

      const coreLink = screen.getByTestId('recipes-sidebar-link-core');
      expect(coreLink).toHaveClass('active');
    });
  });

  describe('sections rendering', () => {
    it('should render all sidebar sections', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      expect(screen.getByText('Guide')).toBeInTheDocument();
      expect(screen.getByText('Core')).toBeInTheDocument();
      expect(screen.getByText('API Modules')).toBeInTheDocument();
    });

    it('should render section links', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      expect(screen.getByText('Quick Start')).toBeInTheDocument();
      expect(screen.getByText('Blok Class')).toBeInTheDocument();
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    });

    it('should render nav element', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const nav = screen.getByTestId('api-sidebar-nav');
      expect(nav).toBeInTheDocument();
      expect(nav.tagName.toLowerCase()).toBe('nav');
    });

    it('should have correct href attributes for links', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const quickStartLink = screen.getByTestId('api-sidebar-link-quick-start');
      expect(quickStartLink).toHaveAttribute('href', '#quick-start');

      const coreLink = screen.getByTestId('api-sidebar-link-core');
      expect(coreLink).toHaveAttribute('href', '#core');
    });
  });

  describe('search functionality', () => {
    it('should filter links when typing in search input', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'caret' } });

      // Caret should be visible
      expect(screen.getByText('Caret')).toBeInTheDocument();
      // Other links should be filtered out
      expect(screen.queryByText('Blocks')).not.toBeInTheDocument();
      expect(screen.queryByText('Quick Start')).not.toBeInTheDocument();
    });

    it('should show empty state when no results match', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'xyz123notfound' } });

      expect(screen.getByTestId('api-sidebar-empty')).toBeInTheDocument();
      expect(screen.getByText('No results')).toBeInTheDocument();
    });

    it('should show clear button when search has value', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'test' } });

      const clearButton = screen.getByTestId('api-sidebar-search-clear');
      expect(clearButton).toBeInTheDocument();
    });

    it('should clear search when clear button is clicked', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'caret' } });

      // Should be filtered
      expect(screen.queryByText('Blocks')).not.toBeInTheDocument();

      // Click clear
      const clearButton = screen.getByTestId('api-sidebar-search-clear');
      fireEvent.click(clearButton);

      // Should show all sections again
      expect(screen.getByText('Blocks')).toBeInTheDocument();
      expect(screen.getByText('Quick Start')).toBeInTheDocument();
    });

    it('should filter by section ID as well as label', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'blocks-api' } });

      expect(screen.getByText('Blocks')).toBeInTheDocument();
    });

    it('should be case insensitive', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'CARET' } });

      expect(screen.getByText('Caret')).toBeInTheDocument();
    });

    it('should show keyboard shortcut with tooltip when search is empty', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const shortcut = screen.getByTestId('api-sidebar-search-shortcut');
      expect(shortcut).toBeInTheDocument();
      expect(shortcut).toHaveAttribute('title', 'Press / to focus search');
    });
  });

  describe('filterLabel prop', () => {
    it('should use custom filterLabel for aria-label', () => {
      render(
        <Sidebar
          sections={MOCK_SECTIONS}
          activeSection="core"
          variant="api"
          filterLabel="Filter API sections"
        />
      );

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      expect(searchInput).toHaveAttribute('aria-label', 'Filter API sections');
    });

    it('should use default filterLabel when not provided', () => {
      render(<Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      expect(searchInput).toHaveAttribute('aria-label', 'Filter sections');
    });
  });

  describe('auto-scroll to active section', () => {
    it('should scroll sidebar when activeSection changes and link is near edge', () => {
      const { rerender } = render(
        <Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />
      );

      const sidebar = screen.getByTestId('api-sidebar');
      const scrollToSpy = vi.spyOn(sidebar, 'scrollTo');

      // Mock getBoundingClientRect to simulate link near bottom edge
      vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 500,
        left: 0,
        right: 200,
        width: 200,
        height: 400,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      Object.defineProperty(sidebar, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(sidebar, 'scrollTop', { value: 0, configurable: true });

      const eventsLink = screen.getByTestId('api-sidebar-link-events-api');
      vi.spyOn(eventsLink, 'getBoundingClientRect').mockReturnValue({
        top: 450,
        bottom: 480,
        left: 0,
        right: 200,
        width: 200,
        height: 30,
        x: 0,
        y: 450,
        toJSON: () => ({}),
      });

      // Change activeSection
      rerender(<Sidebar sections={MOCK_SECTIONS} activeSection="events-api" variant="api" />);

      // Verify scroll was called
      expect(scrollToSpy).toHaveBeenCalled();
    });

    it('should use auto scroll behavior', () => {
      const { rerender } = render(
        <Sidebar sections={MOCK_SECTIONS} activeSection="core" variant="api" />
      );

      const sidebar = screen.getByTestId('api-sidebar');
      const scrollToSpy = vi.spyOn(sidebar, 'scrollTo');

      // Mock getBoundingClientRect to simulate link near bottom edge
      vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 500,
        left: 0,
        right: 200,
        width: 200,
        height: 400,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });
      Object.defineProperty(sidebar, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(sidebar, 'scrollTop', { value: 0, configurable: true });

      const blocksLink = screen.getByTestId('api-sidebar-link-blocks-api');
      vi.spyOn(blocksLink, 'getBoundingClientRect').mockReturnValue({
        top: 450,
        bottom: 480,
        left: 0,
        right: 200,
        width: 200,
        height: 30,
        x: 0,
        y: 450,
        toJSON: () => ({}),
      });

      rerender(<Sidebar sections={MOCK_SECTIONS} activeSection="blocks-api" variant="api" />);

      // Verify auto scroll was used
      expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    });
  });
});
