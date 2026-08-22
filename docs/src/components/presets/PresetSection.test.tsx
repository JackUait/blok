// docs/src/components/presets/PresetSection.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../contexts/I18nContext';
import { PresetSection } from './PresetSection';
import type { PresetSection as PresetSectionType } from './presets-data';

const mockSection: PresetSectionType = {
  id: 'fetch-endpoint',
  exportName: 'fetchStorage',
  title: 'Fetch endpoint',
  description: 'A test preset description.',
  supportsUploadByUrl: true,
  uploadByUrlNote: 'Yes — test note.',
  productionReady: true,
  configOptions: [{ option: 'baseUrl', type: 'string', default: '(required)', description: 'Base URL.' }],
  storageSetup: ['A test setup step.'],
  usageExample: `new Blok({ uploader: fetchStorage({ baseUrl: 'https://x' }) });`,
};

const renderSection = (locale: 'en' | 'ru') =>
  render(
    <MemoryRouter>
      <I18nProvider locale={locale}>
        <PresetSection section={mockSection} />
      </I18nProvider>
    </MemoryRouter>
  );

describe('PresetSection', () => {
  it('reuses the existing tools.* config-table labels rather than hardcoding English', () => {
    renderSection('ru');
    // Values from docs/src/i18n/ru.json's `tools` namespace — these keys are
    // shared with ToolSection, not new presets-only translations.
    expect(screen.getByText('Конфигурация')).toBeInTheDocument();
    expect(screen.getByText('Опция')).toBeInTheDocument();
    expect(screen.getByText('Тип')).toBeInTheDocument();
    expect(screen.getByText('По умолчанию')).toBeInTheDocument();
    expect(screen.getByText('Описание')).toBeInTheDocument();
  });

  it('shows the translated config-table labels in English by default', () => {
    renderSection('en');
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.getByText('Option')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });

  it('keeps the preset-specific labels in English regardless of locale — they carry no translation key on purpose', () => {
    renderSection('ru');
    expect(screen.getByText('Re-hosting a remote URL')).toBeInTheDocument();
    expect(screen.getByText('Storage-side setup')).toBeInTheDocument();
    expect(screen.getByText('Usage')).toBeInTheDocument();
  });
});
