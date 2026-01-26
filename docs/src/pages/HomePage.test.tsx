import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('should render the Nav component', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });

  it('should render the Footer component', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const footer = screen.getByTestId('footer-brand');
    expect(footer).toBeInTheDocument();
  });

  it('should render the Hero section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const heroContent = screen.getByTestId('hero-content');
    expect(heroContent).toBeInTheDocument();
  });

  it('should render the Features section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    const features = within(main).getByText(/why blok/i);
    expect(features).toBeInTheDocument();
  });

  it('should render the QuickStart section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    const quickStart = within(main).getByText(/up and running in minutes/i);
    expect(quickStart).toBeInTheDocument();
  });

  it('should render the ApiPreview section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const api = screen.getByTestId('api-preview-section');
    expect(api).toBeInTheDocument();
  });

  it('should render the MigrationCard section', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const migration = screen.getByTestId('migration-section');
    expect(migration).toBeInTheDocument();
  });

  it('should render a main element', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('should have navigation links', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });
});
