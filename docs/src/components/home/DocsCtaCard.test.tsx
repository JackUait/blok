import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DocsCtaCard } from './DocsCtaCard';
import { I18nProvider } from '../../contexts/I18nContext';

describe('DocsCtaCard', () => {
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

    const link = screen.getByRole('link', { name: /open the docs/i });
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
  });

  it('should render Russian strings when locale is ru', () => {
    localStorage.setItem('blok-docs-locale', 'ru');
    render(
      <I18nProvider>
        <MemoryRouter>
          <DocsCtaCard />
        </MemoryRouter>
      </I18nProvider>
    );

    expect(screen.getByText('Изучите справочник API')).toBeInTheDocument();
  });
});
