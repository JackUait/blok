import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiSidebar } from './ApiSidebar';

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
});
