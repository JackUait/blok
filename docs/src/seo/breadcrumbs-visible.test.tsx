import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ApiModuleBody } from '../components/api/ApiModuleBody';
import { ToolsContent } from '../pages/ToolsPage';
import { I18nProvider } from '../contexts/I18nContext';
import { FrameworkProvider } from '../contexts/FrameworkContext';
import type { Locale } from '../i18n';
import { LOCALE_PREFIX, SITE_URL, localizedPath } from './locales';
import { buildJsonLd } from './jsonld';
import { ROUTE_METADATA, RU_ROUTE_METADATA, type RouteMetadata } from './route-metadata';

// Shiki compiles a real grammar on mount; the trail under test needs none of it.
vi.mock('../components/common/CodeBlock', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
  SUPPORTED_LANGUAGES: [],
}));

interface DocsRoute {
  locale: Locale;
  /** Unprefixed route key, e.g. `/docs/table`. */
  path: string;
  meta: RouteMetadata;
}

const METADATA: Record<Locale, Record<string, RouteMetadata>> = {
  en: ROUTE_METADATA,
  ru: RU_ROUTE_METADATA,
};

/** Every `/docs/<id>` page of both locale trees — the pages ApiModuleBody renders. */
const DOCS_ROUTES: DocsRoute[] = (['en', 'ru'] as Locale[]).flatMap((locale) =>
  Object.entries(METADATA[locale])
    .filter(([path]) => path.startsWith('/docs/'))
    .map(([path, meta]) => ({ locale, path, meta })),
);

const renderRoute = ({ locale, path }: DocsRoute) => {
  render(
    <MemoryRouter initialEntries={[localizedPath(path, locale)]}>
      {/* The provider is uncontrolled by default and would serve English copy
          against Russian metadata, so the locale is passed explicitly. */}
      <I18nProvider locale={locale}>
        <FrameworkProvider>
          <Routes>
            <Route path={`${LOCALE_PREFIX[locale]}/docs/:moduleId`} element={<ApiModuleBody />} />
          </Routes>
        </FrameworkProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
};

interface ListItem {
  name: string;
  item: string;
}

/** The BreadcrumbList entries the page's own JSON-LD advertises. */
const declaredCrumbs = ({ locale, path, meta }: DocsRoute): ListItem[] => {
  const graph = buildJsonLd(path, meta, locale)['@graph'] as Record<string, unknown>[];
  const list = graph.find((node) => node['@type'] === 'BreadcrumbList');
  return (list?.itemListElement as ListItem[] | undefined) ?? [];
};

// Typo inserts non-breaking spaces for line-break control; that is a rendering
// detail, not different text, so it is normalised away before comparing.
const visibleText = (element: Element): string =>
  (element.textContent ?? '').replace(/ /g, ' ').trim();

describe('BreadcrumbList markup describes a visible trail', () => {
  it.each(DOCS_ROUTES)(
    '$locale $path renders a breadcrumb nav exactly when its metadata declares one',
    (route) => {
      renderRoute(route);

      expect(screen.queryByTestId('api-breadcrumbs') !== null).toBe(
        route.meta.breadcrumbs !== undefined,
      );
    },
  );

  it.each(DOCS_ROUTES.filter((route) => route.meta.breadcrumbs))(
    '$locale $path renders exactly the links its BreadcrumbList declares',
    (route) => {
      renderRoute(route);

      const declared = declaredCrumbs(route);
      const links = within(screen.getByTestId('api-breadcrumbs')).getAllByRole('link');

      expect(links.map(visibleText)).toEqual(declared.map((crumb) => crumb.name));
      expect(links.map((link) => link.getAttribute('href'))).toEqual(
        declared.map((crumb) => crumb.item.slice(SITE_URL.length)),
      );
    },
  );

  it.each(DOCS_ROUTES.filter((route) => route.meta.breadcrumbs))(
    '$locale $path ends the visible trail on the current page, which the markup omits',
    (route) => {
      renderRoute(route);

      const nav = screen.getByTestId('api-breadcrumbs');
      const current = within(nav).getByText((_, element) =>
        element?.getAttribute('aria-current') === 'page',
      );

      expect(current.closest('a')).toBeNull();
      expect(declaredCrumbs(route).map((crumb) => crumb.name)).not.toContain(visibleText(current));
    },
  );
});

describe('the aggregated tools page', () => {
  it('renders no trail — it is one page holding every tool, not a tool page', () => {
    render(
      <MemoryRouter initialEntries={['/tools']}>
        <I18nProvider locale="en">
          <FrameworkProvider>
            <ToolsContent />
          </FrameworkProvider>
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(screen.queryAllByTestId('api-breadcrumbs')).toHaveLength(0);
  });
});
