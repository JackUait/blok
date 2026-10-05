// The module lives in docs/scripts/ (a build step), but vitest only collects src/**.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOverlay } from '../../scripts/apply-versioning-overlay.mjs';

const FILES = ['react-router.config.ts', 'vite.config.ts', 'src/components/layout/Nav.tsx', 'src/vite-env.d.ts'];
// jsdom swaps the global URL class, which node's fileURLToPath rejects.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sourceDocsDir = join(repoRoot, 'docs');

// Verbatim copies of tag v1.7.0 (`git show v1.7.0:docs/<path>`), so CI's tagless checkout works.
// The `.fixture` suffix keeps docs tsc and vitest from treating them as source.
const fixturesDir = join(sourceDocsDir, 'src', 'versioning', '__fixtures__');

const checkoutTag = (tag: string, into: string): void => {
  for (const file of FILES) {
    const name = file.split('/').pop() ?? file;
    mkdirSync(join(into, file, '..'), { recursive: true });
    copyFileSync(join(fixturesDir, tag, `${name}.fixture`), join(into, file));
  }
};

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');
const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('applyOverlay', () => {
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'docs-overlay-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('grafts the picker onto v1.7.0 once', () => {
    checkoutTag('v1.7.0', dir);
    applyOverlay({ tagDocsDir: dir, sourceDocsDir });

    const nav = read(dir, 'src/components/layout/Nav.tsx');
    expect(nav.match(/<VersionPicker \/>/g)).toHaveLength(1);
    expect(nav.match(/<VersionBanner \/>/g)).toHaveLength(1);
    expect(count(nav, 'import { VersionPicker } from "../../versioning/VersionPicker";')).toBe(1);
    expect(count(nav, 'import { VersionBanner } from "../../versioning/VersionBanner";')).toBe(1);
    expect(nav).toContain('            <VersionPicker />\n            <LanguageSelector />');
    expect(nav).toContain('        data-blok-testid="nav"\n      >\n        <VersionBanner />');

    const routerConfig = read(dir, 'react-router.config.ts');
    expect(count(routerConfig, "basename: process.env.DOCS_BASE || '/'")).toBe(1);
    expect(count(read(dir, 'vite.config.ts'), "base: process.env.DOCS_BASE || '/'")).toBe(1);
    expect(count(read(dir, 'src/vite-env.d.ts'), 'readonly VITE_DOCS_VERSION?: string;')).toBe(1);

    expect(existsSync(join(dir, 'src/versioning/VersionPicker.tsx'))).toBe(true);
    expect(existsSync(join(dir, 'src/versioning/VersionPicker.test.tsx'))).toBe(false);
    expect(existsSync(join(dir, 'scripts/docs-versions.mjs'))).toBe(true);
    expect(existsSync(join(dir, 'scripts/build-snapshot.mjs'))).toBe(true);
    // docs-backfill.yml audits the tag's root build with the tag's own manifest.
    expect(existsSync(join(dir, 'scripts/audit-build-output.mjs'))).toBe(true);
    expect(existsSync(join(dir, 'scripts/build-audit.mjs'))).toBe(true);
    expect(existsSync(join(dir, 'src/versioning/__fixtures__'))).toBe(false);

    const before = FILES.map((file) => read(dir, file));
    applyOverlay({ tagDocsDir: dir, sourceDocsDir });
    expect(FILES.map((file) => read(dir, file))).toEqual(before);
  });

  it('writes the same config lines as the current docs', () => {
    checkoutTag('v1.7.0', dir);
    applyOverlay({ tagDocsDir: dir, sourceDocsDir });

    for (const file of ['react-router.config.ts', 'vite.config.ts', 'src/vite-env.d.ts']) {
      const current = read(sourceDocsDir, file);
      const patched = read(dir, file);
      const grafted = patched.split('\n').filter((l) => /DOCS_BASE|DOCS_VERSION|assets 404|archived minor/.test(l));
      expect(grafted.length).toBeGreaterThan(0);
      for (const line of grafted) {
        expect(current).toContain(line);
      }
    }
  });

  it('inserts the same Nav lines as the current docs', () => {
    checkoutTag('v1.7.0', dir);
    applyOverlay({ tagDocsDir: dir, sourceDocsDir });

    const current = read(sourceDocsDir, 'src/components/layout/Nav.tsx');
    const grafted = read(dir, 'src/components/layout/Nav.tsx')
      .split('\n')
      .filter((l) => /VersionPicker|VersionBanner/.test(l));
    expect(grafted).toHaveLength(4);
    for (const line of grafted) {
      expect(current.split('\n')).toContain(line);
    }
  });

  it('throws with the file name when an anchor is missing', () => {
    checkoutTag('v1.7.0', dir);
    writeFileSync(join(dir, 'src/components/layout/Nav.tsx'), '');
    expect(() => applyOverlay({ tagDocsDir: dir, sourceDocsDir })).toThrow(/Overlay anchor not found in .*Nav\.tsx/);
  });
});
