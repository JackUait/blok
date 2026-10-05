import { describe, expect, it } from 'vitest';
import { PRERENDER_PATHS } from '../prerender-paths';
import { localizedPrerenderPaths } from './locales';
import { nodeDigests } from '../../scripts/source-digest.mjs';
import { fingerprintRoutes, pageData, type FingerprintSources } from './page-fingerprint';
import { mergeLedger, type Ledger } from './lastmod';

const ROUTES = localizedPrerenderPaths(PRERENDER_PATHS);

const clone = <T>(value: T): T => structuredClone(value);

const changedRoutes = (before: Record<string, string>, after: Record<string, string>): string[] =>
  Object.keys(after)
    .filter((route) => before[route] !== after[route])
    .sort();

describe('page fingerprints', () => {
  const base: FingerprintSources = { ...pageData(), ...nodeDigests };
  const baseline = fingerprintRoutes(ROUTES, base);

  it('fingerprints every prerendered route', () => {
    expect(Object.keys(baseline).sort()).toEqual([...ROUTES].sort());
  });

  // A code example has no translation, so the Russian page shows the edit too.
  it('changes only that page, in both locales, when an untranslated part of an API section is edited', () => {
    const sources: FingerprintSources = { ...base, apiSections: clone(base.apiSections) };
    const method = sources.apiSections.find((section) => section.id === 'caret-api')?.methods?.[0];
    if (!method) throw new Error('caret-api has no method');
    method.example = `${method.example ?? ''}\n// edited`;

    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, sources))).toEqual([
      '/docs/caret-api',
      '/ru/docs/caret-api',
    ]);
  });

  // English renders the authored data only where en.json has no string for it.
  it('leaves the Russian page alone when English prose it translates is edited', () => {
    const catalogs = clone(base.catalogs);
    delete (catalogs.en as { api: { caretApi: { description?: string } } }).api.caretApi.description;
    const before = fingerprintRoutes(ROUTES, { ...base, catalogs });
    const sources: FingerprintSources = { ...base, catalogs, apiSections: clone(base.apiSections) };
    const caret = sources.apiSections.find((section) => section.id === 'caret-api');
    if (!caret) throw new Error('caret-api section is gone');
    caret.description = `${caret.description ?? ''} Edited.`;

    expect(changedRoutes(before, fingerprintRoutes(ROUTES, sources))).toEqual(['/docs/caret-api']);
  });

  it('changes only the Russian page when only its translation is edited', () => {
    const catalogs = clone(base.catalogs);
    const ru = catalogs.ru as { api: { caretApi: { description: string } } };
    ru.api.caretApi.description = `${ru.api.caretApi.description} Правка.`;

    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, { ...base, catalogs }))).toEqual([
      '/ru/docs/caret-api',
    ]);
  });

  it('changes only that tool page when one tool is edited', () => {
    const sources: FingerprintSources = { ...base, toolSections: clone(base.toolSections) };
    const table = sources.toolSections.find((tool) => tool.id === 'table');
    if (!table) throw new Error('table tool is gone');
    table.usageExample = `${table.usageExample}\n// edited`;

    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, sources))).toEqual([
      '/docs/table',
      '/ru/docs/table',
    ]);
  });

  it('leaves the Russian tool page alone when English prose it translates is edited', () => {
    const catalogs = clone(base.catalogs);
    delete (catalogs.en as { tools: { docs: { table: { description?: string } } } }).tools.docs.table.description;
    const before = fingerprintRoutes(ROUTES, { ...base, catalogs });
    const sources: FingerprintSources = { ...base, catalogs, toolSections: clone(base.toolSections) };
    const table = sources.toolSections.find((tool) => tool.id === 'table');
    if (!table) throw new Error('table tool is gone');
    table.description = `${table.description} Edited.`;

    expect(changedRoutes(before, fingerprintRoutes(ROUTES, sources))).toEqual(['/docs/table']);
  });

  // The hub renders every sidebar group title and link label as its cards.
  it.each([
    ['api.links.caret', ['/ru/docs']],
    ['api.sections.core', ['/ru/docs']],
    ['tools.sections.blockTools', ['/ru/docs']],
    ['tools.links.table', ['/ru/docs', '/ru/docs/table']],
  ])('re-dates the Russian hub when its card label %s is renamed', (key, expected) => {
    const catalogs = clone(base.catalogs);
    const path = key.split('.');
    const parent = path.slice(0, -1).reduce<Record<string, unknown>>(
      (node, segment) => node[segment] as Record<string, unknown>,
      catalogs.ru as Record<string, unknown>,
    );
    parent[path[path.length - 1]] = `${String(parent[path[path.length - 1]])} Правка`;

    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, { ...base, catalogs }))).toEqual(expected);
  });

  it('re-dates only the English hub when an English card label Russian translates is renamed', () => {
    const catalogs = clone(base.catalogs);
    (catalogs.en as { api: { links: { caret: string } } }).api.links.caret += ' Edited';

    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, { ...base, catalogs }))).toEqual(['/docs']);
  });

  it('re-dates only the English hub when an English card summary is edited', () => {
    const hubSummaries = clone(base.hubSummaries);
    hubSummaries.en['caret-api'] += ' Edited.';

    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, { ...base, hubSummaries }))).toEqual(['/docs']);
  });

  it('changes only the docs hub, per locale, when a hub string is edited', () => {
    const en = clone(base.catalogs);
    (en.en as { api: { hub: { title: string } } }).api.hub.title += ' Edited.';
    // The Russian hub has its own title, so it falls back to nothing here.
    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, { ...base, catalogs: en }))).toEqual(['/docs']);

    const ru = clone(base.catalogs);
    (ru.ru as { api: { hub: { title: string } } }).api.hub.title += ' Правка.';
    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, { ...base, catalogs: ru }))).toEqual(['/ru/docs']);
  });

  it('leaves the ledger alone when a release adds a changelog entry', () => {
    const released: FingerprintSources = {
      ...base,
      digestSource: (repoPath) => (repoPath === 'CHANGELOG.md' ? 'new release' : base.digestSource(repoPath)),
    };

    expect(changedRoutes(baseline, fingerprintRoutes(ROUTES, released))).toEqual([]);
  });
});

describe('mergeLedger', () => {
  const fingerprints = { '/a': 'h-a', '/b': 'h-b', '/ru/a': 'h-ru-a' };
  const ledger: Ledger = {
    '/a': { hash: 'h-a', date: '2026-07-01' },
    '/b': { hash: 'h-b', date: null },
    '/ru/a': { hash: 'h-ru-a', date: '2026-08-01' },
  };

  it('leaves every date alone on a rebuild with no content change', () => {
    expect(mergeLedger(ledger, fingerprints, '2026-10-05')).toEqual(ledger);
  });

  it('re-dates only the page whose fingerprint changed', () => {
    expect(mergeLedger(ledger, { ...fingerprints, '/ru/a': 'h-ru-a2' }, '2026-10-05')).toEqual({
      ...ledger,
      '/ru/a': { hash: 'h-ru-a2', date: '2026-10-05' },
    });
  });

  it('dates a new page from the day it was added and drops a removed one', () => {
    expect(mergeLedger(ledger, { '/a': 'h-a', '/c': 'h-c' }, '2026-10-05')).toEqual({
      '/a': ledger['/a'],
      '/c': { hash: 'h-c', date: '2026-10-05' },
    });
  });
});
