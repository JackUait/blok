import { describe, it, expect } from 'vitest';
import { scopeUtilitiesLayer, SCOPE_SELECTOR } from '../../../scripts/scope-utilities/scope-tailwind-utilities.mjs';

/**
 * Blok's stylesheet is injected into the host page's <head> (UI.loadStyles).
 * Its Tailwind utilities give editor content its typography (heading sizes via
 * text-3xl) and block spacing (margin utilities like mt-[26px]).
 *
 * Importing those utilities into `@layer utilities` protects a host Tailwind
 * app's own utilities, BUT — per the cascade-layer spec — an UN-LAYERED host
 * reset (`* { margin: 0 }`, `h1,h2,… { font-size: inherit }`, the classic
 * normalize/reset every non-Tailwind app ships) ALWAYS beats a layered rule.
 * So the layered utilities silently lose inside the editor: headings collapse
 * to body size and blocks jam together.
 *
 * Fix: at build time, hoist the generated utilities OUT of @layer utilities
 * (un-layered, so they beat un-layered host resets) and SCOPE every selector
 * to Blok's interface roots (so they never match — and never clobber — the
 * host's own elements). `:where(...)` keeps each utility's natural specificity.
 */
describe('scopeUtilitiesLayer', () => {
  const scope = SCOPE_SELECTOR as string;

  it('exposes the blok-root scope (roots + descendants)', () => {
    expect(scope).toBe(
      '[data-blok-interface], [data-blok-interface] *, [data-blok-popover], [data-blok-popover] *'
    );
  });

  it('removes the @layer utilities wrapper (utilities become un-layered)', () => {
    const out = scopeUtilitiesLayer('@layer utilities { .text-3xl { font-size: 1.875rem; } }');
    expect(out).not.toMatch(/@layer\s+utilities/);
    expect(out).toContain('font-size: 1.875rem');
  });

  it('scopes a simple utility selector to blok roots with :where()', () => {
    const out = scopeUtilitiesLayer('@layer utilities { .text-3xl { font-size: 1.875rem; } }');
    expect(out).toContain(`.text-3xl:where(${scope})`);
    // :where() (not :is()) so the utility keeps its natural specificity.
    expect(out).not.toContain(':is(');
  });

  it('scopes utilities nested inside @media, keeping the media query', () => {
    const out = scopeUtilitiesLayer(
      '@layer utilities { @media (min-width: 40rem) { .sm\\:text-4xl { font-size: 2.25rem; } } }'
    );
    expect(out).toMatch(/@media\s*\(min-width:\s*40rem\)/);
    expect(out).toContain(`.sm\\:text-4xl:where(${scope})`);
    expect(out).not.toMatch(/@layer\s+utilities/);
  });

  it('inserts the scope BEFORE a pseudo-element (never after ::before)', () => {
    const out = scopeUtilitiesLayer(
      "@layer utilities { .before\\:block::before { content: ''; } }"
    );
    expect(out).toContain(`.before\\:block:where(${scope})::before`);
    // Invalid: a compound selector must not continue after a pseudo-element.
    expect(out).not.toContain('::before:where(');
  });

  // Tailwind v4 compiles the `before:` / `after:` variants to LEGACY
  // single-colon pseudo-elements (`:before`, `:after`), not `::before`.
  // The scope must still land BEFORE them — a compound selector must not
  // continue past a pseudo-element, so `:before:where(...)` is INVALID and
  // the whole rule is dropped by the browser (this silently killed every
  // placeholder, whose content comes from a `before:content-[...]` utility).
  it.each([
    ['before', ':before', "content: '';"],
    ['after', ':after', "content: '';"],
    ['first-line', ':first-line', 'font-weight: 700;'],
    ['first-letter', ':first-letter', 'font-size: 2rem;'],
  ])('inserts the scope BEFORE a single-colon %s pseudo-element', (name, pseudo, decl) => {
    const out = scopeUtilitiesLayer(
      `@layer utilities { .${name}\\:x${pseudo} { ${decl} } }`
    );
    expect(out).toContain(`.${name}\\:x:where(${scope})${pseudo}`);
    // Invalid: nothing may follow a pseudo-element in a compound selector.
    expect(out).not.toContain(`${pseudo}:where(`);
  });

  it('inserts the scope BEFORE a single-colon pseudo-element that follows a class + pseudo-class', () => {
    // Mirrors Tailwind's real placeholder output:
    // `.empty:before:content-[…]:empty:before { … }`
    const out = scopeUtilitiesLayer(
      '@layer utilities { .empty\\:before\\:x:empty:before { content: attr(data-blok-placeholder); } }'
    );
    expect(out).toContain(`.empty\\:before\\:x:empty:where(${scope}):before`);
    expect(out).not.toContain(':before:where(');
  });

  it('appends the scope to the subject of a child/sibling-combinator utility', () => {
    const out = scopeUtilitiesLayer(
      '@layer utilities { .space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; } }'
    );
    // Scope lands on the LAST compound (the subject), not the .space-y-4 root.
    expect(out).toContain(`~ :not([hidden]):where(${scope})`);
  });

  it('leaves rules outside @layer utilities untouched', () => {
    const input =
      '@layer base { [data-blok-interface] h1 { font-size: inherit; } }\n.host-thing { color: red; }';
    const out = scopeUtilitiesLayer(input);
    expect(out).toContain('@layer base');
    expect(out).toContain('[data-blok-interface] h1');
    expect(out).toContain('.host-thing { color: red; }');
    expect(out).not.toContain(':where([data-blok-interface]');
  });

  it('is a no-op when there is no @layer utilities block', () => {
    const input = ':root { --x: 1; }';
    expect(scopeUtilitiesLayer(input).trim()).toBe(input);
  });
});
