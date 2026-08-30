import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PresetsPage } from './PresetsPage';
import { I18nProvider } from '../contexts/I18nContext';
import { presets } from '../components/presets/presets-data';
import { getRouteMetadata } from '../seo/route-metadata';
import { applyTypography } from '../utils/typography';

const renderPage = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <PresetsPage />
      </I18nProvider>
    </MemoryRouter>
  );

describe('PresetsPage', () => {
  it('renders the Nav and main landmark', () => {
    renderPage();
    expect(screen.getByTestId('nav')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('lists every shipped preset in the summary table', () => {
    renderPage();
    const table = screen.getByTestId('presets-table');
    for (const preset of presets) {
      expect(within(table).getByTestId(`presets-summary-${preset.id}`)).toBeInTheDocument();
    }
  });

  it("shows the summary table's re-hosting answer for each preset, not a softened version", () => {
    renderPage();
    const table = screen.getByTestId('presets-table');
    for (const preset of presets) {
      const row = within(table).getByTestId(`presets-summary-${preset.id}`);
      expect(row).toHaveTextContent(preset.supportsUploadByUrl ? 'Yes' : 'No');
    }
  });

  it('renders one detail section per preset with its config table and usage example', () => {
    renderPage();
    for (const preset of presets) {
      const section = screen.getByTestId(`presets-section-${preset.id}`);
      expect(section).toBeInTheDocument();
      for (const opt of preset.configOptions) {
        expect(within(section).getByText(opt.option)).toBeInTheDocument();
      }
    }
  });

  it('flags indexeddb as unsuitable for production in its own section', () => {
    renderPage();
    const section = screen.getByTestId('presets-section-indexeddb');
    expect(within(section).getByText(/not for production/i)).toBeInTheDocument();
  });

  it('localizes the lede paragraph and summary-table headers on a ru page, not just the H1', () => {
    render(
      <MemoryRouter initialEntries={['/ru/presets']}>
        <I18nProvider locale="ru">
          <PresetsPage />
        </I18nProvider>
      </MemoryRouter>
    );

    // Values from docs/src/i18n/ru.json's `presets` namespace.
    expect(screen.getByText(/Готовые загрузчики из @bloklabs\/presets/)).toBeInTheDocument();

    const table = screen.getByTestId('presets-table');
    expect(within(table).getByText('Пресет')).toBeInTheDocument();
    expect(within(table).getByText('Повторно размещает файл по URL?')).toBeInTheDocument();
    expect(within(table).getByText('Готов к продакшену?')).toBeInTheDocument();
  });

  // Same gap as on /server: the header assertions above passed while every
  // preset description, note and setup step was still English.
  it('localizes each preset\'s description, notes and setup steps on a ru page', () => {
    render(
      <MemoryRouter initialEntries={['/ru/presets']}>
        <I18nProvider locale="ru">
          <PresetsPage />
        </I18nProvider>
      </MemoryRouter>
    );

    for (const preset of presets) {
      const section = screen.getByTestId(`presets-section-${preset.id}`);
      expect(section).toHaveTextContent(/[\u0400-\u04FF]{4}/);
      expect(within(section).queryByText(preset.description)).toBeNull();
      expect(within(section).queryByText(preset.uploadByUrlNote)).toBeNull();
      for (const step of preset.storageSetup) {
        expect(within(section).queryByText(step)).toBeNull();
      }
      for (const option of preset.configOptions) {
        expect(within(section).queryByText(option.description)).toBeNull();
      }
    }
  });

  it('heads a ru page with the localized H1, not the hardcoded English one', () => {
    // Regression: the page used to hardcode "Storage presets" as its <h1>
    // regardless of locale, so /ru/presets served a Russian title/description
    // (from route-metadata.ru.ts) under an all-English visible heading.
    const metadata = getRouteMetadata('/ru/presets');

    if (metadata === undefined) {
      throw new Error('ru copy for /presets is missing — this test would prove nothing');
    }

    render(
      <MemoryRouter initialEntries={['/ru/presets']}>
        <I18nProvider locale="ru">
          <PresetsPage />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(applyTypography(metadata.h1, 'ru'));
  });

  it('localizes the summary table\'s yes/no answers on a ru page', () => {
    // Regression: both answer columns rendered hardcoded 'Yes'/'No' literals, so
    // /ru/presets served an otherwise-Russian table with English answers in it.
    render(
      <MemoryRouter initialEntries={['/ru/presets']}>
        <I18nProvider locale="ru">
          <PresetsPage />
        </I18nProvider>
      </MemoryRouter>
    );

    const table = screen.getByTestId('presets-table');

    for (const preset of presets) {
      const row = within(table).getByTestId(`presets-summary-${preset.id}`);
      const answers = within(row)
        .getAllByRole('cell')
        .slice(1)
        .map((cell) => cell.textContent);

      expect(answers).toEqual([
        preset.supportsUploadByUrl ? 'Да' : 'Нет',
        preset.productionReady ? 'Да' : 'Нет',
      ]);
    }

    expect(within(table).queryAllByText('Yes')).toHaveLength(0);
    expect(within(table).queryAllByText('No')).toHaveLength(0);
  });
});
