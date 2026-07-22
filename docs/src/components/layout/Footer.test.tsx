import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Locale } from '../../i18n';
import { I18nProvider } from '../../contexts/I18nContext';
import { Footer } from './Footer';

/** The locale is part of the address now, so a test picks a tree by its path. */
const renderFooter = (locale: Locale = 'en', path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider locale={locale}>
        <Footer />
      </I18nProvider>
    </MemoryRouter>
  );

describe('Footer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should render a footer element', () => {
    renderFooter();
    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
  });

  it('should render the Blok mascot', () => {
    renderFooter();
    expect(screen.getByAltText('Blok mascot')).toBeInTheDocument();
  });

  it('should render the tagline', () => {
    renderFooter();
    expect(
      screen.getByText(/friendly block-based rich text editor for modern applications/i)
    ).toBeInTheDocument();
  });

  it('should render Documentation section', () => {
    renderFooter();

    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Quick Start')).toBeInTheDocument();
    expect(screen.getByText('API Reference')).toBeInTheDocument();
    expect(screen.getByText('Migration Guide')).toBeInTheDocument();
  });

  it('should render Resources section', () => {
    renderFooter();

    expect(screen.getByText('Resources')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('npm')).toBeInTheDocument();
    expect(screen.getByText('Live Demo')).toBeInTheDocument();
  });

  it('should render Community section', () => {
    renderFooter();

    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
    expect(screen.getByText('Discussions')).toBeInTheDocument();
    expect(screen.getByText('Contributing')).toBeInTheDocument();
  });

  it('should have external links with correct attributes', () => {
    renderFooter();

    const githubLink = screen.getByTestId('github-link');
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should render the copyright notice', () => {
    renderFooter();

    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('should link the author name to Telegram', () => {
    renderFooter();

    const authorLink = screen.getByRole('link', { name: 'JackUait' });
    expect(authorLink).toHaveAttribute('href', 'https://t.me/jackuait');
    expect(authorLink).toHaveAttribute('target', '_blank');
    expect(authorLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('should render the Apache 2.0 license link', () => {
    renderFooter();

    const licenseLink = screen.getByTestId('license-link');
    expect(licenseLink).toBeInTheDocument();
    expect(licenseLink).toHaveAttribute('href', 'https://www.apache.org/licenses/LICENSE-2.0');
  });

  it('should have a footer-brand div', () => {
    renderFooter();

    expect(screen.getByTestId('footer-brand')).toBeInTheDocument();
  });

  it('should have footer-links div', () => {
    renderFooter();

    expect(screen.getByTestId('footer-links')).toBeInTheDocument();
  });

  it('should have footer-bottom div', () => {
    renderFooter();

    expect(screen.getByTestId('footer-bottom')).toBeInTheDocument();
  });

  it('should render translated strings when locale is Russian', () => {
    renderFooter('ru', '/ru');
    expect(screen.getByText('Документация')).toBeInTheDocument();
    expect(screen.getByText('Быстрый старт')).toBeInTheDocument();
    expect(screen.getByText('Справочник API')).toBeInTheDocument();
    expect(screen.getByText('Руководство по миграции')).toBeInTheDocument();
  });

  // The column links are written as English addresses. Rendered verbatim they
  // dropped a Russian reader back into the English tree on every click.
  it('keeps the documentation column inside the reader’s locale tree', () => {
    renderFooter('ru', '/ru/docs/table');

    expect(screen.getByRole('link', { name: 'Справочник API' })).toHaveAttribute('href', '/ru/docs');
    expect(screen.getByRole('link', { name: 'Руководство по миграции' })).toHaveAttribute(
      'href',
      '/ru/migration',
    );
  });

  describe('language switch', () => {
    it('is a link to the same page in the other locale, not a button', () => {
      renderFooter('en', '/docs/table');

      const link = screen.getByRole('link', { name: /Русский/i });
      expect(link).toHaveAttribute('href', '/ru/docs/table');
      expect(link).toHaveAttribute('hreflang', 'ru');
    });

    it('links back out of the Russian tree from a Russian page', () => {
      renderFooter('ru', '/ru/docs/table');

      const link = screen.getByRole('link', { name: /English/i });
      expect(link).toHaveAttribute('href', '/docs/table');
      expect(link).toHaveAttribute('hreflang', 'en');
    });

    it('records the choice so the site root can honour it later', () => {
      renderFooter('en', '/');

      fireEvent.click(screen.getByRole('link', { name: /Русский/i }));

      expect(localStorage.getItem('blok-docs-locale')).toBe('ru');
    });
  });
});
