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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { css as searchInputCss } from '../../../src/components/utils/popover/components/search-input/search-input.const';
import { PLACEHOLDER_ACTIVE_CLASSES, PLACEHOLDER_CLASSES, PLACEHOLDER_FOCUS_ONLY_CLASSES } from '../../../src/components/utils/placeholder';
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
    it('drives the wrapper start padding through the --_blok-list-pad indirection (backed by --blok-list-padding-start / --blok-checklist-padding-start in main.css)', () => {
      expect(BASE_STYLES).toContain('ps-[var(--_blok-list-pad,0px)]');
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

    it('auto-collapses the gutter in read-only mode by redeclaring the gutter tokens', () => {
      const body = findRuleBody(css, ':where([data-blok-readonly])');

      expect(body).not.toBeNull();
      expect(body).toMatch(/--blok-editor-gutter-start:\s*0px/);
      expect(body).toMatch(/--blok-editor-gutter-end:\s*0px/);
    });

    it('auto-collapses the gutter when the toolbar is hidden via config.hideToolbar', () => {
      const body = findRuleBody(css, ':where([data-blok-toolbar-hidden])');

      expect(body).not.toBeNull();
      expect(body).toMatch(/--blok-editor-gutter-start:\s*0px/);
      expect(body).toMatch(/--blok-editor-gutter-end:\s*0px/);
    });
  });

  describe('block placeholder color', () => {
    it('maps a Tailwind color to the --blok-placeholder-color token with a gray-text fallback', () => {
      expect(css).toMatch(
        /--color-block-placeholder:\s*var\(--blok-placeholder-color,\s*var\(--blok-gray-text\)\)/
      );
    });

    it('keeps the hook out of the palette so ancestor-level host overrides are not shadowed by the wrapper', () => {
      // A palette declaration would land on the wrapper element itself and,
      // via nearest-ancestor custom-property inheritance, beat any value a
      // host sets on a container above the editor.
      expect(css).not.toMatch(/--blok-placeholder-color:\s*[^;]+;/);
    });

    it('styles every placeholder ::before through the token instead of a hardcoded color', () => {
      const classArrays = [PLACEHOLDER_CLASSES, PLACEHOLDER_ACTIVE_CLASSES, PLACEHOLDER_FOCUS_ONLY_CLASSES];

      for (const classes of classArrays) {
        const joined = classes.join(' ');

        expect(joined).toContain('before:text-block-placeholder');
        expect(joined).not.toContain('before:text-gray-text');
      }

      const toolRendererSource = readFileSync(
        resolve(__dirname, '../../../src/components/block/tool-renderer.ts'),
        'utf8'
      );

      expect(toolRendererSource).toContain('before:text-block-placeholder');
      expect(toolRendererSource).not.toContain('before:text-gray-text');
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

  describe('heading typography tokens', () => {
    const LEVELS: Array<[number, string, string]> = [
      // [level, font-size fallback, margin-top fallback]
      [1, '1.875rem', '2rem'],
      [2, '1.5rem', '26px'],
      [3, '1.25rem', '1.25rem'],
      [4, '1.125rem', '0.75rem'],
      [5, '1rem', '0.75rem'],
      [6, '0.875rem', '0.75rem'],
    ];

    it.each(LEVELS)('drives level %i typography from per-level tokens keyed on data-blok-heading-level', (level, fontSize, marginTop) => {
      const body = findRuleBody(css, `:where([data-blok-tool="header"])[data-blok-heading-level="${level}"]`);

      expect(body).not.toBeNull();
      expect(body).toContain(`font-size: var(--blok-heading-${level}-font-size, ${fontSize})`);
      expect(body).not.toContain('line-height');
      expect(body).toContain(`margin-top: var(--blok-heading-margin-top, ${marginTop})`);
    });

    it('drives heading weight, bottom margin, and the shared line-height from shared tokens', () => {
      const body = findRuleBody(css, '[data-blok-tool="header"]');

      expect(body).not.toBeNull();
      expect(body).toContain('font-weight: var(--blok-heading-font-weight, 600)');
      expect(body).toContain('margin-bottom: var(--blok-heading-margin-bottom, 1px)');
      expect(body).toContain('line-height: var(--blok-heading-line-height, 1.3)');
    });
  });

  describe('embed spacing token', () => {
    it('drives the embed top margin from --blok-embed-margin-top', () => {
      expect(css).toMatch(/\[data-blok-tool="embed"\]\s*\{[^}]*margin-top:\s*var\(--blok-embed-margin-top,\s*0\.5rem\)/);
    });
  });
});
