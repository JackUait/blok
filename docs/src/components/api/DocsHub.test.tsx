import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../contexts/I18nContext';
import { DocsHub } from './DocsHub';
import { MODULE_ORDER } from './api-nav';
import { TOOL_SECTIONS } from '../tools/tools-data';
import { DOCS_HUB_SUMMARIES } from './docs-hub-summaries';
import { useApiTranslations } from '../../hooks/useApiTranslations';
import { useToolsTranslations } from '../../hooks/useToolsTranslations';

const renderHub = (locale: 'en' | 'ru' = 'en', at = '/docs') =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <I18nProvider locale={locale}>
        <DocsHub />
      </I18nProvider>
    </MemoryRouter>,
  );

describe('DocsHub', () => {
  it('renders a single H1 naming the documentation', () => {
    renderHub();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/blok documentation/i);
  });

  it('links to every API module as a real anchor', () => {
    const { container } = renderHub();

    const hrefs = new Set(
      Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')),
    );

    for (const id of MODULE_ORDER) {
      expect(hrefs).toContain(`/docs/${id}/`);
    }
  });

  it('links to every built-in tool as a real anchor', () => {
    const { container } = renderHub();

    const hrefs = new Set(
      Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')),
    );

    for (const tool of TOOL_SECTIONS) {
      expect(hrefs).toContain(`/docs/${tool.id}/`);
    }
  });

  it('groups the links under H2 section headings', () => {
    renderHub();
    const groups = screen.getAllByRole('heading', { level: 2 });
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(
      groups.some((heading) => /getting started/i.test(heading.textContent ?? '')),
    ).toBe(true);
  });

  it('gives each link a short description so the page is not a bare list', () => {
    renderHub();
    const quickStart = screen.getByTestId('docs-hub-entry-quick-start');
    expect(within(quickStart).getByRole('link')).toHaveAttribute('href', '/docs/quick-start/');
    expect(quickStart).toHaveTextContent(/get up and running/i);
  });

  // The hub took its H1 from route metadata for English only, and fell back to
  // a hardcoded English literal for every other locale — so /ru/docs/ shipped
  // `lang="ru"`, a Russian <title>, and "Blok documentation" as its heading.
  // Google reads the visible content to decide a page's language and ignores
  // `lang`, so the Russian hub was published as an English page.
  it('takes its heading from route metadata in every locale', () => {
    renderHub('ru', '/ru/docs');

    const headings = screen.getAllByRole('heading', { level: 1 });

    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Документация Blok');
  });

  it('introduces the hub in the reader\'s language, not English', () => {
    const { container } = renderHub('ru', '/ru/docs');
    const intro = container.querySelector('h1 + p, p');

    expect(intro?.textContent ?? '').not.toMatch(/Guides, the full API reference/);
    expect(intro?.textContent ?? '').toMatch(/[А-Яа-я]/);
  });

  describe('card text', () => {
    const LOCALES = [
      ['en', '/docs'],
      ['ru', '/ru/docs'],
    ] as const;

    const prerender = (locale: 'en' | 'ru', at: string): Document => {
      const html = renderToString(
        <MemoryRouter initialEntries={[at]}>
          <I18nProvider locale={locale}>
            <DocsHub />
          </I18nProvider>
        </MemoryRouter>,
      );
      return new DOMParser().parseFromString(html, 'text/html');
    };

    // Typo inserts NBSPs after short Russian words.
    const plain = (text: string | null | undefined): string =>
      (text ?? '').replace(/\u00A0/g, ' ').trim();

    /** The full descriptions the destination pages render, by card id. */
    const fullDescriptions = (locale: 'en' | 'ru'): Map<string, string> => {
      const out = new Map<string, string>();
      const Probe = () => {
        const { apiSections } = useApiTranslations();
        const { toolSections } = useToolsTranslations();
        for (const section of apiSections) {
          if (section.description) out.set(section.id, section.description);
        }
        for (const tool of toolSections) {
          if (!out.has(tool.id)) out.set(tool.id, tool.description);
        }
        return null;
      };
      renderToString(
        <MemoryRouter>
          <I18nProvider locale={locale}>
            <Probe />
          </I18nProvider>
        </MemoryRouter>,
      );
      return out;
    };

    it.each(LOCALES)('every %s card shows its authored summary, not the full description', (locale, at) => {
      const doc = prerender(locale, at);
      const cards = Array.from(doc.querySelectorAll('li[data-blok-testid^="docs-hub-entry-"]'));
      const full = fullDescriptions(locale);
      const summaries = DOCS_HUB_SUMMARIES[locale];

      expect(cards.length).toBeGreaterThan(60);

      for (const card of cards) {
        const id = card.getAttribute('data-blok-testid')?.replace('docs-hub-entry-', '') ?? '';
        const link = card.querySelector('a');
        const label = link?.firstElementChild;
        const description = full.get(id) ?? '';

        expect(summaries[id], `${locale} summary for "${id}"`).toBeDefined();
        expect(plain(label?.nextElementSibling?.textContent), `${locale} card "${id}"`).toBe(summaries[id]);
        if (description.trim() !== summaries[id]) {
          expect(plain(card.textContent)).not.toContain(plain(description));
        }
      }
    });

    it.each(LOCALES)('has no %s summary for a card the hub does not render', (locale, at) => {
      const doc = prerender(locale, at);
      const rendered = Array.from(doc.querySelectorAll('li[data-blok-testid^="docs-hub-entry-"]'))
        .map((card) => card.getAttribute('data-blok-testid')?.replace('docs-hub-entry-', ''))
        .sort();

      expect(Object.keys(DOCS_HUB_SUMMARIES[locale]).sort()).toEqual(rendered);
    });

    it.each(LOCALES)('keeps every %s summary to one short plain sentence', (locale) => {
      for (const [id, summary] of Object.entries(DOCS_HUB_SUMMARIES[locale])) {
        const where = `${locale} summary for "${id}"`;
        expect(summary.length, where).toBeLessThanOrEqual(140);
        expect(summary, where).toMatch(/\.$/);
        expect(summary, where).not.toMatch(/[.!?]\s+[A-ZА-ЯЁ]/);
        expect(summary, where).not.toMatch(/[`\n—–<>]/);
      }
    });

    it('writes every Russian summary in Russian', () => {
      for (const [id, summary] of Object.entries(DOCS_HUB_SUMMARIES.ru)) {
        expect(summary, id).toMatch(/[А-Яа-яЁё]/);
        expect(summary, id).not.toBe(DOCS_HUB_SUMMARIES.en[id]);
      }
    });
  });
});
