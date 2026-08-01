import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ChangelogPage from './ChangelogPage';
import { I18nProvider } from '../contexts/I18nContext';
import enJson from '../i18n/en.json';
import ruJson from '../i18n/ru.json';
import type { Release } from '@/types/changelog';

const en = enJson.changelog;
const ru = ruJson.changelog;

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

### ⚠ BREAKING CHANGES

- Drop the legacy API
`,
);

vi.mock('../../../CHANGELOG.md?raw', () => ({ default: FIXTURE_CHANGELOG }));

// Lets a single test hand the page a release the parser cannot produce today,
// so the untranslated-label fallback can be exercised.
const parsedReleasesOverride = vi.hoisted(() => ({ current: null as Release[] | null }));

vi.mock('../utils/changelog-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/changelog-parser')>();

  return {
    ...actual,
    parseChangelog: (markdown: string): Release[] =>
      parsedReleasesOverride.current ?? actual.parseChangelog(markdown),
  };
});

const renderChangelogPage = (locale: 'en' | 'ru' = 'en') =>
  render(
    <MemoryRouter>
      <I18nProvider locale={locale}>
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
    parsedReleasesOverride.current = null;
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
      renderChangelogPage('ru');

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ru.title);
    });

    it('renders the Russian badge when locale is ru', () => {
      renderChangelogPage('ru');

      expect(screen.getByText(ru.badge)).toBeInTheDocument();
    });

    it('renders the Russian description when locale is ru', () => {
      renderChangelogPage('ru');

      expect(screen.getByText(ru.description)).toBeInTheDocument();
    });

    it('labels a bare-⚠ BREAKING CHANGES entry as breaking', () => {
      renderChangelogPage();

      expect(screen.getByText(en.category.breaking)).toBeInTheDocument();
    });

    it('renders the release date in the date it was tagged, west of UTC', () => {
      // Bare YYYY-MM-DD parses as UTC midnight, so any zone behind UTC used to
      // render the previous day.
      const originalTz = process.env.TZ;
      process.env.TZ = 'America/Los_Angeles';

      try {
        renderChangelogPage();

        expect(screen.getByText('Jan 1, 2024')).toBeInTheDocument();
      } finally {
        process.env.TZ = originalTz;
      }
    });

    // `t` returns the key itself when it cannot resolve it, so `t(key) || raw`
    // never reached its fallback and the page rendered the raw key.
    it('falls back to the raw label when a category has no translation', () => {
      parsedReleasesOverride.current = [
        {
          version: '2.0.0',
          releaseType: 'major',
          date: '2024-02-01',
          changes: [{ category: 'experimental', description: 'Something new' }],
        },
      ] as unknown as Release[];

      renderChangelogPage();

      expect(screen.getByText('experimental')).toBeInTheDocument();
    });

    it('falls back to the raw label when a release type has no translation', () => {
      parsedReleasesOverride.current = [
        {
          version: '2.0.0',
          releaseType: 'nightly',
          date: '2024-02-01',
          changes: [{ category: 'added', description: 'Something new' }],
        },
      ] as unknown as Release[];

      renderChangelogPage();

      expect(screen.getByText('nightly')).toBeInTheDocument();
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
