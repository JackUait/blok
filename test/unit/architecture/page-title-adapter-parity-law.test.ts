/**
 * Adapter parity law for placing the page title.
 *
 * Each adapter ships a title component that moves the header with
 * `editor.title.mount(host)` and hands it back with `editor.title.mount(null)`.
 * Without the second call the header stays inside a removed element: a dead
 * title the user cannot reach. React and Vue declare their types by hand, so
 * the published `.d.ts` must name the component too.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf-8');

const ADAPTERS = [
  ['packages/react/src/index.ts', 'BlokTitle', 'packages/react/src/BlokTitle.tsx'],
  ['packages/vue/src/index.ts', 'BlokTitle', 'packages/vue/src/BlokTitle.ts'],
  ['packages/angular/src/index.ts', 'BlokTitleComponent', 'packages/angular/src/blok-title.component.ts'],
] as const;

describe('page title component — adapter parity', () => {
  it.each(ADAPTERS)('%s exports %s', (index, name) => {
    expect(read(index), `${index} does not export ${name}`).toMatch(new RegExp(`export \\{ ${name} \\}`));
  });

  it.each(ADAPTERS)('%s: %s places the title with title.mount(host)', (_index, _name, source) => {
    expect(read(source), `${source} never calls title.mount with a host`).toMatch(/title\.mount\((?!null\))/);
  });

  it.each(ADAPTERS)('%s: %s gives the title back with title.mount(null)', (_index, _name, source) => {
    // A call statement on its own line, so a comment or a string that mentions it does not count.
    expect(read(source), `${source} never calls title.mount(null)`).toMatch(/^\s*(?:[\w$]+\??\.)*title\??\.mount\(null\);/m);
  });

  it.each([['packages/react/types/index.d.ts'], ['packages/vue/types/index.d.ts']])(
    '%s publishes BlokTitle',
    (path) => {
      expect(read(path), `${path} does not declare BlokTitle`).toContain('export declare const BlokTitle');
    }
  );
});
