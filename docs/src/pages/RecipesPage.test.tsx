import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecipesPage } from './RecipesPage';
import { I18nProvider } from '../contexts/I18nContext';

describe('RecipesPage', () => {
  it('should render the Nav component', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });

  it('should render the hero title', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
  });

  it('should render the hero description', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(
      screen.getByText(/Practical tips, patterns, and code snippets/)
    ).toBeInTheDocument();
  });

  it('should render the community badge', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    const badges = screen.getAllByText('Community');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('should render the Keyboard Shortcuts section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
    expect(screen.getByTestId('keyboard-shortcuts')).toBeInTheDocument();
  });

  it('should render the Code Recipes section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Code Recipes')).toBeInTheDocument();
  });

  it('should render recipe cards with titles', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('Autosave with Debouncing');
    expect(main).toHaveTextContent('Working with Events');
    expect(main).toHaveTextContent('Creating a Custom Tool');
    expect(main).toHaveTextContent('Styling with Data Attributes');
    expect(main).toHaveTextContent('Read-Only Mode');
    expect(main).toHaveTextContent('Localization with Preloading');
  });

  it('should render the main element', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('should render the hero section with heading', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Recipes' });
    expect(heading).toBeInTheDocument();
  });

  it('should render the CTA section', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Have a recipe to share?')).toBeInTheDocument();
    expect(screen.getByText('Contribute a Recipe')).toBeInTheDocument();
  });

  it('should render navigation links', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <RecipesPage />
        </I18nProvider>
      </MemoryRouter>
    );

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });
});
