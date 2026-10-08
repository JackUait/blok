// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure } from '../../../../src/shared/agent/errors';
import { KNOWN_MARKS, richTextHelpers as rt } from '../../../../src/shared/agent/rich-text-ops';
import type { TextRange } from '../../../../types/agent';
import type { RichText, RichTextMarks } from '../../../../types/rich-text';

const failureOf = (operation: () => unknown): AgentFailure => {
  try {
    operation();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error;
    }

    throw error;
  }

  throw new Error('Expected an AgentFailure.');
};

const value: RichText = [
  { text: 'Hello ' },
  { text: 'bold', marks: { bold: true } },
  { embed: { equation: { expression: 'x' } } },
  { text: ' end' },
];

const knownMarkKeys: { [Key in Exclude<keyof RichTextMarks, `tag:${string}`>]: true } = {
  bold: true,
  italic: true,
  underline: true,
  strikethrough: true,
  code: true,
  sup: true,
  sub: true,
  highlight: true,
  color: true,
  background: true,
  link: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rich text helpers', () => {
  it('counts UTF-16 units and one unit for each embed shape', () => {
    const rich: RichText = [
      { text: 'a😀' },
      { embed: { equation: { expression: 'x + y' } } },
      { embed: { page: { id: 'page-1' } } },
      { embed: { html: '<img src="x">' } },
      { text: '\nb' },
    ];

    expect(rt.length(rich)).toBe(8);
    expect(rt.plainText(rich)).toBe('a😀￼￼￼\nb');
    expect(rt.length(value)).toBe(15);
  });

  it('slices across text runs and keeps an embed with its marks', () => {
    const rich: RichText = [
      { text: 'ab', marks: { bold: true } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      { text: 'cd', marks: { link: { href: '/page', target: '_self', rel: 'author' } } },
    ];

    expect(rt.slice(rich, 1, 4)).toStrictEqual([
      { text: 'b', marks: { bold: true } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      { text: 'c', marks: { link: { href: '/page', target: '_self', rel: 'author' } } },
    ]);
    expect(rt.slice(rich, 2, 3)).toStrictEqual([
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
    ]);
  });

  it('formats across segment edges without dropping existing marks', () => {
    expect(rt.format(value, 3, 8, { italic: true })).toStrictEqual([
      { text: 'Hel' },
      { text: 'lo ', marks: { italic: true } },
      { text: 'bo', marks: { bold: true, italic: true } },
      { text: 'ld', marks: { bold: true } },
      { embed: { equation: { expression: 'x' } } },
      { text: ' end' },
    ]);
  });

  it('applies marks to an embed without changing its payload', () => {
    const rich: RichText = [
      { text: 'a' },
      { embed: { equation: { expression: 'x^2' } }, marks: { bold: true } },
      { text: 'b' },
    ];

    expect(rt.format(rich, 1, 2, { italic: true })).toStrictEqual([
      { text: 'a' },
      { embed: { equation: { expression: 'x^2' } }, marks: { bold: true, italic: true } },
      { text: 'b' },
    ]);
  });

  it('unsets marks and merges newly equal neighbours', () => {
    expect(rt.format(value, 0, 15, undefined, ['bold'])).toStrictEqual([
      { text: 'Hello bold' },
      { embed: { equation: { expression: 'x' } } },
      { text: ' end' },
    ]);
  });

  it('sets link, colour and custom marks while unsetting only named keys', () => {
    const rich: RichText = [{
      text: 'abcd',
      marks: { bold: true, color: 'red', 'tag:abbr': { title: 'old' } },
    }];

    expect(rt.format(rich, 1, 3, {
      background: 'yellow',
      link: { href: '/target', target: '_self', rel: 'author' },
      'tag:abbr': { title: 'new' },
    }, ['bold', 'color'])).toStrictEqual([
      { text: 'a', marks: { bold: true, color: 'red', 'tag:abbr': { title: 'old' } } },
      {
        text: 'bc',
        marks: {
          background: 'yellow',
          link: { href: '/target', target: '_self', rel: 'author' },
          'tag:abbr': { title: 'new' },
        },
      },
      { text: 'd', marks: { bold: true, color: 'red', 'tag:abbr': { title: 'old' } } },
    ]);
    expect(rt.format(rich, 0, 4, undefined, ['tag:abbr'])).toStrictEqual([
      { text: 'abcd', marks: { bold: true, color: 'red' } },
    ]);
  });

  it('removes a mark that is both set and unset', () => {
    expect(rt.format([{ text: 'ab', marks: { bold: true } }], 0, 2, {
      bold: true,
      italic: true,
    }, ['bold'])).toStrictEqual([{ text: 'ab', marks: { italic: true } }]);
  });

  it('inserts marked text inside a marked run without inheriting its marks', () => {
    expect(rt.insert([{ text: 'abcd', marks: { bold: true } }], 2, [
      { text: 'X', marks: { italic: true } },
      { text: 'Y' },
    ])).toStrictEqual([
      { text: 'ab', marks: { bold: true } },
      { text: 'X', marks: { italic: true } },
      { text: 'Y' },
      { text: 'cd', marks: { bold: true } },
    ]);
  });

  it('inserts on either side of an embed and merges equal text runs', () => {
    expect(rt.insert(value, 10, [{ text: '!', marks: { bold: true } }])).toStrictEqual([
      { text: 'Hello ' },
      { text: 'bold!', marks: { bold: true } },
      { embed: { equation: { expression: 'x' } } },
      { text: ' end' },
    ]);
    expect(rt.insert(value, 11, [{ text: '!' }])).toStrictEqual([
      { text: 'Hello ' },
      { text: 'bold', marks: { bold: true } },
      { embed: { equation: { expression: 'x' } } },
      { text: '! end' },
    ]);
  });

  it('inserts an embed without flattening its payload or marks', () => {
    expect(rt.insert([{ text: 'ab' }], 1, [
      { embed: { html: '<img src="x">' }, marks: { link: { href: '/image' } } },
    ])).toStrictEqual([
      { text: 'a' },
      { embed: { html: '<img src="x">' }, marks: { link: { href: '/image' } } },
      { text: 'b' },
    ]);
  });

  it('removes exactly one embed unit', () => {
    expect(rt.remove(value, 10, 11)).toStrictEqual([
      { text: 'Hello ' },
      { text: 'bold', marks: { bold: true } },
      { text: ' end' },
    ]);
  });

  it('removes across runs and an embed and merges equal surviving neighbours', () => {
    const rich: RichText = [
      { text: 'ab', marks: { bold: true } },
      { text: 'cd', marks: { italic: true } },
      { embed: { equation: { expression: 'x' } } },
      { text: 'ef', marks: { bold: true } },
    ];

    expect(rt.remove(rich, 1, 6)).toStrictEqual([{ text: 'af', marks: { bold: true } }]);
    expect(rt.remove(rich, 0, 7)).toStrictEqual([]);
  });

  it('keeps empty ranges inert and supports document endpoints', () => {
    expect(rt.slice(value, 10, 10)).toStrictEqual([]);
    expect(rt.remove(value, 10, 10)).toStrictEqual(value);
    expect(rt.format(value, 10, 10, { italic: true })).toStrictEqual(value);
    expect(rt.insert(value, 0, [{ text: 'Start ' }])).toStrictEqual([
      { text: 'Start Hello ' },
      { text: 'bold', marks: { bold: true } },
      { embed: { equation: { expression: 'x' } } },
      { text: ' end' },
    ]);
    expect(rt.insert(value, 15, [{ text: '!' }])).toStrictEqual([
      { text: 'Hello ' },
      { text: 'bold', marks: { bold: true } },
      { embed: { equation: { expression: 'x' } } },
      { text: ' end!' },
    ]);
  });

  it('canonicalizes equal nested marks without flattening embeds', () => {
    const rich: RichText = [
      { text: '', marks: { bold: true } },
      { text: 'a', marks: { link: { href: '/p', target: '_self' }, 'tag:abbr': { title: 't', class: 'c' } } },
      { text: 'b', marks: { 'tag:abbr': { class: 'c', title: 't' }, link: { target: '_self', href: '/p' } } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      { text: 'c', marks: {} },
      { text: 'd' },
    ];

    expect(rt.canonicalize(rich)).toStrictEqual([
      { text: 'ab', marks: { link: { href: '/p', target: '_self' }, 'tag:abbr': { class: 'c', title: 't' } } },
      { embed: { page: { id: 'page-1' } }, marks: { italic: true } },
      { text: 'cd' },
    ]);
  });

  it('does not mutate frozen segments, nested marks, embeds or inserted content', () => {
    const link = { href: '/p', target: '_self', rel: 'author' };
    const attributes = { title: 'word' };
    const equation = { expression: 'x' };
    const embed = { equation };
    const marks: RichTextMarks = { bold: true, link, 'tag:abbr': attributes };
    const rich: RichText = [{ text: 'abcd', marks }, { embed, marks: { italic: true } }];
    const inserted: RichText = [{ text: 'XY', marks: { underline: true } }];
    const set: RichTextMarks = { background: 'yellow' };
    const unset = ['bold', 'tag:abbr'];
    const before = JSON.stringify({ rich, inserted, set, unset });

    for (const segment of [...rich, ...inserted]) {
      if (segment.marks !== undefined) {
        Object.freeze(segment.marks);
      }
      Object.freeze(segment);
    }
    Object.freeze(link);
    Object.freeze(attributes);
    Object.freeze(equation);
    Object.freeze(embed);
    Object.freeze(rich);
    Object.freeze(inserted);
    Object.freeze(set);
    Object.freeze(unset);

    expect(rt.format(rich, 1, 5, set, unset)).toStrictEqual([
      { text: 'a', marks: { bold: true, link: { href: '/p', target: '_self', rel: 'author' }, 'tag:abbr': { title: 'word' } } },
      { text: 'bcd', marks: { background: 'yellow', link: { href: '/p', target: '_self', rel: 'author' } } },
      { embed: { equation: { expression: 'x' } }, marks: { italic: true, background: 'yellow' } },
    ]);
    expect(rt.slice(rich, 1, 5)).toStrictEqual([
      { text: 'bcd', marks: { bold: true, link: { href: '/p', target: '_self', rel: 'author' }, 'tag:abbr': { title: 'word' } } },
      { embed: { equation: { expression: 'x' } }, marks: { italic: true } },
    ]);
    expect(rt.insert(rich, 2, inserted)).toStrictEqual([
      { text: 'ab', marks: { bold: true, link: { href: '/p', target: '_self', rel: 'author' }, 'tag:abbr': { title: 'word' } } },
      { text: 'XY', marks: { underline: true } },
      { text: 'cd', marks: { bold: true, link: { href: '/p', target: '_self', rel: 'author' }, 'tag:abbr': { title: 'word' } } },
      { embed: { equation: { expression: 'x' } }, marks: { italic: true } },
    ]);
    expect(rt.remove(rich, 1, 4)).toStrictEqual([
      { text: 'a', marks: { bold: true, link: { href: '/p', target: '_self', rel: 'author' }, 'tag:abbr': { title: 'word' } } },
      { embed: { equation: { expression: 'x' } }, marks: { italic: true } },
    ]);
    expect(rt.canonicalize(rich)).toStrictEqual(rich);
    expect(JSON.stringify({ rich, inserted, set, unset })).toBe(before);
  });

  it('exposes exactly the built-in public mark keys', () => {
    expect([...KNOWN_MARKS].sort()).toStrictEqual(Object.keys(knownMarkKeys).sort());
    expect(KNOWN_MARKS.has('tag:abbr')).toBe(false);
  });
});

describe('rich text range resolution', () => {
  it('resolves the first and requested occurrences across segment boundaries', () => {
    const twice: RichText = [
      { text: 'a ' },
      { text: 'b a', marks: { bold: true } },
      { text: ' b' },
    ];

    expect(rt.resolve(twice, { find: 'b' })).toStrictEqual({ start: 2, end: 3 });
    expect(rt.resolve(twice, { find: 'b', occurrence: 1 })).toStrictEqual({ start: 2, end: 3 });
    expect(rt.resolve(twice, { find: 'b', occurrence: 2 })).toStrictEqual({ start: 6, end: 7 });
    expect(rt.resolve(twice, { find: 'b a b' })).toStrictEqual({ start: 2, end: 7 });
  });

  it('resolves all and exact ranges without returning expectText', () => {
    expect(rt.resolve(value, 'all')).toStrictEqual({ start: 0, end: 15 });
    expect(rt.resolve(value, { start: 6, end: 10, expectText: 'bold' })).toStrictEqual({ start: 6, end: 10 });
    expect(rt.resolve(value, { start: 10, end: 11, expectText: '￼' })).toStrictEqual({ start: 10, end: 11 });
    expect(rt.resolve(value, { find: 'bold￼ end' })).toStrictEqual({ start: 6, end: 15 });
  });

  it('supports an empty field and empty endpoint ranges', () => {
    expect(rt.resolve([], 'all')).toStrictEqual({ start: 0, end: 0 });
    expect(rt.resolve([], { start: 0, end: 0, expectText: '' })).toStrictEqual({ start: 0, end: 0 });
    expect(rt.resolve(value, { start: 0, end: 0, expectText: '' })).toStrictEqual({ start: 0, end: 0 });
    expect(rt.resolve(value, { start: 15, end: 15 })).toStrictEqual({ start: 15, end: 15 });
  });

  it.each([
    { find: 'missing' },
    { find: 'bold', occurrence: 2 },
  ])('reports the field text when $find is not found often enough', range => {
    const failure = failureOf(() => rt.resolve(value, range));

    expect(failure.error.code).toBe('RANGE_NOT_FOUND');
    expect(failure.error.details).toStrictEqual({ text: 'Hello bold￼ end' });
  });

  it('returns useful fresh text when expectText is stale', () => {
    const failure = failureOf(() => rt.resolve(value, { start: 0, end: 5, expectText: 'Jello' }));

    expect(failure.error.details).toStrictEqual({ current: { text: 'Hello bold￼ end' } });
    expect(failure.error.code).toBe('STALE');
    expect(failure.error.retryable).toBe(true);
  });

  it.each([
    { start: -1, end: 2 },
    { start: 0, end: -1 },
    { start: 5, end: 2 },
    { start: 4, end: 99 },
    { start: 16, end: 16 },
    { start: 0.5, end: 2 },
    { start: 0, end: 2.5 },
    { start: NaN, end: 2 },
    { start: 0, end: Infinity },
  ] satisfies TextRange[])('rejects offsets $start..$end outside the UTF-16 contract', range => {
    expect(failureOf(() => rt.resolve(value, range)).error.code).toBe('RANGE_OUT_OF_BOUNDS');
  });

  it.each([
    { start: 2, end: 3 },
    { start: 1, end: 2 },
    { start: 2, end: 2 },
  ] satisfies TextRange[])('rejects either edge inside a surrogate pair: $start..$end', range => {
    const emoji: RichText = [{ text: 'a😀b' }];

    expect(failureOf(() => rt.resolve(emoji, range)).error.code).toBe('RANGE_OUT_OF_BOUNDS');
  });

  it('accepts whole surrogate pairs and operations using their resolved edges', () => {
    const emoji: RichText = [{ text: 'a😀b', marks: { bold: true } }];
    const range = rt.resolve(emoji, { start: 1, end: 3, expectText: '😀' });

    expect(range).toStrictEqual({ start: 1, end: 3 });
    expect(rt.length(emoji)).toBe(4);
    expect(rt.slice(emoji, range.start, range.end)).toStrictEqual([{ text: '😀', marks: { bold: true } }]);
    expect(rt.remove(emoji, range.start, range.end)).toStrictEqual([{ text: 'ab', marks: { bold: true } }]);
    expect(rt.format(emoji, range.start, range.end, { italic: true })).toStrictEqual([
      { text: 'a', marks: { bold: true } },
      { text: '😀', marks: { bold: true, italic: true } },
      { text: 'b', marks: { bold: true } },
    ]);
  });

  it('checks surrogate boundaries across differently marked segment edges', () => {
    const emoji: RichText = [{ text: 'a\uD83D', marks: { bold: true } }, { text: '\uDE00b', marks: { italic: true } }];

    expect(failureOf(() => rt.resolve(emoji, { start: 2, end: 3 })).error.code).toBe('RANGE_OUT_OF_BOUNDS');
    expect(rt.resolve(emoji, { find: '😀' })).toStrictEqual({ start: 1, end: 3 });
  });

  it.each(['\uD83D', '\uDE00', 'a\uD83D', '\uDE00b'])('rejects a find result that splits a surrogate pair: %j', find => {
    const emoji: RichText = [{ text: 'a😀b' }];

    expect(failureOf(() => rt.resolve(emoji, { find })).error.code).toBe('RANGE_OUT_OF_BOUNDS');
  });

  it('resolves a repeated full emoji in UTF-16 units', () => {
    const emoji: RichText = [{ text: 'a😀b' }, { text: '😀', marks: { bold: true } }];

    expect(rt.resolve(emoji, { find: '😀', occurrence: 2 })).toStrictEqual({ start: 4, end: 6 });
  });

  it.each(['', '   ', '\t\n'])('rejects a blank find: %j', find => {
    expect(failureOf(() => rt.resolve(value, { find })).error.code).toBe('INVALID_ARGS');
  });

  it.each([0, -1, 1.5, NaN, Infinity])('rejects an occurrence outside positive integers: %s', occurrence => {
    expect(failureOf(() => rt.resolve(value, { find: 'e', occurrence })).error.code).toBe('INVALID_ARGS');
  });
});
