import type { ComponentType } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../contexts/I18nContext';
import { FrameworkProvider } from '../../contexts/FrameworkContext';
import routes from '../../routes';
import { Nav } from './Nav';
import { PageMain } from './PageMain';

vi.mock('../common/CodeBlock', () => ({
  CodeBlock: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

type Entry = { path?: string; index?: boolean; file: string };

const modules = import.meta.glob<{ default: ComponentType }>('../../routes/*.tsx', {
  eager: true,
});

/** A concrete URL each route answers; splats get a real module or a miss. */
const urlFor = (entry: Entry): string => {
  if (entry.index) return '/';
  const path = entry.path ?? '';
  if (path === '*') return '/no-such-page';
  return `/${path.replace(/\*$/, 'quick-start')}`;
};

const renderRoute = (entry: Entry) => {
  const url = urlFor(entry);
  const Page = modules[`../../${entry.file.replace(/^\.\//, '')}`].default;
  return render(
    <MemoryRouter initialEntries={[url]}>
      <I18nProvider locale={url === '/ru' || url.startsWith('/ru/') ? 'ru' : 'en'}>
        <FrameworkProvider>
          <Routes>
            <Route path={entry.index ? '/' : `/${entry.path}`} element={<Page />} />
          </Routes>
        </FrameworkProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
};

describe('skip link target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const entries = routes as Entry[];

  it.each(entries.map((entry) => [urlFor(entry), entry] as const))(
    '%s has a focusable target for every skip link',
    (url, entry) => {
      const { container } = renderRoute(entry);
      const links = container.querySelectorAll('a[href="#main-content"]');
      // A redirect route renders nothing; every real page carries the Nav.
      if (container.innerHTML !== '') expect(links.length, url).toBeGreaterThan(0);
      for (const link of links) {
        const target = container.ownerDocument.getElementById(link.getAttribute('href')?.slice(1) ?? '');
        expect(target, `${url}: no element with id="main-content"`).not.toBeNull();
        expect(target?.tabIndex, `${url}: #main-content is not focusable`).toBe(-1);
      }
      cleanup();
    },
  );

  it('covers the real route table, not an empty glob', () => {
    expect(entries.length).toBeGreaterThan(10);
    for (const entry of entries) {
      expect(modules[`../../${entry.file.replace(/^\.\//, '')}`], entry.file).toBeDefined();
    }
  });

  it('moves focus to the main content when activated', () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <Nav links={[]} />
          <PageMain>
            <p>Body</p>
          </PageMain>
        </I18nProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });
});

const SRC = resolve(process.cwd(), 'src');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

describe('main landmark law', () => {
  it('renders every <main> through PageMain, which owns the skip-link target', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /<main[\s>]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
      .filter((file) => file !== 'components/layout/PageMain.tsx');
    expect(offenders).toEqual([]);
  });
});
