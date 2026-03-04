import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hero } from './Hero';
import { I18nProvider } from '../../contexts/I18nContext';

describe('Hero', () => {
  it('should render the eyebrow text', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByText('Open-Source Editor')).toBeInTheDocument();
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

  it('should render the mascot image', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    const mascot = screen.getByAltText(/Blok mascot/);
    expect(mascot).toBeInTheDocument();
    expect(mascot).toHaveAttribute('src', '/mascot.png');
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <MemoryRouter>
        <I18nProvider>
          <Hero />
        </I18nProvider>
      </MemoryRouter>
    );
    expect(screen.getByText('Редактор с открытым кодом')).toBeInTheDocument();
    localStorage.removeItem('blok-docs-locale');
  });
});
