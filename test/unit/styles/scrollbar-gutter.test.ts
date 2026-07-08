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

/**
 * Vertically scrollable containers that still use the NATIVE scrollbar (styled
 * `::-webkit-scrollbar` + Firefox-only `scrollbar-width`). The popover is NOT
 * here: it hides the native scrollbar in every engine and draws its own thumb
 * so it looks identical on all platforms — guarded by
 * `popover-custom-scrollbar.test.ts` instead.
 */
const SCROLLABLE_SELECTORS = [
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

      // Cascade resets (isolation layer) and `none` (which simply HIDES the
      // scrollbar — the popover's custom-thumb approach) don't engage the
      // standard scrollbar styling path, so they can live anywhere. Only the
      // active styling values (thin + colors) trigger Chromium's fallback.
      if (/^(?:initial|inherit|unset|revert|auto|none)\b/.test(value.replace(/\s*!important$/, ''))) {
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
