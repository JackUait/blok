/**
 * The popover items scrollbar is drawn by Blok itself, not by the engine.
 *
 * Native scrollbars are unstyleable to a common look across platforms:
 * Chromium honors a 4px styled `::-webkit-scrollbar`; WebKit ignores
 * `scrollbar-gutter: both-edges` (never mirrors the left lane); Firefox cannot
 * size a scrollbar to an exact pixel; and overlay-scrollbar OS settings reserve
 * no gutter at all. So the popover hides the native scrollbar in EVERY engine
 * and overlays a custom thumb (`[data-blok-popover-scrollbar]`, positioned from
 * JS scroll metrics) that looks and behaves identically everywhere.
 *
 * This static analysis of the flattened stylesheet guards that contract.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

/** Returns the body of the first top-level rule for `selector`, or ''. */
const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  return match === null ? '' : match[1];
};

describe('Popover custom scrollbar (identical on all platforms)', () => {
  describe('native scrollbar is hidden in every engine', () => {
    it('hides the Firefox/standard scrollbar with scrollbar-width: none', () => {
      expect(ruleBody('[data-blok-popover-items]')).toMatch(/scrollbar-width\s*:\s*none/);
    });

    it('hides the Chromium/WebKit scrollbar with ::-webkit-scrollbar { display: none }', () => {
      expect(ruleBody('[data-blok-popover-items]::-webkit-scrollbar')).toMatch(/display\s*:\s*none/);
    });

    it('does NOT depend on the native scrollbar-gutter (it is engine-inconsistent)', () => {
      expect(ruleBody('[data-blok-popover-items]')).not.toMatch(/scrollbar-gutter/);
    });
  });

  describe('the custom thumb', () => {
    it('is an absolutely positioned overlay', () => {
      expect(ruleBody('[data-blok-popover-scrollbar]')).toMatch(/position\s*:\s*absolute/);
    });

    it('is transparent at rest (auto-hides like a native scrollbar)', () => {
      expect(ruleBody('[data-blok-popover-scrollbar]')).toMatch(/opacity\s*:\s*0/);
    });

    it('is revealed while the popover is hovered', () => {
      expect(css).toMatch(/\[data-blok-popover-container\]:hover\s+\[data-blok-popover-scrollbar\][^{]*\{[^}]*opacity\s*:\s*1/);
    });

    it('is revealed while the list is actively scrolling', () => {
      expect(css).toMatch(/\[data-blok-scrolling\]\s*~\s*\[data-blok-popover-scrollbar\][^{]*\{[^}]*opacity\s*:\s*1/);
    });
  });
});
