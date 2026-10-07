import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scopeStylesheet } from '../../../src/playground/scope-view-css';

const SCOPE = ':is(#blokview-panel, #pg-history-render)';
const squash = (css: string): string => css.replace(/\s+/g, ' ').trim();

describe('scopeStylesheet', () => {
  it('prefixes every selector of a plain rule', () => {
    expect(squash(scopeStylesheet('a, .b > c { color: red; }', SCOPE)))
      .toBe(`${SCOPE} a, ${SCOPE} .b > c { color: red; }`);
  });

  // A bare prefix in front of `@layer` is not a selector: the browser drops the whole block.
  it('keeps @layer, @media and @supports blocks and scopes the rules inside', () => {
    const out = squash(scopeStylesheet(
      '@layer base { a { color: red; } } @media (prefers-color-scheme: dark) { @supports (color: red) { td { border: 1px solid; } } }',
      SCOPE
    ));

    expect(out).toBe(`@layer base { ${SCOPE} a { color: red; } } @media (prefers-color-scheme: dark) { @supports (color: red) { ${SCOPE} td { border: 1px solid; } } }`);
  });

  it('leaves @keyframes, @property and layer statements as they are', () => {
    const source = '@layer theme, base; @keyframes pop { from { opacity: 0; } to { opacity: 1; } } @property --x { syntax: "*"; inherits: false; }';

    expect(squash(scopeStylesheet(source, SCOPE))).toBe(squash(source));
  });

  it('does not split on commas inside parentheses or escaped in a class name', () => {
    expect(squash(scopeStylesheet(':is(a, b) i, .px-\\[var\\(--p\\,2px\\)\\] { x: y; }', SCOPE)))
      .toBe(`${SCOPE} :is(a, b) i, ${SCOPE} .px-\\[var\\(--p\\,2px\\)\\] { x: y; }`);
  });

  // Tokens on :root would never match under a prefix; they must land on the scope element.
  it('moves :root and :host onto the scope element', () => {
    expect(squash(scopeStylesheet(':root, :host { --c: red; } :root:not([t="light"]) [x] { y: z; }', SCOPE)))
      .toBe(`${SCOPE}, ${SCOPE} { --c: red; } :root:not([t="light"]) ${SCOPE} [x] { y: z; }`);
  });

  it('leaves nested rules inside a style rule alone', () => {
    expect(squash(scopeStylesheet('input { color: red; &::placeholder { color: gray; } }', SCOPE)))
      .toBe(`${SCOPE} input { color: red; &::placeholder { color: gray; } }`);
  });

  it('keeps every block of the real view.css and never puts the scope before an at-rule', () => {
    const css = readFileSync(resolve(__dirname, '../../../view.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
    const out = scopeStylesheet(css, SCOPE);
    const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

    expect(out).not.toContain(`${SCOPE} @`);
    expect(count(out, /\{/g)).toBe(count(css, /\{/g));
    expect(count(out, /\}/g)).toBe(count(css, /\}/g));
    expect(count(out, /@layer [\w, ]+\{/g)).toBe(count(css, /@layer [\w, ]+\{/g));
    expect(count(out, /@keyframes /g)).toBe(count(css, /@keyframes /g));
    expect(count(out, /@property /g)).toBe(count(css, /@property /g));
    expect(count(out, /@media /g)).toBe(count(css, /@media /g));
  });
});

describe('index.html view.css scoping', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

  // The old inline regex prefixed at-rule preludes and lost every @layer block.
  it('scopes the view stylesheet with scopeStylesheet', () => {
    expect(html).toContain('scopeStylesheet(viewCssText,');
    expect(html).not.toMatch(/viewCssText[\s\S]{0,120}\.replace\(\/\(\[\^\{\}\]\+\)\\\{\/g/);
  });
});
