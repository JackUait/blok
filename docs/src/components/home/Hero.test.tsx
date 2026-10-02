import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

    // Words are separate spans, so match on the heading's text, not a single text node.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Build beautiful');
    expect(heading).toHaveTextContent('block-based editors');
  });

  it('should render the description', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    const description = screen.getByTestId('hero-description');
    expect(description).toHaveTextContent(/A production-ready, extensible rich text editor/);
    expect(description).toHaveTextContent(/Notion-like block-based editing/);
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
    expect(getStartedLink).toHaveAttribute('href', '/docs/');
  });

  it('should render the Try it out button with correct link', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    // Typo inserts a non-breaking space (U+00A0) into the prose ("it" binds
    // forward), so the accessible name reads "Try it out". \s matches NBSP.
    const tryItOutLink = screen.getByRole('link', { name: /Try\s+it\s+out/ });
    expect(tryItOutLink).toBeInTheDocument();
    expect(tryItOutLink).toHaveAttribute('href', '/demo/');
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
    render(
      <I18nProvider locale="ru">
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );
    expect(screen.queryByText('Редактор с открытым кодом')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Создавайте красивые');
  });

  // The card stack is a decorative animation whose textContent ("H1", "1234",
  // "1.2.3.") is not content. It sits inside the /demo link, so an extractor
  // that reads textContent made "H1 1 2 3 4" the anchor text of that link in
  // the generated markdown mirror. The `aria-hidden` on the wrapper is what
  // `CHROME_SELECTOR` in scripts/seo-artifacts.mjs strips on, so it has to be
  // on the card itself, not on individual glyph spans — the slot kinds shuffle
  // at runtime and three different kinds emit text.
  it('hides the decorative card stack from text extraction', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    const cards = screen.getAllByTestId('hero-card');

    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.getAttribute('aria-hidden')).toBe('true');
    }
  });

  // Never on the <a> itself: an aria-hidden focusable element is a WCAG
  // violation. The link keeps its own accessible name.
  it('keeps the demo link itself focusable and named', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      </I18nProvider>
    );

    const link = screen.getByRole('link', { name: 'Try the demo' });

    expect(link.getAttribute('aria-hidden')).toBeNull();
  });
  describe('the copy is a Blok page', () => {
    const renderHero = () =>
      render(
        <I18nProvider>
          <MemoryRouter>
            <Hero />
          </MemoryRouter>
        </I18nProvider>
      );

    const selectWords = (first: Element, last: Element): void => {
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.childNodes.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      act(() => {
        document.dispatchEvent(new Event('selectionchange'));
      });
    };

    it('keeps the full title as the heading name', () => {
      renderHero();

      expect(screen.getByRole('heading', { level: 1, name: 'Build beautiful block-based editors' })).toBeInTheDocument();
    });

    it('splits the title into words that arrive as blocks', () => {
      renderHero();

      const heading = screen.getByRole('heading', { level: 1 });
      const words = heading.querySelectorAll('[data-hero-word]');

      expect([...words].map((w) => w.textContent)).toEqual(['Build', 'beautiful', 'block-based', 'editors']);
    });

    it('shows no format toolbar until text is selected', () => {
      renderHero();

      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    });

    it('formats the selected words from the inline toolbar', () => {
      renderHero();
      const heading = screen.getByRole('heading', { level: 1 });
      const words = heading.querySelectorAll('[data-hero-word]');

      selectWords(words[0], words[1]);
      const bold = screen.getByRole('button', { name: 'Bold' });
      expect(bold).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(bold);

      expect(words[0]).toHaveAttribute('data-bold');
      expect(words[1]).toHaveAttribute('data-bold');
      expect(words[2]).not.toHaveAttribute('data-bold');
      expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('formats words in the description too', () => {
      renderHero();
      const description = screen.getByTestId('hero-description');
      const words = description.querySelectorAll('[data-hero-word]');

      selectWords(words[1], words[1]);
      fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));

      expect(words[1]).toHaveAttribute('data-mark');
      expect(words[0]).not.toHaveAttribute('data-mark');
    });

    it('hides the toolbar when the selection collapses', () => {
      renderHero();
      const words = screen.getByRole('heading', { level: 1 }).querySelectorAll('[data-hero-word]');

      selectWords(words[0], words[0]);
      expect(screen.getByRole('toolbar')).toBeInTheDocument();

      window.getSelection()?.removeAllRanges();
      act(() => {
        document.dispatchEvent(new Event('selectionchange'));
      });

      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    });

    it('ignores selections outside the hero copy', () => {
      renderHero();
      const outside = document.createElement('p');
      outside.textContent = 'elsewhere';
      document.body.appendChild(outside);

      selectWords(outside, outside);

      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
      outside.remove();
    });
  });
});
