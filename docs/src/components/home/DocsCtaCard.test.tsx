import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DocsCtaCard } from './DocsCtaCard';
import { I18nProvider } from '../../contexts/I18nContext';

describe('DocsCtaCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.removeItem('blok-docs-locale');
  });

  it('should render the docs CTA section', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <DocsCtaCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('docs-cta-section')).toBeInTheDocument();
  });

  it('should render the docs CTA card', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <DocsCtaCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('docs-cta-card')).toBeInTheDocument();
  });

  it('should render the title', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <DocsCtaCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('docs-cta-title')).toBeInTheDocument();
    expect(screen.getByText('Explore the API reference')).toBeInTheDocument();
  });

  it('should render a link to /docs', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <DocsCtaCard />
        </MemoryRouter>
      </I18nProvider>
    );

    // Typo inserts a non-breaking space (U+00A0) into the prose ("the" binds
    // forward), so the accessible name reads "Open the docs". \s matches NBSP.
    const link = screen.getByRole('link', { name: /open\s+the\s+docs/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/docs');
  });

  it('should render the description', () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <DocsCtaCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByTestId('docs-cta-description')).toBeInTheDocument();
    expect(screen.getByText('Browse every module, method, and option — each with copy-paste examples and a guided sidebar.')).toBeInTheDocument();
  });

  it('should render Russian strings when locale is ru', () => {
    render(
      <I18nProvider locale="ru">
        <MemoryRouter>
          <DocsCtaCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByText('Изучите справочник API')).toBeInTheDocument();
  });
});
