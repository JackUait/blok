import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiPage } from './ApiPage';

describe('ApiPage', () => {
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
});
