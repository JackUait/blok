/**
 * Static analysis of the flattened stylesheet guaranteeing that every
 * vertically scrollable component reserves space for its scrollbar — the
 * same layout you get with the OS "always show scrollbars" setting — instead
 * of letting a macOS overlay scrollbar paint on top of the content.
 *
 * Two conditions must hold per scroll container, verified live in Chromium:
 *
 * 1. `scrollbar-gutter: stable` — reserves the gutter even before content
 *    overflows, so widths do not jump when the scrollbar appears.
 * 2. A styled `::-webkit-scrollbar` with an explicit `width` — a styled
 *    webkit scrollbar is rendered "classic" (takes layout space) rather than
 *    overlay. Crucially, Chromium IGNORES `::-webkit-scrollbar` styling when
 *    the standard `scrollbar-width` / `scrollbar-color` properties are set on
 *    the same element, silently falling back to the overlay scrollbar. So the
 *    standard properties may only appear inside a
 *    `@supports not selector(::-webkit-scrollbar)` block (i.e. Firefox).
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

/** Every vertically scrollable container in the editor UI. */
const SCROLLABLE_SELECTORS = [
  '[data-blok-popover-items]',
  '[data-emoji-picker-body]',
  '[data-blok-database-drawer-content]',
  '.blok-file-preview-pre',
  '.blok-file-preview-md',
  '.blok-file-preview-office',
];

const escapeForRegex = (selector: string): string =>
  selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Collects the [start, end) source ranges of every
 * `@supports not selector(::-webkit-scrollbar) { ... }` block.
 */
const firefoxOnlyRanges = (): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  const opener = /@supports\s+not\s+selector\(\s*::-webkit-scrollbar\s*\)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(css)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;

    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') depth -= 1;
      index += 1;
    }
    ranges.push([match.index, index]);
  }

  return ranges;
};

describe('Scrollbar gutter reservation (flattened src/styles/main.css)', () => {
  for (const selector of SCROLLABLE_SELECTORS) {
    it(`${selector} declares scrollbar-gutter: stable both-edges so left and right indents stay symmetric`, () => {
      const pattern = new RegExp(
        `${escapeForRegex(selector)}[^{}]*\\{[^}]*scrollbar-gutter\\s*:\\s*stable both-edges`,
      );

      expect(css).toMatch(pattern);
    });

    it(`${selector} styles ::-webkit-scrollbar with an explicit width so the scrollbar is classic (takes layout space)`, () => {
      const pattern = new RegExp(
        `${escapeForRegex(selector)}::-webkit-scrollbar[^{}]*\\{[^}]*width\\s*:\\s*\\d`,
      );

      expect(css).toMatch(pattern);
    });
  }

  /**
   * System-like visibility: the scrollbar must take up space permanently, but
   * stay invisible while idle (like macOS overlay scrollbars) — the thumb is
   * transparent at rest and only revealed on hover or during scrolling.
   */
  describe('scrollbar stays invisible at rest and reveals on hover/scroll (system-like behavior)', () => {
    /** Containers whose scrollbars auto-hide; reveal is hover- and/or scroll-driven. */
    const AUTO_HIDE_SELECTORS = [
      '[data-blok-popover-items]',
      '[data-emoji-picker-body]',
      '[data-blok-database-board]',
      '[data-blok-database-drawer-content]',
      '.blok-file-preview-pre',
      '.blok-file-preview-md',
      '.blok-file-preview-office',
    ];

    for (const selector of AUTO_HIDE_SELECTORS) {
      it(`${selector} keeps its ::-webkit-scrollbar-thumb transparent at rest`, () => {
        // Tempered token: allow further comma-grouped base selectors before
        // the `{`, but never a `:hover` variant — that's the reveal rule.
        const pattern = new RegExp(
          `${escapeForRegex(selector)}::-webkit-scrollbar-thumb(?:(?!:hover)[^{}])*\\{[^}]*background\\s*:\\s*transparent`,
        );

        expect(css).toMatch(pattern);
      });

      it(`${selector} reveals the thumb on hover or scroll activity`, () => {
        const pattern = new RegExp(
          `${escapeForRegex(selector)}(?::hover|\\[data-blok-scrolling\\])[^{}]*::-webkit-scrollbar-thumb[^{}]*\\{[^}]*background\\s*:\\s*(?!transparent)`,
        );

        expect(css).toMatch(pattern);
      });
    }

    it('inline (horizontal toolbar) popovers opt out of the vertical scrollbar gutter — via child combinators only', () => {
      const pattern = /\[data-blok-popover-inline\]\s*>\s*\[data-blok-popover-container\]\s*>\s*\[data-blok-popover-items\][^{}]*\{[^}]*scrollbar-gutter\s*:\s*auto/;

      expect(css).toMatch(pattern);
    });

    it('the inline opt-out does NOT descendant-match nested vertical menus (e.g. Turn into) mounted inside the inline popover root', () => {
      // A space-combinator form would also strip the gutter from nested
      // popovers appended into the inline root, making their left indent
      // ignore the scrollbar width again.
      const broadPattern = /\[data-blok-popover-inline\]\s+\[data-blok-popover-items\]/;

      expect(css).not.toMatch(broadPattern);
    });

    it('[data-blok-popover-items] reveals the thumb during keyboard-driven scrolling via [data-blok-scrolling]', () => {
      const pattern = /\[data-blok-popover-items\]\[data-blok-scrolling\][^{}]*::-webkit-scrollbar-thumb[^{}]*\{[^}]*background\s*:\s*(?!transparent)/;

      expect(css).toMatch(pattern);
    });
  });

  /**
   * Popover scrollbar spacing spec: with the 6px container padding and the
   * 4px scrollbar, the items element is offset so the right side reads
   * content → 2px → scrollbar → 2px → popover edge, and the left indent is
   * 4px + the scrollbar-width lane (8px total, symmetric with the right).
   */
  describe('popover scrollbar spacing (2px before/after the scrollbar; 4px + scrollbar width on the left)', () => {
    const itemsRule = (): string => {
      const match = css.match(/\[data-blok-popover-items\]\s*\{([^}]*)\}/);

      return match === null ? '' : match[1];
    };

    it('pulls the items right edge to 2px from the popover edge (margin-right: -1 scrollbar width against the 6px container padding)', () => {
      expect(itemsRule()).toMatch(/margin-right\s*:\s*calc\(-1 \* var\(--blok-space-1\)\)/);
    });

    it('keeps a 2px gap between the content and the scrollbar (padding-right)', () => {
      expect(itemsRule()).toMatch(/padding-right\s*:\s*var\(--blok-space-0-5\)/);
    });

    it('sets the left indent to 4px + the scrollbar lane (margin-left: -2px against the 6px container padding, lane via both-edges)', () => {
      expect(itemsRule()).toMatch(/margin-left\s*:\s*calc\(-1 \* var\(--blok-space-0-5\)\)/);
    });

    it('inline (horizontal toolbar) popovers reset the vertical-scrollbar offsets', () => {
      const match = css.match(/\[data-blok-popover-inline\]\s*>\s*\[data-blok-popover-container\]\s*>\s*\[data-blok-popover-items\][^{}]*\{([^}]*)\}/);
      const body = match === null ? '' : match[1];

      expect(body).toMatch(/margin-right\s*:\s*0/);
      expect(body).toMatch(/margin-left\s*:\s*0/);
      expect(body).toMatch(/padding-right\s*:\s*0/);
    });
  });

  it('standard scrollbar-width/scrollbar-color stay inside @supports not selector(::-webkit-scrollbar) — otherwise Chromium ignores the webkit styling and falls back to an overlay scrollbar', () => {
    const ranges = firefoxOnlyRanges();
    const insideFirefoxOnly = (offset: number): boolean =>
      ranges.some(([start, end]) => offset >= start && offset < end);

    const offenders: string[] = [];
    const declaration = /scrollbar-(?:width|color)\s*:\s*([^;]+);/g;
    let match: RegExpExecArray | null;

    while ((match = declaration.exec(css)) !== null) {
      const value = match[1].trim();

      // Cascade resets (isolation layer) don't engage the standard scrollbar
      // styling path, so they can live anywhere.
      if (/^(?:initial|inherit|unset|revert|auto)\b/.test(value.replace(/\s*!important$/, ''))) {
        continue;
      }

      if (!insideFirefoxOnly(match.index)) {
        const line = css.slice(0, match.index).split('\n').length;

        offenders.push(`line ${line}: ${match[0].trim()}`);
      }
    }

    expect(
      offenders,
      `scrollbar-width/scrollbar-color found outside @supports not selector(::-webkit-scrollbar):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
