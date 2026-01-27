import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RecipesPage } from './RecipesPage';

describe('RecipesPage', () => {
  it('should render the Nav component', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });

  it('should render the hero title', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
  });

  it('should render the hero description', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    expect(
      screen.getByText(/Practical tips, patterns, and code snippets/)
    ).toBeInTheDocument();
  });

  it('should render the cookbook badge', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Cookbook')).toBeInTheDocument();
  });

  it('should render the Quick Tips section', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Quick Tips')).toBeInTheDocument();
    expect(screen.getByTestId('quick-tips')).toBeInTheDocument();
  });

  it('should render the Keyboard Shortcuts section', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByTestId('keyboard-shortcuts')).toBeInTheDocument();
  });

  it('should render the Code Recipes section', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Code Recipes')).toBeInTheDocument();
  });

  it('should render recipe cards with titles', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Autosave with Debouncing')).toBeInTheDocument();
    expect(screen.getByText('Working with Events')).toBeInTheDocument();
    expect(screen.getByText('Creating a Custom Tool')).toBeInTheDocument();
    expect(screen.getByText('Styling with Data Attributes')).toBeInTheDocument();
    expect(screen.getByText('Read-Only Mode')).toBeInTheDocument();
    expect(screen.getByText('Localization with Preloading')).toBeInTheDocument();
  });

  it('should render the main element', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('should render the hero section with heading', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Recipes' });
    expect(heading).toBeInTheDocument();
  });

  it('should render the CTA section', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Have a recipe to share?')).toBeInTheDocument();
    expect(screen.getByText('Share on GitHub')).toBeInTheDocument();
  });

  it('should render navigation links', () => {
    render(
      <MemoryRouter>
        <RecipesPage />
      </MemoryRouter>
    );

    const nav = screen.getByTestId('nav');
    expect(nav).toBeInTheDocument();
  });
});
