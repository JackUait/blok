import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiSidebar } from './ApiSidebar';

describe('ApiSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render an aside element with data-api-sidebar attribute', () => {
    render(<ApiSidebar activeSection="core" />);

    const aside = document.querySelector('[data-api-sidebar]');
    expect(aside).toBeInTheDocument();
    expect(aside?.tagName.toLowerCase()).toBe('aside');
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

    const blokClassLink = screen.getByText('Blok Class');
    expect(blokClassLink.closest('a')).toHaveClass('active');
  });

  it('should not apply active class to inactive sections', () => {
    render(<ApiSidebar activeSection="core" />);

    const configLink = screen.getByText('Configuration');
    expect(configLink.closest('a')).not.toHaveClass('active');
  });

  it('should have api-sidebar-nav nav element', () => {
    const { container } = render(<ApiSidebar activeSection="core" />);

    const nav = container.querySelector('.api-sidebar-nav');
    expect(nav).toBeInTheDocument();
    expect(nav?.tagName.toLowerCase()).toBe('nav');
  });

  it('should have api-sidebar-section divs', () => {
    const { container } = render(<ApiSidebar activeSection="core" />);

    const sections = container.querySelectorAll('.api-sidebar-section');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('should have api-sidebar-title h4 elements', () => {
    const { container } = render(<ApiSidebar activeSection="core" />);

    const titles = container.querySelectorAll('.api-sidebar-title');
    expect(titles.length).toBeGreaterThan(0);
  });

  it('should have api-sidebar-link anchors', () => {
    const { container } = render(<ApiSidebar activeSection="core" />);

    const links = container.querySelectorAll('.api-sidebar-link');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should have correct href attributes for links', () => {
    render(<ApiSidebar activeSection="core" />);

    const quickStartLink = screen.getByText('Quick Start');
    expect(quickStartLink.closest('a')).toHaveAttribute('href', '#quick-start');

    const coreLink = screen.getByText('Blok Class');
    expect(coreLink.closest('a')).toHaveAttribute('href', '#core');
  });

  it('should have onClick handlers for scroll functionality', () => {
    const { container } = render(<ApiSidebar activeSection="core" />);

    const links = container.querySelectorAll('.api-sidebar-link');
    links.forEach((link) => {
      expect(link.getAttribute('onclick')).toBeDefined();
    });
  });
});
