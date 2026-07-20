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

import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import { css as searchInputCss } from '../../../src/components/utils/popover/components/search-input/search-input.const';
import { PLACEHOLDER_ACTIVE_CLASSES, PLACEHOLDER_CLASSES, PLACEHOLDER_FOCUS_ONLY_CLASSES } from '../../../src/components/utils/placeholder';
import { WRAPPER_STYLES as CALLOUT_WRAPPER_STYLES } from '../../../src/tools/callout/constants';
import { BASE_STYLES, CHECKLIST_ITEM_STYLES, ITEM_STYLES } from '../../../src/tools/list/constants';
import { BASE_STYLES as TOGGLE_BASE_STYLES } from '../../../src/tools/toggle/constants';

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

  describe('block vertical padding (public --blok-block-padding-top/-bottom contract)', () => {
    /*
     * Read-only hosts were found blanket-overriding `[data-blok-tool]
     * { padding: 0 0 0.2em }` because per-block padding was hardcoded as
     * Tailwind arbitrary values (py-[7px] px-[2px], py-[0.2em], py-[5px]).
     * These tests pin the token indirection that makes the hack deletable:
     * every block tool wrapper routes its padding through
     * --blok-block-padding-top / -bottom / -inline, keeping its own
     * historical value as the fallback.
     */
    const readToolSource = (rel: string): string =>
      readFileSync(resolve(__dirname, '../../../src/tools', rel), 'utf8');

    const blokBlockUtility = (): string =>
      css.match(/@utility blok-block\s*\{[\s\S]*?\}/)?.[0] ?? '';

    it('drives the blok-block utility from the three tokens (7px/7px/2px fallbacks) instead of hardcoded padding', () => {
      const utility = blokBlockUtility();

      expect(utility).toContain('pt-[var(--blok-block-padding-top,7px)]');
      expect(utility).toContain('pb-[var(--blok-block-padding-bottom,7px)]');
      expect(utility).toContain('px-[var(--blok-block-padding-inline,2px)]');
      expect(utility).not.toContain('py-[7px]');
      expect(utility).not.toContain('px-[2px]');
    });

    it('keeps the tokens out of the palette so ancestor-level host overrides are not shadowed by the wrapper (placeholder-color precedent)', () => {
      expect(css).not.toMatch(/--blok-block-padding-(?:top|bottom|inline):\s*[^;]+;/);
    });

    it('routes list wrapper vertical padding through the tokens with 7px fallbacks', () => {
      expect(BASE_STYLES).toContain('pt-[var(--blok-block-padding-top,7px)]');
      expect(BASE_STYLES).toContain('pb-[var(--blok-block-padding-bottom,7px)]');
      expect(BASE_STYLES).not.toContain('py-[7px]');
    });

    it('routes toggle wrapper vertical padding through the tokens with 7px fallbacks', () => {
      expect(TOGGLE_BASE_STYLES).toContain('pt-[var(--blok-block-padding-top,7px)]');
      expect(TOGGLE_BASE_STYLES).toContain('pb-[var(--blok-block-padding-bottom,7px)]');
      expect(TOGGLE_BASE_STYLES).not.toContain('py-[7px]');
    });

    it('routes callout wrapper vertical padding through the tokens with callout-specific 5px fallbacks', () => {
      expect(CALLOUT_WRAPPER_STYLES).toContain('pt-[var(--blok-block-padding-top,5px)]');
      expect(CALLOUT_WRAPPER_STYLES).toContain('pb-[var(--blok-block-padding-bottom,5px)]');
      expect(CALLOUT_WRAPPER_STYLES).not.toContain('py-[5px]');
    });

    it('routes header padding through the three tokens with 7px/7px/2px fallbacks (BASE_STYLES is module-local — source scan)', () => {
      const headerSource = readToolSource('header/index.ts');

      expect(headerSource).toContain('pt-[var(--blok-block-padding-top,7px)]');
      expect(headerSource).toContain('pb-[var(--blok-block-padding-bottom,7px)]');
      expect(headerSource).toContain('px-[var(--blok-block-padding-inline,2px)]');
      expect(headerSource).not.toContain('py-[7px] px-[2px]');
    });

    it('anchors the toggle-heading arrow offset to the top-padding token so a host override keeps the arrow aligned', () => {
      const headerSource = readToolSource('header/index.ts');

      expect(headerSource).toContain('top-[calc(var(--blok-block-padding-top,7px)_+_0.65em)]');
      expect(headerSource).not.toContain('top-[calc(7px_+_0.65em)]');
    });

    it('routes quote vertical padding through the tokens with quote-specific 0.2em fallbacks (BASE_CLASSES is module-local — source scan)', () => {
      const quoteSource = readToolSource('quote/index.ts');

      expect(quoteSource).toContain('pt-[var(--blok-block-padding-top,0.2em)]');
      expect(quoteSource).toContain('pb-[var(--blok-block-padding-bottom,0.2em)]');
      expect(quoteSource).not.toContain('py-[0.2em]');
    });

    it('keeps the quote 0.2em fallbacks winning over the blok-block defaults in the compiled cascade (equal specificity — source order decides)', async () => {
      // Quote merges api.styles.block ('blok-block') with its own padding
      // classes. twMerge cannot see inside a custom utility, so BOTH classes
      // land on the element and the winner is decided by the cascade order of
      // the GENERATED utilities (the build-time :where() scoping adds zero
      // specificity to each, uniformly). Compile the real utility definition
      // with the real quote candidates and pin that quote's padding rules are
      // emitted after .blok-block.
      const utility = blokBlockUtility();
      const quoteSource = readToolSource('quote/index.ts');
      const quotePt = quoteSource.match(/pt-\[var\(--blok-block-padding-top,[^\]]+\)\]/)?.[0];
      const quotePb = quoteSource.match(/pb-\[var\(--blok-block-padding-bottom,[^\]]+\)\]/)?.[0];

      expect(utility).not.toBe('');
      expect(quotePt).toBeDefined();
      expect(quotePb).toBeDefined();

      if (quotePt === undefined || quotePb === undefined) {
        return;
      }

      const theme = readFileSync(
        resolve(__dirname, '../../../node_modules/tailwindcss/theme.css'),
        'utf8'
      );
      const compiler = await compile(
        `@import 'tailwindcss/theme.css' theme(reference);\n${utility}\n@tailwind utilities;`,
        { loadStylesheet: async (id, base) => ({ path: id, base, content: theme }) }
      );
      const output = compiler.build(['blok-block', quotePt, quotePb]);

      const blokBlockIndex = output.indexOf('.blok-block');
      const quotePtIndex = output.indexOf('padding-top: var(--blok-block-padding-top,0.2em)');
      const quotePbIndex = output.indexOf('padding-bottom: var(--blok-block-padding-bottom,0.2em)');

      expect(blokBlockIndex).toBeGreaterThan(-1);
      expect(quotePtIndex).toBeGreaterThan(blokBlockIndex);
      expect(quotePbIndex).toBeGreaterThan(blokBlockIndex);
    });
  });

  describe('native selection opt-out', () => {
    it('gates the editor ::selection repaint behind :not([data-blok-native-selection]) at zero added specificity', () => {
      expect(css).toMatch(
        /\[data-blok-interface\]:where\(:not\(\[data-blok-native-selection\]\)\)\s+::selection/
      );
    });

    it('keeps the popover ::selection repaint unconditional', () => {
      expect(css).toMatch(/\[data-blok-popover\]\s+::selection/);
    });

    it('re-points --blok-selection-inline at the UA Highlight color under the opt-out', () => {
      expect(css).toMatch(
        /:where\(\[data-blok-native-selection\]\)\s*\{[^}]*--blok-selection-inline:\s*Highlight/
      );
    });

    it('declares the Highlight redeclaration AFTER the last dark-theme --blok-selection-inline declaration (palette blocks are zero-specificity; source order is the override mechanism)', () => {
      const optOutIndex = css.indexOf('--blok-selection-inline: Highlight');
      const darkDeclarations = [...css.matchAll(/--blok-selection-inline:\s*rgba\(35, 131, 226, 0\.3\)/g)];

      expect(optOutIndex).toBeGreaterThan(-1);
      expect(darkDeclarations.length).toBeGreaterThanOrEqual(2);

      const lastDarkIndex = darkDeclarations[darkDeclarations.length - 1].index;

      expect(optOutIndex).toBeGreaterThan(lastDarkIndex);
    });
  });
});
