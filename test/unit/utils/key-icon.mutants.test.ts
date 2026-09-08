import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  makeShortcutHtml,
  shortcutToAriaKeyshortcuts,
  shortcutToReadable,
} from '../../../src/components/utils/key-icon';

const SPAN_OPEN = '<span style="display:inline-flex;align-items:center;line-height:1">';
const SPAN_CLOSE = '</span>';

/**
 * Rebuilds the exact `<svg>` a key glyph must render as.
 *
 * Every geometry number is passed in literally by the caller — nothing here is
 * derived from `label`, because the label-length branch and the width formula
 * are themselves under test.
 * @param label - glyph the SVG must contain
 * @param width - expected `width` / `viewBox` width
 * @param fontSize - expected `font-size`
 * @param x - expected `x` of the text node
 */
const keySvg = (label: string, width: number, fontSize: number, x: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg"` +
  ` width="${width}" height="16"` +
  ` viewBox="0 0 ${width} 16"` +
  ` style="display:inline-block;vertical-align:middle;flex-shrink:0"` +
  ` aria-hidden="true">` +
  `<text` +
  ` x="${x}"` +
  ` y="9"` +
  ` text-anchor="middle"` +
  ` dominant-baseline="middle"` +
  ` font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif"` +
  ` font-size="${fontSize}"` +
  ` font-weight="400"` +
  ` fill="currentColor"` +
  `>${label}</text>` +
  `</svg>`;

describe('key-icon — makeShortcutHtml markup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a single-glyph shortcut as the complete literal markup', () => {
    expect(makeShortcutHtml('⌘')).toBe(
      '<span style="display:inline-flex;align-items:center;line-height:1">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="16" viewBox="0 0 13 16"' +
        ' style="display:inline-block;vertical-align:middle;flex-shrink:0" aria-hidden="true">' +
        '<text x="6.5" y="9" text-anchor="middle" dominant-baseline="middle"' +
        ' font-family="-apple-system,BlinkMacSystemFont,\'SF Pro Text\',\'Helvetica Neue\',sans-serif"' +
        ' font-size="13" font-weight="400" fill="currentColor">⌘</text></svg>' +
        '</span>',
    );
  });

  it('sizes a one-character glyph at 13px wide with a 13px font', () => {
    expect(makeShortcutHtml('⇧')).toBe(SPAN_OPEN + keySvg('⇧', 13, 13, 6.5) + SPAN_CLOSE);
  });

  it('sizes a multi-character label at 7.5px per character with an 11px font', () => {
    expect(makeShortcutHtml('Del')).toBe(SPAN_OPEN + keySvg('Del', 23, 11, 11.5) + SPAN_CLOSE);
  });

  it('concatenates the glyphs of a run with no separator between them', () => {
    expect(makeShortcutHtml('⌘B')).toBe(
      SPAN_OPEN + keySvg('⌘', 13, 13, 6.5) + keySvg('B', 13, 13, 6.5) + SPAN_CLOSE,
    );
  });

  it('renders a beautified " + " shortcut identically to its concatenated form', () => {
    expect(makeShortcutHtml('⌘ + B')).toBe(makeShortcutHtml('⌘B'));
    expect(makeShortcutHtml('⌘ + B')).toBe(
      SPAN_OPEN + keySvg('⌘', 13, 13, 6.5) + keySvg('B', 13, 13, 6.5) + SPAN_CLOSE,
    );
  });

  it('resolves a cased key name through the lowercased lookup', () => {
    // "Ctrl" is the discriminating input: KEY_LABEL_MAP has 'ctrl' but not 'Ctrl',
    // so the lowercase lookup is the only one that can produce the '⌃' glyph.
    // Any token that is already lowercase or already a glyph resolves the same
    // way through either lookup and proves nothing.
    expect(makeShortcutHtml('Ctrl')).toBe(SPAN_OPEN + keySvg('⌃', 13, 13, 6.5) + SPAN_CLOSE);
  });

  it('renders three glyphs for a three-key shortcut', () => {
    expect(makeShortcutHtml('⌘⇧P')).toBe(
      SPAN_OPEN +
        keySvg('⌘', 13, 13, 6.5) +
        keySvg('⇧', 13, 13, 6.5) +
        keySvg('P', 13, 13, 6.5) +
        SPAN_CLOSE,
    );
  });

  it('returns the input untouched when it holds no keys at all', () => {
    expect(makeShortcutHtml('')).toBe('');
  });

  it('returns whitespace-only input untouched instead of rendering a blank glyph', () => {
    expect(makeShortcutHtml('   ')).toBe('   ');
    expect(makeShortcutHtml(' + ')).toBe(' + ');
  });
});

describe('key-icon — empty-token handling in the text conversions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the input untouched when shortcutToReadable finds no keys', () => {
    expect(shortcutToReadable('')).toBe('');
    expect(shortcutToReadable('   ')).toBe('   ');
  });

  it('returns the input untouched when shortcutToAriaKeyshortcuts finds no keys', () => {
    expect(shortcutToAriaKeyshortcuts('')).toBe('');
    expect(shortcutToAriaKeyshortcuts('   ')).toBe('   ');
  });

  it('leaves an unmapped multi-character token in its original case', () => {
    expect(shortcutToAriaKeyshortcuts('Foo')).toBe('Foo');
    expect(shortcutToAriaKeyshortcuts('⌘ + Foo')).toBe('Meta+Foo');
  });
});

/*
 * Proven-equivalent mutants (three, all `MethodExpression: token.trim() -> token`):
 *
 *   key-icon.ts@49:18  resolveLabel                 line 50
 *   key-icon.ts@169:22 shortcutToReadable           line 170
 *   key-icon.ts@238:22 shortcutToAriaKeyshortcuts   line 239
 *
 * All three re-trim a token that `tokenizeSegment` already trimmed: line 64 is
 * `const token = match[0].trim();` and lines 66-68 push only that trimmed value,
 * and only when it is non-empty. `String.prototype.trim` is idempotent, so
 * `token.trim() === token` holds for every value that can reach those lines.
 * Neither site is reachable with an untrimmed token: `resolveLabel` is
 * module-private and called once (line 123) with a `tokenizeSegment` output, and
 * the two mappers run inside `.map()` over the same output. A differential run of
 * each mutant against the clean module over 1333 inputs (whitespace-only, cased
 * names, glyph runs, embedded and trailing " + " separators) x 3 exported
 * functions produced 0 differing outputs in 11997 comparisons.
 *
 * One further mutant the sweep cannot score, but the tests here do kill:
 *
 *   key-icon.ts@51:9 `LogicalOperator: A ?? B -> A && B` on line 52.
 *
 * A textual replacement yields `A && B ?? trimmed`, which is a SyntaxError (`&&`
 * may not be mixed with `??` unparenthesised), so the module never loads and no
 * test failure can be attributed. Stryker mutates the AST node instead and its
 * printer re-parenthesises, giving `(A && B) ?? trimmed`. Run against that real
 * form, "resolves a cased key name through the lowercased lookup" fails: the
 * mutant renders `Ctrl` at `width="30" font-size="11"` where the clean source
 * renders the glyph `⌃` at `width="13" font-size="13"`.
 */
