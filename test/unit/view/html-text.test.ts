// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type * as Parse5 from 'parse5';

/**
 * parse5 is spied on rather than replaced: the fast path is only worth having if
 * the tokenizer is genuinely never entered, and a real parse still has to run for
 * every case the fast path must not claim.
 */
const parseFragmentCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('parse5', async (importOriginal) => {
  const actual = await importOriginal<typeof Parse5>();

  return {
    ...actual,
    parseFragment: (...args: Parameters<typeof actual.parseFragment>) => {
      parseFragmentCalls.count += 1;

      return actual.parseFragment(...args);
    },
  };
});

const { htmlTextContent } = await import('../../../src/view/html-text');
const { blocksToMarkdown } = await import('../../../src/view/blocks-to-markdown');
const { blocksToPlainText } = await import('../../../src/view/blocks-to-plain-text');
const { blocksToHtml } = await import('../../../src/view/blocks-to-html');

describe('htmlTextContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseFragmentCalls.count = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('reads a field without tokenizing it when there is nothing to tokenize', () => {
    it.each([
      ['plain prose', 'The quick brown fox'],
      ['a bare greater-than', 'a > b'],
      ['a tab and a form feed', 'a\tb\fc'],
      ['a non-breaking space', 'a\u00a0b'],
      ['an emoji', 'ship it \u{1F680}'],
      ['a lone surrogate', 'a\ud800b'],
      ['trailing whitespace', 'hi   '],
      ['a newline', 'first\nsecond'],
    ])('%s', (_name, text) => {
      expect(htmlTextContent(text)).toBe(text);
      expect(parseFragmentCalls.count).toBe(0);
    });
  });

  /**
   * The four characters parse5's input-stream preprocessing acts on. Anything
   * carrying one has to take the real parse, or the fast path would return a
   * string parse5 would have changed.
   */
  describe('still tokenizes a field parse5 would rewrite', () => {
    it.each([
      ['a tag', 'a <b>bold</b> word', 'a bold word'],
      ['an entity', 'a &amp; b', 'a & b'],
      ['a carriage return', 'a\r\nb', 'a\nb'],
      ['a lone carriage return', 'a\rb', 'a\nb'],
      ['a NUL', 'a\u0000b', 'ab'],
    ])('%s', (_name, text, expected) => {
      expect(htmlTextContent(text)).toBe(expected);
      expect(parseFragmentCalls.count).toBeGreaterThan(0);
    });
  });
});

/**
 * parse5 throws `RangeError: Invalid code point` for two adjacent low
 * surrogates — the shape a truncated UTF-16 paste leaves behind. One such field
 * must cost that field, not the whole document: the server runtime converts
 * stored articles, where an abort means an article that can never be read
 * again rather than a request someone can retry.
 */
describe('a field parse5 cannot tokenize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseFragmentCalls.count = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const broken = 'before \udc00\udc01 after';

  it('degrades to the raw field instead of throwing', () => {
    expect(htmlTextContent(broken)).toContain('after');
  });

  it('does not stop the blocks around it from reading', () => {
    const text = blocksToPlainText({
      blocks: [
        { type: 'paragraph', data: { text: 'first' } },
        { type: 'paragraph', data: { text: `a <b>x</b> ${broken}` } },
        { type: 'paragraph', data: { text: 'last' } },
      ],
    });

    expect(text).toContain('first');
    expect(text).toContain('last');
  });

  it('does not stop a document from rendering to HTML', () => {
    const html = blocksToHtml({
      blocks: [
        { type: 'paragraph', data: { text: `a <b>x</b> ${broken}` } },
        { type: 'paragraph', data: { text: 'last' } },
      ],
    });

    expect(html).toContain('last');
  });

  it('does not stop a document from serializing to Markdown', () => {
    const markdown = blocksToMarkdown({
      blocks: [
        { type: 'paragraph', data: { text: `a <b>x</b> ${broken}` } },
        { type: 'paragraph', data: { text: 'last' } },
      ],
    });

    expect(markdown).toContain('last');
  });
});

describe('blocksToMarkdown inline reading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseFragmentCalls.count = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The markdown serializer reads inline HTML through its own `parseFragment`
   * call, not through `htmlTextContent`, so it needs the fast path of its own.
   * A lone text node serializes to its raw value with no Markdown escaping, so
   * passthrough is what the tokenizer would have produced anyway.
   */
  it('does not tokenize a paragraph that carries no markup', () => {
    const markdown = blocksToMarkdown({
      blocks: [
        { type: 'paragraph', data: { text: 'The quick brown fox' } },
        { type: 'header', data: { text: 'A plain heading', level: 2 } },
      ],
    });

    expect(markdown).toBe('The quick brown fox\n\n## A plain heading');
    expect(parseFragmentCalls.count).toBe(0);
  });

  it('tokenizes a paragraph that carries markup', () => {
    const markdown = blocksToMarkdown({
      blocks: [{ type: 'paragraph', data: { text: 'a <b>bold</b> word' } }],
    });

    expect(markdown).toBe('a **bold** word');
    expect(parseFragmentCalls.count).toBeGreaterThan(0);
  });
});
