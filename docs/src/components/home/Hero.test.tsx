import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hero, SLOT_KINDS } from './Hero';
import { LAYOUTS, CARD_KEYS } from './heroFormations';
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

  it('never pins a single block kind to an always-present slot', () => {
    // The slots present in EVERY formation (the intersection across all variants) show on
    // every loop. If such a slot had a single-kind pool, that block would appear literally
    // every loop — give those slots a varied pool so no one block type ever dominates.
    const alwaysPresent = CARD_KEYS.filter((slot) =>
      Object.values(LAYOUTS).every((counts) =>
        Object.values(counts).every((variants) =>
          variants.every((variant) => variant.some((entry) => entry.slot === slot))
        )
      )
    );
    expect(alwaysPresent.length).toBeGreaterThan(0);
    for (const slot of alwaysPresent) {
      expect(SLOT_KINDS[slot].length, `slot ${slot} is always on screen`).toBeGreaterThan(1);
    }
  });

  it('should render four hero block cards', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getAllByTestId('hero-card')).toHaveLength(4);
  });

  it('opens on the full four-card formation', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    // The opening pose is stack@4, so all four cards are on screen from the first paint.
    const visible = screen
      .getAllByTestId('hero-card')
      .filter((card) => card.style.opacity !== '0');
    expect(visible).toHaveLength(4);
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
