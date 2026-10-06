# Versioned Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** blokeditor.com serves the latest release at `/`, `main` at `/next/`, and older minors at `/v/<minor>/`. A header picker switches between them and keeps the reader on the same page.

**Architecture:** Each docs build takes its base path and version id from env vars (`DOCS_BASE`, `VITE_DOCS_VERSION`). Each stable release attaches two snapshot tarballs to its GitHub release. Every deploy downloads the snapshots, adds a fresh `/next/` build, writes `/versions.json` and uploads one Pages artifact. Old tags (1.7–1.15) are built once by a backfill workflow that copies `src/versioning/` from `main` into the tag before building.

**Tech Stack:** React Router 8 framework mode (`ssr: false`, prerender), Vite, Vitest + Testing Library, Node `.mjs` scripts, GitHub Actions, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-05-docs-versioning-design.md`

## Global Constraints

- One entry per minor. Each shows its latest patch.
- `/` = latest **stable** release. Prereleases never become root and never get an entry.
- `main` lives at `/next/`, labelled "Next".
- Archives live at `/v/<minor>/`. The latest minor is NEVER also under `/v/`.
- Archive range starts at 1.7. 1.6 is dropped.
- Only the root snapshot is in the sitemap. `/next/` and `/v/**` HTML carry `<meta name="robots" content="noindex, follow">`.
- Site size budget: 900 MB. Past it, drop the oldest minor.
- The picker's current entry shows a checkmark. It never uses a blue fill or blue text.
- Do NOT modify `docs/package.json` or the root `package.json` (CLAUDE.md config rule). New build steps are separate scripts.
- **Spec amendment:** the picker and banner strings live in `docs/src/versioning/strings.ts`, NOT in `en.json`/`ru.json`. The same files are copied into old tags whose `en.json` lacks the keys, so `t()` would print raw keys there.
- `src/versioning/` may import only `react`, `react-router`, `lucide-react` and `@/lib/utils`. Everything else is missing or different at v1.7. Task 6's overlay depends on this.
- Comments: short, and only where something silently breaks if changed.
- TDD: write the failing test, watch it fail, then implement.
- Commits go straight to `main` (trunk-based). Stage only this plan's files. NEVER `git commit -a`, because other sessions share the tree.

## Review Focus

1. **Page missing in the target version** (e.g. `/docs/audio` → 1.7, which predates audio). Expect a fallback to the target's home in the same locale, not a 404. Pinned in Task 2.
2. **`versions.json` unreachable** (dev server, offline, a 404 during a deploy). Expect the picker to still render the current version, with no crash and no empty menu. Pinned in Task 3.
3. **Two patches of one minor plus a beta** (`v1.15.0`, `v1.15.2`, `v1.16.0-beta.1`). Expect root = 1.15.2, no 1.16 entry, and only one 1.15. Pinned in Task 4.
4. **Hydration under a basename.** Clicking an internal link inside `/v/1.12/` must stay inside `/v/1.12/`, and the injected noindex tag must not break hydration. Pinned in Task 0 (spike output) and Task 7 (assembled site).
5. **A snapshot asset missing on a release** (backfill not run, or an upload that failed). Expect the deploy to fail loudly and name the tag, not silently publish a site with no root. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/react-router.config.ts` (modify) | `basename` from `DOCS_BASE` |
| `docs/vite.config.ts` (modify) | `base` from `DOCS_BASE` |
| `docs/src/versioning/versions.ts` | types, the current version, manifest parsing, href mapping |
| `docs/src/versioning/strings.ts` | en/ru copy for the picker and banner |
| `docs/src/versioning/VersionPicker.tsx` | the header dropdown |
| `docs/src/versioning/VersionBanner.tsx` | the "old / unreleased docs" strip |
| `docs/src/components/layout/Nav.tsx` (modify) | mounts both |
| `docs/scripts/docs-versions.mjs` | pure logic: release selection, manifest, relocation, noindex, pages.json, budget |
| `docs/scripts/build-snapshot.mjs` | CLI: build one snapshot dir and tar it |
| `docs/scripts/assemble-site.mjs` | CLI: download snapshots and assemble the Pages tree |
| `docs/scripts/apply-versioning-overlay.mjs` | CLI: graft versioning onto an old tag's checkout |
| `.github/workflows/deploy-docs.yml` (modify) | snapshot on release; assemble on every deploy |
| `.github/workflows/docs-backfill.yml` | one-off build of 1.7–1.15 |
| `scripts/verify-live-docs.mjs` (modify) | probes for `/next/`, an archive and `/versions.json` |
| `docs/src/versioning/*.test.ts(x)` | tests (vitest only collects `docs/src/**`, which is why `seo-artifacts.test.ts` sits in `src/` too) |

Run docs tests with: `cd docs && npx vitest run <paths>`.

---

### Task 0: Gate — hydration under a basename (spike output)

There is no code in this task. It checks the one unverified runtime claim before anything is built on it.

**Files:** none. The spike worktree `~/Packages/.blok-undo/wt/docs-v16` is at v1.7.0, with output in `docs/dist/client/`.

- [ ] **Step 1: Relocate the spike output into a servable tree**

```bash
cd ~/Packages/.blok-undo/wt/docs-v16/docs/dist/client
mkdir -p /tmp/claude-501/docsver/site/v/1.7
cp -R v/1.7/. /tmp/claude-501/docsver/site/v/1.7/
cp -R assets /tmp/claude-501/docsver/site/v/1.7/assets
cp -R fonts *.png *.ico *.svg site.webmanifest /tmp/claude-501/docsver/site/
cd /tmp/claude-501/docsver/site && npx --yes serve -l 4599 . &
```

- [ ] **Step 2: Drive it with `playwright-cli`** (load the `playwright-cli` skill; run `playwright-cli list` first and reuse a session)

Open `http://localhost:4599/v/1.7/docs/quick-start/`. Click a sidebar link, e.g. "Table".
Expected:
- the URL becomes `/v/1.7/docs/table` with no full reload
- the console shows no hydration error
- every asset request hits `/v/1.7/assets/…` and returns 200

- [ ] **Step 3: Insert `<meta name="robots" content="noindex, follow">` right after `<head>` in that one HTML file by hand. Reload and repeat Step 2.**

Expected: no hydration error.
If this fails, stop: Task 4's `injectNoindex` needs a different placement. Report back before continuing.

- [ ] **Step 4: Record the result** (pass/fail and console output) in the plan's checkbox notes. No commit.

---

### Task 1: Base path from the environment

**Files:**
- Modify: `docs/react-router.config.ts`
- Modify: `docs/vite.config.ts` (the `defineConfig({` object)
- Create: `docs/src/versioning/base-config.test.ts`

**Interfaces:**
- Produces: `DOCS_BASE` env var (default `/`, always with a leading and trailing slash) read at config time. `import.meta.env.BASE_URL` equals it at runtime.

- [ ] **Step 1: Write the failing test**

```ts
// docs/src/versioning/base-config.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  const rr = (await import('../../react-router.config')).default;
  const vite = (await import('../../vite.config')).default;
  return { rr, vite };
};

describe('docs base path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('serves from the site root by default', async () => {
    vi.stubEnv('DOCS_BASE', '');
    const { rr, vite } = await load();
    expect(rr.basename).toBe('/');
    expect(vite.base).toBe('/');
  });

  it('builds under the DOCS_BASE subpath', async () => {
    vi.stubEnv('DOCS_BASE', '/v/1.14/');
    const { rr, vite } = await load();
    expect(rr.basename).toBe('/v/1.14/');
    expect(vite.base).toBe('/v/1.14/');
  });
});
```

If `vite.config.ts` exports a function rather than an object, call it with `{ command: 'build', mode: 'production' }`. Check the export first; `src/vite-config.test.ts` already imports it.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd docs && npx vitest run src/versioning/base-config.test.ts`
Expected: FAIL. `basename` is `undefined`.

- [ ] **Step 3: Implement**

In `docs/react-router.config.ts`, after `ssr: false,`:

```ts
  // `/v/1.14/` for an archived minor, `/next/` for main. Assets and links follow it.
  basename: process.env.DOCS_BASE || '/',
```

In `docs/vite.config.ts`, as the first key of the `defineConfig({` object:

```ts
  // Must match react-router.config.ts `basename`, or assets 404 under a subpath.
  base: process.env.DOCS_BASE || '/',
```

- [ ] **Step 4: Run it and watch it pass**, then run `npx vitest run src/vite-config.test.ts src/routes.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/react-router.config.ts docs/vite.config.ts docs/src/versioning/base-config.test.ts
git commit -m "feat(docs): take the base path from DOCS_BASE"
```

---

### Task 2: Version model and href mapping

**Files:**
- Create: `docs/src/versioning/versions.ts`
- Create: `docs/src/versioning/versions.test.ts`

**Interfaces:**
- Produces:
  - `interface DocsVersion { id: string; label: string; path: string }`. `path` is site-absolute with a trailing slash: `/`, `/next/` or `/v/1.14/`.
  - `interface VersionsManifest { latest: string; versions: DocsVersion[] }`
  - `currentVersionId(): string` returns `import.meta.env.VITE_DOCS_VERSION`, or `'next'` when unset.
  - `parseVersionsManifest(json: unknown): VersionsManifest | null`
  - `versionHref(target: DocsVersion, routerPath: string, targetPages: readonly string[] | null): string`. `routerPath` is the basename-stripped path from `useLocation()` (e.g. `/ru/docs/table`). `targetPages` lists the target's served paths without its base (e.g. `['/', '/docs/table', '/ru/docs/table']`). `null` means unknown, so the page is assumed to exist.

- [ ] **Step 1: Write the failing tests**

```ts
// docs/src/versioning/versions.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentVersionId, parseVersionsManifest, versionHref } from './versions';

const v114 = { id: '1.14', label: '1.14', path: '/v/1.14/' };
const root = { id: '1.15', label: '1.15', path: '/' };

describe('versionHref', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('falls back to the target home in the same locale when the page does not exist there', () => {
    expect(versionHref(v114, '/ru/docs/audio', ['/', '/ru', '/docs/table', '/ru/docs/table'])).toBe('/v/1.14/ru/');
    expect(versionHref(v114, '/docs/audio', ['/', '/ru', '/docs/table'])).toBe('/v/1.14/');
  });

  it('keeps the page and the locale when the target has it', () => {
    expect(versionHref(v114, '/ru/docs/table', ['/', '/ru', '/ru/docs/table'])).toBe('/v/1.14/ru/docs/table/');
    expect(versionHref(root, '/docs/table', ['/', '/docs/table'])).toBe('/docs/table/');
  });

  it('assumes the page exists when the target page list is unknown', () => {
    expect(versionHref(v114, '/docs/table', null)).toBe('/v/1.14/docs/table/');
  });

  it('maps the home page to the target base', () => {
    expect(versionHref(v114, '/', ['/'])).toBe('/v/1.14/');
  });
});

describe('parseVersionsManifest', () => {
  it('accepts a well-formed manifest', () => {
    const json = { latest: '1.15', versions: [root, v114] };
    expect(parseVersionsManifest(json)).toEqual(json);
  });

  it('rejects anything malformed instead of throwing', () => {
    expect(parseVersionsManifest(null)).toBeNull();
    expect(parseVersionsManifest({ latest: '1.15' })).toBeNull();
    expect(parseVersionsManifest({ latest: '1.15', versions: [{ id: 1 }] })).toBeNull();
  });
});

describe('currentVersionId', () => {
  it('reads the build-time version', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '1.14');
    expect(currentVersionId()).toBe('1.14');
  });

  it('is next when the build does not say', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '');
    expect(currentVersionId()).toBe('next');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd docs && npx vitest run src/versioning/versions.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// docs/src/versioning/versions.ts
// Copied verbatim into old tags by apply-versioning-overlay.mjs. Import only
// react, react-router, lucide-react and @/lib/utils from this folder.

export interface DocsVersion {
  id: string;
  label: string;
  /** Site-absolute, with a trailing slash: `/`, `/next/`, `/v/1.14/`. */
  path: string;
}

export interface VersionsManifest {
  latest: string;
  versions: DocsVersion[];
}

/** Served from the site root by every version, so old snapshots see new entries. */
export const VERSIONS_URL = '/versions.json';

export const currentVersionId = (): string => import.meta.env.VITE_DOCS_VERSION || 'next';

const isVersion = (value: unknown): value is DocsVersion => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.label === 'string' && typeof record.path === 'string';
};

export const parseVersionsManifest = (json: unknown): VersionsManifest | null => {
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  if (typeof record.latest !== 'string' || !Array.isArray(record.versions)) return null;
  if (!record.versions.every(isVersion)) return null;
  return { latest: record.latest, versions: record.versions };
};

const trimSlash = (path: string): string => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);

const localeHome = (routerPath: string): string => (routerPath === '/ru' || routerPath.startsWith('/ru/') ? '/ru' : '/');

export const versionHref = (
  target: DocsVersion,
  routerPath: string,
  targetPages: readonly string[] | null,
): string => {
  const path = trimSlash(routerPath) || '/';
  const exists = targetPages === null || targetPages.includes(path);
  const page = exists ? path : localeHome(path);
  return page === '/' ? target.path : `${target.path}${page.slice(1)}/`;
};
```

Add `readonly VITE_DOCS_VERSION?: string` to the `ImportMetaEnv` interface in `docs/src/vite-env.d.ts`. If that interface doesn't exist, add:

```ts
interface ImportMetaEnv {
  readonly VITE_DOCS_VERSION?: string;
}
```

- [ ] **Step 4: Run and watch them pass.** Run `cd docs && npx tsc --noEmit -p tsconfig.json`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add docs/src/versioning/versions.ts docs/src/versioning/versions.test.ts docs/src/vite-env.d.ts
git commit -m "feat(docs): add the docs version model and cross-version links"
```

---

### Task 3: Version picker and banner in the header

**Files:**
- Create: `docs/src/versioning/strings.ts`
- Create: `docs/src/versioning/VersionPicker.tsx`, `docs/src/versioning/VersionPicker.test.tsx`
- Create: `docs/src/versioning/VersionBanner.tsx`, `docs/src/versioning/VersionBanner.test.tsx`
- Modify: `docs/src/components/layout/Nav.tsx`. Import both, render `<VersionPicker />` immediately before `<LanguageSelector />`, and render `<VersionBanner />` as the first child of `<nav … data-blok-testid="nav">`.

**Interfaces:**
- Consumes: `DocsVersion`, `VERSIONS_URL`, `currentVersionId`, `parseVersionsManifest` and `versionHref` from Task 2.
- Produces: `VersionPicker` and `VersionBanner` (no props). Task 6's overlay inserts exactly these two lines into old `Nav.tsx` files:
  - `            <VersionPicker />` before the line `            <LanguageSelector />`
  - `        <VersionBanner />` after the two lines `        data-blok-testid="nav"` / `      >`
  - plus the imports `import { VersionPicker } from "../../versioning/VersionPicker";` and `import { VersionBanner } from "../../versioning/VersionBanner";`

- [ ] **Step 1: Write the failing tests**

```tsx
// docs/src/versioning/VersionPicker.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VersionPicker } from './VersionPicker';

const manifest = {
  latest: '1.15',
  versions: [
    { id: 'next', label: 'Next', path: '/next/' },
    { id: '1.15', label: '1.15', path: '/' },
    { id: '1.14', label: '1.14', path: '/v/1.14/' },
  ],
};

const respond = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

const renderAt = (path: string, basename?: string) =>
  render(
    <MemoryRouter basename={basename} initialEntries={[`${basename ?? ''}${path}`]}>
      <VersionPicker />
    </MemoryRouter>,
  );

describe('VersionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_DOCS_VERSION', '1.14');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('still shows the current version when versions.json cannot be loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('offline')));
    renderAt('/docs/table', '/v/1.14');
    const trigger = screen.getByRole('button', { name: /1\.14/ });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(1));
  });

  it('links every version to the same page and keeps the locale', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      String(url).endsWith('pages.json')
        ? respond(['/', '/ru', '/ru/docs/table'])
        : respond(manifest),
    );
    renderAt('/ru/docs/table', '/v/1.14');
    fireEvent.click(screen.getByRole('button', { name: /1\.14/ }));
    const latest = await screen.findByRole('menuitem', { name: /1\.15/ });
    await waitFor(() => expect(latest).toHaveAttribute('href', '/ru/docs/table/'));
  });

  it('marks the current version with a check and primary ink, not a fill', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(manifest));
    renderAt('/', '/v/1.14');
    fireEvent.click(screen.getByRole('button', { name: /1\.14/ }));
    const current = await screen.findByRole('menuitem', { name: /1\.14/ });
    const other = await screen.findByRole('menuitem', { name: /1\.15/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    // Only the hover fill is allowed; a resting fill or blue ink is a selected-state violation.
    expect(current.className.split(/\s+/).filter((c) => c.startsWith('bg-'))).toEqual([]);
    expect(current.className).not.toMatch(/blue/);
    expect(current.className).toContain('text-foreground');
    expect(other.className).not.toContain('text-foreground');
  });
});
```

```tsx
// docs/src/versioning/VersionBanner.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VersionBanner } from './VersionBanner';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <VersionBanner />
    </MemoryRouter>,
  );

describe('VersionBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('tells an archive reader which version they are on and links to latest', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '1.12');
    vi.stubEnv('BASE_URL', '/v/1.12/');
    renderAt('/docs/table');
    expect(screen.getByText(/1\.12/)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/');
  });

  it('speaks Russian inside the /ru tree and links to the Russian latest', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '1.12');
    vi.stubEnv('BASE_URL', '/v/1.12/');
    renderAt('/ru/docs/table');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/ru/');
    expect(screen.getByRole('status').textContent).toMatch(/[а-я]/);
  });

  it('flags /next/ as unreleased', () => {
    vi.stubEnv('VITE_DOCS_VERSION', 'next');
    vi.stubEnv('BASE_URL', '/next/');
    renderAt('/');
    expect(screen.getByRole('status').textContent).toMatch(/unreleased/i);
  });

  it('renders nothing on the root build', () => {
    vi.stubEnv('VITE_DOCS_VERSION', '1.15');
    vi.stubEnv('BASE_URL', '/');
    const { container } = renderAt('/');
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd docs && npx vitest run src/versioning/VersionPicker.test.tsx src/versioning/VersionBanner.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// docs/src/versioning/strings.ts
// Not in en.json/ru.json: old tags get this folder copied in, and their
// translation files lack these keys.
export const VERSION_STRINGS = {
  en: {
    pickerLabel: 'Documentation version',
    next: 'Next',
    archive: (version: string) => `You're viewing docs for ${version}.`,
    unreleased: "You're viewing docs for an unreleased version.",
    toLatest: 'Go to the latest version',
  },
  ru: {
    pickerLabel: 'Версия документации',
    next: 'Следующая',
    archive: (version: string) => `Вы читаете документацию версии ${version}.`,
    unreleased: 'Вы читаете документацию невыпущенной версии.',
    toLatest: 'Перейти к последней версии',
  },
} as const;

export const stringsFor = (routerPath: string) =>
  routerPath === '/ru' || routerPath.startsWith('/ru/') ? VERSION_STRINGS.ru : VERSION_STRINGS.en;
```

```tsx
// docs/src/versioning/VersionBanner.tsx
import { useLocation } from 'react-router';
import { currentVersionId } from './versions';
import { stringsFor } from './strings';

export const VersionBanner = () => {
  const { pathname } = useLocation();
  if (import.meta.env.BASE_URL === '/') return null;

  const strings = stringsFor(pathname);
  const id = currentVersionId();
  const ru = strings === stringsFor('/ru');

  return (
    <div
      role="status"
      className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-6 py-1.5 text-center text-[13px] font-medium text-muted-foreground"
    >
      <span>{id === 'next' ? strings.unreleased : strings.archive(id)}</span>
      {/* A plain <a>: the latest version is a different app, so the router must not handle it. */}
      <a href={ru ? '/ru/' : '/'} className="font-semibold text-foreground underline underline-offset-2">
        {strings.toLatest}
      </a>
    </div>
  );
};
```

```tsx
// docs/src/versioning/VersionPicker.tsx
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type DocsVersion, VERSIONS_URL, currentVersionId, parseVersionsManifest, versionHref } from './versions';
import { stringsFor } from './strings';

const labelFor = (id: string, next: string) => (id === 'next' ? next : id);

export const VersionPicker = () => {
  const { pathname } = useLocation();
  const strings = stringsFor(pathname);
  const currentId = currentVersionId();
  const self: DocsVersion = { id: currentId, label: labelFor(currentId, strings.next), path: import.meta.env.BASE_URL };

  const [versions, setVersions] = useState<DocsVersion[]>([self]);
  const [pages, setPages] = useState<Record<string, string[] | null>>({});
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetched after hydration: the prerendered HTML lists only the current
  // version, so server and client markup match.
  useEffect(() => {
    let cancelled = false;
    fetch(VERSIONS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        const manifest = parseVersionsManifest(json);
        if (cancelled || !manifest) return;
        setVersions(manifest.versions);
        manifest.versions.forEach((version) => {
          fetch(`${version.path}pages.json`)
            .then((response) => (response.ok ? response.json() : null))
            .then((list) => {
              if (cancelled) return;
              setPages((prev) => ({ ...prev, [version.id]: Array.isArray(list) ? list : null }));
            })
            .catch(() => undefined);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className={cn(
          'flex h-9 cursor-pointer items-center gap-1 rounded-full px-3 text-sm font-semibold text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          isOpen && 'bg-secondary text-foreground',
        )}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`${strings.pickerLabel}: ${self.label}`}
      >
        {self.label}
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </button>

      <div
        className={cn(
          'absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-[10rem] origin-top-right rounded-2xl border border-border bg-popover p-1.5 shadow-card transition-all duration-150',
          isOpen ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
        )}
        role="menu"
        aria-label={strings.pickerLabel}
        aria-hidden={!isOpen}
      >
        {versions.map((version) => {
          const active = version.id === currentId;
          const label = labelFor(version.id, strings.next);
          return (
            // A plain <a>: every version is its own app.
            <a
              key={version.id}
              href={versionHref(version, pathname, pages[version.id] ?? null)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-secondary',
                active && 'text-foreground',
              )}
              role="menuitem"
              aria-current={active ? 'true' : undefined}
              tabIndex={isOpen ? 0 : -1}
            >
              <span className="flex-1">{label}</span>
              <Check className={cn('size-4 transition-opacity', active ? 'opacity-100' : 'opacity-0')} strokeWidth={2.5} />
            </a>
          );
        })}
      </div>
    </div>
  );
};
```

Wire both into `Nav.tsx` exactly as listed under **Interfaces**.

- [ ] **Step 4: Run the new tests and watch them pass**, then run `cd docs && npx vitest run src/components/layout/Nav.test.tsx` and `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 5: Look at it.** Run `cd docs && VITE_DOCS_VERSION=1.14 DOCS_BASE=/v/1.14/ npx react-router dev`. Open `/v/1.14/docs/table` with `playwright-cli`. Check:
  - the banner shows above the bar
  - the picker sits left of the globe and opens a one-entry menu (there is no versions.json in dev)
  - light and dark themes both look right
  - at 375 px width the header doesn't overflow. If it does, hide the picker label below `sm` and keep the chevron.

- [ ] **Step 6: Commit**

```bash
git add docs/src/versioning docs/src/components/layout/Nav.tsx
git commit -m "feat(docs): add the version picker and archive banner to the header"
```

---

### Task 4: Snapshot and assembly logic (pure)

**Files:**
- Create: `docs/scripts/docs-versions.mjs`
- Create: `docs/src/versioning/docs-versions.test.ts`

**Interfaces:**
- Produces (all named exports of `docs/scripts/docs-versions.mjs`):
  - `selectSnapshots(tags: string[], { oldest = '1.7' } = {}) → { root: { tag, minor }, archives: { tag, minor }[] }`. Stable `vX.Y.Z` only, newest patch per minor, newest minor = root, archives sorted newest first, minors below `oldest` dropped. Throws when no stable tag exists.
  - `buildVersionsManifest(selection) → VersionsManifest`. Order: `next`, then root, then archives.
  - `relocateBuild(clientDir: string, base: string) → void`. Moves every top-level entry of `clientDir` except the base's first segment into `clientDir/<base>`, and deletes the root `index.html` (the SPA fallback). No-op when `base === '/'`.
  - `listPages(snapshotDir: string) → string[]`. Paths of every `index.html` under `snapshotDir`, relative and slashless (`/`, `/docs/table`, `/ru`), sorted. Skips `/404`.
  - `injectNoindex(snapshotDir: string) → number`. Inserts `<meta name="robots" content="noindex, follow">` right after `<head>` in every `.html` file that lacks it, and returns how many it changed. Placement depends on Task 0's result.
  - `snapshotAssetNames(minor: string) → { root: 'docs-root.tgz', archive: \`docs-v${minor}.tgz\` }`
  - `pruneToBudget(entries: { minor: string, bytes: number }[], fixedBytes: number, budget = 900 * 1024 ** 2) → string[]`. Returns the archive minors to KEEP, dropping the oldest first until the total fits.

- [ ] **Step 1: Write the failing tests**

```ts
// docs/src/versioning/docs-versions.test.ts
// The module lives in docs/scripts/ (a build step), but vitest only collects src/**.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVersionsManifest,
  injectNoindex,
  listPages,
  pruneToBudget,
  relocateBuild,
  selectSnapshots,
} from '../../scripts/docs-versions.mjs';

describe('selectSnapshots', () => {
  it('takes the newest patch per minor, skips prereleases and never duplicates the latest minor', () => {
    const selection = selectSnapshots(['v1.15.0', 'v1.15.2', 'v1.16.0-beta.1', 'v1.14.0', 'v1.6.2', 'v1.7.0']);
    expect(selection.root).toEqual({ tag: 'v1.15.2', minor: '1.15' });
    expect(selection.archives).toEqual([
      { tag: 'v1.14.0', minor: '1.14' },
      { tag: 'v1.7.0', minor: '1.7' },
    ]);
  });

  it('sorts minors numerically, not as strings', () => {
    const selection = selectSnapshots(['v1.9.0', 'v1.10.1', 'v1.8.0']);
    expect(selection.root.minor).toBe('1.10');
    expect(selection.archives.map((a) => a.minor)).toEqual(['1.9', '1.8']);
  });

  it('fails loudly when there is no stable release', () => {
    expect(() => selectSnapshots(['v2.0.0-beta.1'])).toThrow(/stable/);
  });
});

describe('buildVersionsManifest', () => {
  it('lists next, then the root release, then archives', () => {
    const manifest = buildVersionsManifest({
      root: { tag: 'v1.15.2', minor: '1.15' },
      archives: [{ tag: 'v1.14.0', minor: '1.14' }],
    });
    expect(manifest).toEqual({
      latest: '1.15',
      versions: [
        { id: 'next', label: 'Next', path: '/next/' },
        { id: '1.15', label: '1.15', path: '/' },
        { id: '1.14', label: '1.14', path: '/v/1.14/' },
      ],
    });
  });
});

describe('file steps', () => {
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'docs-versions-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const file = (path: string, body = '<html><head><title>x</title></head></html>') => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  };

  it('moves assets under the base and drops the SPA fallback', () => {
    file('v/1.14/docs/table/index.html');
    file('assets/client-abc.js', 'js');
    file('favicon.ico', 'ico');
    file('index.html');
    relocateBuild(dir, '/v/1.14/');
    expect(existsSync(join(dir, 'v/1.14/assets/client-abc.js'))).toBe(true);
    expect(existsSync(join(dir, 'v/1.14/favicon.ico'))).toBe(true);
    expect(existsSync(join(dir, 'index.html'))).toBe(false);
    expect(existsSync(join(dir, 'assets'))).toBe(false);
  });

  it('lists served pages without the 404 page', () => {
    file('index.html');
    file('docs/table/index.html');
    file('ru/index.html');
    file('404/index.html');
    expect(listPages(dir)).toEqual(['/', '/docs/table', '/ru']);
  });

  it('marks every page noindex once', () => {
    file('docs/table/index.html');
    expect(injectNoindex(dir)).toBe(1);
    expect(injectNoindex(dir)).toBe(0);
    expect(readFileSync(join(dir, 'docs/table/index.html'), 'utf8')).toContain(
      '<head><meta name="robots" content="noindex, follow">',
    );
  });
});

describe('pruneToBudget', () => {
  it('drops the oldest minors first until the site fits', () => {
    const mb = 1024 ** 2;
    const keep = pruneToBudget(
      [
        { minor: '1.14', bytes: 300 * mb },
        { minor: '1.13', bytes: 300 * mb },
        { minor: '1.12', bytes: 300 * mb },
      ],
      100 * mb,
    );
    expect(keep).toEqual(['1.14', '1.13']);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd docs && npx vitest run src/versioning/docs-versions.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `docs/scripts/docs-versions.mjs`

```js
// docs/scripts/docs-versions.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const STABLE = /^v(\d+)\.(\d+)\.(\d+)$/;

const compareMinor = (a, b) => {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);
  return bMajor - aMajor || bMinor - aMinor;
};

export const selectSnapshots = (tags, { oldest = '1.7' } = {}) => {
  const newestPerMinor = new Map();
  for (const tag of tags) {
    const match = STABLE.exec(tag);
    if (!match) continue;
    const minor = `${match[1]}.${match[2]}`;
    const patch = Number(match[3]);
    const seen = newestPerMinor.get(minor);
    if (!seen || patch > seen.patch) newestPerMinor.set(minor, { tag, minor, patch });
  }
  const minors = [...newestPerMinor.keys()].filter((minor) => compareMinor(minor, oldest) <= 0).sort(compareMinor);
  if (minors.length === 0) throw new Error('No stable release tag found; cannot pick the root docs version.');
  const pick = (minor) => ({ tag: newestPerMinor.get(minor).tag, minor });
  return { root: pick(minors[0]), archives: minors.slice(1).map(pick) };
};

export const buildVersionsManifest = ({ root, archives }) => ({
  latest: root.minor,
  versions: [
    { id: 'next', label: 'Next', path: '/next/' },
    { id: root.minor, label: root.minor, path: '/' },
    ...archives.map(({ minor }) => ({ id: minor, label: minor, path: `/v/${minor}/` })),
  ],
});

export const snapshotAssetNames = (minor) => ({ root: 'docs-root.tgz', archive: `docs-v${minor}.tgz` });

// React Router writes prerendered HTML under the base, but assets and public/
// files at the build root while referencing them as `<base>assets/...`.
export const relocateBuild = (clientDir, base) => {
  if (base === '/') return;
  const segments = base.split('/').filter(Boolean);
  const target = join(clientDir, ...segments);
  mkdirSync(target, { recursive: true });
  // The root index.html is the SPA fallback for `/`, which this snapshot does not own.
  rmSync(join(clientDir, 'index.html'), { force: true });
  for (const entry of readdirSync(clientDir)) {
    if (entry === segments[0]) continue;
    renameSync(join(clientDir, entry), join(target, entry));
  }
};

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

export const listPages = (snapshotDir) =>
  walk(snapshotDir)
    .filter((path) => path.endsWith(`${sep}index.html`) || path === join(snapshotDir, 'index.html'))
    .map((path) => `/${relative(snapshotDir, path).split(sep).slice(0, -1).join('/')}`)
    .filter((path) => path !== '/404')
    .sort();

const NOINDEX = '<meta name="robots" content="noindex, follow">';

export const injectNoindex = (snapshotDir) => {
  let changed = 0;
  for (const path of walk(snapshotDir)) {
    if (!path.endsWith('.html')) continue;
    const html = readFileSync(path, 'utf8');
    if (html.includes(NOINDEX) || !html.includes('<head>')) continue;
    writeFileSync(path, html.replace('<head>', `<head>${NOINDEX}`));
    changed += 1;
  }
  return changed;
};

export const pruneToBudget = (entries, fixedBytes, budget = 900 * 1024 ** 2) => {
  const kept = [...entries];
  const total = () => fixedBytes + kept.reduce((sum, entry) => sum + entry.bytes, 0);
  while (kept.length > 0 && total() > budget) kept.pop();
  return kept.map((entry) => entry.minor);
};

export const dirBytes = (dir) => (existsSync(dir) ? walk(dir).reduce((sum, path) => sum + statSync(path).size, 0) : 0);
```

Check the prerendered `<head>` markup: the spike HTML starts `<!DOCTYPE html><html lang="en"><head><meta charSet=…`, so a bare `<head>` exists. If the Task 0 result moved the tag elsewhere, change the replace target to match.

- [ ] **Step 4: Run and watch them pass**

- [ ] **Step 5: Commit**

```bash
git add docs/scripts/docs-versions.mjs docs/src/versioning/docs-versions.test.ts
git commit -m "feat(docs): add snapshot selection and assembly steps"
```

---

### Task 5: Snapshot and assembly CLIs

**Files:**
- Create: `docs/scripts/build-snapshot.mjs`
- Create: `docs/scripts/assemble-site.mjs`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces these CLIs.
  - `node docs/scripts/build-snapshot.mjs --version <id> --base <base> --out <file.tgz>`. Run from repo root after `yarn build` (the library). For base `/`, it runs `yarn build` in `docs/` (the full build, with sitemap, 404.html and llms). Otherwise it runs `npx tsc && npx react-router build` in `docs/` with no SEO artifacts. Then: `relocateBuild`, `injectNoindex` (non-root only), `pages.json` written into the base dir, e.g. `dist/client/v/1.14/pages.json`, so it is served at `<base>pages.json` (computed by `listPages` on that dir), and the tar of `docs/dist/client` into `--out`. Env passed to the build: `DOCS_BASE`, `VITE_DOCS_VERSION`.
  - `node docs/scripts/assemble-site.mjs --next <next.tgz> --out <dir> [--local-dir <dir with tarballs>]`. Lists tags with `gh release list --exclude-pre-releases --exclude-drafts --limit 200 --json tagName`. Then `selectSnapshots` and `gh release download <tag> -p <asset> -D <tmp>` for root + archives. With `--local-dir` it reads `<dir>/<tag>/<asset>` instead, for tests and dry runs. It unpacks root into `<out>`, `next.tgz` into `<out>`, and each archive into `<out>`. It prunes by `pruneToBudget` (fixed = root + next), deleting pruned `v/<minor>` dirs, and writes `<out>/versions.json` from the kept selection. It exits 1 naming the tag when an asset is missing.

- [ ] **Step 1: Write the failing test.** Add an end-to-end case to `docs-versions.test.ts`. It builds fake tarballs with `tar -czf` from tiny trees (`index.html`, `pages.json`) under `<tmp>/releases/<tag>/`, runs `assemble-site.mjs --local-dir` with tags supplied through a `--tags v1.15.2,v1.14.0` override flag (which skips `gh`), and asserts:
  - `<out>/index.html` comes from the root tarball
  - `<out>/next/index.html` exists
  - `<out>/v/1.14/index.html` exists
  - `versions.json` equals `buildVersionsManifest(...)`

  A second case deletes `<tmp>/releases/v1.14.0/docs-v1.14.tgz` and asserts a non-zero exit with `v1.14.0` in stderr.

```ts
import { execFileSync, spawnSync } from 'node:child_process';

const tgz = (srcDir: string, out: string) => execFileSync('tar', ['-czf', out, '-C', srcDir, '.']);

it('assembles root, next and archives from release tarballs', () => {
  const releases = join(dir, 'releases');
  const tree = (name: string, html: string) => {
    const src = join(dir, 'src', name);
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'index.html'), html);
    return src;
  };
  mkdirSync(join(releases, 'v1.15.2'), { recursive: true });
  mkdirSync(join(releases, 'v1.14.0'), { recursive: true });
  tgz(tree('root', 'ROOT'), join(releases, 'v1.15.2', 'docs-root.tgz'));
  const archiveSrc = join(dir, 'src', 'arch');
  mkdirSync(join(archiveSrc, 'v', '1.14'), { recursive: true });
  writeFileSync(join(archiveSrc, 'v', '1.14', 'index.html'), 'OLD');
  tgz(archiveSrc, join(releases, 'v1.14.0', 'docs-v1.14.tgz'));
  const nextSrc = join(dir, 'src', 'next');
  mkdirSync(join(nextSrc, 'next'), { recursive: true });
  writeFileSync(join(nextSrc, 'next', 'index.html'), 'NEXT');
  tgz(nextSrc, join(dir, 'next.tgz'));

  const out = join(dir, 'site');
  execFileSync('node', [
    'scripts/assemble-site.mjs', '--next', join(dir, 'next.tgz'), '--out', out,
    '--local-dir', releases, '--tags', 'v1.15.2,v1.14.0',
  ], { cwd: join(__dirname, '..', '..') });

  expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe('ROOT');
  expect(readFileSync(join(out, 'next', 'index.html'), 'utf8')).toBe('NEXT');
  expect(readFileSync(join(out, 'v', '1.14', 'index.html'), 'utf8')).toBe('OLD');
  expect(JSON.parse(readFileSync(join(out, 'versions.json'), 'utf8')).latest).toBe('1.15');
});
```

(Use `fileURLToPath(new URL('.', import.meta.url))` for `__dirname`. Write the missing-asset case the same way, using `spawnSync` and asserting `status !== 0` and `stderr` containing `v1.14.0`.)

- [ ] **Step 2: Run and watch it fail.** Expected: FAIL, script not found.

- [ ] **Step 3: Implement both CLIs.** Use `node:util` `parseArgs` and `execFileSync` with `{ stdio: 'inherit' }` for builds and `tar`/`gh`. Keep all logic in `docs-versions.mjs`; the CLIs only parse args, run commands and call those functions.

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Real snapshot smoke test (local).** From repo root:

```bash
yarn build
node docs/scripts/build-snapshot.mjs --version next --base /next/ --out /tmp/claude-501/docsver/next.tgz
node docs/scripts/build-snapshot.mjs --version 1.15 --base / --out /tmp/claude-501/docsver/root.tgz
tar -tzf /tmp/claude-501/docsver/next.tgz | grep -c 'next/assets/' # > 0
tar -tzf /tmp/claude-501/docsver/next.tgz | grep -E '^\./(assets|index\.html)' # nothing
```

- [ ] **Step 6: Commit**

```bash
git add docs/scripts/build-snapshot.mjs docs/scripts/assemble-site.mjs docs/src/versioning/docs-versions.test.ts
git commit -m "feat(docs): add snapshot build and site assembly scripts"
```

---

### Task 6: Overlay for old tags and the backfill workflow

**Files:**
- Create: `docs/scripts/apply-versioning-overlay.mjs`
- Create: `docs/src/versioning/overlay.test.ts`
- Create: `.github/workflows/docs-backfill.yml`

**Interfaces:**
- Consumes: the Nav insertion lines from Task 3, the `DOCS_BASE` config lines from Task 1, and `build-snapshot.mjs` from Task 5.
- Produces: `applyOverlay({ tagDocsDir, sourceDocsDir })`, exported and also run as a CLI (`--tag-docs <dir> --source-docs <dir>`). It:
  1. copies `sourceDocsDir/src/versioning/**` (excluding `*.test.*`) into `tagDocsDir/src/versioning/`
  2. copies `sourceDocsDir/scripts/{docs-versions,build-snapshot}.mjs` into `tagDocsDir/scripts/`
  3. replaces `  ssr: false,` in `react-router.config.ts` with the Task 1 two lines
  4. replaces `export default defineConfig({` in `vite.config.ts` with the Task 1 lines
  5. inserts the two imports after the `LanguageSelector` import line in `Nav.tsx`, plus the two JSX lines
  6. adds `readonly VITE_DOCS_VERSION?: string` to `vite-env.d.ts`

  Every anchor must match **exactly once**, or it throws `Overlay anchor not found in <file>: <anchor>`. It is idempotent: a second run is a no-op.

- [ ] **Step 1: Write the failing test.** Copy the needed files of a real old tag into a temp dir with `git show v1.7.0:docs/<file>` and apply the overlay from `docs/`:
  - assert each anchor was patched exactly once
  - assert a second run changes nothing
  - assert a missing anchor throws with the file name

```ts
import { execFileSync } from 'node:child_process';
import { applyOverlay } from '../../scripts/apply-versioning-overlay.mjs';

const FILES = ['react-router.config.ts', 'vite.config.ts', 'src/components/layout/Nav.tsx', 'src/vite-env.d.ts'];
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

const checkoutTag = (tag: string, into: string) => {
  for (const file of FILES) {
    const body = execFileSync('git', ['show', `${tag}:docs/${file}`], { cwd: repoRoot });
    mkdirSync(join(into, file, '..'), { recursive: true });
    writeFileSync(join(into, file), body);
  }
};

it('grafts the picker onto v1.7.0 once', () => {
  checkoutTag('v1.7.0', dir);
  applyOverlay({ tagDocsDir: dir, sourceDocsDir: join(repoRoot, 'docs') });
  const nav = readFileSync(join(dir, 'src/components/layout/Nav.tsx'), 'utf8');
  expect(nav.match(/<VersionPicker \/>/g)).toHaveLength(1);
  expect(nav.match(/<VersionBanner \/>/g)).toHaveLength(1);
  expect(readFileSync(join(dir, 'react-router.config.ts'), 'utf8')).toContain("basename: process.env.DOCS_BASE || '/'");
  expect(existsSync(join(dir, 'src/versioning/VersionPicker.tsx'))).toBe(true);
  expect(existsSync(join(dir, 'src/versioning/VersionPicker.test.tsx'))).toBe(false);

  applyOverlay({ tagDocsDir: dir, sourceDocsDir: join(repoRoot, 'docs') });
  expect(readFileSync(join(dir, 'src/components/layout/Nav.tsx'), 'utf8')).toBe(nav);
});
```

(Plus a missing-anchor case that writes an empty `Nav.tsx` and expects `/Overlay anchor not found in .*Nav\.tsx/`. If `src/vite-env.d.ts` doesn't exist at v1.7.0, drop it from `FILES` and make step 6 of the overlay create the file.)

- [ ] **Step 2: Run and watch it fail. Step 3: implement. Step 4: run and watch it pass.**

- [ ] **Step 5: Local proof on the oldest tag.** Reuse the spike worktree:

```bash
cd ~/Packages/.blok-undo/wt/docs-v16 && git checkout -f v1.7.0 && git clean -fdq -e node_modules
node /Users/jackuait/Packages/blok/docs/scripts/apply-versioning-overlay.mjs --tag-docs docs --source-docs /Users/jackuait/Packages/blok/docs
yarn install --immutable && yarn build && (cd docs && yarn install --frozen-lockfile)
node docs/scripts/build-snapshot.mjs --version 1.7 --base /v/1.7/ --out /tmp/claude-501/docsver/v1.7.tgz
```

Expected: exit 0. Repeat for `v1.15.2` with `--base /v/1.15/` and also `--base /` (the root). If any tag fails `tsc`, fix the overlay generically. Never per tag, unless the fix is impossible; then stop and report.

- [ ] **Step 6: Write `.github/workflows/docs-backfill.yml`**

```yaml
name: Docs Backfill

on:
  workflow_dispatch:
    inputs:
      tags:
        description: Space-separated release tags (latest patch of each minor)
        required: true
        default: v1.7.0 v1.8.0 v1.9.0 v1.10.1 v1.11.0 v1.12.0 v1.13.0 v1.14.0 v1.15.2
      root_tag:
        description: Tag that also gets the root snapshot (latest stable)
        required: true
        default: v1.15.2

permissions:
  contents: write

jobs:
  prepare:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    outputs:
      tags: ${{ steps.split.outputs.tags }}
    steps:
      - id: split
        env:
          TAGS: ${{ inputs.tags }}
        run: echo "tags=$(jq -cn --arg t "$TAGS" '$t | split(" ") | map(select(length > 0))')" >> "$GITHUB_OUTPUT"

  snapshot:
    name: Snapshot ${{ matrix.tag }}
    needs: prepare
    runs-on: ubuntu-latest
    timeout-minutes: 7
    strategy:
      fail-fast: false
      matrix:
        tag: ${{ fromJSON(needs.prepare.outputs.tags) }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          path: source
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ matrix.tag }}
          path: tag
      - name: Setup Node.js and Dependencies
        uses: ./source/.github/actions/setup-node-deps
        with:
          working-directory: tag
      - name: Graft versioning onto the tag
        run: node source/docs/scripts/apply-versioning-overlay.mjs --tag-docs tag/docs --source-docs source/docs
      - name: Build library and docs deps
        working-directory: tag
        run: yarn build && (cd docs && yarn install --frozen-lockfile)
      - name: Build snapshots and attach them to the release
        working-directory: tag
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ matrix.tag }}
          ROOT_TAG: ${{ inputs.root_tag }}
        run: |
          minor="$(echo "${TAG#v}" | cut -d. -f1,2)"
          node docs/scripts/build-snapshot.mjs --version "$minor" --base "/v/$minor/" --out "docs-v$minor.tgz"
          gh release upload "$TAG" "docs-v$minor.tgz" --clobber --repo "$GITHUB_REPOSITORY"
          if [ "$TAG" = "$ROOT_TAG" ]; then
            node docs/scripts/build-snapshot.mjs --version "$minor" --base / --out docs-root.tgz
            gh release upload "$TAG" docs-root.tgz --clobber --repo "$GITHUB_REPOSITORY"
          fi
```

Before committing, read `.github/actions/setup-node-deps/action.yml`. If it takes no working-directory input, replace that step with `actions/setup-node` (`node-version: 24`) plus `yarn install --immutable` in `tag/`.
The step-5 timings were 42–180 s per tag locally, so the 7-minute cap per matrix job fits.

- [ ] **Step 7: Commit**

```bash
git add docs/scripts/apply-versioning-overlay.mjs docs/src/versioning/overlay.test.ts .github/workflows/docs-backfill.yml
git commit -m "feat(docs): backfill versioned snapshots for past minors"
```

- [ ] **Step 8: STOP and ask the user** to approve pushing and dispatching `Docs Backfill`. It uploads assets to 9 public GitHub releases. After they approve: push, `gh workflow run docs-backfill.yml`, watch it, and confirm with `gh release view v1.14.0 --json assets -q '.assets[].name'` that every tag has its tarball and `v1.15.2` has `docs-root.tgz`.

---

### Task 7: Deploy assembles the versioned site

Do this only after Task 6 Step 8 has succeeded. Until then a deploy would find no snapshots and fail.

**Files:**
- Modify: `.github/workflows/deploy-docs.yml`
- Modify: `scripts/verify-live-docs.mjs`
- Test: `test/unit/scripts/verify-live-docs.test.ts` if one exists (check `ls test/unit/scripts/`). Otherwise add the probe logic as an exported pure function and test it there.

**Interfaces:**
- Consumes: `build-snapshot.mjs` and `assemble-site.mjs`.

- [ ] **Step 1: Add a `snapshot` job** to `deploy-docs.yml`. It runs on `github.event_name == 'release' && !github.event.release.prerelease`, needs `docs-tests` and `verify-release`, has `permissions: contents: write` and `timeout-minutes: 7`, and checks out the release tag. Then:

```bash
yarn build
minor="$(node -p "require('./package.json').version.split('.').slice(0,2).join('.')")"
node docs/scripts/build-snapshot.mjs --version "$minor" --base / --out docs-root.tgz
node docs/scripts/build-snapshot.mjs --version "$minor" --base "/v/$minor/" --out "docs-v$minor.tgz"
gh release upload "$TAG" docs-root.tgz "docs-v$minor.tgz" --clobber
```

- [ ] **Step 2: Change the `build` job.** `needs: [docs-tests, verify-release, snapshot]`, and allow `snapshot` to be `skipped` the same way `verify-release` is. Replace the "Build docs" and "Copy CHANGELOG" steps with:

```bash
node docs/scripts/build-snapshot.mjs --version next --base /next/ --out next.tgz
node docs/scripts/assemble-site.mjs --next next.tgz --out site
cp CHANGELOG.md site/CHANGELOG.md
```

Point "Verify deploy artifact", "Record deploy marker" and `upload-pages-artifact` at `site/` instead of `docs/dist/client/`. Extend "Verify deploy artifact":

```bash
test -f site/next/docs/quick-start/index.html
grep -q 'noindex' site/next/docs/quick-start/index.html
test -s site/versions.json
archive="$(node -p "require('./site/versions.json').versions.find(v => v.path.startsWith('/v/'))?.path ?? ''")"
if [ -n "$archive" ]; then test -f "site${archive}index.html"; grep -q 'noindex' "site${archive}index.html"; fi
! grep -q 'noindex' site/docs/quick-start/index.html
```

Take the deploy marker from `site/next/assets/client-*.js`, NOT `site/assets/`. On a plain main push the root snapshot is unchanged, so a root marker would match the previous deploy and the smoke test's readiness poll would pass against stale content.

- [ ] **Step 3: Extend `scripts/verify-live-docs.mjs`** with probes:
  - `/versions.json` returns 200 and parses
  - `/next/` returns 200
  - the first `/v/` entry returns 200
  - `/sitemap.xml` contains no `/next/` or `/v/` URL

  Write the failing test for the sitemap rule first, against a fixture string.

- [ ] **Step 4: Gate — time it without deploying.** Add a `workflow_dispatch` input `dry_run` (boolean). When true, skip `deploy` and `seo-smoke`. Push, run with `dry_run: true`, and read the timings of the assemble + `upload-pages-artifact` steps. If the `build` job exceeds 7 minutes, report it to the user and propose moving the assembly into its own job before deploying for real. Do not proceed silently.

- [ ] **Step 5: Browser check of the assembled site.** Download the dry run's Pages artifact (`gh run download`), serve it on a free port, and with `playwright-cli`:
  - `/` shows 1.15 and has no banner
  - the picker lists Next, 1.15, 1.14 … 1.7
  - from `/ru/docs/table/`, pick 1.12 → `/v/1.12/ru/docs/table/`
  - from `/docs/audio/` (if present), pick 1.7 → `/v/1.7/`
  - inside `/v/1.12/`, a sidebar click stays under `/v/1.12/`
  - no hydration errors in the console

- [ ] **Step 6: Commit and push**, then watch the next real deploy and `seo-smoke` go green.

```bash
git add .github/workflows/deploy-docs.yml scripts/verify-live-docs.mjs test/unit/scripts/
git commit -m "feat(docs): deploy the versioned docs site"
```

---

### Task 8: Landing

- [ ] Run the full docs test suite (`cd docs && npx vitest run`). It's the docs gate, not the whole repo; per the memory rule, never the full root `yarn test`. Also run `cd docs && npx tsc --noEmit`, and ESLint on the changed root files only.
- [ ] Release note owed (not breaking: no package surface changes). "Docs now have a version picker. `blokeditor.com/` shows the latest release, and unreleased docs moved to `/next/`." Tell the user. The release flow needs no change: the `snapshot` job runs on publish.
- [ ] Remove the spike worktree: `git worktree remove --force ~/Packages/.blok-undo/wt/docs-v16`.
- [ ] `git pull --rebase && git push`, and `git status` shows up to date.
