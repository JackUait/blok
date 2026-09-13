import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  makeShortcutHtml,
  shortcutToReadable,
  shortcutToAriaKeyshortcuts,
} from '../../../../src/components/utils/key-icon';

/**
 * The exact SVG a single-character glyph must render as. Written out in full
 * rather than rebuilt from the implementation's own arithmetic: every width,
 * coordinate and attribute name here is an independent claim about the output.
 */
const CMD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"' +
  ' width="13" height="16"' +
  ' viewBox="0 0 13 16"' +
  ' style="display:inline-block;vertical-align:middle;flex-shrink:0"' +
  ' aria-hidden="true">' +
  '<text' +
  ' x="6.5"' +
  ' y="9"' +
  ' text-anchor="middle"' +
  ' dominant-baseline="middle"' +
  ' font-family="-apple-system,BlinkMacSystemFont,\'SF Pro Text\',\'Helvetica Neue\',sans-serif"' +
  ' font-size="13"' +
  ' font-weight="400"' +
  ' fill="currentColor"' +
  '>⌘</text>' +
  '</svg>';

/** Same, for a three-character label: narrower per char, smaller font. */
const DEL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"' +
  ' width="23" height="16"' +
  ' viewBox="0 0 23 16"' +
  ' style="display:inline-block;vertical-align:middle;flex-shrink:0"' +
  ' aria-hidden="true">' +
  '<text' +
  ' x="11.5"' +
  ' y="9"' +
  ' text-anchor="middle"' +
  ' dominant-baseline="middle"' +
  ' font-family="-apple-system,BlinkMacSystemFont,\'SF Pro Text\',\'Helvetica Neue\',sans-serif"' +
  ' font-size="11"' +
  ' font-weight="400"' +
  ' fill="currentColor"' +
  '>Del</text>' +
  '</svg>';

const OPEN = '<span style="display:inline-flex;align-items:center;line-height:1">';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makeShortcutHtml', () => {
  it('renders a single-char glyph as the exact 13x16 SVG', () => {
    expect(makeShortcutHtml('⌘')).toBe(`${OPEN}${CMD_SVG}</span>`);
  });

  it('renders a multi-char label narrower and at the smaller font size', () => {
    expect(makeShortcutHtml('Del')).toBe(`${OPEN}${DEL_SVG}</span>`);
  });

  it('concatenates tokens with no separator between the SVGs', () => {
    const html = makeShortcutHtml('⌘ + Del');

    expect(html).toBe(`${OPEN}${CMD_SVG}${DEL_SVG}</span>`);
    expect(html).not.toContain('Stryker');
  });

  it('splits concatenated modifier symbols into separate glyphs', () => {
    const html = makeShortcutHtml('⌃⌘L');

    expect(html.match(/<svg/gu)).toHaveLength(3);
    expect(html).toContain('>⌃</text>');
    expect(html).toContain('>⌘</text>');
    expect(html).toContain('>L</text>');
  });

  it('returns the input untouched when it tokenizes to nothing', () => {
    expect(makeShortcutHtml('')).toBe('');
    expect(makeShortcutHtml('   ')).toBe('   ');
  });

  it('drops whitespace-only tokens instead of rendering empty glyphs', () => {
    // "⌘ " tokenizes to ['⌘', ' ']; the blank one must not become a 0-wide SVG.
    const html = makeShortcutHtml('⌘ ');

    expect(html).toBe(`${OPEN}${CMD_SVG}</span>`);
    expect(html).not.toContain('width="0"');
  });

  it.each([
    ['ctrl', '⌃'],
    ['alt', '⌥'],
    ['shift', '⇧'],
    ['enter', '↵'],
    ['backspace', '⌫'],
    ['escape', '⎋'],
    ['esc', '⎋'],
    ['delete', '⌦'],
    ['tab', '⇥'],
    ['win', '⊞'],
    ['␡', '⌦'],
  ])('maps %s to its canonical glyph', (name, glyph) => {
    expect(makeShortcutHtml(name)).toContain(`>${glyph}</text>`);
  });

  it('resolves a mixed-case key name through the lowercase map', () => {
    // 'Ctrl' misses the exact-case map and must fall through to 'ctrl'.
    expect(makeShortcutHtml('Ctrl')).toContain('>⌃</text>');
    expect(makeShortcutHtml('CTRL')).toContain('>⌃</text>');
  });

  it('passes an unmapped token through as its own label', () => {
    expect(makeShortcutHtml('F5')).toContain('>F5</text>');
  });
});

describe('shortcutToReadable', () => {
  it.each([
    ['⌘', 'Command'],
    ['⇧', 'Shift'],
    ['⌥', 'Option'],
    ['⌃', 'Control'],
    ['⌫', 'Backspace'],
    ['⌦', 'Delete'],
    ['⏎', 'Return'],
    ['↵', 'Return'],
    ['⎋', 'Escape'],
    ['⇥', 'Tab'],
    ['↑', 'Up'],
    ['↓', 'Down'],
    ['←', 'Left'],
    ['→', 'Right'],
    ['⊞', 'Win'],
  ])('expands %s to %s', (glyph, name) => {
    expect(shortcutToReadable(glyph)).toBe(name);
  });

  it('joins expanded tokens with a plus sign', () => {
    expect(shortcutToReadable('⌃⌘L')).toBe('Control+Command+L');
    expect(shortcutToReadable('⌘ + C')).toBe('Command+C');
  });

  it('uppercases plain letter and number tokens', () => {
    expect(shortcutToReadable('b')).toBe('B');
    expect(shortcutToReadable('⌘ + 1')).toBe('Command+1');
  });

  it('resolves a mixed-case short label through the lowercase map', () => {
    // 'Del' misses the exact-case map; only the lowercase pass yields 'Delete'.
    expect(shortcutToReadable('Del')).toBe('Delete');
    expect(shortcutToReadable('Ins')).toBe('Insert');
  });

  it('returns the input untouched when it tokenizes to nothing', () => {
    expect(shortcutToReadable('')).toBe('');
    expect(shortcutToReadable('  ')).toBe('  ');
  });
});

describe('shortcutToAriaKeyshortcuts', () => {
  it.each([
    ['⌘', 'Meta'],
    ['cmd', 'Meta'],
    ['command', 'Meta'],
    ['win', 'Meta'],
    ['⊞', 'Meta'],
    ['⌃', 'Control'],
    ['ctrl', 'Control'],
    ['control', 'Control'],
    ['⌥', 'Alt'],
    ['alt', 'Alt'],
    ['option', 'Alt'],
    ['⇧', 'Shift'],
    ['shift', 'Shift'],
    ['⌫', 'Backspace'],
    ['⌦', 'Delete'],
    ['del', 'Delete'],
    ['⏎', 'Enter'],
    ['↵', 'Enter'],
    ['return', 'Enter'],
    ['⎋', 'Escape'],
    ['esc', 'Escape'],
    ['⇥', 'Tab'],
    ['↑', 'ArrowUp'],
    ['↓', 'ArrowDown'],
    ['←', 'ArrowLeft'],
    ['→', 'ArrowRight'],
    ['ins', 'Insert'],
    ['insert', 'Insert'],
  ])('maps %s to the UI-Events value %s', (token, key) => {
    expect(shortcutToAriaKeyshortcuts(token)).toBe(key);
  });

  it('joins mapped tokens with a plus sign', () => {
    expect(shortcutToAriaKeyshortcuts('⌃⌘L')).toBe('Control+Meta+L');
  });

  it('resolves a mixed-case key name through the lowercase map', () => {
    // 'Cmd' misses the exact-case map; only the lowercase pass yields 'Meta'.
    expect(shortcutToAriaKeyshortcuts('Cmd')).toBe('Meta');
    expect(shortcutToAriaKeyshortcuts('Del')).toBe('Delete');
  });

  it('uppercases a single-char token but leaves a longer one alone', () => {
    expect(shortcutToAriaKeyshortcuts('Space')).toBe('Space');
    expect(shortcutToAriaKeyshortcuts('b')).toBe('B');
    expect(shortcutToAriaKeyshortcuts('⌘ + f1')).toBe('Meta+f1');
  });

  it('returns the input untouched when it tokenizes to nothing', () => {
    expect(shortcutToAriaKeyshortcuts('')).toBe('');
    expect(shortcutToAriaKeyshortcuts(' ')).toBe(' ');
  });
});
