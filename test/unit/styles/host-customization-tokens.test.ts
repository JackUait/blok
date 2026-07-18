/**
 * Host customization contract.
 *
 * Host applications (e.g. knowledge-base microfrontends) were found styling
 * Blok internals through test IDs and data attributes because no public
 * customization hook existed:
 *
 *   [data-blok-testid='popover-search-input']::placeholder { ... }
 *   [data-blok-element-content] { max-width: 650px }  (while width='full')
 *   [data-list-style] { padding-left: 18px !important }
 *   .host-container { padding-left: 56px }            (gutter for +/⠿ controls)
 *
 * The root cause is a gap in the public `--blok-*` custom-property surface.
 * These tests pin the contract that closes it: each knob below must be a
 * runtime-overridable custom property so hosts never have to target
 * internals again.
 */
import { describe, expect, it } from 'vitest';

import { css as searchInputCss } from '../../../src/components/utils/popover/components/search-input/search-input.const';
import { BASE_STYLES, CHECKLIST_ITEM_STYLES, ITEM_STYLES } from '../../../src/tools/list/constants';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const findRuleBody = (source: string, selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|,\\s*|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = source.match(pattern);

  return match === null ? null : match[1];
};

describe('Host customization tokens (public --blok-* contract)', () => {
  describe('popover search input placeholder', () => {
    it('maps a Tailwind color to the --blok-search-input-placeholder token', () => {
      expect(css).toMatch(
        /--color-search-input-placeholder:\s*var\(--blok-search-input-placeholder\)/
      );
    });

    it('declares a default for --blok-search-input-placeholder in the palette', () => {
      expect(css).toMatch(/--blok-search-input-placeholder:\s*[^;]+;/);
    });

    it('styles the placeholder through the token instead of a hardcoded color', () => {
      expect(searchInputCss.input).toContain('placeholder:text-search-input-placeholder');
      expect(searchInputCss.input).not.toContain('placeholder:text-gray-text');
    });
  });

  describe('content column max-width', () => {
    it('lets hosts override the cap via --blok-content-max-width at runtime', () => {
      const body = findRuleBody(css, '.max-w-blok-content');

      expect(body).not.toBeNull();
      expect(body).toMatch(
        /max-width:\s*var\(--blok-content-max-width,\s*var\(--max-width-content\)\)/
      );
    });

    it('lets --blok-content-max-width override the cap even in width="full" mode', () => {
      const body = findRuleBody(css, '[data-blok-width="full"] [data-blok-element-content]');

      expect(body).not.toBeNull();
      expect(body).toMatch(/max-width:\s*var\(--blok-content-max-width,\s*none\)/);
    });
  });

  describe('list wrapper indentation', () => {
    it('drives the wrapper start padding from --blok-list-padding-start', () => {
      expect(BASE_STYLES).toContain('ps-[var(--blok-list-padding-start,0px)]');
    });
  });

  describe('list marker-to-content gap', () => {
    it('drives the item row gap from --blok-list-gap on standard items', () => {
      expect(ITEM_STYLES).toContain('gap-[var(--blok-list-gap,0px)]');
    });

    it('drives the item row gap from --blok-list-gap on checklist items', () => {
      expect(CHECKLIST_ITEM_STYLES).toContain('gap-[var(--blok-list-gap,0px)]');
    });
  });

  describe('editor gutter for the floating block controls', () => {
    it('reserves the gutter on the redactor via --blok-editor-gutter-start/-end', () => {
      const body = findRuleBody(css, '[data-blok-redactor]');

      expect(body).not.toBeNull();
      expect(body).toMatch(
        /padding-inline-start:\s*var\(--blok-editor-gutter-start,\s*0px\)/
      );
      expect(body).toMatch(
        /padding-inline-end:\s*var\(--blok-editor-gutter-end,\s*0px\)/
      );
    });

    it('auto-collapses the gutter in read-only mode with an overridable rule', () => {
      const body = findRuleBody(css, ':where([data-blok-readonly]) [data-blok-redactor]');

      expect(body).not.toBeNull();
      expect(body).toMatch(/padding-inline:\s*0/);
    });
  });

  describe('zero-specificity theme declarations', () => {
    it('declares the light palette via :where() so a host single-attribute selector always wins', () => {
      expect(css).toMatch(
        /:where\(\[data-blok-interface\]\),\s*:where\(\[data-blok-popover\]\),\s*:where\(\[data-blok-top-layer\]\)\s*\{[^}]*--blok-selection:/
      );
    });

    it('declares the dark system-preference palette via :where()', () => {
      expect(css).toMatch(
        /:where\(:root:not\(\[data-blok-theme="light"\]\) \[data-blok-interface\]\)/
      );
    });

    it('declares the dark attribute palette via :where()', () => {
      expect(css).toMatch(
        /:where\(\[data-blok-theme="dark"\] \[data-blok-interface\]\)/
      );
    });

    it('keeps no bare-specificity light palette selector', () => {
      expect(css).not.toMatch(/^\[data-blok-interface\],\n\[data-blok-popover\],\n\[data-blok-top-layer\] \{/m);
    });
  });
});
