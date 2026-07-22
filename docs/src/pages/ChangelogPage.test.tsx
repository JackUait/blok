import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChangelogPage from './ChangelogPage';
import { I18nProvider } from '../contexts/I18nContext';
import enJson from '../i18n/en.json';
import ruJson from '../i18n/ru.json';

const en = enJson.changelog;
const ru = ruJson.changelog;

const STORAGE_KEY = 'blok-docs-locale';

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

// The page reads the changelog through a build-time `?raw` import, so the test
// substitutes the source file rather than stubbing a network response.
const FIXTURE_CHANGELOG = vi.hoisted(
  () => `# Changelog

## [1.0.0](https://github.com/JackUait/blok/compare/v0.9.1...v1.0.0) (2024-01-01)

### ✨ Features

- Initial release

## [0.9.1](https://github.com/JackUait/blok/compare/v0.9.0...v0.9.1) (2023-12-01)

### 🐛 Bug Fixes

- Fix a thing
`,
);

vi.mock('../../../CHANGELOG.md?raw', () => ({ default: FIXTURE_CHANGELOG }));

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
    (window as GtagWindow).gtag = vi.fn();
  });

  afterEach(() => {
    delete (window as GtagWindow).gtag;
    vi.restoreAllMocks();
  });

  describe('content', () => {
    it('renders release entries without any network request', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      renderChangelogPage();

      // Prerendering runs no effects: a fetched changelog would freeze this
      // route's HTML at its loading state and ship no prose to crawlers.
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('renders the hero title in English by default', () => {
      renderChangelogPage();

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.title);
    });

    it('renders the badge in English by default', () => {
      renderChangelogPage();

      expect(screen.getByText(en.badge)).toBeInTheDocument();
    });

    it('renders the description in English by default', () => {
      renderChangelogPage();

      expect(screen.getByText(en.description)).toBeInTheDocument();
    });

    it('renders the hero title in Russian when locale is ru', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');

      renderChangelogPage();

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ru.title);
    });

    it('renders the Russian badge when locale is ru', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');

      renderChangelogPage();

      expect(screen.getByText(ru.badge)).toBeInTheDocument();
    });

    it('renders the Russian description when locale is ru', () => {
      localStorage.setItem(STORAGE_KEY, 'ru');

      renderChangelogPage();

      expect(screen.getByText(ru.description)).toBeInTheDocument();
    });

    it('renders the Nav component', () => {
      renderChangelogPage();

      expect(screen.getByTestId('nav')).toBeInTheDocument();
    });
  });

  describe('analytics', () => {
    const gtagCalls = (): unknown[][] => {
      const gtag = (window as GtagWindow).gtag;
      if (!vi.isMockFunction(gtag)) {
        throw new Error('window.gtag is not stubbed');
      }
      return gtag.mock.calls;
    };

    it('tracks changelog_version_open when a release version is opened', () => {
      renderChangelogPage();

      fireEvent.click(screen.getByText('v1.0.0'));

      expect(gtagCalls()).toContainEqual([
        'event',
        'changelog_version_open',
        { version: '1.0.0', release_type: 'major' },
      ]);
    });

    it('reports the version of the entry that was opened', () => {
      renderChangelogPage();

      fireEvent.click(screen.getByText('v0.9.1'));

      expect(gtagCalls()).toContainEqual([
        'event',
        'changelog_version_open',
        { version: '0.9.1', release_type: 'patch' },
      ]);
    });

    it('does not fire the event before any release is opened', () => {
      renderChangelogPage();

      expect(
        gtagCalls().filter((call) => call[1] === 'changelog_version_open')
      ).toHaveLength(0);
    });
  });
});
