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

    const heading = screen.getByRole('heading', { level: 1, name: 'From EditorJS to Blok' });
    expect(heading).toBeInTheDocument();
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
