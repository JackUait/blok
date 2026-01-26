import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiPage } from './ApiPage';

describe('ApiPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  it('should render the Nav component', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('nav')).toBeInTheDocument();
  });

  it('should render the ApiSidebar component', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('api-sidebar')).toBeInTheDocument();
  });

  it('should render the main api content area', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('api-main')).toBeInTheDocument();
  });

  it('should render all API sections', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Check that sections are rendered using getByTestId which queries by data-testid
    expect(screen.getByTestId('quick-start')).toBeInTheDocument();
    expect(screen.getByTestId('core')).toBeInTheDocument();
    expect(screen.getByTestId('config')).toBeInTheDocument();
  });

  it('should render API section badges', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Check for badges using data-testid
    expect(screen.getAllByTestId('api-section-badge').length).toBeGreaterThan(0);
  });

  it('should render Blocks API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('blocks-api')).toBeInTheDocument();
  });

  it('should render Caret API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('caret-api')).toBeInTheDocument();
  });

  it('should render Events API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('events-api')).toBeInTheDocument();
  });

  it('should render Saver API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Saver API')).toBeInTheDocument();
  });

  it('should render Selection API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Selection API')).toBeInTheDocument();
  });

  it('should render Styles API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Styles API')).toBeInTheDocument();
  });

  it('should render Toolbar API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Toolbar API')).toBeInTheDocument();
  });

  it('should render Tools API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Tools API')).toBeInTheDocument();
  });

  it('should render OutputData section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Use getAllByText and find the one that's an h1
    const headings = screen.getAllByText((content) => content.includes('OutputData'));
    expect(headings.some((el) => el.tagName === 'H1')).toBe(true);
  });

  it('should render BlockData section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Use getAllByText and find the one that's an h1
    const headings = screen.getAllByText((content) => content.includes('BlockData'));
    expect(headings.some((el) => el.tagName === 'H1')).toBe(true);
  });

  it('should have api-docs container', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(screen.getByTestId('api-docs')).toBeInTheDocument();
  });

  it('should render navigation links', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Check that nav is rendered using testid
    expect(screen.getByTestId('nav')).toBeInTheDocument();
  });

  it('should have api-section elements', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Check that sections are rendered using role
    const sections = screen.getAllByRole('region');
    expect(sections.length).toBeGreaterThan(0);
  });

  describe('anchor link navigation', () => {
    it('should update URL hash when clicking anchor links', async () => {
      const pushStateSpy = vi.spyOn(window.history, 'pushState');
      
      render(
        <MemoryRouter>
          <ApiPage />
        </MemoryRouter>
      );

      // Find an anchor link (section title anchor)
      const anchorLink = screen.getByRole('link', { name: /Link to Blok Class/ });
      fireEvent.click(anchorLink);
      
      await vi.runAllTimersAsync();
      
      expect(pushStateSpy).toHaveBeenCalledWith(null, '', '#core');
      
      pushStateSpy.mockRestore();
    });

    it('should render anchor links for API methods', () => {
      render(
        <MemoryRouter>
          <ApiPage />
        </MemoryRouter>
      );

      // Check that method anchor links exist
      const methodAnchor = screen.getByRole('link', { name: /Link to blocks\.clear\(\)/ });
      expect(methodAnchor).toBeInTheDocument();
      expect(methodAnchor).toHaveAttribute('href', '#blocks-api-blocks-clear');
    });

    it('should render anchor links for properties in tables', () => {
      render(
        <MemoryRouter>
          <ApiPage />
        </MemoryRouter>
      );

      // Check that property anchor links exist (e.g., isReady in core section)
      const propAnchor = screen.getByRole('link', { name: /Link to isReady/ });
      expect(propAnchor).toBeInTheDocument();
      expect(propAnchor).toHaveAttribute('href', '#core-prop-isready');
    });

    it('should render anchor links for config options', () => {
      render(
        <MemoryRouter>
          <ApiPage />
        </MemoryRouter>
      );

      // Check that config option anchor links exist - use getAllByRole since "holder" appears in multiple sections
      const holderAnchors = screen.getAllByRole('link', { name: /Link to holder/ });
      const configHolderAnchor = holderAnchors.find(
        (el) => el.getAttribute('href') === '#config-holder'
      );
      expect(configHolderAnchor).toBeInTheDocument();
    });
  });
});
