import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PresetsPage } from './PresetsPage';
import { I18nProvider } from '../contexts/I18nContext';
import { presets } from '../components/presets/presets-data';

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
});
