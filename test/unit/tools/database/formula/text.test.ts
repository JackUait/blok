import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileError, run } from './helpers';

describe('formula text functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['substring("Notion", 0, 3)', 'Not'],
    ['substring("Notion", 3)', 'ion'],
    ['contains("Notion", "ot")', true],
    ['contains("Notion", "x")', false],
    ['test("Notion", "Not")', true],
    ['test("Notion", "\\\\d")', false],
    ['match("Notion Notion", "Not")', ['Not', 'Not']],
    ['match("Notion 123 Notion 456", "\\\\d+")', ['123', '456']],
    ['match("Notion", "x")', []],
    ['replace("Notion Notion", "N", "M")', 'Motion Notion'],
    ['replaceAll("Notion Notion", "N", "M")', 'Motion Motion'],
    ['replaceAll("Notion 123", "\\\\d", "")', 'Notion '],
    ['lower("NOTION")', 'notion'],
    ['upper("notion")', 'NOTION'],
    ['repeat("0", 4)', '0000'],
    ['repeat("~=", 10)', '~=~=~=~=~=~=~=~=~=~='],
    ['split("apple,pear,orange", ",")', ['apple', 'pear', 'orange']],
    ['join(["a", "b", "c"], ", ")', 'a, b, c'],
    ['join(["dog", "go"], "")', 'doggo'],
    ['join([1, 2], "-")', '1-2'],
    ['"   notion   ".trim()', 'notion'],
    ['padStart("7", 3, "0")', '007'],
    ['padEnd("7", 3, "0")', '700'],
  ])('%s = %j', (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it('returns empty when the pattern is not a valid regular expression', () => {
    expect(run('test("a", "(")')).toBeNull();
  });

  it('wraps text in a link', () => {
    expect(run('link("Notion", "https://notion.so")')).toEqual({
      kind: 'richText', runs: [{ text: 'Notion', styles: [], link: 'https://notion.so' }],
    });
  });

  it('adds styles and colors, ignoring ones the docs do not list', () => {
    expect(run('style("Notion", "b", "u")')).toEqual({ kind: 'richText', runs: [{ text: 'Notion', styles: ['b', 'u'] }] });
    expect(run('style("Notion", "blue", "gray_background", "sparkle")')).toEqual({
      kind: 'richText', runs: [{ text: 'Notion', styles: ['blue', 'gray_background'] }],
    });
  });

  it('removes all styles, or only the named ones', () => {
    expect(run('unstyle(style("Text", "b", "i"))')).toBe('Text');
    expect(run('unstyle(style("Text", "b", "i"), "b")')).toEqual({ kind: 'richText', runs: [{ text: 'Text', styles: ['i'] }] });
  });

  it('keeps styled runs when text is joined with +', () => {
    expect(run('"Revenue: " + style("$5", "green")')).toEqual({
      kind: 'richText', runs: [{ text: 'Revenue: ', styles: [] }, { text: '$5', styles: ['green'] }],
    });
  });

  it('reads styled text as plain text in other text functions', () => {
    expect(run('length(style("abc", "b"))')).toBe(3);
    expect(run('style("abc", "b") == "abc"')).toBe(true);
  });

  it('formats numbers with formatNumber', () => {
    expect(run('formatNumber(1234.5, "usd", 0)')).toBe('$1,235');
    expect(run('formatNumber(-1234.5, "usd")')).toBe('-$1,234.50');
    expect(run('formatNumber(1234567.891, "number_with_commas")')).toBe('1,234,567.891');
    expect(run('formatNumber(0.5, "percent")')).toBe('50%');
    expect(run('formatNumber(2.345, "number", 1)')).toBe('2.3');
    expect(run('formatNumber(1, "doubloons")')).toBeNull();
  });

  it.each([
    ['concat("a", "b")', 'Argument 1 of concat() expects a list, got Text'],
    ['slice("abc", 1)', 'Argument 1 of slice() expects a list, got Text'],
    ['lower(1)', 'Argument 1 of lower() expects Text, got Number'],
    ['repeat("a", "b")', 'Argument 2 of repeat() expects Number, got Text'],
  ])('%s fails with "%s"', (source, message) => {
    expect(compileError(source)).toBe(message);
  });
});
