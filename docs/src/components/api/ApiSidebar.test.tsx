import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApiSidebar } from './ApiSidebar';

// Mock scrollTo for JSDOM
Element.prototype.scrollTo = vi.fn();

describe('ApiSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render an aside element with data-api-sidebar attribute', () => {
    render(<ApiSidebar activeSection="core" />);

    const aside = screen.getByTestId('api-sidebar');
    expect(aside).toBeInTheDocument();
    expect(aside.tagName.toLowerCase()).toBe('aside');
  });

  it('should render the search input', () => {
    render(<ApiSidebar activeSection="core" />);

    const searchInput = screen.getByTestId('api-sidebar-search-input');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('placeholder', 'Filter...');
  });

  it('should render all sidebar sections', () => {
    render(<ApiSidebar activeSection="core" />);

    expect(screen.getByText('Guide')).toBeInTheDocument();
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('API Modules')).toBeInTheDocument();
    expect(screen.getByText('Data')).toBeInTheDocument();
  });

  it('should render Guide section links', () => {
    render(<ApiSidebar activeSection="quick-start" />);

    expect(screen.getByText('Quick Start')).toBeInTheDocument();
  });

  it('should render Core section links', () => {
    render(<ApiSidebar activeSection="core" />);

    expect(screen.getByText('Blok Class')).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('should render API Modules section links', () => {
    render(<ApiSidebar activeSection="blocks-api" />);

    expect(screen.getByText('Blocks')).toBeInTheDocument();
    expect(screen.getByText('Caret')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Saver')).toBeInTheDocument();
    expect(screen.getByText('Selection')).toBeInTheDocument();
    expect(screen.getByText('Styles')).toBeInTheDocument();
    expect(screen.getByText('Toolbar')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();
  });

  it('should render Data section links', () => {
    render(<ApiSidebar activeSection="output-data" />);

    expect(screen.getByText('OutputData')).toBeInTheDocument();
    expect(screen.getByText('BlockData')).toBeInTheDocument();
  });

  it('should apply active class to the active section', () => {
    render(<ApiSidebar activeSection="core" />);

    const coreLink = screen.getByTestId('api-sidebar-link-core');
    expect(coreLink).toHaveClass('active');
  });

  it('should not apply active class to inactive sections', () => {
    render(<ApiSidebar activeSection="core" />);

    const configLink = screen.getByTestId('api-sidebar-link-config');
    expect(configLink).not.toHaveClass('active');
  });

  it('should render nav element', () => {
    render(<ApiSidebar activeSection="core" />);

    const nav = screen.getByTestId('api-sidebar-nav');
    expect(nav).toBeInTheDocument();
    expect(nav.tagName.toLowerCase()).toBe('nav');
  });

  it('should render sidebar sections', () => {
    render(<ApiSidebar activeSection="core" />);

    const sections = screen.getAllByTestId('api-sidebar-section');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('should have correct href attributes for links', () => {
    render(<ApiSidebar activeSection="core" />);

    const quickStartLink = screen.getByTestId('api-sidebar-link-quick-start');
    expect(quickStartLink).toHaveAttribute('href', '#quick-start');

    const coreLink = screen.getByTestId('api-sidebar-link-core');
    expect(coreLink).toHaveAttribute('href', '#core');
  });

  it('should have onClick handlers for scroll functionality', () => {
    render(<ApiSidebar activeSection="core" />);

    const quickStartLink = screen.getByTestId('api-sidebar-link-quick-start');
    expect(quickStartLink.tagName.toLowerCase()).toBe('a');
  });

  describe('search functionality', () => {
    it('should filter links when typing in search input', () => {
      render(<ApiSidebar activeSection="core" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'caret' } });

      // Caret should be visible
      expect(screen.getByText('Caret')).toBeInTheDocument();
      // Other links should be filtered out
      expect(screen.queryByText('Blocks')).not.toBeInTheDocument();
      expect(screen.queryByText('Quick Start')).not.toBeInTheDocument();
    });

    it('should show empty state when no results match', () => {
      render(<ApiSidebar activeSection="core" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'xyz123notfound' } });

      expect(screen.getByTestId('api-sidebar-empty')).toBeInTheDocument();
      expect(screen.getByText('No results')).toBeInTheDocument();
    });

    it('should show clear button when search has value', () => {
      render(<ApiSidebar activeSection="core" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'test' } });

      const clearButton = screen.getByTestId('api-sidebar-search-clear');
      expect(clearButton).toBeInTheDocument();
    });

    it('should clear search when clear button is clicked', () => {
      render(<ApiSidebar activeSection="core" />);

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
      render(<ApiSidebar activeSection="core" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'blocks-api' } });

      expect(screen.getByText('Blocks')).toBeInTheDocument();
    });

    it('should be case insensitive', () => {
      render(<ApiSidebar activeSection="core" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'CARET' } });

      expect(screen.getByText('Caret')).toBeInTheDocument();
    });

    it('should filter to show multiple matching results', () => {
      render(<ApiSidebar activeSection="core" />);

      const searchInput = screen.getByTestId('api-sidebar-search-input');
      fireEvent.change(searchInput, { target: { value: 'tool' } });

      // Should show Toolbar, InlineToolbar, and Tools
      expect(screen.getByText('Toolbar')).toBeInTheDocument();
      expect(screen.getByText('InlineToolbar')).toBeInTheDocument();
      expect(screen.getByText('Tools')).toBeInTheDocument();
    });

    it('should show keyboard shortcut with tooltip when search is empty', () => {
      render(<ApiSidebar activeSection="core" />);

      const shortcut = screen.getByTestId('api-sidebar-search-shortcut');
      expect(shortcut).toBeInTheDocument();
      expect(shortcut).toHaveAttribute('title', 'Press / to focus search');
    });
  });

  describe('auto-scroll to active section', () => {
    it('should scroll sidebar when activeSection changes and link is near edge', () => {
      const { rerender } = render(<ApiSidebar activeSection="core" />);

      const sidebar = screen.getByTestId('api-sidebar');
      const scrollToSpy = vi.spyOn(sidebar, 'scrollTo');

      // Mock getBoundingClientRect to simulate link near bottom edge
      vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 500, left: 0, right: 200, width: 200, height: 400, x: 0, y: 100, toJSON: () => ({})
      });
      Object.defineProperty(sidebar, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(sidebar, 'scrollTop', { value: 0, configurable: true });

      const eventsLink = screen.getByTestId('api-sidebar-link-events-api');
      vi.spyOn(eventsLink, 'getBoundingClientRect').mockReturnValue({
        top: 450, bottom: 480, left: 0, right: 200, width: 200, height: 30, x: 0, y: 450, toJSON: () => ({})
      });

      // Change activeSection
      rerender(<ApiSidebar activeSection="events-api" />);

      // Verify scroll was called
      expect(scrollToSpy).toHaveBeenCalled();
    });

    it('should use auto scroll behavior', () => {
      const { rerender } = render(<ApiSidebar activeSection="core" />);

      const sidebar = screen.getByTestId('api-sidebar');
      const scrollToSpy = vi.spyOn(sidebar, 'scrollTo');

      // Mock getBoundingClientRect to simulate link near bottom edge
      vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
        top: 100, bottom: 500, left: 0, right: 200, width: 200, height: 400, x: 0, y: 100, toJSON: () => ({})
      });
      Object.defineProperty(sidebar, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(sidebar, 'scrollTop', { value: 0, configurable: true });

      const blocksLink = screen.getByTestId('api-sidebar-link-blocks-api');
      vi.spyOn(blocksLink, 'getBoundingClientRect').mockReturnValue({
        top: 450, bottom: 480, left: 0, right: 200, width: 200, height: 30, x: 0, y: 450, toJSON: () => ({})
      });

      rerender(<ApiSidebar activeSection="blocks-api" />);

      // Verify auto scroll was used
      expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    });
  });
});
