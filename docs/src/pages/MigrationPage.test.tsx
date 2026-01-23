import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MigrationPage } from './MigrationPage';

describe('MigrationPage', () => {
  it('should render the Nav component', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const nav = document.querySelector('[data-nav]');
    expect(nav).toBeInTheDocument();
  });

  it('should render the migration breadcrumb', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Migration Guide')).toBeInTheDocument();
  });

  it('should render the breadcrumb separator', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const separator = container.querySelector('.breadcrumb-separator');
    expect(separator?.textContent).toBe('/');
  });

  it('should render the migration hero badge', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const badge = document.querySelector('.migration-hero-badge');
    expect(badge).toBeInTheDocument();
  });

  it('should render the migration hero title', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    expect(screen.getByText('From EditorJS to Blok')).toBeInTheDocument();
  });

  it('should render the migration hero description', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    expect(
      screen.getByText('Blok is designed as a drop-in replacement for EditorJS. Follow this guide to migrate your project in minutes, not hours.')
    ).toBeInTheDocument();
  });

  it('should render the CodemodCard component', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Automated Codemod')).toBeInTheDocument();
  });

  it('should render the MigrationSteps component', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    expect(screen.getByText('What Gets Transformed')).toBeInTheDocument();
    expect(screen.getByText('CSS Selector Reference')).toBeInTheDocument();
  });

  it('should render the main element with migration-main class', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const main = container.querySelector('.migration-main');
    expect(main).toBeInTheDocument();
    expect(main?.tagName.toLowerCase()).toBe('main');
  });

  it('should have migration-breadcrumb div', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const breadcrumb = container.querySelector('.migration-breadcrumb');
    expect(breadcrumb).toBeInTheDocument();
  });

  it('should have migration-hero section', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const hero = container.querySelector('.migration-hero');
    expect(hero).toBeInTheDocument();
  });

  it('should have migration-hero-badge div', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const badge = container.querySelector('.migration-hero-badge');
    expect(badge).toBeInTheDocument();
  });

  it('should have migration-hero-title h1', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const title = container.querySelector('.migration-hero-title');
    expect(title?.tagName.toLowerCase()).toBe('h1');
  });

  it('should have migration-hero-description p', () => {
    const { container } = render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const description = container.querySelector('.migration-hero-description');
    expect(description?.tagName.toLowerCase()).toBe('p');
  });

  it('should render navigation links', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const nav = document.querySelector('[data-nav]');
    expect(nav).toBeInTheDocument();
  });
});
