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

  it('every marker rule in main.css names a lazy sheet, or a part its entry starts', () => {
    const markersIn = (file: string): RegExpMatchArray[] =>
      [...readFileSync(file, 'utf-8').matchAll(/\[data-blok-sheet='([^']+)'\] \{ --blok-sheet: ([^;]+); \}/g)];
    const names = lazyEntries().flatMap((entry) => [basename(entry, '.css'), ...markersIn(entry).map(([, part]) => part)]);
    const markers = markersIn(MAIN_CSS);

    expect(markers.filter(([, name, value]) => name !== value || !names.includes(name))).toEqual([]);
    expect(readFileSync(MAIN_CSS, 'utf-8').match(/data-blok-sheet/g)?.length ?? 0).toBe(markers.length);
    expect([...names].sort()).toEqual(markers.map(([, name]) => name).sort());
  });

  it.each(lazyEntries().map((entry) => [basename(entry), entry]))('%s numbers its parts in order', (file, entry) => {
    const name = basename(file, '.css');
    const parts = [...readFileSync(entry, 'utf-8').matchAll(/\[data-blok-sheet='([^']+)'\]/g)].map(([, part]) => part);

    expect(parts).toEqual(parts.map((_part, index) => `${name}-${index + 2}`));
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

/** main.css with its local imports inlined, without any lazy sheet: what every page pays for at load. */
const eagerCss = (file: string, seen = new Set<string>()): string => {
  if (seen.has(file)) return '';
  seen.add(file);

  return readFileSync(file, 'utf-8').replace(/@import\s+['"](\.[^'"]+)['"]\s*;?/g, (_match, spec: string) => eagerCss(resolve(dirname(file), spec), seen));
};

describe('media and Ask AI CSS load lazily', () => {
  const eager = eagerCss(MAIN_CSS);

  it.each([
    ['darkroom.css', '.blok-darkroom__stage'],
    ['markup-panel.css', '.blok-darkroom__markup-rail'],
    ['markup-editor.css', '.blok-markup-selection'],
    ['alt-popover.css', '.blok-image-alt-popover'],
    ['media-empty.css', '.blok-media-empty__card'],
    ['image.css', '.blok-image-inner'],
    ['video.css', '.blok-video-controls'],
    ['audio.css', '.blok-audio-cover'],
    ['embed.css', '.blok-embed-window'],
    ['bookmark.css', '.blok-bookmark__window'],
    ['file.css', '.blok-file-card'],
    ['assistant.css', '[data-blok-assistant-reply]'],
    ['ask-ai-menu.css', '[data-blok-ask-ai-open]'],
    ['ask-ai-icons.css', '[data-blok-ask-ai-draw]'],
  ])('%s is not in the eager sheet', (_file, selector) => {
    expect(eager).not.toContain(selector);
  });

  it('keeps the shared invalid-field rule eager: the link tool, find bar and database fields use it', () => {
    expect(eager).toContain(':where([data-blok-interface], [data-blok-popover], [data-blok-top-layer]) [aria-invalid="true"] {');
  });
});
