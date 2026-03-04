import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IntegrationsPage } from './IntegrationsPage';
import { I18nProvider } from '../contexts/I18nContext';
import enJson from '../i18n/en.json';
import ruJson from '../i18n/ru.json';

const en = enJson.integrations;
const ru = ruJson.integrations;

const STORAGE_KEY = 'blok-docs-locale';

const renderIntegrationsPage = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <IntegrationsPage />
      </I18nProvider>
    </MemoryRouter>
  );

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('English locale (default)', () => {
    it('renders the Nav component', () => {
      renderIntegrationsPage();

      expect(screen.getByTestId('nav')).toBeInTheDocument();
    });

    it('renders the hero badge in English', () => {
      renderIntegrationsPage();

      // The badge text "Integrations" may appear multiple times (e.g. nav link + hero badge)
      expect(screen.getAllByText(en.badge).length).toBeGreaterThan(0);
    });

    it('renders the hero title in English', () => {
      renderIntegrationsPage();

      expect(screen.getByRole('heading', { level: 1, name: en.heroTitle })).toBeInTheDocument();
    });

    it('renders the install note in English', () => {
      renderIntegrationsPage();

      expect(screen.getByText(en.installNote)).toBeInTheDocument();
    });

    it('renders the parameters table heading in English', () => {
      renderIntegrationsPage();

      expect(screen.getAllByText(en.parametersTitle).length).toBeGreaterThan(0);
    });

    it('renders the main content area', () => {
      renderIntegrationsPage();

      expect(screen.getByRole('main')).toBeInTheDocument();
    });
  });

  describe('Russian locale', () => {
    it('renders the hero badge in Russian', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');

      renderIntegrationsPage();

      // The badge text may appear multiple times (e.g. nav link + hero badge)
      expect(screen.getAllByText(ru.badge).length).toBeGreaterThan(0);
    });

    it('renders the hero title in Russian', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');

      renderIntegrationsPage();

      expect(screen.getByRole('heading', { level: 1, name: ru.heroTitle })).toBeInTheDocument();
    });

    it('renders the install note in Russian', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');

      renderIntegrationsPage();

      expect(screen.getByText(ru.installNote)).toBeInTheDocument();
    });

    it('renders the parameters table heading in Russian', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');

      renderIntegrationsPage();

      expect(screen.getAllByText(ru.parametersTitle).length).toBeGreaterThan(0);
    });
  });

  describe('locale does not affect section data', () => {
    it('renders the React integration section in English', () => {
      renderIntegrationsPage();

      const main = screen.getByRole('main');
      expect(main).toBeInTheDocument();
      // The section IDs from integrations-data are always present
      expect(document.getElementById('react-install')).toBeInTheDocument();
    });

    it('renders the React integration section in Russian', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');

      renderIntegrationsPage();

      expect(document.getElementById('react-install')).toBeInTheDocument();
    });
  });
});
