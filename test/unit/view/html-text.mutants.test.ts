import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type * as Html from '../../../src/html';

const parser = vi.hoisted(() => ({ throwNext: null as Error | null }));

vi.mock('../../../src/html', async (importOriginal) => {
  const actual = await importOriginal<typeof Html>();

  return {
    ...actual,
    parseFragment: (html: string): ReturnType<typeof actual.parseFragment> => {
      if (parser.throwNext !== null) {
        const failure = parser.throwNext;

        parser.throwNext = null;
        throw failure;
      }

      return actual.parseFragment(html);
    },
  };
});

import {
  htmlTextContent,
  needsTokenizing,
  parseInlineFragment,
  repairSurrogates,
} from '../../../src/view/html-text';

/**
 * Two survivors are equivalent: both mutants of the `html === ''` half of the
 * fast path. The empty string carries none of the characters the tokenizer acts
 * on, so the second half already returns it verbatim — whichever way the first
 * half answers.
 */
describe('html text mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parser.throwNext = null;
  });

  afterEach(() => {
    parser.throwNext = null;
    vi.restoreAllMocks();
  });

  describe('reading text out of a fragment', () => {
    it('decodes entities and turns a break into a newline', () => {
      expect(htmlTextContent('a &lt; b<br>c')).toBe('a < b\nc');
    });

    // An inline equation reads as its source: the children are a KaTeX cache.
    it('reads an equation as its source attribute', () => {
      expect(htmlTextContent('<span data-latex="x^2">rendered junk</span>&nbsp;')).toContain('x^2');
    });

    // A comment has neither attributes nor children, which is the only node
    // shape that reaches the empty fallback.
    it('contributes nothing for a comment', () => {
      expect(htmlTextContent('a<!-- note -->b')).toBe('ab');
    });

    it('returns markup-free text without tokenizing it', () => {
      expect(needsTokenizing('plain text')).toBe(false);
      expect(htmlTextContent('plain text')).toBe('plain text');
      expect(htmlTextContent('')).toBe('');
    });
  });

  describe('repairing surrogates', () => {
    it('keeps a valid pair and replaces a lone one', () => {
      expect(repairSurrogates('a😀b')).toBe('a😀b');
      expect(repairSurrogates('a\uD800b')).toBe('a�b');
    });
  });

  describe('retrying a refused parse', () => {
    it('repairs and retries when the parser refuses the input outright', () => {
      parser.throwNext = new RangeError('bad input');

      expect(parseInlineFragment('a\uD800b').childNodes).toHaveLength(1);
    });

    it('lets any other failure through', () => {
      parser.throwNext = new TypeError('something else');

      expect(() => parseInlineFragment('a&amp;b')).toThrow(TypeError);
    });
  });
});
