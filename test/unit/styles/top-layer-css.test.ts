/**
 * Static analysis of src/styles/main.css to guarantee that the CSS reset for
 * Top-Layer-promoted blok elements is present, complete, and safe.
 *
 * The HTML Popover API promotes elements to the CSS Top Layer, where the
 * User-Agent stylesheet applies modal-dialog defaults (`position: fixed;
 * inset: 0; margin: auto; width: fit-content; border: solid; padding: 0.25em;
 * background: Canvas; overflow: auto`). Without an author-stylesheet reset,
 * any blok floating-UI element gets pinned to the bottom-right corner of the
 * viewport and acquires unwanted padding/border/background.
 *
 * The reset MUST target a generic marker attribute (`data-blok-top-layer`)
 * that the centralized helper sets on every promoted element. That guarantees
 * future floating-UI components (dialogs, dropdowns, picker menus) inherit
 * the safety net automatically — no per-component CSS update required.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const RESET_SELECTOR = '[data-blok-top-layer][popover]';

const REQUIRED_RESET_PROPERTIES: ReadonlyArray<{
  property: string;
  value: string;
  reason: string;
}> = [
  { property: 'inset', value: 'auto', reason: 'UA pins to inset:0; must release so inline top/left wins' },
  { property: 'margin', value: '0', reason: 'UA sets margin:auto which would centre the element in the viewport' },
  { property: 'border', value: '0', reason: 'UA paints a solid border around popovers' },
  { property: 'padding', value: '0', reason: 'UA adds 0.25em padding that would offset every popover' },
  { property: 'width', value: 'auto', reason: 'UA forces width:fit-content' },
  { property: 'height', value: 'auto', reason: 'UA forces height to viewport' },
  { property: 'max-width', value: 'none', reason: 'UA caps at 100vw' },
  { property: 'max-height', value: 'none', reason: 'UA caps at 100vh' },
  { property: 'overflow', value: 'visible', reason: 'UA forces overflow:auto and shows scrollbars' },
];

const findRuleBody = (source: string, selector: string): string | null => {
  /**
   * Match the selector list ending with the marker selector — the helper rule
   * may share a multi-selector list with related rules. Capture only the body
   * `{ ... }` so per-property assertions can run on the declarations.
   */
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|,\\s*|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = source.match(pattern);

  return match === null ? null : match[1];
};

describe('CSS Top Layer reset (src/styles/main.css)', () => {
  it(`defines a rule targeting ${RESET_SELECTOR}`, () => {
    /**
     * If this fails the helper has been wired up but the CSS safety net is
     * missing — every element promoted by promoteToTopLayer() will land in
     * the bottom-right corner of the viewport.
     */
    expect(findRuleBody(css, RESET_SELECTOR)).not.toBeNull();
  });

  it.each(REQUIRED_RESET_PROPERTIES)(
    `neutralizes UA default for $property ($reason)`,
    ({ property, value }) => {
      const body = findRuleBody(css, RESET_SELECTOR);

      expect(body).not.toBeNull();

      const declarationPattern = new RegExp(`(?:^|;|\\{)\\s*${property}\\s*:\\s*${value}\\b`);

      expect(body).toMatch(declarationPattern);
    }
  );

  it('does NOT set background on the generic reset (would override author bg classes via specificity 0,2,0 > 0,1,0)', () => {
    /**
     * Regression for the transparent-tooltip bug. The shared reset previously
     * set `background: transparent`, which beat tailwind utilities like
     * `bg-tooltip-bg` (specificity 0,1,0) and made the tooltip pill see-through.
     * Components that need a transparent background opt in via their own,
     * more specific rule (see `[data-blok-popover][data-blok-top-layer][popover]`).
     */
    const body = findRuleBody(css, RESET_SELECTOR);

    expect(body).not.toBeNull();

    expect(body).not.toMatch(/(^|;|\{)\s*background\s*:/);
  });

  it('keeps the popover-specific transparent-background carve-out (popover paints bg on inner container, not wrapper)', () => {
    /**
     * The popover wrapper itself must be transparent because the inner
     * `[data-blok-popover-container]` paints the visible pill background.
     * Without this rule the UA `background: Canvas` would bleed through
     * the gaps around the inner container.
     */
    expect(css).toMatch(/\[data-blok-popover\][^{]*\[popover\][^{]*\{[^}]*background\s*:\s*transparent/);
  });
});
