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

    const nav = document.querySelector('[data-nav]');
    expect(nav).toBeInTheDocument();
  });

  it('should render the ApiSidebar component', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    const sidebar = document.querySelector('[data-api-sidebar]');
    expect(sidebar).toBeInTheDocument();
  });

  it('should render the main api content area', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    const main = document.querySelector('.api-main');
    expect(main).toBeInTheDocument();
  });

  it('should render all API sections', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Check that sections are rendered by their IDs
    expect(document.getElementById('quick-start')).toBeInTheDocument();
    expect(document.getElementById('core')).toBeInTheDocument();
    expect(document.getElementById('config')).toBeInTheDocument();
  });

  it('should render API section badges', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Check for badges in the sidebar and main content
    const badges = document.querySelectorAll('.api-section-badge');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('should render Blocks API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(document.getElementById('blocks-api')).toBeInTheDocument();
  });

  it('should render Caret API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(document.getElementById('caret-api')).toBeInTheDocument();
  });

  it('should render Events API section', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    expect(document.getElementById('events-api')).toBeInTheDocument();
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
    const { container } = render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    const apiDocs = container.querySelector('.api-docs');
    expect(apiDocs).toBeInTheDocument();
  });

  it('should render navigation links', () => {
    render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    // Check that nav has the data-nav attribute
    const nav = document.querySelector('[data-nav]');
    expect(nav).toBeInTheDocument();
  });

  it('should have api-section elements', () => {
    const { container } = render(
      <MemoryRouter>
        <ApiPage />
      </MemoryRouter>
    );

    const sections = container.querySelectorAll('.api-section');
    expect(sections.length).toBeGreaterThan(0);
  });
});
