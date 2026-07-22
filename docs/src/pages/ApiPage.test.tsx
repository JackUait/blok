import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '../contexts/I18nContext';
import { FrameworkProvider } from '../contexts/FrameworkContext';
import { ApiPage } from './ApiPage';
import { ROUTE_METADATA } from '../seo/route-metadata';

vi.mock('../components/common/CodeBlock', () => ({
  CodeBlock: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <I18nProvider>
        <FrameworkProvider>
          <Routes>
            <Route path="/docs/*" element={<ApiPage />} />
          </Routes>
        </FrameworkProvider>
      </I18nProvider>
    </MemoryRouter>,
  );

/** The Russian tree, mounted the way `routes.ts` mounts it (a second absolute route). */
const renderRussianAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <I18nProvider locale="ru">
        <FrameworkProvider>
          <Routes>
            <Route path="/ru/docs/*" element={<ApiPage />} />
          </Routes>
        </FrameworkProvider>
      </I18nProvider>
    </MemoryRouter>,
  );

describe('ApiPage routing', () => {
  it('renders a single module at /docs/caret-api', () => {
    renderAt('/docs/caret-api');
    // The h1 is the descriptive route-metadata copy, not the bare module name;
    // "Caret API" itself still appears in the breadcrumb trail.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      ROUTE_METADATA['/docs/caret-api'].h1,
    );
    expect(screen.queryByText('Selection API')).toBeNull();
  });

  it('/docs renders the hub page listing every module and tool', () => {
    renderAt('/docs');
    // No longer a redirect: /docs is the crawlable parent of the reference.
    expect(screen.getByTestId('docs-hub')).toBeInTheDocument();
    expect(screen.getByTestId('docs-hub-entry-quick-start')).toBeInTheDocument();
    expect(screen.getByTestId('docs-hub-entry-paragraph')).toBeInTheDocument();
  });

  it('sidebar marks the active module', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('api-sidebar-link-caret-api')).toHaveClass('active');
  });

  it('renders a built-in tool page at /docs/paragraph', () => {
    renderAt('/docs/paragraph');
    expect(screen.getByTestId('tools-section-paragraph')).toBeInTheDocument();
    // The tool appears in the docs sidebar too.
    expect(screen.getByTestId('api-sidebar-link-paragraph')).toBeInTheDocument();
  });
});

describe('ApiPage structure', () => {
  it('renders the Nav component', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('nav')).toBeInTheDocument();
  });

  it('renders the API sidebar', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('api-sidebar')).toBeInTheDocument();
  });

  it('renders the framework toggle inside the sidebar', () => {
    // caret-api has no inline quick-start toggle, so this proves the desktop
    // placement: the toggle is part of the side menu, not a detached sibling.
    renderAt('/docs/caret-api');
    const sidebar = screen.getByTestId('api-sidebar');
    const toggles = screen.getAllByTestId('framework-toggle');
    expect(toggles.some((toggle) => sidebar.contains(toggle))).toBe(true);
  });

  it('renders the main api content area', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('api-main')).toBeInTheDocument();
  });

  it('has the api-docs container', () => {
    renderAt('/docs/caret-api');
    expect(screen.getByTestId('api-docs')).toBeInTheDocument();
  });

  it('gives <main> the id targeted by the nav skip-link', () => {
    renderAt('/docs/caret-api');
    const main = document.querySelector('main');
    expect(main).toHaveAttribute('id', 'main-content');
  });
});

// `/ru/docs/caret-api` puts the module id at segment 3, not 2. Reading segment 2
// off the raw pathname yielded "docs", so no sidebar group matched, the whole
// accordion stayed collapsed, nothing was aria-current, and the TOC vanished on
// all 57 Russian reference pages.
describe('ApiPage in the Russian tree', () => {
  it('resolves the active module from the locale-stripped path', () => {
    renderRussianAt('/ru/docs/caret-api');

    expect(screen.getByTestId('api-sidebar-link-caret-api')).toHaveClass('active');
    expect(screen.getByTestId('api-sidebar-link-caret-api')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('on-this-page')).toBeInTheDocument();
  });

  it('keeps every navigation target inside the Russian tree', () => {
    renderRussianAt('/ru/docs/caret-api');

    expect(screen.getByTestId('api-sidebar-link-selection-api')).toHaveAttribute(
      'href',
      '/ru/docs/selection-api',
    );
    // Below `lg` this dropdown is the only docs navigation on screen.
    fireEvent.click(screen.getByTestId('mobile-section-nav-trigger'));
    expect(screen.getByTestId('mobile-section-nav-item-selection-api')).toHaveAttribute(
      'href',
      '/ru/docs/selection-api',
    );

    expect(screen.getByTestId('api-pagination-next')).toHaveAttribute(
      'href',
      '/ru/docs/selection-api',
    );

    const breadcrumbs = screen.getByTestId('api-breadcrumbs');
    for (const link of within(breadcrumbs).getAllByRole('link')) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/ru\//));
    }
  });

  it('leaves the English tree unprefixed', () => {
    renderAt('/docs/caret-api');

    expect(screen.getByTestId('api-sidebar-link-selection-api')).toHaveAttribute(
      'href',
      '/docs/selection-api',
    );
  });
});

describe('ApiPage on-this-page fallback', () => {
  it('renders a TOC dropdown affordance for the lg breakpoint range instead of hiding it entirely', () => {
    renderAt('/docs/caret-api');

    const dropdown = screen.getByTestId('on-this-page-dropdown');
    expect(dropdown).toBeInTheDocument();

    // Scoped to the lg-only range — visible at lg, hidden again once the
    // persistent xl+ sidebar TOC takes over.
    const wrapper = dropdown.parentElement;
    expect(wrapper?.className).toMatch(/\blg:block\b/);
    expect(wrapper?.className).toMatch(/\bxl:hidden\b/);
  });
});
