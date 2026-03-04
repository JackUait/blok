import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChangelogPage from './ChangelogPage';
import { I18nProvider } from '../contexts/I18nContext';
import enJson from '../i18n/en.json';
import ruJson from '../i18n/ru.json';

const en = enJson.changelog;
const ru = ruJson.changelog;

const STORAGE_KEY = 'blok-docs-locale';

const renderChangelogPage = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <ChangelogPage />
      </I18nProvider>
    </MemoryRouter>
  );

describe('ChangelogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading state', () => {
    it('renders loading text while fetch is in flight', () => {
      vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => undefined));

      renderChangelogPage();

      expect(screen.getByText(en.loading)).toBeInTheDocument();
    });

    it('renders the title and badge in loading state', () => {
      vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => undefined));

      renderChangelogPage();

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.title);
      expect(screen.getByText(en.badge)).toBeInTheDocument();
    });

    it('renders Russian loading text when locale is ru', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');
      vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => undefined));

      renderChangelogPage();

      expect(screen.getByText(ru.loading)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders error message when fetch fails with network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByText(en.errorLoading, { exact: false })).toBeInTheDocument();
      });
    });

    it('renders error message when server returns non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 404, statusText: 'Not Found' })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByText(en.errorLoading, { exact: false })).toBeInTheDocument();
      });
    });

    it('renders Russian error prefix when locale is ru and fetch fails', async () => {
      localStorage.setItem(STORAGE_KEY, 'ru');
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByText(ru.errorLoading, { exact: false })).toBeInTheDocument();
      });
    });
  });

  describe('success state', () => {
    const MINIMAL_CHANGELOG = `# Changelog

## [1.0.0](https://github.com/JackUait/blok/compare/v0.0.1...v1.0.0) (2024-01-01)

### ✨ Features

- Initial release
`;

    it('renders the hero title in English by default', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(MINIMAL_CHANGELOG, { status: 200 })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.title);
      });
    });

    it('renders the badge in English by default', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(MINIMAL_CHANGELOG, { status: 200 })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByText(en.badge)).toBeInTheDocument();
      });
    });

    it('renders the description in English by default', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(MINIMAL_CHANGELOG, { status: 200 })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByText(en.description)).toBeInTheDocument();
      });
    });

    it('renders the hero title in Russian when locale is ru', async () => {
      localStorage.setItem(STORAGE_KEY, 'ru');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(MINIMAL_CHANGELOG, { status: 200 })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ru.title);
      });
    });

    it('renders the Russian badge when locale is ru', async () => {
      localStorage.setItem(STORAGE_KEY, 'ru');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(MINIMAL_CHANGELOG, { status: 200 })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByText(ru.badge)).toBeInTheDocument();
      });
    });

    it('renders the Russian description when locale is ru', async () => {
      localStorage.setItem(STORAGE_KEY, 'ru');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(MINIMAL_CHANGELOG, { status: 200 })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByText(ru.description)).toBeInTheDocument();
      });
    });

    it('renders the Nav component', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(MINIMAL_CHANGELOG, { status: 200 })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByTestId('nav')).toBeInTheDocument();
      });
    });

    it('renders release entries from CHANGELOG.md', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(MINIMAL_CHANGELOG, { status: 200 })
      );

      renderChangelogPage();

      await waitFor(() => {
        expect(screen.getByText('v1.0.0')).toBeInTheDocument();
      });
    });
  });
});
