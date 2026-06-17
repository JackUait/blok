import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';
import { I18nProvider } from '../contexts/I18nContext';

describe('HomePage', () => {
  it('should render the Nav component', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });

  it('should render the Footer component', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const footer = screen.getByTestId('footer-brand');
    expect(footer).toBeInTheDocument();
  });

  it('should render the Hero section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const heroContent = screen.getByTestId('hero-content');
    expect(heroContent).toBeInTheDocument();
  });

  it('should render the Features section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    const features = within(main).getByText(/built for developers/i);
    expect(features).toBeInTheDocument();
  });

  it('should render the QuickStart section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    const quickStart = within(main).getByText(/up and running in minutes/i);
    expect(quickStart).toBeInTheDocument();
  });

  it('should render the MigrationCard section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const migration = screen.getByTestId('migration-section');
    expect(migration).toBeInTheDocument();
  });

  it('should render a main element', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('should have navigation links', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <HomePage />
        </I18nProvider>
      </MemoryRouter>
    );

    // Primary site nav plus the Airbnb-style category bar are both landmarks
    const navs = screen.getAllByRole('navigation');
    expect(navs.length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole('navigation', { name: /browse the documentation/i })
    ).toBeInTheDocument();
  });
});
