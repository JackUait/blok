// docs/src/pages/ServerPage.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ServerPage } from './ServerPage';
import { I18nProvider } from '../contexts/I18nContext';
import { serverLimits, serverPaths } from '../components/server/server-data';
import { getRouteMetadata } from '../seo/route-metadata';
import { applyTypography } from '../utils/typography';

const renderPage = (locale: 'en' | 'ru' = 'en', path = '/server') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider locale={locale}>
        <ServerPage />
      </I18nProvider>
    </MemoryRouter>,
  );

describe('ServerPage', () => {
  it('renders the Nav and main landmark', () => {
    renderPage();
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('states the 70% link-preview limit on the first screen, above the three paths', () => {
    renderPage();
    const note = screen.getByTestId('server-coverage-note');

    expect(note).toHaveTextContent(/70%/);
    expect(note).toHaveTextContent(/plain link/i);

    // "First screen" means before the paths in document order, not merely present.
    const paths = screen.getByTestId('server-paths');
    expect(note.compareDocumentPosition(paths) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists the four paths in the order the design puts them, storage-only first', () => {
    renderPage();
    const table = screen.getByTestId('server-table');
    const ids = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.getAttribute('data-blok-testid'));

    expect(ids).toEqual([
      'server-summary-own-storage',
      'server-summary-dotnet',
      'server-summary-own-server',
      'server-summary-serverless',
    ]);
  });

  it('says for each path whether it runs the service, without softening it', () => {
    renderPage();
    const table = screen.getByTestId('server-table');

    for (const path of serverPaths) {
      const row = within(table).getByTestId(`server-summary-${path.id}`);
      expect(row).toHaveTextContent(path.runsService ? 'Yes' : 'No');
    }
  });

  it('renders one section per path with its failure modes', () => {
    renderPage();

    for (const path of serverPaths) {
      const section = screen.getByTestId(`server-section-${path.id}`);
      expect(section).toBeInTheDocument();
      for (const mode of path.failureModes) {
        expect(within(section).getByText(mode.symptom)).toBeInTheDocument();
      }
    }
  });

  it('states every deploy-time limit rather than burying it in a path section', () => {
    renderPage();
    const limits = screen.getByTestId('server-limits');

    for (const limit of serverLimits) {
      expect(within(limits).getByTestId(`server-limit-${limit.id}`)).toBeInTheDocument();
    }
  });

  it('heads a ru page with the localized H1, not the hardcoded English one', () => {
    const metadata = getRouteMetadata('/ru/server');

    if (metadata === undefined) {
      throw new Error('ru copy for /server is missing — this test would prove nothing');
    }

    renderPage('ru', '/ru/server');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      applyTypography(metadata.h1, 'ru'),
    );
  });

  it('localizes the lede and the summary-table headers on a ru page', () => {
    renderPage('ru', '/ru/server');

    // Values from docs/src/i18n/ru.json's `server` namespace.
    expect(screen.getByText(/Blok нужно куда-то класть загруженные файлы/)).toBeInTheDocument();

    const table = screen.getByTestId('server-table');
    expect(within(table).getByText('Ваш случай')).toBeInTheDocument();
    expect(within(table).getByText('Запускает сервис?')).toBeInTheDocument();
  });

  it("localizes the summary table's yes/no answers on a ru page", () => {
    renderPage('ru', '/ru/server');
    const table = screen.getByTestId('server-table');

    for (const path of serverPaths) {
      const row = within(table).getByTestId(`server-summary-${path.id}`);
      const answer = within(row).getAllByRole('cell').at(-1)?.textContent;

      expect(answer).toBe(path.runsService ? 'Да' : 'Нет');
    }

    expect(within(table).queryAllByText('Yes')).toHaveLength(0);
    expect(within(table).queryAllByText('No')).toHaveLength(0);
  });
});
