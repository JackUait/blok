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

/**
 * End of the comment or quoted run starting at `at`, or -1 when neither.
 * Both may hold braces and apostrophes, so the scanner steps over them whole.
 */
const skipEnd = (source: string, at: number): number => {
  const char = source.charAt(at);

  if (char === '/' && source.charAt(at + 1) === '*') {
    const closer = source.indexOf('*/', at + 2);

    return closer === -1 ? source.length : closer + 2;
  }

  if (char !== '"' && char !== "'") {
    return -1;
  }

  const closer = source.indexOf(char, at + 1);

  return closer === -1 ? source.length : closer + 1;
};

/** Selector text as written before a `{`, comments and stray whitespace gone. */
const normalizePrelude = (raw: string): string =>
  raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .replace(/\s+/g, ' ');

/**
 * Body of the top-level rule whose selector is EXACTLY `selector`, brace-matched.
 *
 * The match is on the whole prelude, not a substring: popover-animation.css
 * nests `> [data-blok-popover-items]` rules that contain the same text and sit
 * earlier in the flattened source. A missing rule throws, so `not.toMatch`
 * can never pass on an empty body.
 */
const ruleBody = (selector: string): string => {
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = -1;
  let bodyEnd = -1;
  let index = 0;

  while (index < css.length && bodyEnd === -1) {
    const char = css.charAt(index);
    const skipTo = skipEnd(css, index);

    if (skipTo !== -1) {
      index = skipTo;
    } else if (char === '{') {
      const matched = depth === 0 && normalizePrelude(css.slice(preludeStart, index)) === selector;

      bodyStart = matched ? index + 1 : bodyStart;
      depth += 1;
      preludeStart = index + 1;
      index += 1;
    } else if (char === '}') {
      depth -= 1;
      bodyEnd = bodyStart !== -1 && depth === 0 ? index : bodyEnd;
      preludeStart = index + 1;
      index += 1;
    } else {
      preludeStart = char === ';' ? index + 1 : preludeStart;
      index += 1;
    }
  }

  if (bodyEnd === -1) {
    throw new Error(`No top-level rule for selector: ${selector}`);
  }

  return css.slice(bodyStart, bodyEnd);
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
