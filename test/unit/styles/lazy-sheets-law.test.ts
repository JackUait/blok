/**
 * Lazy sheets (src/components/utils/lazy-styles.ts) must compile exactly like
 * main.css. A plain `.css?inline` file skips the Tailwind optimize step, so it
 * loses the browser fallbacks (color-mix and friends) main.css gets. The
 * `@tailwind utilities source(none)` line is what makes @tailwindcss/vite take
 * the file: it emits no utilities, but runs the same optimizer.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATABASE_DRAWINGS } from '../../../src/components/ui/toolbox-preview';

import { lazyEntries } from './helpers/read-main-css';

const MAIN_CSS = resolve(__dirname, '../../../src/styles/main.css');
const LOADER = resolve(__dirname, '../../../src/components/utils/lazy-styles.ts');

const localImports = (file: string): string[] =>
  [...readFileSync(file, 'utf-8').matchAll(/@import\s+['"](\.[^'"]+)['"]/g)].map(([, spec]) => resolve(dirname(file), spec));

describe('lazy sheets law', () => {
  it.each(lazyEntries().map((entry) => [basename(entry), entry]))('%s goes through the Tailwind optimizer', (_name, entry) => {
    expect(readFileSync(entry, 'utf-8')).toMatch(/^@tailwind utilities source\(none\);$/m);
  });

  it.each(lazyEntries().map((entry) => [basename(entry), entry]))('%s is loaded by lazy-styles.ts', (name) => {
    expect(readFileSync(LOADER, 'utf-8')).toContain(`import('../../styles/lazy/${name}?inline')`);
  });

  it('every marker rule in main.css names a lazy sheet', () => {
    const names = lazyEntries().map((entry) => basename(entry, '.css'));
    const markers = [...readFileSync(MAIN_CSS, 'utf-8').matchAll(/\[data-blok-sheet='([^']+)'\] \{ --blok-sheet: ([^;]+); \}/g)];

    expect(markers.filter(([, name, value]) => name !== value || !names.includes(name))).toEqual([]);
    expect(readFileSync(MAIN_CSS, 'utf-8').match(/data-blok-sheet/g)?.length ?? 0).toBe(markers.length);
  });

  it('the toolbox preview knows every drawing that reads the database sheet', () => {
    const previewDir = resolve(__dirname, '../../../src/styles/block-preview');
    const databaseDrawings = readFileSync(resolve(previewDir, 'database.css'), 'utf-8');
    const named = new Set([...databaseDrawings.matchAll(/data-blok-preview='([a-z-]+)'/g)].map(([, name]) => name));
    const others = [...readdirSync(previewDir).filter((file) => file !== 'database.css'), '../block-preview.css']
      .filter((file) => readFileSync(resolve(previewDir, file), 'utf-8').includes('--blok-database-'));

    expect([...named].sort()).toEqual([...DATABASE_DRAWINGS].sort());
    expect(others).toEqual([]);
  });

  it('main.css does not also import a lazy sheet', () => {
    const lazySheets = lazyEntries().flatMap(localImports);
    const eager = localImports(MAIN_CSS);

    expect(eager.filter((file) => lazySheets.includes(file))).toEqual([]);
  });
});
