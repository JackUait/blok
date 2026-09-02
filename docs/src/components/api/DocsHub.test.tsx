import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../contexts/I18nContext';
import { DocsHub } from './DocsHub';
import { MODULE_ORDER } from './api-nav';
import { TOOL_SECTIONS } from '../tools/tools-data';

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
});
