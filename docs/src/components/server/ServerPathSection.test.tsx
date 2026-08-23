// docs/src/components/server/ServerPathSection.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../contexts/I18nContext';
import { ServerPathSection } from './ServerPathSection';
import type { ServerPath } from './server-data';

const withService: ServerPath = {
  id: 'own-server',
  title: 'You run your own backend',
  situation: 'A test situation line.',
  description: 'A test description.',
  runsService: true,
  whatToRun: [{ label: 'Start it', language: 'bash', code: 'docker run example' }],
  appRoute: [{ label: 'Forward it', language: 'typescript', code: "app.use('/api/blok', proxy);" }],
  editorConfig: { label: 'Point at it', language: 'typescript', code: 'new Blok({});' },
  failureModes: [
    { symptom: 'It refuses to start.', cause: 'A bad address.', fix: 'Use 127.0.0.1.' },
  ],
};

const withoutService: ServerPath = {
  id: 'own-storage',
  title: 'You already have storage',
  situation: 'A test situation line.',
  description: 'A test description.',
  runsService: false,
  whatToRun: [],
  appRoute: [],
  editorConfig: { label: 'Point at storage', language: 'typescript', code: 'new Blok({});' },
  presetsPath: '/presets',
  failureModes: [{ symptom: 'No preview.', cause: 'No server.', fix: 'Run one.' }],
};

const renderSection = (section: ServerPath, locale: 'en' | 'ru' = 'en', path = '/server') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider locale={locale}>
        <ServerPathSection section={section} />
      </I18nProvider>
    </MemoryRouter>,
  );

describe('ServerPathSection', () => {
  it('carries what to run, the app route, the editor config and the failure modes', () => {
    renderSection(withService);
    const section = screen.getByTestId('server-section-own-server');

    expect(within(section).getByText('Start it')).toBeInTheDocument();
    expect(within(section).getByText('Forward it')).toBeInTheDocument();
    expect(within(section).getByText('Point at it')).toBeInTheDocument();
    expect(within(section).getByText('It refuses to start.')).toBeInTheDocument();
    expect(within(section).getByText('Use 127.0.0.1.')).toBeInTheDocument();
  });

  it('omits the run and route headings for the path that runs nothing', () => {
    renderSection(withoutService);
    const section = screen.getByTestId('server-section-own-storage');

    expect(within(section).queryByText('What to run')).not.toBeInTheDocument();
    expect(within(section).queryByText('The one route in your app')).not.toBeInTheDocument();
    expect(within(section).getByText('Point at storage')).toBeInTheDocument();
  });

  it('links the storage-only path to /presets rather than restating it', () => {
    renderSection(withoutService);
    const link = within(screen.getByTestId('server-section-own-storage')).getByRole('link', {
      name: /presets/i,
    });

    expect(link).toHaveAttribute('href', '/presets');
  });

  it('keeps the presets link inside the Russian tree on a /ru page', () => {
    // A hardcoded /presets href would drop a Russian reader back into the
    // English tree, which is the one link on this page that leaves it.
    renderSection(withoutService, 'ru', '/ru/server');
    const link = within(screen.getByTestId('server-section-own-storage')).getByRole('link', {
      name: /пресет|хранилищ/i,
    });

    expect(link).toHaveAttribute('href', '/ru/presets');
  });

  it('localizes its own headings in Russian', () => {
    renderSection(withService, 'ru', '/ru/server');
    const section = screen.getByTestId('server-section-own-server');

    // Values from docs/src/i18n/ru.json's `server` namespace.
    expect(within(section).getByText('Что запустить')).toBeInTheDocument();
    expect(within(section).getByText('Один маршрут в вашем приложении')).toBeInTheDocument();
    expect(within(section).getByText('Когда что-то ломается')).toBeInTheDocument();
  });
});
