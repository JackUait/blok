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
    it(`${selector} declares scrollbar-gutter: stable`, () => {
      const pattern = new RegExp(
        `${escapeForRegex(selector)}[^{}]*\\{[^}]*scrollbar-gutter\\s*:\\s*stable`,
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
