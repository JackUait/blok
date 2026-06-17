import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hero } from './Hero';
import { I18nProvider } from '../../contexts/I18nContext';

describe('Hero', () => {
  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });
  it('should not render an eyebrow kicker', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.queryByText('Open-Source Editor')).not.toBeInTheDocument();
  });

  it('should render the main title', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByText('Build beautiful')).toBeInTheDocument();
    expect(screen.getByText('block-based editors')).toBeInTheDocument();
  });

  it('should render the description', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByText(/A production-ready, extensible rich text editor/)).toBeInTheDocument();
    expect(screen.getByText(/Notion-like block-based editing/)).toBeInTheDocument();
  });

  it('should render the Get Started button with correct link', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    const getStartedLink = screen.getByRole('link', { name: 'Get Started' });
    expect(getStartedLink).toBeInTheDocument();
    expect(getStartedLink).toHaveAttribute('href', '#quick-start');
  });

  it('should render the Try it out button with correct link', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    const tryItOutLink = screen.getByRole('link', { name: /Try it out/ });
    expect(tryItOutLink).toBeInTheDocument();
    expect(tryItOutLink).toHaveAttribute('href', '/demo');
  });

  it('should have data-hero-content attribute', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('hero-content')).toBeInTheDocument();
  });

  it('should have data-hero-demo attribute', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('hero-demo')).toBeInTheDocument();
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );
    expect(screen.queryByText('Редактор с открытым кодом')).not.toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Создавайте красивые'))
    ).toBeInTheDocument();
  });
});
