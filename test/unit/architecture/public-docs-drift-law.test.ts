import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The adapters' public type docblocks enumerate which config props are
 * reactive ("sync after mount without recreation") and then assert everything
 * else is consumed once at creation. Those lists are hand-written PROSE, so a
 * prop made reactive in the implementation can silently stay missing from the
 * docs — which is exactly how `style.tokens` shipped reactive while the
 * docblock still steered hosts toward hand-rolling the imperative effect.
 *
 * This law makes that drift a red test: every reactive sync in the adapter
 * sources MUST be named in the corresponding public docblock. The React
 * implementation marks each sync with a `// Reactive: <prop>` comment and is
 * the canonical adapter contract (parity across adapters is enforced
 * elsewhere); Angular's reactive surface is its signal-backed setter inputs.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

const read = (relPath: string): string => readFileSync(resolve(REPO_ROOT, relPath), 'utf8');

/** `// Reactive: <prop>` markers in the React hook — the source of truth. */
const reactiveProps = Array.from(
  read('packages/react/src/useBlok.ts').matchAll(/^\s*\/\/ Reactive: ([\w.]+)/gm)
).map((m) => m[1]);

/** The `/** ... *\/` docblock immediately preceding a marker string. */
const docblockBefore = (source: string, marker: string): string => {
  const markerAt = source.indexOf(marker);

  expect(markerAt, `marker "${marker}" not found`).toBeGreaterThan(-1);

  const start = source.lastIndexOf('/**', markerAt);
  const end = source.indexOf('*/', start);

  return source.slice(start, end);
};

describe('adapter reactive-props docblock drift law', () => {
  it('has a non-empty reactive marker list to enforce (non-vacuity)', () => {
    expect(reactiveProps).toContain('readOnly');
    expect(reactiveProps).toContain('style.tokens');
    expect(reactiveProps.length).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['packages/react/types/index.d.ts'],
    ['packages/vue/types/index.d.ts'],
  ])('%s docblock names every reactive prop', (typesPath) => {
    const docblock = docblockBefore(read(typesPath), 'export interface UseBlokConfig');
    const missing = reactiveProps.filter((prop) => !docblock.includes(`\`${prop}\``));

    expect(missing, `${typesPath} "Reactive props" docblock omits: ${missing.join(', ')}`).toEqual([]);
  });

  it('Angular component docblock names every signal-backed reactive input', () => {
    const source = read('packages/angular/src/blok-editor.component.ts');
    const reactiveInputs = Array.from(source.matchAll(/@Input\(\) set (\w+)\(/g)).map((m) => m[1]);

    expect(reactiveInputs.length).toBeGreaterThanOrEqual(7);

    const docblock = docblockBefore(source, '@Component({');
    const missing = reactiveInputs.filter((input) => !docblock.includes(`\`${input}\``));

    expect(missing, `BlokEditorComponent docblock omits reactive inputs: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('editor gutter token discoverability law', () => {
  /*
   * `--blok-editor-gutter-start` is deliberately excluded from the runtime
   * tokens.set() surface (CSS-only, state-dependent), which left it documented
   * only in a CSS comment — invisible to hosts hand-rolling gutter padding.
   * The README must name it so the override contract is discoverable.
   */
  it('README documents the gutter override tokens', () => {
    expect(read('README.md')).toContain('--blok-editor-gutter-start');
  });
});
