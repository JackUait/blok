// Pure: file access and hashing come in through `FingerprintSources`, with the
// Node implementations in docs/scripts/source-digest.mjs.
import { API_SECTIONS, type ApiSection } from '../components/api/api-data';
import { MODULE_ORDER } from '../components/api/api-nav';
import { DOCS_HUB_SUMMARIES } from '../components/api/docs-hub-summaries';
import { TOOL_SECTIONS, type ToolSection } from '../components/tools/tools-data';
import { SECTION_TRANSLATION_KEYS, translateApiSection } from '../hooks/useApiTranslations';
import { buildDocsSidebarSections } from '../hooks/useDocsSidebarSections';
import { translateToolSection } from '../hooks/useToolsTranslations';
import { resolveTranslation, translations, type Locale } from '../i18n';
import { BLOK_VERSION } from '../utils/constants';
import { DEFAULT_LOCALE, splitLocalePath } from './locales';
import { getRouteMetadata } from './route-metadata';

/**
 * The files and catalogue namespaces that belong to ONE static page. Shared
 * chrome (layout, nav, footer, common UI) is left out on purpose: editing it
 * changes no page's content.
 */
export const STATIC_PAGES: Record<string, { files: string[]; catalog: string[] }> = {
  '/': { files: ['docs/src/pages/HomePage.tsx', 'docs/src/components/home'], catalog: ['home'] },
  '/demo': {
    files: ['docs/src/pages/DemoPage.tsx', 'docs/src/components/demo'],
    // The "next steps" cards borrow these docs link labels.
    catalog: ['demo', 'api.links.quickStart', 'api.links.configuration', 'api.links.outputData', 'api.sections.adapters'],
  },
  // The cards and summaries come in as resolved data (hubData below).
  '/docs': {
    files: ['docs/src/components/api/DocsHub.tsx'],
    catalog: ['api.hub', 'api.sections', 'api.links', 'tools.sections', 'tools.links'],
  },
  // Only a redirect into /docs renders here.
  '/tools': { files: ['docs/src/routes/tools.tsx'], catalog: [] },
  '/presets': {
    files: ['docs/src/pages/PresetsPage.tsx', 'docs/src/components/presets'],
    // Table headings shared with the tool pages.
    catalog: [
      'presets',
      'tools.configuration',
      'tools.option',
      'tools.type',
      'tools.default',
      'tools.description',
      'tools.usageExample',
    ],
  },
  '/server': { files: ['docs/src/pages/ServerPage.tsx', 'docs/src/components/server'], catalog: ['server'] },
  '/migration': {
    files: ['docs/src/pages/MigrationPage.tsx', 'docs/src/components/migration'],
    catalog: ['migration'],
  },
  '/migration/reference': {
    files: [
      'docs/src/pages/MigrationReferencePage.tsx',
      'docs/src/components/migration/CodemodCard.tsx',
      'docs/src/components/migration/Diff.tsx',
      'docs/src/components/migration/MigrationSectionHeader.tsx',
      'docs/src/components/migration/MigrationStepRail.tsx',
      'docs/src/components/migration/MigrationSteps.tsx',
      'docs/src/components/migration/migration-data.ts',
    ],
    catalog: ['migration'],
  },
  // CHANGELOG.md is left out: the release heading dates it (lastmod.ts), so a
  // release needs no ledger update.
  '/changelog': { files: ['docs/src/pages/ChangelogPage.tsx'], catalog: ['changelog'] },
  '/404': { files: ['docs/src/routes/not-found.tsx'], catalog: [] },
};

// Page-specific files of API pages, by section id. ApiSection.tsx renders every
// reference page (quick start's markup included), so it is not listed.
export const API_PAGE_FILES: Record<string, string[]> = {
  // framework-snippets.ts is shared by these three pages, so an edit re-dates all three.
  tutorial: ['docs/src/components/api/TutorialContent.tsx', 'docs/src/components/common/framework-snippets.ts'],
  'quick-start': ['docs/src/components/common/framework-snippets.ts'],
  config: ['docs/src/components/common/framework-snippets.ts'],
  concepts: ['docs/src/components/api/ConceptsContent.tsx'],
  'custom-block-tool': ['docs/src/components/api/HowToCustomToolContent.tsx'],
  'dev-override-seam': ['docs/src/components/api/DevOverrideSeamContent.tsx'],
};

export const API_EXTRA_CATALOG: Record<string, string[]> = {
  'quick-start': ['api.quickStartSteps'],
  tutorial: ['api.links.customBlockTool', 'api.links.everythingIsABlock'],
};

export interface FingerprintSources {
  apiSections: ApiSection[];
  toolSections: ToolSection[];
  catalogs: Record<Locale, unknown>;
  hubSummaries: Record<Locale, Record<string, string>>;
  /** Normalised out of every input: a release bump rewrites no page's content. */
  version: string;
  /** Content digest of a repo-relative file or directory. */
  digestSource: (repoPath: string) => string;
  hash: (input: string) => string;
}

/** The real page data; callers add `digestSource` and `hash`. */
export const pageData = (): Omit<FingerprintSources, 'digestSource' | 'hash'> => ({
  apiSections: API_SECTIONS,
  toolSections: TOOL_SECTIONS,
  catalogs: translations,
  hubSummaries: DOCS_HUB_SUMMARIES,
  version: BLOK_VERSION,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

const subtree = (catalog: unknown, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), catalog);

// What a locale actually renders: its own strings, English where a key is missing
// (the fallback in i18n/index.ts).
const withFallback = (own: unknown, fallback: unknown): unknown => {
  if (!isRecord(own) || !isRecord(fallback)) return own ?? fallback;
  const keys = new Set([...Object.keys(fallback), ...Object.keys(own)]);
  return Object.fromEntries([...keys].map((key) => [key, withFallback(own[key], fallback[key])]));
};

const catalogInput = (sources: FingerprintSources, locale: Locale, namespaces: string[]): unknown[] =>
  namespaces.map((namespace) => {
    const own = subtree(sources.catalogs[locale], namespace);
    return locale === DEFAULT_LOCALE ? own : withFallback(own, subtree(sources.catalogs[DEFAULT_LOCALE], namespace));
  });

// The `t` the site renders with (I18nContext), over the given catalogues.
const translator = (sources: FingerprintSources, locale: Locale) => (key: string): string =>
  resolveTranslation(sources.catalogs, locale, key);

// What the hub shows: each card group's title and its links in order, and this
// locale's own summaries. Icons are left out: they are not text.
const hubData = (sources: FingerprintSources, locale: Locale): unknown => ({
  groups: buildDocsSidebarSections(translator(sources, locale), sources.toolSections).map((group) => ({
    title: group.title,
    links: group.links.map(({ id, label }) => ({ id, label })),
  })),
  summaries: sources.hubSummaries[locale],
});

const pageInput = (route: string, sources: FingerprintSources): unknown => {
  const { locale, path: unprefixed } = splitLocalePath(route);
  const meta = getRouteMetadata(route);
  if (!meta) throw new Error(`No route metadata for ${route}`);
  const copy = { title: meta.title, description: meta.description, h1: meta.h1 };

  const page = STATIC_PAGES[unprefixed];
  if (page) {
    return {
      copy,
      catalog: catalogInput(sources, locale, page.catalog),
      files: page.files.map(sources.digestSource),
      ...(unprefixed === '/docs' && { data: hubData(sources, locale) }),
    };
  }

  const id = unprefixed.replace(/^\/docs\//, '');
  // A module id shadows a tool id, as in route-metadata.ts.
  if (MODULE_ORDER.includes(id)) {
    // Resolved for the locale, so an English edit Russian translates leaves the Russian page alone.
    const sections = sources.apiSections
      .filter((section) => section.id === id)
      .map((section) => translateApiSection(section, translator(sources, locale)));
    const namespace = SECTION_TRANSLATION_KEYS[id];
    const files = API_PAGE_FILES[id] ?? [];
    return {
      copy,
      data: sections,
      catalog: catalogInput(sources, locale, [...(namespace ? [namespace] : []), ...(API_EXTRA_CATALOG[id] ?? [])]),
      files: files.map(sources.digestSource),
    };
  }

  const tools = sources.toolSections
    .filter((tool) => tool.id === id)
    .map((tool) => translateToolSection(tool, translator(sources, locale)));
  if (tools.length > 0) {
    return {
      copy,
      data: tools,
      catalog: catalogInput(sources, locale, [`tools.docs.${id}`, `tools.links.${id}`]),
    };
  }

  throw new Error(`No content sources mapped for route ${route}`);
};

/**
 * Route -> digest of that page's own content: its data, prose, files and locale strings.
 * Changing what goes in moves every hash: migrate the ledger's hashes and keep
 * its dates, never re-date them with the update script.
 */
export const fingerprintRoutes = (
  routes: readonly string[],
  sources: FingerprintSources,
): Record<string, string> =>
  Object.fromEntries(
    routes.map((route) => [
      route,
      sources.hash(stableStringify(pageInput(route, sources)).split(sources.version).join('<version>')),
    ]),
  );
