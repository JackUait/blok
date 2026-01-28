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

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });

  it('should render the migration hero title', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    expect(screen.getByText('From EditorJS')).toBeInTheDocument();
    // Blok appears in the gradient span within the h1 title
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Blok');
  });

  it('should render the migration hero description', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    expect(
      screen.getByText(/Blok is designed as a drop-in replacement for EditorJS/)
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

  it('should render the main element', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('should render the hero section with heading', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent('Blok');
  });

  it('should render navigation links', () => {
    render(
      <MemoryRouter>
        <MigrationPage />
      </MemoryRouter>
    );

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });
});
